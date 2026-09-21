class QueueController {
    constructor() {
        this.client = window.entSupabase;
        this.tabs = document.querySelectorAll('#queue-tabs .tab');
        this.searchInput = document.getElementById('queue-search');
        this.dateInput = document.getElementById('queue-date');
        this.results = document.getElementById('queue-results');
        this.visits = [];
        this.activeStatus = 'all';
    }

    init() {
        this.dateInput.value = this.formatDateInput(new Date());
        this.tabs.forEach((tab) => tab.addEventListener('click', () => {
            this.activeStatus = tab.dataset.status;
            this.tabs.forEach((item) => item.classList.toggle('active', item === tab));
            this.render();
        }));
        this.searchInput.addEventListener('input', () => this.render());
        this.dateInput.addEventListener('change', () => this.loadVisits());
        this.loadVisits();
        const timer = setInterval(() => this.loadVisits(), 30000);
        window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    }

    async loadVisits() {
        if (!this.client) {
            this.results.innerHTML = '<p>Connect Supabase before loading the queue.</p>';
            return;
        }

        const selectedDate = new Date(`${this.dateInput.value}T00:00:00`);
        const nextDate = new Date(selectedDate);
        nextDate.setDate(nextDate.getDate() + 1);
        let query = this.client
            .from('visits')
            .select('id, patient_id, kind, clinic_location, reason, status, checked_in_at, patients(first_name, middle_name, last_name, suffix, phone)')
            .gte('checked_in_at', selectedDate.toISOString())
            .lt('checked_in_at', nextDate.toISOString())
            .order('checked_in_at', { ascending: true });
        query = query.neq('status', 'scheduled').neq('kind', 'event');
        if (window.entStaff.role === 'doctor') query = query.eq('doctor_id', window.entStaff.id);
        const { data, error } = await query;

        if (error) {
            this.results.innerHTML = `<p>${this.escapeHtml(error.message)}</p>`;
            return;
        }

        this.visits = data || [];
        this.updateTabCounts();
        this.render();
    }

    updateTabCounts() {
        const counts = { all: this.visits.length, waiting: 0, with_doctor: 0, completed: 0 };
        this.visits.forEach((visit) => {
            if (counts[visit.status] !== undefined) counts[visit.status] += 1;
        });
        this.tabs.forEach((tab) => {
            tab.textContent = `${this.formatStatus(tab.dataset.status)} (${counts[tab.dataset.status]})`;
        });
    }

    render() {
        const searchTerm = this.searchInput.value.trim().toLowerCase();
        const filteredVisits = this.visits.filter((visit) => {
            const patient = visit.patients || {};
            const name = [patient.first_name, patient.middle_name, patient.last_name, patient.suffix].filter(Boolean).join(' ');
            const matchesStatus = this.activeStatus === 'all' || visit.status === this.activeStatus;
            const matchesSearch = [name, patient.phone, visit.reason].filter(Boolean).join(' ').toLowerCase().includes(searchTerm);
            return matchesStatus && matchesSearch;
        });

        this.results.innerHTML = filteredVisits.length
            ? filteredVisits.map((visit) => this.renderVisit(visit)).join('')
            : '<p>No patients are currently in this queue.</p>';
        this.results.querySelectorAll('.queue-action').forEach((button) => {
            button.addEventListener('click', () => this.updateStatus(button.dataset.id, button.dataset.status));
        });
        this.results.querySelectorAll('.accept-patient').forEach(button => {
            button.addEventListener('click', () => this.acceptPatient(button));
        });
        this.results.querySelectorAll('.cancel-patient').forEach(button => {
            button.addEventListener('click', () => this.cancelPatient(button));
        });
    }

    renderVisit(visit) {
        const patient = visit.patients || {};
        const name = [patient.first_name, patient.middle_name, patient.last_name, patient.suffix].filter(Boolean).join(' ');
        const actionStatus = visit.status === 'waiting' ? 'with_doctor' : visit.status === 'with_doctor' ? 'completed' : 'waiting';
        const actionLabel = actionStatus === 'with_doctor' ? 'Start Visit' : actionStatus === 'completed' ? 'Complete' : 'Return to Waiting';
        let actions = '';
        if (window.entStaff.role === 'doctor' && visit.kind === 'appointment') {
            if (visit.status === 'waiting') actions = `<button class="small accept-patient" type="button" data-id="${visit.id}">Accept Patient</button>`;
            else if (['with_doctor', 'completed'].includes(visit.status)) actions = `<a class="primary" href="consultation.html?visit_id=${encodeURIComponent(visit.id)}">${visit.status === 'completed' ? 'View Notes' : 'Continue Notes'}</a>`;
        } else if (window.entStaff.role !== 'doctor' && (visit.kind !== 'appointment' || visit.status === 'cancelled')) {
            actions = `<button class="small queue-action" type="button" data-id="${visit.id}" data-status="${actionStatus}">${actionLabel}</button>`;
        }
        if (['secretary', 'admin'].includes(window.entStaff.role) && visit.status === 'waiting') {
            actions += `<button class="outline cancel-patient" type="button" data-id="${visit.id}">Cancel</button>`;
        }
        return `<div class="result">
            <div class="avatar">${this.escapeHtml((patient.first_name || '?').charAt(0).toUpperCase())}</div>
            <div class="result-info"><strong>${this.escapeHtml(name || 'Unknown patient')}</strong>
                <small>${this.escapeHtml(visit.reason || 'General visit')} · ${this.escapeHtml(this.formatTime(visit.checked_in_at))}</small></div>
            <span class="status ${this.escapeHtml(visit.status)}">${this.escapeHtml(this.formatStatus(visit.status))}</span>
            <a class="outline" href="profile.html?id=${encodeURIComponent(visit.patient_id)}">View</a>
            ${actions}
        </div>`;
    }

    async acceptPatient(button) {
        if (button.disabled) return;
        button.disabled = true;
        try {
            const { error } = await this.client.rpc('accept_consultation', { p_visit_id: button.dataset.id });
            if (error) throw error;
            window.location.href = `consultation.html?visit_id=${encodeURIComponent(button.dataset.id)}`;
        } catch (error) {
            this.results.insertAdjacentHTML('afterbegin', `<p role="alert">${this.escapeHtml(error.message || 'Unable to accept patient. Please try again.')}</p>`);
            button.disabled = false;
        }
    }

    async cancelPatient(button) {
        if (button.disabled || !['secretary', 'admin'].includes(window.entStaff.role)) return;
        button.disabled = true;
        try {
            const { error } = await this.client.rpc('cancel_visit', {
                p_visit_id: button.dataset.id, p_expected_status: 'waiting'
            });
            if (error) throw error;
            await this.loadVisits();
        } catch (error) {
            this.results.insertAdjacentHTML('afterbegin', `<p role="alert">${this.escapeHtml(error.message || 'Unable to cancel this visit. Please try again.')}</p>`);
            button.disabled = false;
        }
    }

    async updateStatus(visitId, status) {
        const { error } = await this.client.from('visits').update({ status }).eq('id', visitId);
        if (error) {
            this.results.insertAdjacentHTML('afterbegin', `<p>${this.escapeHtml(error.message)}</p>`);
            return;
        }
        this.loadVisits();
    }

    formatDateInput(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    formatTime(value) {
        return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    formatStatus(value) {
        return value === 'all' ? 'All' : value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
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
    const controller = new QueueController();
    controller.init();
});
