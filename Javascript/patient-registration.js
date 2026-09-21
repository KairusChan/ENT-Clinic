class PatientRegistrationController {
    constructor() {
        this.form = document.getElementById('patient-registration-form');
        this.status = document.querySelector('.form-status');
        this.client = window.entSupabase;
    }

    init() {
        this.pictures = new window.PatientPictures(document.getElementById('patient-pictures'));
        this.form.addEventListener('submit', (event) => this.handleSubmit(event));
    }

    async handleSubmit(event) {
        event.preventDefault();
        if (this.saving) return;
        if (this.pictures.busy) { this.setStatus('Wait for the pictures to finish preparing.'); return; }

        if (!this.client) {
            this.setStatus('Add your Supabase URL and anon key in Javascript/supabase-config.js first.');
            return;
        }

        const formData = new FormData(this.form);
        const patient = Object.fromEntries(formData.entries());
        for (const key of ['first_name', 'middle_name', 'last_name']) patient[key] = (patient[key] || '').trim().replace(/\s+/g, ' ');
        if (!patient.first_name || !patient.last_name || !patient.date_of_birth) {
            this.setStatus('First name, last name and date of birth are required.');
            return;
        }
        if (patient.date_of_birth > new Date().toLocaleDateString('en-CA')) {
            this.setStatus('Date of birth cannot be in the future.');
            return;
        }
        Object.keys(patient).forEach((key) => {
            if (patient[key] === '') {
                delete patient[key];
            }
        });

        this.setStatus('Saving patient...');
        this.saving = true;
        const button = this.form.querySelector('[type="submit"]');
        button.disabled = true;
        this.pictures.busy = true;
        this.pictures.render();
        try {
            patient.record_pictures = await this.pictures.upload(this.client);
            const { error } = await this.client.from('patients').insert(patient);
            if (error) {
                this.setStatus(error.code === '23505'
                    ? 'A patient with these first and last names and birthdate already exists. Open Patient Lists to find the existing record, even if the middle name or initial differs.'
                    : error.message);
                return;
            }
            window.location.href = 'search.html';
        } catch (error) {
            this.setStatus(error.message?.startsWith('Picture upload failed:') ? error.message : 'Unable to confirm the save. Check Patient Lists before trying again.');
        } finally {
            this.pictures.busy = false;
            this.pictures.render();
            this.saving = false;
            button.disabled = false;
        }
    }

    setStatus(message) {
        this.status.textContent = message;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!await window.entSessionReady) return;
    const controller = new PatientRegistrationController();
    controller.init();
});
