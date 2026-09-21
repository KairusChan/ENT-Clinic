class ScheduleAlerts {
    constructor(controller) {
        this.controller = controller;
        this.client = window.entSupabase;
        this.staff = window.entStaff;
        this.button = document.getElementById('enable-schedule-alerts');
        this.connection = document.getElementById('schedule-live-status');
        this.permission = document.getElementById('schedule-alert-permission');
        this.toast = document.getElementById('schedule-alert-toast');
        this.seen = new Set();
    }
    init() {
        this.button.addEventListener('click', () => this.enable());
        document.getElementById('dismiss-schedule-alert').addEventListener('click', () => { this.toast.hidden = true; });
        this.showPermission();
        this.channel = this.client.channel(`doctor-schedule-${this.staff.id}`)
            .on('postgres_changes', {event: '*', schema: 'public', table: 'visits', filter: `doctor_id=eq.${this.staff.id}`}, payload => this.changed(payload))
            .subscribe(status => {
                this.connection.textContent = status === 'SUBSCRIBED' ? 'Live updates connected' : 'Live updates reconnecting; checking every 30 seconds';
                if (status === 'SUBSCRIBED') this.reload();
            });
        this.visibilityHandler = () => { if (!document.hidden) { this.showPermission(); this.reload(); } };
        document.addEventListener('visibilitychange', this.visibilityHandler);
        window.addEventListener('pagehide', () => this.stop(), {once: true});
    }
    reload() {
        if (this.controller.loading) this.controller.refreshPending = true;
        else this.controller.refresh();
    }
    changed(payload) {
        this.reload();
        const visit = payload.new;
        if (!visit || visit.doctor_id !== this.staff.id || !['operation', 'event'].includes(visit.kind)) return;
        const key = `change:${visit.id}:${visit.updated_at || payload.commit_timestamp}:${visit.status}`;
        const label = visit.kind === 'operation' ? 'Operation' : 'Event';
        this.deliver(key, `${label} ${visit.status === 'cancelled' ? 'cancelled' : payload.eventType === 'INSERT' ? 'booked' : 'updated'}`, 'Your schedule has changed. Review My Schedule for details.');
    }
    remind(visits) {
        visits.forEach(visit => {
            if (!['operation', 'event'].includes(visit.kind)) return;
            this.deliver(`due:${visit.id}:${visit.checked_in_at}:${visit.reminder_minutes}`, 'Schedule reminder', `${visit.kind === 'operation' ? 'An operation' : 'An event'} is due at ${new Date(visit.checked_in_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}. Open My Schedule for details.`);
        });
    }
    deliver(key, title, body) {
        const storageKey = `ent-alert:${this.staff.id}:${key}`;
        if (this.seen.has(key)) return;
        try { if (sessionStorage.getItem(storageKey)) { this.seen.add(key); return; } } catch {}
        this.seen.add(key);
        try { sessionStorage.setItem(storageKey, '1'); } catch {}
        document.getElementById('schedule-alert-title').textContent = title;
        document.getElementById('schedule-alert-body').textContent = body;
        this.toast.hidden = false;
        if ('Notification' in window && Notification.permission === 'granted') {
            try {
                const notification = new Notification(title, {body, tag: key});
                notification.onclick = () => { window.focus(); notification.close(); };
            } catch { /* In-page alerts remain available where system notifications are unsupported. */ }
        }
    }
    showPermission() {
        if (window.entNativePush) {
            this.button.disabled = false;
            this.button.textContent = 'Enable phone notifications';
            this.permission.textContent = 'Allow Android notifications for schedule updates, including when the app is closed.';
            return;
        }
        if (!('Notification' in window) || !window.isSecureContext) {
            this.button.disabled = true;
            this.permission.textContent = 'Live in-app alerts are on. Device alerts require a supported browser over HTTPS or the mobile app.';
            return;
        }
        const granted = Notification.permission === 'granted';
        this.button.disabled = granted;
        this.button.textContent = granted ? 'Browser alerts enabled' : 'Enable browser alerts';
        this.permission.textContent = granted ? 'Browser alerts work while this page is running. Closed-app phone alerts require push setup.' : Notification.permission === 'denied' ? 'Notifications are blocked. Allow them in your browser settings, then return here.' : 'Allow browser notifications for schedule changes and reminders while this page is running.';
    }
    async enable() {
        if (window.entNativePush) {
            this.button.disabled = true;
            try {
                await window.entNativePush.enable();
                this.permission.textContent = 'Phone registered. Background delivery requires the clinic push sender to be running.';
            } catch (error) { this.permission.textContent = error.message; }
            finally { this.button.disabled = false; }
            return;
        }
        try { await Notification.requestPermission(); this.showPermission(); }
        catch { this.permission.textContent = 'Unable to enable browser notifications. Live in-app alerts are still on.'; }
    }
    stop() {
        if (this.channel) this.client.removeChannel(this.channel);
        document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
}
window.ScheduleAlerts = ScheduleAlerts;
