class PatientPicker {
    constructor(root, client) {
        this.root = root;
        this.client = client;
        this.input = root.querySelector('[data-patient-search]');
        this.value = root.querySelector('[name="patient_id"]');
        this.results = root.querySelector('[data-patient-results]');
        this.status = root.querySelector('[role="status"]');
        this.request = 0;
        this.input.addEventListener('input', () => {
            this.value.value = '';
            this.input.setCustomValidity(this.input.value ? 'Choose a patient from the search results.' : '');
            clearTimeout(this.timer);
            const request = ++this.request;
            this.results.replaceChildren();
            this.timer = setTimeout(() => this.search(request), 250);
        });
        this.input.form.addEventListener('reset', () => this.clear());
    }
    clear() {
        clearTimeout(this.timer);
        ++this.request;
        this.input.value = '';
        this.value.value = '';
        this.input.setCustomValidity('');
        this.results.replaceChildren();
        this.status.textContent = '';
    }
    label(patient) {
        return [patient.first_name, patient.middle_name, patient.last_name, patient.suffix].filter(Boolean).join(' ')
            + ` — ${patient.date_of_birth || 'Birthdate unavailable'} — #${patient.id}`;
    }
    choose(patient) {
        ++this.request;
        this.value.value = patient.id;
        this.input.value = this.label(patient);
        this.input.setCustomValidity('');
        this.results.replaceChildren();
        this.status.textContent = 'Patient selected.';
    }
    async init() {
        const id = new URLSearchParams(location.search).get('patient_id');
        if (!id) return;
        const request = ++this.request;
        try {
            const {data, error} = await this.client.from('patients')
                .select('id, first_name, middle_name, last_name, suffix, date_of_birth').eq('id', id).maybeSingle();
            if (request !== this.request) return;
            if (error) throw error;
            if (data) this.choose(data);
            else this.status.textContent = 'Patient not found. Search for another patient.';
        } catch { if (request === this.request) this.status.textContent = 'Unable to load patient. Try searching again.'; }
    }
    async search(request) {
        const words = this.input.value.trim().replace(/[^\p{L}\p{M}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean);
        if (words.join('').length < 2) { this.status.textContent = 'Type at least two characters to search.'; return; }
        this.status.textContent = 'Searching…';
        try {
            let query = this.client.from('patients').select('id, first_name, middle_name, last_name, suffix, date_of_birth');
            for (const word of words) query = query.or(`first_name.ilike.%${word}%,middle_name.ilike.%${word}%,last_name.ilike.%${word}%`);
            const {data, error} = await query.order('last_name').limit(20);
            if (request !== this.request) return;
            if (error) throw error;
            this.results.replaceChildren();
            for (const patient of data) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'patient-picker-option';
                button.textContent = this.label(patient);
                button.addEventListener('click', () => this.choose(patient));
                this.results.append(button);
            }
            this.status.textContent = data.length ? 'Choose a patient. If needed, type more of their name to narrow the results.' : 'No matching patients.';
        } catch { if (request === this.request) this.status.textContent = 'Unable to search patients. Please try again.'; }
    }
}
window.PatientPicker = PatientPicker;
