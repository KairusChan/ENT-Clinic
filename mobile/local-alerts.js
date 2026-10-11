// Supabase provides updates while the WebView runs; Android owns downloaded reminders.
export class LocalDoctorAlerts {
    constructor(native, client, staff, storage = localStorage) {
        this.native = native;
        this.client = client;
        this.staff = staff;
        this.storage = storage;
        this.stopped = false;
        this.stateKey = `ent-local-alerts:${staff.id}`;
        try { this.previous = JSON.parse(storage.getItem(this.stateKey) || 'null'); } catch { this.previous = null; }
    }
    async enable() {
        if (this.staff.role !== 'doctor') throw Error('Sign in as a doctor to enable alerts.');
        let permission = await this.native.checkPermissions();
        if (permission.display !== 'granted') permission = await this.native.requestPermissions();
        if (permission.display !== 'granted') throw Error('Allow notifications in Android app settings, then try again.');
        await this.native.createChannel({id:'doctor-local', name:'Doctor alerts', description:'Patient queue and downloaded schedule reminders', importance:4, visibility:0, vibration:true});
        await this.refresh();
        return 'Doctor alerts enabled. Downloaded reminders can appear with the app closed. Open the app to receive new bookings, queue arrivals, and cancellations.';
    }
    refresh() {
        if (this.stopped) return Promise.resolve();
        if (this.running) { this.again = true; return this.running; }
        this.running = (async () => {
            do { this.again = false; await this.sync(); } while (this.again && !this.stopped);
        })().finally(() => { this.running = null; });
        return this.running;
    }
    async sync() {
        if ((await this.native.checkPermissions()).display !== 'granted' || this.stopped) return;
        const now = new Date();
        const start = new Date(now); start.setHours(0,0,0,0);
        const horizon = new Date(now.getTime() + 30 * 86400000);
        const visits = [];
        for (let offset = 0; ; offset += 500) {
            const {data, error} = await this.client.from('visits')
                .select('id, doctor_id, kind, status, checked_in_at, ends_at, reminder_minutes, clinic_location')
                .eq('doctor_id', this.staff.id).gte('checked_in_at', start.toISOString())
                .lte('checked_in_at', horizon.toISOString()).order('id').range(offset, offset + 499);
            if (error) throw error;
            visits.push(...(data || []));
            if (!data || data.length < 500) break;
        }
        if (this.stopped) return;
        const pending = (await this.native.getPending()).notifications;
        const managed = pending.filter(item => item.extra?.source === 'ent-doctor');
        const desired = [];
        const snapshots = {};
        let arrivals = 0, changes = 0;
        for (const visit of visits) {
            if (visit.doctor_id !== this.staff.id) continue;
            const key = String(visit.id);
            const fingerprint = JSON.stringify([visit.kind, visit.status, visit.checked_in_at, visit.ends_at, visit.reminder_minutes, visit.clinic_location]);
            snapshots[key] = fingerprint;
            const today = new Date(visit.checked_in_at).toDateString() === now.toDateString();
            if (visit.kind === 'appointment' && visit.status === 'waiting' && today && this.previous?.[key] !== fingerprint) arrivals++;
            if (!['operation', 'event'].includes(visit.kind)) continue;
            if (this.previous && this.previous[key] !== fingerprint) changes++;
            const reminderExpiry = visit.ends_at ? new Date(visit.ends_at) : new Date(new Date(visit.checked_in_at).getTime() + 86400000);
            if (visit.status !== 'scheduled' || reminderExpiry <= now) continue;
            const due = new Date(visit.checked_in_at).getTime() - (visit.reminder_minutes || 15) * 60000;
            // Due reminders are delivered once, not rescheduled at every refresh.
            const reminderKey = `reminder:${key}:${visit.checked_in_at}:${visit.reminder_minutes}`;
            if (due <= now.getTime() && this.wasDelivered(reminderKey) && !managed.some(item => item.extra.doctorId === this.staff.id && item.extra.key === reminderKey)) continue;
            desired.push({key:reminderKey, at:Math.max(due, now.getTime() + 1500), route:'schedule', immediate:due <= now.getTime()});
        }
        // A secretary cancellation can delete a booking instead of changing its status.
        for (const [key, fingerprint] of Object.entries(this.previous || {})) {
            if (snapshots[key]) continue;
            try {
                const [kind, status, begins, ends] = JSON.parse(fingerprint);
                const expiry = ends ? new Date(ends) : new Date(new Date(begins).getTime() + 86400000);
                if (['operation', 'event'].includes(kind) && status === 'scheduled' && new Date(begins) >= start && expiry > now) changes++;
            } catch {}
        }
        const retain = new Set(desired.map(item => item.key));
        const obsolete = managed.filter(item => item.extra.doctorId !== this.staff.id || !retain.has(item.extra.key));
        if (obsolete.length) await this.native.cancel({notifications:obsolete.map(({id}) => ({id}))});
        const used = new Set(pending.map(item => item.id));
        const nextId = () => { let id = Math.floor(Math.random() * 2000000000) + 1; while (used.has(id)) id = id % 2000000000 + 1; used.add(id); return id; };
        const notifications = [];
        for (const item of desired) {
            if (managed.some(n => n.extra.doctorId === this.staff.id && n.extra.key === item.key)) continue;
            notifications.push(this.notification(nextId(), item.key, 'Clinic schedule reminder', 'Open My Schedule to review your upcoming operation or event.', item.route, item.at));
        }
        if (arrivals) notifications.push(this.notification(nextId(), `queue:${Date.now()}`, 'Patient queue updated', `${arrivals} patient(s) waiting. Open Today’s Patients to review.`, 'queue'));
        if (changes) notifications.push(this.notification(nextId(), `change:${Date.now()}`, 'Clinic schedule updated', 'Open My Schedule to review your operations and events.', 'schedule'));
        if (this.stopped) return;
        if (notifications.length) await this.native.schedule({notifications});
        for (const item of desired) this.markDelivered(item.key);
        this.previous = snapshots;
        try { this.storage.setItem(this.stateKey, JSON.stringify(snapshots)); } catch {}
    }
    notification(id, key, title, body, route, at) {
        return {id, title, body, channelId:'doctor-local', smallIcon:'ic_stat_clinic',
            ...(at ? {schedule:{at:new Date(at), allowWhileIdle:true}} : {}),
            extra:{source:'ent-doctor', doctorId:this.staff.id, key, route}};
    }
    wasDelivered(key) {
        try { return this.storage.getItem(`${this.stateKey}:${key}`) === '1'; } catch { return false; }
    }
    markDelivered(key) {
        try { this.storage.setItem(`${this.stateKey}:${key}`, '1'); } catch {}
    }
    async disconnect() {
        this.stopped = true;
        try { await this.running; } catch {}
        await clearDoctorNotifications(this.native);
        try { this.storage.removeItem(this.stateKey); } catch {}
    }
}

export async function clearDoctorNotifications(native) {
    const pending = (await native.getPending()).notifications.filter(item => item.extra?.source === 'ent-doctor');
    if (pending.length) await native.cancel({notifications:pending.map(({id}) => ({id}))});
    await native.removeAllDeliveredNotifications();
}
