class PatientProfileController {
    constructor() {
        this.patientId = new URLSearchParams(window.location.search).get('id');
        this.header = document.getElementById('patient-header');
        this.details = document.getElementById('patient-details');
        this.visits = document.getElementById('patient-visits');
        this.newVisitLinks = document.querySelectorAll('.form-actions a[href="appointment.html"]');
        this.client = window.entSupabase;
    }

    init() {
        if (!this.patientId) {
            this.setMessage('No patient was selected. Return to search and choose a patient.');
            return;
        }

        this.newVisitLinks.forEach((link) => {
            link.href = `appointment.html?patient_id=${encodeURIComponent(this.patientId)}`;
        });
        this.loadPatient();
    }

    async loadPatient() {
        if (!this.client) {
            this.setMessage('Add your Supabase URL and anon key in Javascript/supabase-config.js first.');
            return;
        }

        const { data: patient, error: patientError } = await this.client
            .from('patients')
            .select('*')
            .eq('id', this.patientId)
            .maybeSingle();

        if (patientError || !patient) {
            this.setMessage(patientError?.message || 'Patient record not found.');
            return;
        }

        this.renderPatient(patient);
        this.renderPictures(patient);
        this.loadVisits();
    }

    renderPictures(patient) {
        const root = document.getElementById('patient-pictures');
        const editorRoot = document.createElement('div');
        root.replaceChildren(editorRoot);
        const editable = ['admin', 'secretary'].includes(window.entStaff?.role);
        const pictures = new window.PatientPictures(editorRoot, patient.record_pictures || [], editable);
        if (!editable) return;
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'primary';
        save.textContent = 'Save pictures';
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        root.append(save, status);
        save.addEventListener('click', async () => {
            if (pictures.busy) { status.textContent = 'Wait for the pictures to finish preparing.'; return; }
            save.disabled = true;
            pictures.busy = true;
            pictures.render();
            try {
                const storedPictures = await pictures.upload(this.client);
                const { data, error } = await this.client.from('patients')
                    .update({ record_pictures: storedPictures })
                    .eq('id', this.patientId).eq('updated_at', patient.updated_at)
                    .select('updated_at').maybeSingle();
                if (error) throw error;
                if (!data) throw new Error('This patient was changed elsewhere. Reload the profile before saving pictures.');
                patient.updated_at = data.updated_at;
                status.textContent = 'Pictures saved.';
            } catch (error) { status.textContent = error.message || 'Unable to save pictures. Please try again.'; }
            finally { save.disabled = false; pictures.busy = false; pictures.render(); }
        });
    }

    async loadVisits() {
        const { data: visits, error } = await this.client
            .from('visits')
            .select('id, clinic_location, reason, status, checked_in_at, doctor_id, kind')
            .eq('patient_id', this.patientId)
            .order('checked_in_at', { ascending: false });

        if (error) {
            this.visits.innerHTML = `<p>${this.escapeHtml(error.message)}</p>`;
            return;
        }

        if (!visits?.length) {
            this.visits.innerHTML = '<p>No visits have been recorded for this patient.</p>';
            return;
        }

        let notes = [];
        let notesUnavailable = false;
        try {
            const result = await this.client.from('Notes').select('*').eq('patient_id', this.patientId);
            if (result.error) throw result.error;
            notes = result.data || [];
        } catch {
            notesUnavailable = true;
        }
        const notesByVisit = new Map(notes.map(note => [String(note.visit_id), note]));
        this.visits.innerHTML = visits.map((visit, index) => this.renderVisit(
            visit, notesByVisit.get(String(visit.id)), index === 0, notesUnavailable
        )).join('');
    }

