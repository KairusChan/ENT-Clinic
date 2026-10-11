document.addEventListener('DOMContentLoaded', async () => {
    const client = window.entSupabase;
    const requestForm = document.getElementById('recovery-request');
    const resetForm = document.getElementById('recovery-reset');
    const status = document.getElementById('recovery-status');
    let busy = false;
    if (!client) { status.textContent = 'Unable to connect. Contact your clinic administrator.'; return; }
    const reveal = () => { requestForm.hidden = true; resetForm.hidden = false; status.textContent = 'Enter your new password.'; };
    client.auth.onAuthStateChange(event => { if (event === 'PASSWORD_RECOVERY') reveal(); });
    const {data, error} = await client.auth.getSession();
    if (!error && data.session) reveal();
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has('error_description')) status.textContent = 'This recovery link is invalid or expired. Request a new link.';
    requestForm.addEventListener('submit', async event => {
        event.preventDefault(); if (busy) return;
        busy = true; const button = requestForm.querySelector('button'); button.disabled = true;
        try {
            const native = Boolean(window.entLoginNotifications);
            const configured = window.ENT_SUPABASE_CONFIG?.recoveryUrl;
            if (native && !configured) throw Error('Open Forgot password on the clinic website to receive a recovery link.');
            const redirectTo = configured || new URL('reset-password.html', location.href).href;
            const {error} = await client.auth.resetPasswordForEmail(requestForm.elements.email.value.trim(), {redirectTo});
            if (error) throw error;
            status.textContent = 'If this email is registered, a password reset link has been sent. Check your inbox and spam folder.';
        } catch (error) { status.textContent = error.message || 'Unable to send the reset link. Try again.'; }
        finally { busy = false; button.disabled = false; }
    });
    resetForm.addEventListener('submit', async event => {
        event.preventDefault(); if (busy) return;
        const password = resetForm.elements.password.value;
        if (password.length < 6) { status.textContent = 'Use at least 6 characters.'; return; }
        if (password !== resetForm.elements.confirm_password.value) { status.textContent = 'Passwords do not match.'; return; }
        busy = true; const button = resetForm.querySelector('button'); button.disabled = true;
        try {
            const {error} = await client.auth.updateUser({password});
            if (error) throw error;
            resetForm.reset(); resetForm.hidden = true;
            status.textContent = 'Password updated. Return to Login and use your new password.';
            await client.auth.signOut({scope: 'local'});
        } catch (error) { status.textContent = error.message || 'Unable to update password. Request a new link and try again.'; }
        finally { busy = false; button.disabled = false; }
    });
});