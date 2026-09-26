class ScheduleController {
    constructor() {
        this.client = window.entSupabase;
        this.form = document.getElementById('booking-form');
        this.date = document.getElementById('schedule-date');
        this.results = document.getElementById('schedule-results');
        this.status = document.getElementById('schedule-status');
        this.reminders = document.getElementById('schedule-reminders');
        this.kinds = document.getElementById('schedule-panel')?.dataset?.scheduleKinds?.split(',');
        this.cardView = document.getElementById('schedule-panel')?.dataset?.scheduleView === 'cards';
        this.canBook = ['secretary', 'admin'].includes(window.entStaff.role);
    }
    localDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    async init() {
        this.date.value = this.localDate(new Date());
        this.date.addEventListener('change', () => this.refresh());
        if (this.form && this.canBook) {
            this.form.addEventListener('submit', event => this.book(event));
            const kind = document.getElementById('booking-kind');
            this.picker = new window.PatientPicker(document.getElementById('patient-picker'), this.client);
            const updatePatientRequirement = () => { this.picker.input.required = kind.value !== 'event'; };
            kind.addEventListener('change', updatePatientRequirement);
            this.form.addEventListener('reset', () => { this.picker.input.required = true; });
            updatePatientRequirement();
            await this.loadOptions();
        } else if (this.form) this.form.hidden = true;
        if (this.cardView && window.entStaff.role === 'doctor' && window.ScheduleAlerts) {
            this.alerts = new window.ScheduleAlerts(this);
            this.alerts.init();
        }
        await this.refresh();
        this.timer = setInterval(() => this.refresh(), 30000);
        window.addEventListener('pagehide', () => clearInterval(this.timer), { once: true });
    }
    async loadOptions() {
        const status = document.getElementById('booking-status');
        try {
            const [, doctors] = await Promise.all([
                this.picker.init(),
                this.client.from('staff').select('id, full_name').eq('role', 'doctor').eq('is_active', true).order('full_name')
            ]);
            if (doctors.error) throw doctors.error;
            doctors.data.forEach(doctor => document.getElementById('booking-doctor').add(new Option(doctor.full_name, doctor.id)));
            if (!doctors.data.length) status.textContent = 'No active doctors are available for booking.';
        } catch (error) { status.textContent = error.message; }
    }
    query() {
        let query = this.client.from('visits').select('id, patient_id, doctor_id, kind, reason, status, checked_in_at, ends_at, reminder_minutes, clinic_location, patients(first_name, middle_name, last_name, suffix), staff!visits_doctor_id_fkey(full_name)');
        if (window.entStaff.role === 'doctor') query = query.eq('doctor_id', window.entStaff.id);
        if (this.kinds) query = query.in('kind', this.kinds);
        return query;
    }
    async refresh() {
        if (this.loading || !this.date.value) return;
        this.loading = true;
        try {
            const start = new Date(`${this.date.value}T00:00:00`);
            const end = new Date(start);
            end.setDate(end.getDate() + 1);
            const now = new Date();
            const horizon = new Date(now.getTime() + 86400000);
            const [schedule, upcoming] = await Promise.all([
                this.query().gte('checked_in_at', start.toISOString()).lt('checked_in_at', end.toISOString()).order('checked_in_at'),
                this.query().eq('status', 'scheduled').gt('ends_at', now.toISOString()).lte('checked_in_at', horizon.toISOString()).order('checked_in_at')
            ]);
            if (schedule.error || upcoming.error) throw schedule.error || upcoming.error;
            this.results.innerHTML = schedule.data.length ? schedule.data.map(visit => this.render(visit)).join('') : '<p>No scheduled items on this date.</p>';
            this.results.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => this.update(button)));
            const due = upcoming.data.filter(visit => new Date(visit.checked_in_at).getTime() - now.getTime() <= visit.reminder_minutes * 60000);
            this.reminders.innerHTML = due.length ? '<h3>Schedule reminders</h3>' + due.map(visit => `<p><strong>${this.escape(this.kindLabel(visit.kind))}</strong>: ${this.escape(this.name(visit.patients) || visit.reason || 'Event')} with ${this.escape(visit.staff?.full_name || 'Doctor')} — ${this.escape(new Date(visit.checked_in_at).toLocaleString())}${new Date(visit.checked_in_at) <= now ? ' (due now)' : ''}</p>`).join('') : '<p>No scheduled items due for a reminder.</p>';
            this.alerts?.remind(due);
            this.status.textContent = '';
        } catch (error) {
            this.status.textContent = `Unable to refresh schedule: ${error.message}`;
            this.reminders.textContent = 'Reminders unavailable until the schedule reconnects.';
        } finally {
            this.loading = false;
            if (this.refreshPending) { this.refreshPending = false; this.refresh(); }
        }
    }
    renderCard(visit) {
        const kind = visit.kind === 'operation' ? 'operation' : 'event';
        const time = value => this.escape(new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        const patient = this.name(visit.patients);
        const title = visit.reason || patient || (kind === 'operation' ? 'Operation' : 'Event');
        return `<article class="schedule-item ${kind}-item">
            <div class="schedule-item-time"><strong>${time(visit.checked_in_at)}</strong>${visit.ends_at ? `<span>to ${time(visit.ends_at)}</span>` : ''}</div>
            <div class="schedule-item-detail"><div class="schedule-item-labels"><span class="schedule-kind">${kind === 'operation' ? 'Operation' : 'Event'}</span><span class="schedule-state">${this.escape(visit.status.replaceAll('_', ' '))}</span></div>
                <h3>${this.escape(title)}</h3>${patient && patient !== title ? `<p class="schedule-patient">${this.escape(patient)}</p>` : ''}
                <div class="schedule-item-facts"><span><small>Location</small>${this.escape(visit.clinic_location || 'Not specified')}</span><span><small>Doctor</small>${this.escape(visit.staff?.full_name || 'Unassigned')}</span></div>
            </div>
            ${visit.patient_id ? `<a class="outline schedule-patient-link" href="profile.html?id=${encodeURIComponent(visit.patient_id)}">View patient &rarr;</a>` : ''}
        </article>`;
    }
    render(visit) {
        if (this.cardView && !this.canBook) return this.renderCard(visit);
        const scheduled = visit.status === 'scheduled';
        const arrivedToday = this.localDate(new Date(visit.checked_in_at)) === this.localDate(new Date());
        return `<div class="result schedule-row"><div class="result-info"><strong>${this.escape(this.name(visit.patients) || visit.reason || 'Event')} · ${this.escape(this.kindLabel(visit.kind))}</strong><small>${this.escape(new Date(visit.checked_in_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}${visit.ends_at ? ' – ' + this.escape(new Date(visit.ends_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})) : ''} · ${this.escape(visit.staff?.full_name || 'Unassigned')} · ${this.escape(visit.clinic_location || '')}</small><small>${this.escape(visit.reason || '')}</small></div><span class="status">${this.escape(visit.status.replaceAll('_', ' '))}</span>${visit.patient_id ? `<a class="outline" href="profile.html?id=${encodeURIComponent(visit.patient_id)}">View Patient</a>` : ''}${this.canBook && scheduled ? `${arrivedToday && visit.kind !== 'event' ? `<button type="button" class="small" data-id="${visit.id}" data-action="waiting">Add to Queue</button>` : ''}<button type="button" class="outline" data-id="${visit.id}" data-action="cancelled">Cancel</button>` : ''}</div>`;
    }
    async book(event) {
        event.preventDefault();
        const button = this.form.querySelector('button[type="submit"]');
        if (button.disabled) return;
        const status = document.getElementById('booking-status');
        const fields = Object.fromEntries(new FormData(this.form));
        if (!['operation', 'event'].includes(fields.kind)) {
            status.textContent = 'Choose Operation or Event. Use Add Appointment for a consultation.';
            return;
        }
        if (!fields.starts_at || !fields.ends_at) {
            status.textContent = 'Saving without a time is not supported yet. No schedule has been saved.';
            return;
        }
        const start = new Date(fields.starts_at);
        const end = new Date(fields.ends_at);
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start < new Date() || end <= start) {
            status.textContent = 'Choose a future start time and an end time after the start.';
            return;
        }
        if (fields.kind !== 'event' && !fields.patient_id) {
            status.textContent = 'Select a patient for an operation.';
            return;
        }
        button.disabled = true;
        status.textContent = 'Booking...';
        try {
            const { error } = await this.client.from('visits').insert({
                patient_id: fields.patient_id || null, doctor_id: fields.doctor_id, kind: fields.kind,
                reason: fields.reason.trim(), clinic_location: fields.clinic_location?.trim() || null,
                checked_in_at: start.toISOString(), ends_at: end.toISOString(),
                reminder_minutes: 15, status: 'scheduled'
            });
            if (error) throw error;
            status.textContent = 'Booked. The appointment is now on the doctor’s schedule.';
            this.form.reset();
            this.date.value = this.localDate(start);
            await this.refresh();
        } catch (error) {
            status.textContent = error.code === '23P01' ? 'This doctor already has a booking during that time. Choose another time.' : error.message;
        } finally { button.disabled = false; }
    }
    async update(button) {
        button.disabled = true;
        try {
            const { error } = button.dataset.action === 'cancelled'
                ? await this.client.rpc('cancel_visit', { p_visit_id: button.dataset.id, p_expected_status: 'scheduled' })
                : await this.client.from('visits').update({status: button.dataset.action}).eq('id', button.dataset.id).eq('status', 'scheduled');
            if (error) throw error;
            await this.refresh();
        } catch (error) { this.status.textContent = error.message; }
        finally { button.disabled = false; }
    }
    kindLabel(kind) { return !kind || kind === 'appointment' ? 'Consultation' : kind === 'operation' ? 'Operation' : 'Event'; }
    name(patient) { return [patient?.first_name, patient?.middle_name, patient?.last_name, patient?.suffix].filter(Boolean).join(' '); }
    escape(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
}
document.addEventListener('DOMContentLoaded', async () => {
    if (!await window.entSessionReady) return;
    new ScheduleController().init();
});
