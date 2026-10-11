class ChangePasswordController {
    constructor(form) {
        this.form = form;
        this.status = document.getElementById('password-status');
        this.button = form.querySelector('[type="submit"]');
        form.addEventListener('submit', event => this.save(event));
    }
    async save(event) {
        event.preventDefault();
        if (this.saving) return;
        const password = this.form.elements.new_password.value;
        const confirmation = this.form.elements.confirm_password.value;
        if (password.length < 6) {
            this.status.textContent = 'Use a password with at least 6 characters.';
            return;
        }
        if (password !== confirmation) {
            this.status.textContent = 'Passwords do not match.';
            return;
        }
        this.saving = true;
        this.button.disabled = true;
        this.status.textContent = 'Changing password...';
        try {
            const {error} = await window.entSupabase.auth.updateUser({password});
            if (error) throw error;
            this.form.reset();
            this.status.textContent = 'Password changed successfully. Use your new password the next time you sign in.';
        } catch (error) {
            this.status.textContent = error.message || 'Unable to change your password. Please try again.';
        } finally {
            this.saving = false;
            this.button.disabled = false;
        }
    }
}
document.addEventListener('DOMContentLoaded', async () => {
    if (!await window.entSessionReady) return;
    const form = document.getElementById('change-password-form');
    new ChangePasswordController(form);
    form.querySelector('[type="submit"]').disabled = false;
});