    renderVisit(visit, note, latest, notesUnavailable) {
        const canOpenConsultation = window.entStaff?.role === 'doctor'
            && visit.doctor_id === window.entStaff.id && visit.kind === 'appointment'
            && ['with_doctor', 'completed'].includes(visit.status);
        return `<details class="visit-history" ${latest ? 'open' : ''}>
            <summary>${latest ? 'Latest visit: ' : ''}${this.escapeHtml(visit.reason || 'Clinic visit')}
                <span class="status">${this.escapeHtml(this.formatStatus(visit.status))}</span>
                <small>${this.escapeHtml(visit.clinic_location || 'Clinic')} &middot; ${this.formatDate(visit.checked_in_at)}</small>
            </summary>
            <div class="visit-notes"><h4>Doctor's notes</h4>
                ${notesUnavailable ? `<p role="status">Unable to load doctor's notes. Please reload the profile to try again.</p>` : this.renderNotes(note, visit)}
                ${canOpenConsultation ? `<a class="outline" href="consultation.html?visit_id=${encodeURIComponent(visit.id)}">${visit.status === 'completed' ? 'View Notes' : 'Continue Notes'}</a>` : ''}
            </div>
        </details>`;
    }

    renderNotes(note, visit = {}, documentView = window.entStaff?.role === 'secretary') {
        if (!note) return '<p>No saved doctor notes are available for this visit.</p>';
        const fields = [
            ['subjective', 'Subjective'], ['objective', 'Objective'], ['history', 'History'],
            ['assessment', 'Assessment'], ['plan', 'Plan'], ['recommendation', 'Recommendation'],
            ['diagnostic', 'Medication'], ['rx', 'RX / Prescription'], ['referral', 'Referral'],
            ['admitting_orders', 'Admitting Orders'], ['pf', 'PF']
        ];
        const sections = fields.filter(([key]) => String(note[key] ?? '').trim()).map(([key, label]) =>
            `<section class="visit-note-section${key === 'pf' ? ' visit-note-fee' : ''}"><h5>${key === 'pf' ? 'Professional fee (PF)' : label}</h5><p class="visit-note-text">${this.escapeHtml(note[key])}</p></section>`
        ).join('');
        if (!sections) return '<p>No saved doctor notes are available for this visit.</p>';
        const content = `<div class="visit-notes-grid">${sections}</div>`;
        return documentView ? this.renderNoteDocument(content, visit) : content;
    }

    renderNoteDocument(content, visit) {
        const patient = this.patient || {};
        const date = new Date(visit.checked_in_at);
        const validDate = !Number.isNaN(date.getTime());
        const birth = new Date(`${patient.date_of_birth}T00:00:00`);
        let age = '';
        if (validDate && !Number.isNaN(birth.getTime()) && birth <= date) {
            age = date.getFullYear() - birth.getFullYear();
            if (date.getMonth() < birth.getMonth() || (date.getMonth() === birth.getMonth() && date.getDate() < birth.getDate())) age--;
        }
        const field = (label, value) => `<div class="note-document-field"><span>${label}:</span><span>${this.escapeHtml(value || '—')}</span></div>`;
        const name = [patient.first_name, patient.middle_name, patient.last_name, patient.suffix].filter(Boolean).join(' ');
        return `<article class="note-document" aria-label="Doctor's notes document">
            <header class="note-document-header">
                <img src="../css/images/clinic-caduceus.png" alt="Medical emblem">
                <div><h3>ALDRIN BUTZ E. BAMBA, MD, DPBO-HNS</h3>
                    <strong>Diplomate, Otorhinolaryngology - Head and Neck Surgery</strong>
                    <div>Specialist in Ears, Nose, Throat, Sinuses, Mouth and Throat Diseases</div>
                    <div>Tumor Surgery of the Head and Neck</div>
                    <div>Voice, Swallowing and Breathing Disorders</div>
                    <div>Diagnostic and Therapeutic Upper Aerodigestive Tract Endoscopy</div>
                    <div>Hearing and Balance Disorders</div>
                    <div>Cleft Lip and Palate Surgery</div>
                    <div>Facial Trauma, Maxillofacial and Reconstructive Surgery of the Head and Neck</div>
                </div>
            </header>
            <div class="note-document-patient">
                ${field('Name', name)}
                ${field('Date', validDate ? date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '')}
                ${field('Address', patient.address)}
                ${field('Age/Sex', [age, patient.sex || ''].filter(value => value !== '').join(' / '))}
            </div>
            <img class="note-document-rx" src="../css/images/prescription-rx.png" alt="Rx">
            ${content}
        </article>`;
    }

    renderPatient(patient) {
        this.patient = patient;
        const fullName = [patient.first_name, patient.middle_name, patient.last_name, patient.suffix].filter(Boolean).join(' ');
        this.header.innerHTML = `<div class="avatar">${this.escapeHtml(patient.first_name.charAt(0).toUpperCase())}</div>
            <div><strong>${this.escapeHtml(fullName)}</strong><small>Patient #${this.escapeHtml(patient.id)}</small></div>`;

        const fields = [
            ['Date of birth', patient.date_of_birth],
            ['Sex', this.formatSex(patient.sex)],
            ['Phone', patient.phone],
            ['Address', patient.address],
            ['Suffix', patient.suffix],
        ];
        this.details.innerHTML = fields.map(([label, value]) => `<div class="profile-stat">
            <small>${label}</small><strong>${this.escapeHtml(value || 'Not provided')}</strong>
        </div>`).join('');
    }

    setMessage(message) {
        this.header.innerHTML = `<div class="avatar">?</div><div><strong>Patient unavailable</strong><small>${this.escapeHtml(message)}</small></div>`;
        this.details.innerHTML = '';
        this.visits.innerHTML = '';
    }

    formatSex(value) {
        return value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : '';
    }

    formatStatus(value) {
        return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    }

    formatDate(value) {
        return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    }

    escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!document.getElementById('patient-header')) return;
    if (!await window.entSessionReady) return;
    const controller = new PatientProfileController();
    controller.init();
});
