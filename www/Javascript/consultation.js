class ConsultationController {
    constructor() {
        this.client = window.entSupabase;
        this.visitId = new URLSearchParams(window.location.search).get('visit_id');
        this.form = document.getElementById('consultation-form');
        this.fields = document.getElementById('note-fields');
        this.status = document.getElementById('consultation-status');
        this.saveButton = document.getElementById('save-notes');
        this.names = ['subjective', 'objective', 'assessment', 'plan', 'referral', 'recommendation', 'admitting_orders', 'pf', 'diagnostic'];
        this.storedNames = [...this.names, 'history', 'rx'];
        this.dirty = false;
        this.saving = false;
    }
    async init() {
        if (window.entStaff?.role !== 'doctor' || !this.visitId) {
            this.status.textContent = 'Open a patient consultation from the doctor queue.';
            return;
        }
        document.querySelectorAll('[data-note-preset]').forEach(button => button.addEventListener('click', () => this.addSection(button.dataset.notePreset)));
        this.form.addEventListener('submit', event => this.save(event));
        this.form.addEventListener('input', () => { this.dirty = true; });
        window.addEventListener('beforeunload', event => {
            if (this.dirty) { event.preventDefault(); event.returnValue = ''; }
        });
        document.querySelectorAll('a').forEach(link => link.addEventListener('click', event => {
            if (this.saving || (this.dirty && !window.confirm('Leave this consultation without saving your notes?'))) {
                event.preventDefault();
                event.stopImmediatePropagation();
            } else {
                this.dirty = false;
            }
        }, true));
        try {
            const {data: visit, error} = await this.client.from('visits')
                .select('id, patient_id, doctor_id, kind, reason, status, checked_in_at, patients(first_name, middle_name, last_name, suffix, date_of_birth, sex, allergies)')
                .eq('id', this.visitId).eq('doctor_id', window.entStaff.id).eq('kind', 'appointment').maybeSingle();
            if (error) throw error;
            if (!visit) throw new Error('Consultation not found or not assigned to you.');
            const patient = visit.patients || {};
            document.getElementById('consultation-patient').textContent = [patient.first_name, patient.middle_name, patient.last_name, patient.suffix].filter(Boolean).join(' ') || 'Patient';
            document.getElementById('consultation-details').textContent = `Birthdate: ${patient.date_of_birth || 'Not provided'} · Patient #${visit.patient_id} · ${new Date(visit.checked_in_at).toLocaleString()}`;
            document.getElementById('consultation-reason').textContent = visit.reason || 'Not provided';
            document.getElementById('consultation-allergies').textContent = patient.allergies || 'Not recorded';
            document.getElementById('consultation-state').textContent = visit.status.replaceAll('_', ' ');
            document.getElementById('patient-record-link').href = `profile.html?id=${encodeURIComponent(visit.patient_id)}`;
            const {data: note, error: noteError} = await this.client.from('Notes').select('*').eq('visit_id', this.visitId).maybeSingle();
            if (noteError) {
                // Let an accepted doctor draft notes even when note storage is unavailable.
                // Saving stays disabled until storage has loaded successfully.
                if (visit.status === 'with_doctor') this.fields.disabled = false;
                throw new Error(`${visit.status === 'with_doctor' ? 'You can draft notes, but saving is unavailable until note storage is connected.' : 'Unable to load saved notes.'} ${noteError.message}`);
            }
            if (note) {
                this.names.forEach(name => { this.form.elements[name].value = note[name] || ''; if (note[name]) this.showSection(name); });
                this.originalNotes = Object.fromEntries(this.storedNames.map(name => [name, note[name] || '']));
                this.fields.disabled = false;
                this.saveButton.disabled = false;
                this.saveButton.textContent = 'Save Changes';
                this.status.textContent = 'You can edit these consultation notes. Save Changes updates the notes and returns to today’s patients.';
                return;
            }
            if (visit.status !== 'with_doctor') throw new Error(visit.status === 'completed' ? 'No consultation notes were recorded for this completed visit.' : 'Accept this patient from Today’s Patients before writing notes.');
            this.fields.disabled = false;
            this.saveButton.disabled = false;
            this.status.textContent = 'Enter the relevant sections. Save Notes completes the consultation and returns to today’s patients.';
        } catch (error) { this.status.textContent = error.message || 'Unable to load the consultation. Please reopen it from the queue.'; }
    }
    showSection(name) {
        document.getElementById(`section-${name}`).hidden = false;
        document.querySelectorAll('[data-note-preset]').forEach(button => {
            if (button.dataset.notePreset === name) button.setAttribute('aria-expanded', 'true');
        });
    }
    addSection(name) {
        if (this.fields.disabled || this.saving || !this.names.includes(name)) return;
        this.showSection(name);
        this.form.elements[name].focus();
    }
    async save(event) {
        event.preventDefault();
        if (this.saving || this.saveButton.disabled) return;
        // Retain retired fields when editing a saved note; the database still expects them.
        const notes = Object.fromEntries(this.storedNames.map(name => [name,
            this.names.includes(name) ? this.form.elements[name].value.trim() : (this.originalNotes?.[name] || '')
        ]));
        if (!Object.values(notes).some(Boolean)) { this.status.textContent = 'Enter consultation notes before saving.'; return; }
        if (Object.values(notes).some(value => value.length > 20000)) { this.status.textContent = 'Each section must be at most 20,000 characters.'; return; }
        this.saving = true;
        this.fields.disabled = true;
        this.saveButton.disabled = true;
        this.status.textContent = 'Saving consultation notes…';
        try {
            const procedure = this.originalNotes ? 'update_consultation_notes' : 'save_consultation_notes';
            const args = { p_visit_id: this.visitId, p_notes: notes };
            if (this.originalNotes) args.p_expected_notes = this.originalNotes;
            const {error} = await this.client.rpc(procedure, args);
            if (error) throw error;
            this.dirty = false;
            window.location.href = 'queue.html';
        } catch (error) {
            this.status.textContent = `Unable to confirm the save. Your notes remain here; retry Save Notes to confirm. ${error.message || ''}`;
            this.fields.disabled = false;
            this.saveButton.disabled = false;
        } finally { this.saving = false; }
    }
}
document.addEventListener('DOMContentLoaded', async () => {
    if (!await window.entSessionReady) return;
    new ConsultationController().init();
});
