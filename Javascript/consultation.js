class ConsultationController {
    constructor() {
        this.client = window.entSupabase;
        this.visitId = new URLSearchParams(window.location.search).get('visit_id');
        this.form = document.getElementById('consultation-form');
        this.fields = document.getElementById('note-fields');
        this.status = document.getElementById('consultation-status');
        this.saveButton = document.getElementById('save-notes');
        this.names = ['subjective', 'objective', 'assessment', 'plan', 'recommendation', 'medication', 'referral', 'admitting_orders', 'pf'];
        // Keep the existing database field compatible with saved notes and RPCs.
        this.storageName = name => name === 'medication' ? 'diagnostic' : name;
        this.storedNames = [...this.names.map(this.storageName), 'history', 'rx'];
        this.printLabels = {recommendation: 'Recommendation', medication: 'Medication', referral: 'Referral', admitting_orders: 'Admitting Orders'};
        this.dirty = false;
        this.saving = false;
    }
    async init() {
        if (window.entStaff?.role !== 'doctor' || !this.visitId) {
            this.status.textContent = 'Open a patient consultation from the doctor queue.';
            return;
        }
        this.form.addEventListener('submit', event => this.save(event));
        this.form.addEventListener('input', () => { this.dirty = true; this.updatePrintButtons(); });
        document.querySelectorAll('[data-print-note]').forEach(button => button.addEventListener('click', () => this.printSection(button.dataset.printNote)));
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
                .select('id, patient_id, doctor_id, kind, reason, status, checked_in_at, patients(first_name, middle_name, last_name, suffix, date_of_birth, sex, address, allergies)')
                .eq('id', this.visitId).eq('doctor_id', window.entStaff.id).eq('kind', 'appointment').maybeSingle();
            if (error) throw error;
            if (!visit) throw new Error('Consultation not found or not assigned to you.');
            const patient = visit.patients || {};
            this.printPatient = patient;
            this.visitDate = visit.checked_in_at;
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
                this.names.forEach(name => { this.form.elements[name].value = note[this.storageName(name)] || ''; });
                this.originalNotes = Object.fromEntries(this.storedNames.map(name => [name, note[name] || '']));
                this.fields.disabled = false;
                this.saveButton.disabled = false;
                this.saveButton.textContent = 'Save Changes';
                this.updatePrintButtons();
                this.status.textContent = 'Saved notes are ready to print. Save any changes before printing.';
                return;
            }
            if (visit.status !== 'with_doctor') throw new Error(visit.status === 'completed' ? 'No consultation notes were recorded for this completed visit.' : 'Accept this patient from Today’s Patients before writing notes.');
            this.fields.disabled = false;
            this.saveButton.disabled = false;
            this.status.textContent = 'Enter your notes and PF, then save to complete the consultation and return to the queue.';
        } catch (error) { this.status.textContent = error.message || 'Unable to load the consultation. Please reopen it from the queue.'; }
    }
    updatePrintButtons() {
        document.querySelectorAll('[data-print-note]').forEach(button => {
            button.hidden = !this.originalNotes;
            button.disabled = !this.originalNotes || this.dirty || this.saving || !this.originalNotes[this.storageName(button.dataset.printNote)]?.trim();
            button.title = this.dirty ? 'Save changes before printing.' : 'Print this saved section.';
        });
    }
    async printSection(name) {
        if (!Object.hasOwn(this.printLabels, name) || !this.originalNotes || this.dirty || this.saving) return;
        const content = this.originalNotes[this.storageName(name)];
        if (!content?.trim()) return;
        const printout = document.getElementById('consultation-printout');
        printout.replaceChildren();
        if (name === 'medication' || name === 'referral') {
            const images = this.renderLetterhead(printout, name, content);
            try {
                await Promise.all(images.map(image => image.decode ? image.decode() : Promise.resolve()));
            } catch {
                this.status.textContent = 'Print artwork could not load. Please reopen the consultation and try again.';
                return;
            }
            window.print();
            return;
        }
        const append = (tag, text) => {
            const element = document.createElement(tag);
            element.textContent = text;
            printout.appendChild(element);
        };
        append('h1', 'ENT Clinic');
        append('p', document.getElementById('consultation-patient').textContent);
        append('p', document.getElementById('consultation-details').textContent);
        append('p', 'Consultation #' + this.visitId);
        append('pre', content);
        window.print();
    }
    renderLetterhead(printout, name, content) {
        const add = (parent, tag, className, text) => {
            const element = document.createElement(tag);
            element.className = className;
            if (text !== undefined) element.textContent = text;
            parent.appendChild(element);
            return element;
        };
        const sheet = add(printout, 'div', 'letterhead-sheet');
        const header = add(sheet, 'header', 'letterhead-header');
        const logo = add(header, 'img', 'letterhead-symbol');
        logo.src = '../css/images/clinic-caduceus.png';
        logo.alt = 'Winged medical emblem';
        const heading = add(header, 'div', 'letterhead-heading');
        add(heading, 'h1', '', 'ALDRIN BUTZ E. BAMBA, MD, DPBO-HNS');
        add(heading, 'strong', '', 'Diplomate, Otorhinolaryngology - Head and Neck Surgery');
        add(heading, 'div', '', 'Specialist in Ears, Nose, Throat, Sinuses, Mouth and Throat Diseases');
        for (const line of ['Tumor Surgery of the Head and Neck', 'Voice, Swallowing and Breathing Disorders', 'Diagnostic and Therapeutic Upper Aerodigestive Tract Endoscopy', 'Hearing and Balance Disorders', 'Cleft Lip and Palate Surgery', 'Facial Trauma, Maxillofacial and Reconstructive Surgery of the Head and Neck']) add(heading, 'div', '', line);
        const patient = this.printPatient || {};
        const visitDate = new Date(this.visitDate);
        const validDate = !Number.isNaN(visitDate.getTime());
        const birth = patient.date_of_birth ? new Date(patient.date_of_birth + 'T00:00:00') : null;
        let age = '';
        if (birth && !Number.isNaN(birth.getTime()) && validDate && birth <= visitDate) {
            age = visitDate.getFullYear() - birth.getFullYear();
            if (visitDate.getMonth() < birth.getMonth() || (visitDate.getMonth() === birth.getMonth() && visitDate.getDate() < birth.getDate())) age--;
        }
        const details = add(sheet, 'div', 'letterhead-patient');
        const field = (label, value) => {
            const row = add(details, 'div', 'letterhead-field');
            add(row, 'span', '', label + ':');
            add(row, 'span', 'letterhead-value', value);
        };
        field('Name', document.getElementById('consultation-patient').textContent);
        field('Date', validDate ? visitDate.toLocaleDateString('en-PH', {year:'numeric',month:'short',day:'numeric'}) : '');
        field('Address', patient.address || '');
        field('Age/Sex', [age, patient.sex || ''].filter(value => value !== '').join(' / '));
        const body = add(sheet, 'div', 'letterhead-body');
        const rx = add(body, 'img', 'letterhead-rx');
        rx.src = '../css/images/prescription-rx.png';
        rx.alt = 'Rx';
        add(body, 'pre', 'letterhead-content', content);
        const closing = add(sheet, 'footer', 'letterhead-closing');
        const signature = add(closing, 'div', 'letterhead-signature');
        add(signature, 'strong', 'letterhead-signature-name', 'Aldrin Butz E. Bamba, MD, DPBOHNS');
        add(signature, 'div', '', 'License No. : 0135273');
        add(signature, 'div', '', 'PTR No. : ____________________');
        add(signature, 'div', '', 'S2 No. : _____________________');
        const clinics = add(closing, 'div', 'letterhead-clinics');
        for (const lines of [
            ['UB Healthcare Clinic', 'Mc Arthur Hiway, San Francisco, Mabalacat City', 'Tuesday - Thursday - Saturday', '9:00am to 12:00nn', 'Secretary: 0917-139-6050'],
            ['St. Catherine of Alexandria Foundation', 'and Medical Center, Room 106', 'Rizal Street Ext., Brgy. Cutcut, Angeles City', 'Wednesday & Friday 1:00pm to 4:00pm', 'Secretary: 0991-481-7667'],
            ['Maxicare Primary Care Clinic', 'G/F, SM City Clark, Tech Hub 6', 'M.A. Roxas Hiway, Angeles City', 'Friday 4:00pm to 7:00pm', 'Sunday 7:00am to 10:00am']
        ]) {
            const clinic = add(clinics, 'div', 'letterhead-clinic');
            lines.forEach((line, index) => add(clinic, index === 0 ? 'strong' : 'div', '', line));
        }
        return [logo, rx];
    }
    async save(event) {
        event.preventDefault();
        if (this.saving || this.saveButton.disabled) return;
        // Retain retired fields when editing a saved note; the database still expects them.
        const notes = Object.fromEntries(this.storedNames.map(name => [name,
            (name === 'diagnostic' || this.names.includes(name)) ? this.form.elements[name === 'diagnostic' ? 'medication' : name].value.trim() : (this.originalNotes?.[name] || '')
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
            this.originalNotes = {...notes};
            this.fields.disabled = false;
            this.saveButton.disabled = false;
            this.saveButton.textContent = 'Save Changes';
            document.getElementById('consultation-state').textContent = 'completed';
            this.status.textContent = 'Notes saved. Returning to the patient queue...';
            window.location.href = 'queue.html';
        } catch (error) {
            this.status.textContent = `Unable to confirm the save. Your notes remain here; retry Save Notes to confirm. ${error.message || ''}`;
            this.fields.disabled = false;
            this.saveButton.disabled = false;
        } finally { this.saving = false; this.updatePrintButtons(); }
    }
}
document.addEventListener('DOMContentLoaded', async () => {
    if (!await window.entSessionReady) return;
    new ConsultationController().init();
});
