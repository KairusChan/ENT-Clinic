document.addEventListener('DOMContentLoaded', async () => {
    const password = document.getElementById('login-password');
    const toggle = document.getElementById('toggle-password');
    toggle.addEventListener('click', () => {
        const show = password.type === 'password';
        password.type = show ? 'text' : 'password';
        toggle.textContent = show ? 'Hide' : 'Show';
        toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        toggle.setAttribute('aria-pressed', String(show));
    });
    const panel = document.getElementById('login-permission');
    const button = document.getElementById('enable-login-notifications');
    const status = document.getElementById('login-permission-status');
    const native = window.entLoginNotifications;
    if (!native && (!('Notification' in window) || !window.isSecureContext)) return;
    try {
        const permission = native ? await native.check() : Notification.permission;
        if (permission === 'granted') return;
        panel.hidden = false;
        if (permission === 'denied') {
            status.textContent = 'Notifications are blocked. Enable them in your browser or app settings.';
            button.hidden = true;
        }
    } catch { panel.hidden = false; }
    button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            const permission = native ? await native.request() : await Notification.requestPermission();
            status.textContent = permission === 'granted' ? 'Notifications enabled. Sign in to receive your clinic alerts.' : 'Notifications are not enabled. You can enable them later in settings.';
            button.hidden = permission === 'granted';
        } catch { status.textContent = 'Unable to enable notifications. Please check your device settings.'; }
        finally { button.disabled = false; }
    });
});
