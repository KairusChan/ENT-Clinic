class AppointmentController {
    constructor() {
        this.client = window.entSupabase;
        this.form = document.getElementById('appointment-form');
        this.status = document.getElementById('appointment-status');
    }
    async init() {
        if (!['secretary', 'admin'].includes(window.entStaff?.role)) { this.form.hidden = true; return; }
        this.form.addEventListener('submit', event => this.save(event));
        this.picker = new window.PatientPicker(document.getElementById('patient-picker'), this.client);
        await this.picker.init();
        try {
            const {data, error} = await this.client.from('staff').select('id, full_name')
                .eq('role', 'doctor').eq('is_active', true).order('full_name');
            if (error) throw error;
            data.forEach(doctor => document.getElementById('appointment-doctor').add(new Option(doctor.full_name, doctor.id)));
            if (!data.length) this.status.textContent = 'No active doctors are available.';
        } catch (error) { this.status.textContent = `Unable to load doctors: ${error.message}`; }
    }
    async save(event) {
        event.preventDefault();
        const button = this.form.querySelector('[type="submit"]');
        if (button.disabled) return;
        const fields = Object.fromEntries(new FormData(this.form));
        if (!fields.patient_id || !fields.doctor_id || !fields.reason.trim()) {
            this.status.textContent = 'Choose a patient and doctor, and enter the reason for consultation.';
            return;
        }
        button.disabled = true;
        this.status.textContent = 'Adding consultation…';
        try {
            // Keep the existing database kind so historical consultations and doctor filters remain compatible.
            const {error} = await this.client.from('visits').insert({
                patient_id: fields.patient_id, doctor_id: fields.doctor_id,
                reason: fields.reason.trim(), kind: 'appointment', status: 'waiting'
            });
            if (error) throw error;
            window.location.href = 'queue.html';
        } catch (error) {
            this.status.textContent = `Unable to confirm the consultation. Check today's queue before retrying. ${error.message || ''}`;
            button.disabled = false;
        }
    }
}
document.addEventListener('DOMContentLoaded', async () => {
    if (!await window.entSessionReady) return;
    new AppointmentController().init();
});
