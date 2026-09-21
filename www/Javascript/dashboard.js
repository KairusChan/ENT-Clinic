class DashboardController {
    constructor() {
        this.client = window.entSupabase;
        this.queue = document.getElementById('dashboard-queue');
        this.metrics = {
            all: document.getElementById('metric-all'),
            waiting: document.getElementById('metric-waiting'),
            with_doctor: document.getElementById('metric-with-doctor'),
            completed: document.getElementById('metric-completed')
        };
    }

    init() {
        this.loadDashboard();
        const timer = setInterval(() => this.loadDashboard(), 30000);
        window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    }

    async loadDashboard() {
        if (!this.client) {
            this.queue.innerHTML = '<p>Connect Supabase before loading dashboard data.</p>';
            return;
        }

        const today = new Date();
        const tomorrow = new Date(today);
        today.setHours(0, 0, 0, 0);
        tomorrow.setHours(0, 0, 0, 0);
        tomorrow.setDate(tomorrow.getDate() + 1);
        let query = this.client
            .from('visits')
            .select('id, patient_id, reason, status, checked_in_at, patients(first_name, middle_name, last_name, suffix)')
            .gte('checked_in_at', today.toISOString())
            .lt('checked_in_at', tomorrow.toISOString())
            .order('checked_in_at', { ascending: false });
        query = query.neq('status', 'scheduled').neq('kind', 'event');
        if (window.entStaff.role === 'doctor') query = query.eq('doctor_id', window.entStaff.id);
        const { data: visits, error } = await query;

        if (error) {
            this.queue.innerHTML = `<p>${this.escapeHtml(error.message)}</p>`;
            return;
        }

        this.updateMetrics(visits || []);
        this.renderLatest(visits || []);
    }

    updateMetrics(visits) {
        const counts = { all: visits.length, waiting: 0, with_doctor: 0, completed: 0 };
        visits.forEach((visit) => {
            if (counts[visit.status] !== undefined) counts[visit.status] += 1;
        });
        Object.entries(this.metrics).forEach(([status, element]) => {
            element.textContent = counts[status];
        });
    }

    renderLatest(visits) {
        const latestVisits = visits.slice(0, 5);
        this.queue.innerHTML = latestVisits.length
            ? latestVisits.map((visit) => {
                const patient = visit.patients || {};
                const name = [patient.first_name, patient.middle_name, patient.last_name, patient.suffix].filter(Boolean).join(' ');
                return `<div class="result"><div class="avatar">${this.escapeHtml((patient.first_name || '?').charAt(0).toUpperCase())}</div>
                    <div class="result-info"><strong>${this.escapeHtml(name || 'Unknown patient')}</strong>
                    <small>${this.escapeHtml(visit.reason || 'General visit')} · ${this.escapeHtml(new Date(visit.checked_in_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</small></div>
                    <span class="status ${this.escapeHtml(visit.status)}">${this.escapeHtml(this.formatStatus(visit.status))}</span></div>`;
            }).join('')
            : '<p>No patients in today&#039;s queue.</p>';
    }

    formatStatus(value) {
        return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
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
    const controller = new DashboardController();
    controller.init();
});