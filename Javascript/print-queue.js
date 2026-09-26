class PrintQueueController {
    constructor() {
        this.client = window.entSupabase;
        this.list = document.getElementById('print-queue-list');
        this.status = document.getElementById('print-queue-status');
        this.filter = document.getElementById('print-filter');
        this.preview = document.getElementById('print-preview-panel');
        this.previewStatus = document.getElementById('print-preview-status');
        this.printButton = document.getElementById('print-document');
        this.completeButton = document.getElementById('print-complete');
        this.renderer = new PatientProfileController();
        this.rows = [];
        this.sections = { diagnostic: 'Medication', recommendation: 'Recommendation', referral: 'Referral', admitting_orders: 'Admitting Orders' };
    }
    async init() {
        if (!['doctor', 'secretary', 'admin'].includes(window.entStaff?.role)) return;
        document.getElementById('print-refresh').addEventListener('click', () => this.refresh());
        this.filter.addEventListener('change', () => this.render());
        document.getElementById('print-preview-close').addEventListener('click', () => { if (!this.busy) { this.openRequest = (this.openRequest || 0) + 1; this.preview.hidden = true; this.selected = null; } });
        this.printButton.addEventListener('click', () => this.print());
        this.completeButton.addEventListener('click', () => this.complete());
        await this.refresh();
        this.timer = setInterval(() => this.refresh(), 30000);
        window.addEventListener('pagehide', () => clearInterval(this.timer), { once: true });
    }
    query() {
        let query = this.client.from('Notes').select('*, patients(first_name, middle_name, last_name, suffix, date_of_birth, sex, address), visits(checked_in_at, reason), staff(full_name)');
        if (window.entStaff.role === 'doctor') query = query.eq('doctor_id', window.entStaff.id);
        return query;
    }
    items() {
        return this.rows.flatMap(row => Object.keys(this.sections).filter(section => String(row[section] || '').trim()).map(section => ({ row, section })));
    }
    isPrinted(row, section) {
        return this.trackingReady && this.receipts.get(row.id + ':' + section) === row[section];
    }
    async refresh() {
        if (this.loading) return;
        this.loading = true;
        try {
            const rows = [];
            for (let offset = 0; ; offset += 100) {
                const { data, error } = await this.query().order('id', { ascending: false }).range(offset, offset + 99);
                if (error) throw error;
                rows.push(...data);
                if (data.length < 100) break;
            }
            this.receipts = new Map();
            this.trackingReady = true;
            for (let offset = 0; offset < rows.length; offset += 100) {
                const { data, error } = await this.client.from('note_section_print_receipts').select('note_id, section, content').in('note_id', rows.slice(offset, offset + 100).map(row => row.id));
                if (error) { this.trackingReady = false; break; }
                data.forEach(receipt => this.receipts.set(receipt.note_id + ':' + receipt.section, receipt.content));
            }
            this.rows = rows;
            this.status.textContent = this.trackingReady ? '' : 'Saved notes are ready to print. Printed-status tracking is unavailable; all saved notes are shown. Apply the print queue database migration if it has not been installed.';
            this.render();
            if (this.selected && !rows.some(row => String(row.id) === String(this.selected.id))) {
                this.selected = null;
                this.preview.hidden = true;
            }
        } catch (error) {
            this.status.textContent = 'Unable to refresh saved notes: ' + (error.message || 'Check your connection.');
            if (!this.rows.length) this.list.textContent = 'Saved notes are unavailable.';
        } finally { this.loading = false; }
    }
    render() {
        const rows = this.items().filter(({row, section}) => this.filter.value === 'all' || !this.isPrinted(row, section));
        const escape = value => this.renderer.escapeHtml(value);
        this.list.innerHTML = rows.length ? rows.map(({row, section}) => {
            const patient = row.patients || {};
            const name = [patient.first_name, patient.middle_name, patient.last_name, patient.suffix].filter(Boolean).join(' ') || 'Patient';
            const printed = this.isPrinted(row, section);
            return `<div class="result"><div class="result-info"><strong>${escape(name)} &middot; ${this.sections[section]}</strong><small>${escape(row.staff?.full_name || 'Doctor')} &middot; ${escape(new Date(row.created_at).toLocaleString())}</small><small>${escape(row.visits?.reason || 'Consultation')} &middot; Visit #${escape(row.visit_id)}</small></div><span class="status">${printed ? 'Printed' : this.trackingReady ? 'Waiting to print' : 'Saved'}</span><button class="outline" type="button" data-note-id="${escape(row.id)}" data-section="${section}">Preview / Print</button></div>`;
        }).join('') : '<p>No notes waiting to print.</p>';
        this.list.querySelectorAll('[data-note-id]').forEach(button => button.addEventListener('click', () => this.open(button.dataset.noteId, button.dataset.section)));
    }
    async latest(id) {
        const { data, error } = await this.query().eq('id', id).maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('These notes are no longer available. Refresh the queue.');
        return data;
    }
    show(row, section) {
        if (!Object.hasOwn(this.sections, section) || !String(row[section] || '').trim()) throw new Error('This section is empty. Refresh the queue.');
        this.selected = row;
        this.selectedSection = section;
        this.renderer.patient = row.patients || {};
        const html = this.renderer.renderNotes({ [section]: row[section] }, row.visits || {}, true);
        document.getElementById('print-document-preview').innerHTML = html;
        document.getElementById('print-queue-output').innerHTML = html;
        this.printButton.textContent = 'Print ' + this.sections[section];
        this.preview.hidden = false;
        this.completeButton.disabled = !this.trackingReady;
    }
    async open(id, section) {
        if (this.busy) return;
        const request = this.openRequest = (this.openRequest || 0) + 1;
        try {
            const row = await this.latest(id);
            if (request !== this.openRequest) return;
            this.show(row, section);
            this.previewStatus.textContent = 'Print the document, then select Mark printed after confirming the paper copy.';
            this.preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (error) { this.status.textContent = error.message; }
    }
    async print() {
        if (!this.selected || this.busy) return;
        this.busy = true;
        this.printButton.disabled = this.completeButton.disabled = true;
        try {
            const row = await this.latest(this.selected.id);
            this.show(row, this.selectedSection);
            this.completeButton.disabled = true;
            const images = document.getElementById('print-queue-output').querySelectorAll('img');
            await Promise.all([...images].map(image => image.decode()));
            window.print();
            this.previewStatus.textContent = 'If the paper copy printed successfully, select Mark printed. Cancelling the dialog keeps the notes in the queue.';
        } catch (error) { this.previewStatus.textContent = 'Unable to print: ' + error.message; }
        finally { this.busy = false; this.printButton.disabled = false; this.completeButton.disabled = !this.trackingReady; }
    }
    async complete() {
        if (!this.selected || this.busy || !this.trackingReady) return;
        this.busy = true;
        this.completeButton.disabled = this.printButton.disabled = true;
        try {
            const { error } = await this.client.rpc('mark_note_section_printed', { p_note_id: this.selected.id, p_section: this.selectedSection, p_expected_content: this.selected[this.selectedSection] });
            if (error) throw error;
            this.previewStatus.textContent = 'Marked printed. Available again under All saved notes.';
            this.selected = null;
            this.preview.hidden = true;
            await this.refresh();
        } catch (error) { this.previewStatus.textContent = 'Unable to mark printed: ' + error.message; }
        finally { this.busy = false; this.printButton.disabled = false; this.completeButton.disabled = !this.trackingReady; }
    }
}
document.addEventListener('DOMContentLoaded', async () => {
    if (!await window.entSessionReady) return;
    new PrintQueueController().init();
});
