class AdminController {
    constructor() {
        this.client = window.entSupabase;
        this.patientForm = document.getElementById('admin-patient-form');
        this.patientStatus = document.getElementById('admin-patient-status');
        this.patientList = document.getElementById('admin-patient-list');
        this.schedule = document.getElementById('admin-schedule');
        this.staffList = document.getElementById('admin-staff-list');
        this.settingsForm = document.getElementById('admin-settings-form');
        this.settingsStatus = document.getElementById('admin-settings-status');
    }

    init() {
        this.patientForm?.addEventListener('submit', (event) => this.savePatient(event));
        this.settingsForm?.addEventListener('submit', (event) => this.saveSettings(event));
        this.loadData();
    }

    async loadData() {
        if (!this.client) {
            this.setAllStatus('Configure Supabase before using the Admin workspace.');
            return;
        }

        const tasks = [];
        if (this.patientList) tasks.push(this.loadPatients());
        if (this.schedule || document.getElementById('admin-patients-today')) tasks.push(this.loadVisits());
        if (this.staffList || document.getElementById('admin-staff-count')) tasks.push(this.loadStaff());
        await Promise.all(tasks);
    }

    async loadPatients() {
        const { data, error } = await this.client
            .from('patients')
            .select('id, first_name, middle_name, last_name, suffix, phone, email')
            .order('created_at', { ascending: false });

        if (error) {
            this.patientList.innerHTML = `<p>${this.escapeHtml(error.message)}</p>`;
            return;
        }

        this.patientList.innerHTML = data.length
            ? data.map((patient) => `<div class="result">
                <div class="avatar">${this.escapeHtml(patient.first_name.charAt(0).toUpperCase())}</div>
                <div class="result-info"><strong>${this.escapeHtml([patient.first_name, patient.middle_name, patient.last_name, patient.suffix].filter(Boolean).join(' '))}</strong>
                <small>${this.escapeHtml(patient.phone || patient.email || 'No contact details')}</small></div>
                <a class="outline" href="../Doctor/profile.html?id=${patient.id}">View</a>
            </div>`).join('')
            : '<p>No patient records yet.</p>';
    }

    async savePatient(event) {
        event.preventDefault();
        const patient = Object.fromEntries(new FormData(this.patientForm).entries());
        Object.keys(patient).forEach((key) => {
            if (!patient[key]) delete patient[key];
        });
        const { error } = await this.client.from('patients').insert(patient);
        this.patientStatus.textContent = error ? error.message : 'Patient saved.';
        if (!error) {
            this.patientForm.reset();
            this.loadPatients();
        }
    }

    async loadVisits() {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        const { data, error } = await this.client
            .from('visits')
            .select('id, patient_id, reason, status, checked_in_at, patients(first_name, last_name)')
            .gte('checked_in_at', start.toISOString())
            .lt('checked_in_at', end.toISOString())
            .order('checked_in_at', { ascending: true });

        if (error) {
            this.setAllStatus(error.message);
            return;
        }

        const counts = { waiting: 0, with_doctor: 0 };
        data.forEach((visit) => {
            if (counts[visit.status] !== undefined) counts[visit.status] += 1;
        });
        this.setMetric('admin-patients-today', data.length);
        this.setMetric('admin-waiting', counts.waiting);
        this.setMetric('admin-with-doctor', counts.with_doctor);
        if (!this.schedule) return;
        this.schedule.innerHTML = data.length ? data.map((visit) => this.renderVisit(visit)).join('') : '<p>No visits scheduled today.</p>';
        this.schedule.querySelectorAll('.admin-status').forEach((select) => {
            select.addEventListener('change', () => this.updateVisit(select));
        });
    }

    renderVisit(visit) {
        const patient = visit.patients || {};
        const name = [patient.first_name, patient.last_name].filter(Boolean).join(' ');
        return `<div class="result"><div class="result-info"><strong>${this.escapeHtml(name)}</strong>
            <small>${this.escapeHtml(visit.reason || 'General visit')} · ${new Date(visit.checked_in_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></div>
            <select class="filter admin-status" data-id="${visit.id}" aria-label="Visit status">
                ${this.statusOption('scheduled', visit.status)}${this.statusOption('waiting', visit.status)}${this.statusOption('with_doctor', visit.status)}${this.statusOption('completed', visit.status)}${this.statusOption('cancelled', visit.status)}
            </select></div>`;
    }

    async updateVisit(select) {
        const { error } = await this.client.from('visits').update({ status: select.value }).eq('id', select.dataset.id);
        if (error) this.schedule.insertAdjacentHTML('afterbegin', `<p>${this.escapeHtml(error.message)}</p>`);
        else this.loadVisits();
    }

    async loadStaff() {
        const { data, error } = await this.client.from('staff').select('id, full_name, role, is_active').order('full_name');
        if (error) {
            this.setAllStatus(error.message);
            return;
        }
        this.setMetric('admin-staff-count', data.filter((staff) => staff.is_active !== false).length);
        if (!this.staffList) return;
        this.staffList.innerHTML = data.length ? data.map((staff) => `<div class="result">
            <div class="result-info"><strong>${this.escapeHtml(staff.full_name)}</strong><small>${this.escapeHtml(staff.role)}</small></div>
            <span class="status ${staff.is_active ? 'doctor' : 'completed'}">${staff.is_active ? 'Active' : 'Disabled'}</span>
            <button class="small admin-staff-toggle" type="button" data-id="${staff.id}" data-active="${staff.is_active}">${staff.is_active ? 'Disable' : 'Enable'}</button>
        </div>`).join('') : '<p>No staff profiles found.</p>';
        this.staffList.querySelectorAll('.admin-staff-toggle').forEach((button) => {
            button.addEventListener('click', () => this.toggleStaff(button));
        });
    }

    async toggleStaff(button) {
        const { error } = await this.client.from('staff').update({ is_active: button.dataset.active !== 'true' }).eq('id', button.dataset.id);
        if (error) this.staffList.insertAdjacentHTML('afterbegin', `<p>${this.escapeHtml(error.message)}</p>`);
        else this.loadStaff();
    }

    saveSettings(event) {
        event.preventDefault();
        const settings = Object.fromEntries(new FormData(this.settingsForm).entries());
        localStorage.setItem('entClinicSettings', JSON.stringify(settings));
        this.settingsStatus.textContent = 'Settings saved in this browser.';
    }

    statusOption(value, current) {
        return `<option value="${value}"${value === current ? ' selected' : ''}>${this.formatStatus(value)}</option>`;
    }

    formatStatus(value) {
        return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    }

    setAllStatus(message) {
        for (const container of [this.patientList, this.schedule, this.staffList, document.getElementById('admin-dashboard-status')]) {
            if (container) container.textContent = message;
        }
    }

    setMetric(id, value) {
        const metric = document.getElementById(id);
        if (metric) metric.textContent = value;
    }

    escapeHtml(value) {
        return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!await window.entSessionReady) return;
    const controller = new AdminController();
    controller.init();
});
