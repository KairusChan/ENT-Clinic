document.addEventListener('DOMContentLoaded', async () => {
    if (!await window.entSessionReady) return;
    const root = document.getElementById('consultation-transfer');
    const role = window.entStaff?.role;
    if (!root || !['secretary', 'doctor'].includes(role)) return;
    const client = window.entSupabase;
    const patientId = new URLSearchParams(window.location.search).get('id');
    if (role === 'secretary' && !patientId) return;
    const el = (tag, text = '', className = '') => {
        const node = document.createElement(tag);
        node.textContent = text;
        node.className = className;
        return node;
    };
    const dropdown = el('details', '', 'approval-dropdown');
    const heading = el('summary', '', 'approval-summary');
    const title = el('div', '', 'deletion-title');
    title.append(el('h2', role === 'doctor' ? 'Consultation transfer approvals' : 'Transfer patient consultations'),
        el('p', 'Move all saved consultations to the correct patient record after doctor approval.', 'deletion-subtitle'));
    const refresh = el('button', 'Refresh requests', 'outline deletion-refresh');
    refresh.type = 'button';
    heading.append(title);
    const body = el('div', '', 'approval-body');
    const toolbar = el('div', '', 'approval-toolbar');
    toolbar.append(refresh);
    const status = el('p', '', 'deletion-status');
    status.setAttribute('role', 'status');
    const content = el('div', '', 'deletion-content');
    body.append(toolbar, status, content);
    dropdown.append(heading, body);
    root.append(dropdown);
    const revealRequest = () => {
        if (window.location.hash === '#consultation-transfer') {
            dropdown.open = true;
            root.scrollIntoView?.({behavior: 'smooth', block: 'start'});
        }
    };
    window.addEventListener?.('hashchange', revealRequest);
    revealRequest();
    let busy = false;

    function profileLink(id, text) {
        const link = el('a', text, 'outline');
        link.href = `profile.html?id=${encodeURIComponent(id)}`;
        return link;
    }

    async function review(request, approve, button) {
        if (busy) return;
        if (approve && !window.confirm(`Approve moving all ${request.consultation_count} saved consultations?\n\nFROM: ${request.source_label}\nTO: ${request.target_label}\n\nConfirm both records belong to the same person. The transfer occurs after every authoring doctor approves.`)) return;
        busy = true;
        button.disabled = true;
        refresh.disabled = true;
        try {
            const { data, error } = await client.rpc('review_consultation_transfer', { p_request_id: request.id, p_approve: approve });
            if (error) throw error;
            await load();
            status.textContent = data === 'approved' ? 'Transfer completed. All saved consultations are now on the destination patient. The original record remains available for a separate deletion request.'
                : data === 'rejected' ? 'Transfer rejected. No consultations were moved.'
                : 'Your approval is recorded. Waiting for the other authoring doctors; no consultations have moved yet.';
            if (data === 'approved') window.dispatchEvent(new Event('consultations-transferred'));
        } catch (error) { status.textContent = error.message || 'Unable to confirm the decision. Refresh requests before trying again.'; }
        finally { busy = false; button.disabled = false; refresh.disabled = false; }
    }

    function renderRequest(request) {
        const card = el('article', '', 'deletion-request');
        const header = el('div', '', 'deletion-request-heading');
        const state = ['pending', 'approved', 'rejected'].includes(request.status) ? request.status : 'pending';
        header.append(el('h3', `${request.consultation_count} saved consultation${request.consultation_count === 1 ? '' : 's'}`),
            el('span', request.status === 'approved' ? 'Transferred' : request.status === 'rejected' ? 'Rejected' : 'Awaiting approval', `deletion-badge deletion-badge-${state}`));
        const records = el('div', '', 'transfer-records');
        for (const [label, value] of [['From duplicate record', request.source_label], ['To patient record to keep', request.target_label]]) {
            const record = el('div', '', 'deletion-reason');
            record.append(el('span', label, 'deletion-label'), el('p', value));
            records.append(record);
        }
        const reason = el('div', '', 'deletion-reason');
        reason.append(el('span', 'Reason for transfer', 'deletion-label'), el('p', request.reason));
        const approvals = request.consultation_transfer_approvals || [];
        const mine = approvals.find(a => a.doctor_id === window.entStaff.id);
        const summary = el('p', `${approvals.filter(a => a.status === 'approved').length} of ${approvals.length} authoring doctors approved.`, 'deletion-hint');
        card.append(header, records, reason, summary);
        if (request.resolution_reason) card.append(el('p', request.resolution_reason, 'deletion-notice'));
        const actions = el('div', '', 'deletion-actions');
        if (request.source_patient_id) actions.append(profileLink(request.source_patient_id, 'Review source patient'));
        if (request.target_patient_id) actions.append(profileLink(request.target_patient_id, 'Review destination patient'));
        if (role === 'doctor' && request.status === 'pending' && mine) {
            if (mine.status === 'approved') card.append(el('p', 'You approved this transfer. Waiting for the remaining doctors.', 'deletion-notice'));
            if (mine.status === 'pending') {
                const approve = el('button', 'Approve transfer', 'primary');
                approve.type = 'button';
                approve.addEventListener('click', () => review(request, true, approve));
                actions.append(approve);
            }
            const reject = el('button', 'Reject transfer', 'outline deletion-danger');
            reject.type = 'button';
            reject.addEventListener('click', () => review(request, false, reject));
            actions.append(reject);
        }
        card.append(actions);
        return card;
    }

    function renderForm(source, count) {
        const form = el('form', '', 'deletion-form');
        const sourceName = [source.first_name, source.middle_name, source.last_name, source.suffix].filter(Boolean).join(' ');
        form.append(el('p', `From: ${sourceName} / DOB: ${source.date_of_birth || 'unknown'} / Patient #${source.id}`, 'deletion-notice'),
            el('p', `Request all ${count} saved consultations together. Every doctor who wrote these notes must approve. Waiting or active visits and pending deletion requests do not block this transfer. Existing destination consultations are kept; appointments without saved notes and patient details stay on this record.`, 'deletion-subtitle'));
        const pickerRoot = el('div', '', 'field patient-picker');
        // Static markup only; patient values are rendered by PatientPicker using textContent.
        pickerRoot.innerHTML = '<label for="transfer-patient-search">Patient record to keep (required)</label>'
            + '<input id="transfer-patient-search" data-patient-search autocomplete="off" required placeholder="Search by patient name">'
            + '<input type="hidden" name="patient_id"><div data-patient-results class="patient-picker-results"></div><p role="status" class="deletion-hint"></p>';
        const field = el('div', '', 'field');
        const label = el('label', 'Reason for transfer (required)');
        label.htmlFor = 'transfer-reason';
        const reason = el('textarea');
        reason.id = 'transfer-reason'; reason.required = true; reason.maxLength = 1000; reason.rows = 3;
        reason.placeholder = 'Example: Same patient was registered twice, once with middle initial L. and once with middle name Lopez.';
        field.append(label, reason, el('small', 'Maximum 1,000 characters. Verify both names and birthdates before requesting.', 'deletion-hint'));
        const actions = el('div', '', 'deletion-actions');
        const submit = el('button', 'Ask doctors to approve transfer', 'primary');
        submit.type = 'submit'; actions.append(submit);
        form.append(pickerRoot, field, actions);
        content.append(form);
        const picker = new window.PatientPicker(pickerRoot, client);
        const choose = picker.choose.bind(picker);
        picker.choose = patient => {
            if (String(patient.id) === String(patientId)) {
                picker.clear(); picker.status.textContent = 'Choose a different patient record as the destination.'; return;
            }
            choose(patient);
        };
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (busy) return;
            const targetId = picker.value.value;
            if (!targetId || targetId === String(patientId)) { status.textContent = 'Choose a different destination from the patient search results.'; return; }
            if (!reason.value.trim()) { status.textContent = 'Enter the reason for this transfer.'; return; }
            busy = true; submit.disabled = true; refresh.disabled = true;
            try {
                const { error } = await client.rpc('request_consultation_transfer', {
                    p_source_patient_id: patientId, p_target_patient_id: targetId, p_reason: reason.value.trim()
                });
                if (error) throw error;
                await load();
                status.textContent = 'Transfer requested. All authoring doctors must approve before any consultations move.';
            } catch (error) { status.textContent = error.message || 'Unable to confirm the request. Refresh requests before trying again.'; }
            finally { busy = false; submit.disabled = false; refresh.disabled = false; }
        });
    }

    async function load() {
        status.textContent = 'Loading consultation transfers...';
        content.replaceChildren();
        try {
            let query = client.from('consultation_transfer_requests').select('*, consultation_transfer_approvals(doctor_id, status)').order('created_at', { ascending: false });
            query = role === 'doctor' ? query.eq('status', 'pending') : query.or(`source_patient_id.eq.${Number(patientId)},target_patient_id.eq.${Number(patientId)}`);
            const { data, error } = await query.limit(100);
            if (error) throw error;
            const requests = data || [];
            for (const request of requests) content.append(renderRequest(request));
            status.textContent = requests.length ? '' : 'No consultation transfer requests.';
            if (role === 'secretary' && !requests.some(r => r.status === 'pending')) {
                const [patient, notes] = await Promise.all([
                    client.from('patients').select('id, first_name, middle_name, last_name, suffix, date_of_birth').eq('id', patientId).maybeSingle(),
                    client.from('Notes').select('id', { count: 'exact', head: true }).eq('patient_id', patientId)
                ]);
                if (patient.error || notes.error) throw patient.error || notes.error;
                if (!patient.data) throw new Error('Patient record not found.');
                if (notes.count > 0) renderForm(patient.data, notes.count);
                else content.append(el('p', 'This record has no saved consultations to transfer. If it is a duplicate, you can request deletion below.', 'deletion-notice'));
            }
        } catch (error) { status.textContent = `Unable to load consultation transfers: ${error.message || 'Please try again.'}`; }
    }
    refresh.addEventListener('click', async () => {
        if (busy) return;
        busy = true; refresh.disabled = true;
        try { await load(); } finally { busy = false; refresh.disabled = false; }
    });
    await load();
});
