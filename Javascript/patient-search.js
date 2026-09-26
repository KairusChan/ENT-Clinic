class PatientSearchController {
    constructor() {
        this.searchInput = document.getElementById('patient-search');
        this.searchButton = document.getElementById('patient-search-button');
        this.results = document.getElementById('patient-results');
        this.status = document.getElementById('patient-results-status');
        this.client = window.entSupabase;
        this.patients = [];
        this.pagination = document.getElementById('patient-pagination');
        this.page = 0;
        this.pageSize = this.pagination ? 3 : Infinity;
    }

    init() {
        if (this.pagination) {
            document.getElementById('patient-previous').addEventListener('click', () => this.renderResults(this.page - 1));
            document.getElementById('patient-next').addEventListener('click', () => this.renderResults(this.page + 1));
        }
        this.searchButton.addEventListener('click', () => this.renderResults());
        this.searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.renderResults();
            }
        });
        this.loadPatients();
    }

    async loadPatients() {
        if (!this.client) {
            this.setStatus('Add your Supabase URL and anon key in Javascript/supabase-config.js first.');
            return;
        }

        const { data, error } = await this.client
            .from('patients')
            .select('id, patient_number, first_name, last_name, middle_name, suffix, date_of_birth, sex, phone, email')
            .order('created_at', { ascending: false });

        if (error) {
            this.setStatus(error.message);
            return;
        }

        this.patients = data || [];
        this.renderResults();
    }

    renderResults(page = 0) {
        const searchTerm = this.searchInput.value.trim().toLowerCase();
        if (searchTerm !== this.lastSearchTerm) page = 0;
        this.lastSearchTerm = searchTerm;
        const matchingPatients = this.patients.filter((patient) => {
            const searchableText = [
                patient.id,
                patient.patient_number,
                patient.first_name,
                patient.last_name,
                patient.middle_name,
                patient.suffix,
                patient.date_of_birth,
                patient.phone,
                patient.email
            ].join(' ').toLowerCase();

            return searchableText.includes(searchTerm);
        });

        this.page = Math.max(0, Math.min(page, Math.ceil(matchingPatients.length / this.pageSize) - 1));
        const start = this.pagination ? this.page * this.pageSize : 0;
        if (this.pagination) {
            this.pagination.hidden = matchingPatients.length <= this.pageSize;
            document.getElementById('patient-page-status').textContent =
                `${start + 1}\u2013${Math.min(start + this.pageSize, matchingPatients.length)} of ${matchingPatients.length} patients`;
            document.getElementById('patient-previous').disabled = this.page === 0;
            document.getElementById('patient-next').disabled = start + this.pageSize >= matchingPatients.length;
        }

        if (!matchingPatients.length) {
            this.results.innerHTML = '<p id="patient-results-status">No patient records found.</p>';
            this.status = document.getElementById('patient-results-status');
            return;
        }

        this.results.innerHTML = matchingPatients.slice(start, start + this.pageSize).map((patient) => this.renderPatient(patient)).join('');
    }

    renderPatient(patient) {
        const fullName = [patient.first_name, patient.middle_name, patient.last_name, patient.suffix]
            .filter(Boolean)
            .join(' ');
        const patientNumber = patient.patient_number || `Patient #${patient.id}`;
        const details = [patient.date_of_birth, patient.phone, patient.email]
            .filter(Boolean)
            .join(' · ');

        return `<a class="result" href="profile.html?id=${encodeURIComponent(patient.id)}">
            <div class="avatar">${this.escapeHtml(patient.first_name.charAt(0).toUpperCase())}</div>
            <div class="result-info">
                <strong>${this.escapeHtml(fullName)}</strong>
                <small>${this.escapeHtml(patientNumber)}${details ? ` · ${this.escapeHtml(details)}` : ''}</small>
            </div>
            <span class="outline">View</span>
        </a>`;
    }

    escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    setStatus(message) {
        this.status.textContent = message;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!await window.entSessionReady) return;
    const controller = new PatientSearchController();
    controller.init();
});
