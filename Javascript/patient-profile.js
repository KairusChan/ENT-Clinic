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

        this.visits.innerHTML = visits.length
            ? visits.map((visit) => `<div class="patient-line">
                <div><strong>${this.escapeHtml(visit.reason || 'Clinic visit')}</strong>
                <small>${this.escapeHtml(visit.clinic_location || 'Clinic')} Â· ${this.formatDate(visit.checked_in_at)}</small></div>
                <span class="status">${this.escapeHtml(this.formatStatus(visit.status))}</span>
                ${window.entStaff?.role === 'doctor' && visit.doctor_id === window.entStaff.id && visit.kind === 'appointment' && ['with_doctor', 'completed'].includes(visit.status) ? `<a class="outline" href="consultation.html?visit_id=${encodeURIComponent(visit.id)}">${visit.status === 'completed' ? 'View Notes' : 'Continue Notes'}</a>` : ''}
            </div>`).join('')
            : '<p>No visits have been recorded for this patient.</p>';

    }

    renderPatient(patient) {
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
    if (!await window.entSessionReady) return;
    const controller = new PatientProfileController();
    controller.init();
});
