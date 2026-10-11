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
        this.registerForm = document.getElementById('register-form');
        this.registerForm?.addEventListener('submit', event => this.handleRegister(event));
        document.getElementById('show-login')?.addEventListener('click', () => this.showForm(false));
        document.getElementById('show-register')?.addEventListener('click', () => this.showForm(true));
    }

    showForm(register) {
        this.loginForm.classList.toggle('hidden', register);
        this.registerForm.classList.toggle('hidden', !register);
        for (const [id, active] of [['show-login', !register], ['show-register', register]]) {
            const button = document.getElementById(id);
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        }
        this.setStatus(register ? 'Use the registration code provided for your role.' : 'Sign in with your clinic account.');
    }

    async handleRegister(event) {
        event.preventDefault();
        if (this.registering) return;
        if (!this.client) return this.setStatus('Supabase is not configured. Contact your clinic administrator.');
        const value = id => document.getElementById(id).value;
        const password = value('register-password');
        const name = value('register-name').trim();
        const role = value('register-role');
        if (!name || !['admin', 'doctor', 'secretary'].includes(role)) return this.setStatus('Enter your name and select a role.');
        if (password.length < 6) return this.setStatus('Use a password with at least 6 characters.');
        if (password !== value('register-confirm')) return this.setStatus('Passwords do not match.');
        const code = value('register-code').trim();
        if (!code) return this.setStatus('Enter the registration code for your role.');
        const button = this.registerForm.querySelector('button[type="submit"]');
        this.registering = true;
        button.disabled = true;
        this.setStatus('Creating your account...');
        try {
            const { data, error } = await this.client.auth.signUp({
                email: value('register-email').trim(), password,
                options: { data: { full_name: name, role, registration_code: code } }
            });
            if (error) throw error;
            if (!data?.user || data.user.identities?.length === 0) {
                this.setStatus('An account may already exist for this email. Try signing in or contact your administrator.');
                return;
            }
            if (data.session) {
                const dashboard = await this.resolveDashboard(data.user);
                if (dashboard) {
                    this.registerForm.reset();
                    window.location.href = dashboard;
                    return;
                }
                await this.client.auth.signOut();
                this.setStatus('Login account created, but no active staff profile was found. Ask your administrator to check the registration SQL setup.');
                return;
            }
            this.loginEmail.value = value('register-email').trim();
            this.registerForm.reset();
            this.showForm(false);
            this.setStatus('Check your email to confirm your account, then log in. Contact your administrator if no confirmation email arrives.');
        } catch (error) {
            this.setStatus(/database error|registration code/i.test(error.message || '')
                ? 'Registration failed. Check that your code is unused, unexpired, and matches the selected role. Your administrator may also need to run the registration setup SQL.'
                : error.message || 'Could not register. Check your connection and try again.');
        } finally {
            this.registering = false;
            button.disabled = false;
        }
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
