document.addEventListener('DOMContentLoaded', async () => {
    if (!await window.entSessionReady) return;
    const client = window.entSupabase;
    const admin = window.entStaff.role === 'admin' && !!document.getElementById('account-list');
    const form = document.getElementById('account-form');
    const status = document.getElementById('account-status');
    const list = document.getElementById('account-list');
    const passwordForm = document.getElementById('password-form');
    let busy = false;
    const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    async function load() {
        if (!admin) return;
        const { data, error } = await client.from('staff').select('id, full_name, role, is_active').in('role', ['doctor', 'secretary']).order('full_name');
        list.innerHTML = error ? `<p>${escape(error.message)}</p>` : data.map(staff => `<div class="result"><div class="result-info"><strong>${escape(staff.full_name)}</strong><small>${escape(staff.role)} · ${staff.is_active ? 'Active' : 'Disabled'}</small></div><div class="account-actions"><button type="button" class="outline" data-action="password" data-id="${escape(staff.id)}" data-name="${escape(staff.full_name)}">Change password</button><button type="button" class="outline" data-action="delete" data-id="${escape(staff.id)}" data-name="${escape(staff.full_name)}">Delete</button></div></div>`).join('') || '<p>No doctor or secretary accounts yet.</p>';
    }
    async function perform(body, success) {
        if (busy) return;
        busy = true;
        document.querySelectorAll('main button').forEach(button => { button.disabled = true; });
        status.textContent = 'Saving…';
        try {
            const { data, error } = await client.functions.invoke('manage-staff', { body });
            if (error) {
                let message = 'Unable to reach account management. Check your connection and ensure the manage-staff function is deployed.';
                try { message = (await error.context.json()).error || message; } catch { /* Network or deployment error. */ }
                throw new Error(message);
            }
            if (data?.error) throw new Error(data.error);
            status.textContent = data.message;
            success();
            await load();
        } catch (error) { status.textContent = error.message; }
        finally {
            busy = false;
            document.querySelectorAll('main button').forEach(button => { button.disabled = false; });
        }
    }
    form.addEventListener('submit', event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form));
        if (values.password !== values.confirm_password) { status.textContent = 'Passwords do not match.'; return; }
        delete values.confirm_password;
        perform({ ...values, action: 'create', role: admin ? values.role : 'secretary' }, () => form.reset());
    });
    if (admin) {
        list.addEventListener('click', event => {
            const button = event.target.closest('button[data-action]');
            if (!button || busy) return;
            if (button.dataset.action === 'delete') {
                if (window.confirm(`Delete ${button.dataset.name}'s login? This cannot be undone. Accounts linked to clinical records cannot be deleted.`)) perform({ action: 'delete', id: button.dataset.id }, () => { passwordForm.hidden = true; passwordForm.reset(); });
            } else {
                passwordForm.reset();
                passwordForm.elements.id.value = button.dataset.id;
                document.getElementById('password-heading').textContent = `Change password for ${button.dataset.name}`;
                passwordForm.hidden = false;
                passwordForm.elements.password.focus();
            }
        });
        passwordForm.addEventListener('submit', event => {
            event.preventDefault();
            if (passwordForm.elements.password.value !== passwordForm.elements.confirm_password.value) { status.textContent = 'Passwords do not match.'; return; }
            perform({ action: 'password', id: passwordForm.elements.id.value, password: passwordForm.elements.password.value }, () => { passwordForm.reset(); passwordForm.hidden = true; });
        });
        document.getElementById('password-cancel').addEventListener('click', () => { passwordForm.reset(); passwordForm.hidden = true; });
        await load();
    }
});
