class AuthController {
    constructor() {
        this.loginForm = document.getElementById('login-form');
        this.loginEmail = document.getElementById('login-email');
        this.loginPassword = document.getElementById('login-password');
        this.status = document.querySelector('.auth-note');
        this.client = window.entSupabase;
    }

    init() {
        this.bindFormEvents();
    }

    bindFormEvents() {
        this.loginForm.addEventListener('submit', (event) => this.handleLogin(event));
    }

    async handleLogin(event) {
        event.preventDefault();

        if (!this.client) {
            this.setStatus('Add your Supabase URL and anon key in Javascript/supabase-config.js first.');
            return;
        }

        this.setStatus('Signing in...');
        const { data, error } = await this.client.auth.signInWithPassword({
            email: this.loginEmail.value,
            password: this.loginPassword.value
        });

        if (error) {
            this.setStatus(error.message);
            return;
        }

        const dashboard = await this.resolveDashboard(data.user);
        if (dashboard) {
            window.location.href = dashboard;
        } else {
            await this.client.auth.signOut();
            this.setStatus('This account does not have an active clinic role.');
        }
    }

    async resolveDashboard(user) {
        const { data: staffMember } = await this.client
            .from('staff')
            .select('role, is_active')
            .eq('id', user.id)
            .maybeSingle();

        if (staffMember && staffMember.is_active === false) {
            return null;
        }

        if (staffMember?.role === 'admin') {
            return 'Admin/index.html';
        }

        if (staffMember?.role === 'doctor') {
            return 'Doctor/index.html';
        }

        if (staffMember?.role === 'secretary') {
            return 'Secretary/index.html';
        }

        return null;
    }

    setStatus(message) {
        this.status.textContent = message;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const authController = new AuthController();
    authController.init();
});
