// Requests and decisions are authorized and performed atomically by database RPCs.
document.addEventListener('DOMContentLoaded', async () => {
    if (!await window.entSessionReady) return;
    const role = window.entStaff?.role;
    const root = document.getElementById('patient-deletion');
    if (!root || !['secretary', 'doctor'].includes(role)) return;
    const client = window.entSupabase;
    const patientId = new URLSearchParams(window.location.search).get('id');
    const element = (tag, text, className) => {
        const node = document.createElement(tag);
        if (text) node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    const dropdown = element('details', '', 'approval-dropdown');
    const heading = element('summary', '', 'approval-summary');
    const title = element('div', '', 'deletion-title');
    title.append(element('span', 'Patient records', 'eyebrow'),
        element('h2', role === 'doctor' ? 'Patient deletion approvals' : 'Request patient deletion'),
        element('p', role === 'doctor' ? 'Review requests from your secretary before removing a patient record.' : 'Send a removal request to the doctor for review.', 'deletion-subtitle'));
    const status = element('p', '', 'deletion-status');
    status.setAttribute('role', 'status');
    const content = element('div', '', 'deletion-content');
    const refresh = element('button', 'Refresh requests', 'outline deletion-refresh');
    refresh.type = 'button';
    heading.append(title);
    const body = element('div', '', 'approval-body');
    const toolbar = element('div', '', 'approval-toolbar');
    toolbar.append(refresh);
    body.append(toolbar, status, content);
    dropdown.append(heading, body);
    root.append(dropdown);
    const revealRequest = () => {
        if (window.location.hash === '#patient-deletion') {
            dropdown.open = true;
            root.scrollIntoView?.({behavior: 'smooth', block: 'start'});
        }
    };
    window.addEventListener?.('hashchange', revealRequest);
    revealRequest();
    let busy = false;
    async function load() {
        content.replaceChildren();
        status.textContent = 'Loading deletion requests...';
        try {
            let query = client.from('patient_deletion_requests').select('*').order('created_at', { ascending: false });
            query = role === 'doctor' ? query.eq('status', 'pending') : query.eq('patient_id', patientId);
            const { data, error } = await query;
            if (error) throw error;
            status.textContent = data.length ? '' : 'No deletion requests.';
            for (const request of data) {
                const row = element('article', '', 'deletion-request');
                const rowHeading = element('div', '', 'deletion-request-heading');
                const state = ['pending', 'approved', 'rejected'].includes(request.status) ? request.status : 'pending';
                rowHeading.append(element('h3', request.patient_label), element('span', `Status: ${request.status}`, `deletion-badge deletion-badge-${state}`));
                const reasonBlock = element('div', '', 'deletion-reason');
                reasonBlock.append(element('span', 'Reason for deletion', 'deletion-label'), element('p', request.reason));
                row.append(rowHeading, reasonBlock);
                if (request.resolution_reason) row.append(element('p', request.resolution_reason, 'deletion-notice'));
                if (role === 'doctor') {
                    const actions = element('div', '', 'deletion-actions');
                    const link = element('a', 'Review patient profile', 'outline');
                    link.href = `profile.html?id=${encodeURIComponent(request.patient_id)}`;
                    actions.append(link);
                    for (const approve of [true, false]) {
                        const button = element('button', approve ? 'Approve deletion' : 'Reject request', approve ? 'outline deletion-danger' : 'outline');
                        button.type = 'button';
                        button.addEventListener('click', async () => {
                            if (busy) return;
                            if (approve && !window.confirm(`Permanently delete ${request.patient_label} and all their appointments, including waiting or active visits? Pending transfers involving this record will be rejected. Saved notes must be transferred first.`)) return;
                            busy = true;
                            button.disabled = true;
                            try {
                                const { error } = await client.rpc('review_patient_deletion', { p_request_id: request.id, p_approve: approve });
                                if (error) throw error;
                                if (approve) window.dispatchEvent(new Event('patient-deleted'));
                                await load();
                                status.textContent = approve ? 'Deletion approved. Patient record deleted.' : 'Request rejected. Patient record retained.';
                            } catch (error) { status.textContent = error.message || 'Unable to review request. Refresh to check its status.'; }
                            finally { busy = false; button.disabled = false; }
                        });
                        actions.append(button);
                    }
                    row.append(actions);
                }
                content.append(row);
            }
            if (role === 'secretary' && patientId && !data.some(request => request.status === 'pending')) {
                const form = element('form', '', 'deletion-form');
                const field = element('div', '', 'field');
                const label = element('label', 'Reason for deletion (required)');
                label.htmlFor = 'deletion-reason';
                const reason = element('textarea');
                reason.id = 'deletion-reason';
                reason.rows = 4;
                reason.placeholder = 'Explain why this record should be removed, e.g. a duplicate registration. Include the patient ID to keep, if applicable.';
                reason.setAttribute('aria-describedby', 'deletion-reason-hint');
                reason.required = true;
                reason.maxLength = 1000;
                const hint = element('small', 'Maximum 1,000 characters.', 'deletion-hint');
                hint.id = 'deletion-reason-hint';
                field.append(label, reason, hint);
                const button = element('button', 'Ask doctor to approve deletion', 'primary');
                button.type = 'submit';
                const actions = element('div', '', 'deletion-actions');
                actions.append(button);
                form.append(element('p', 'Only a doctor can approve deletion. Waiting or active visits do not block approval and will be removed with the patient. You may request deletion while a transfer is pending, but saved notes must be transferred before deletion is approved. Pending deletion pauses normal consultation changes; approved transfers can still proceed.', 'deletion-notice'), field, actions);
                form.addEventListener('submit', async event => {
                    event.preventDefault();
                    if (busy || !reason.value.trim()) return;
                    busy = true;
                    button.disabled = true;
                    try {
                        const { error } = await client.rpc('request_patient_deletion', { p_patient_id: patientId, p_reason: reason.value.trim() });
                        if (error) throw error;
                        await load();
                        status.textContent = 'Request sent. A doctor can approve or reject it from Patient Lists.';
                    } catch (error) { status.textContent = error.message || 'Unable to confirm request. Refresh to check its status.'; }
                    finally { busy = false; button.disabled = false; }
                });
                content.append(form);
            }
        } catch (error) { status.textContent = `Unable to load deletion requests: ${error.message || 'Please try again.'}`; }
    }
    refresh.addEventListener('click', () => { if (!busy) load(); });
    await load();
});
