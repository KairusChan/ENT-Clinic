class NotificationCenter {
    constructor(staff) {
        this.storageKey = `ent-notifications:${staff.id}`;
        this.items = [];
        try {
            const saved = JSON.parse(sessionStorage.getItem(this.storageKey) || '[]');
            if (Array.isArray(saved)) this.items = saved.filter(item => item && typeof item.key === 'string' && typeof item.title === 'string' && typeof item.body === 'string').slice(0, 50);
        } catch {}
    }
    init() {
        const topbar = document.querySelector('.topbar');
        if (!topbar) return;
        const logout = topbar.querySelector('.topbar-logout');
        const actions = document.createElement('div');
        actions.className = 'topbar-actions';
        this.root = document.createElement('div');
        this.root.className = 'notification-center';
        this.root.innerHTML = `<button class="notification-bell" type="button" aria-label="Notifications" aria-expanded="false" aria-controls="notification-panel">
            <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="notification-count" hidden></span></button>
            <section id="notification-panel" class="notification-panel" aria-label="Notifications" hidden>
                <div class="notification-heading"><h2>Notifications</h2><button type="button" class="outline" data-close>Close</button></div>
                <div class="notification-tools"><button type="button" class="outline" data-read>Mark all read</button></div>
                <div class="notification-list"></div>
            </section>`;
        this.bell = this.root.querySelector('.notification-bell');
        this.badge = this.root.querySelector('.notification-count');
        this.panel = this.root.querySelector('.notification-panel');
        this.list = this.root.querySelector('.notification-list');
        this.bell.addEventListener('click', () => this.toggle());
        this.root.querySelector('[data-close]').addEventListener('click', () => { this.close(); this.bell.focus(); });
        this.root.querySelector('[data-read]').addEventListener('click', () => this.markAllRead());
        document.addEventListener('click', event => { if (!this.root.contains(event.target)) this.close(); });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !this.panel.hidden) { this.close(); this.bell.focus(); }
        });
        actions.append(this.root);
        if (logout) actions.append(logout);
        topbar.append(actions);
        this.render();
    }
    safeRoute(route) {
        return ['queue.html', 'schedule.html', 'search.html#patient-deletion', 'search.html#consultation-transfer'].includes(route) ? route : 'schedule.html';
    }
    add(key, title, body, route) {
        if (this.items.some(item => item.key === key)) return;
        this.items.unshift({key, title, body, route: this.safeRoute(route), read: false, at: new Date().toISOString()});
        this.items = this.items.slice(0, 50);
        this.save();
        this.render();
    }
    markAllRead() {
        this.items.forEach(item => { item.read = true; });
        this.save();
        this.render();
    }
    toggle() {
        this.panel.hidden = !this.panel.hidden;
        this.bell.setAttribute('aria-expanded', String(!this.panel.hidden));
    }
    close() {
        this.panel.hidden = true;
        this.bell.setAttribute('aria-expanded', 'false');
    }
    save() {
        try { sessionStorage.setItem(this.storageKey, JSON.stringify(this.items)); } catch {}
    }
    render() {
        if (!this.bell) return;
        const unread = this.items.filter(item => !item.read).length;
        this.badge.hidden = unread === 0;
        this.badge.textContent = unread > 9 ? '9+' : String(unread);
        this.bell.setAttribute('aria-label', `Notifications, ${unread} unread`);
        this.root.querySelector('[data-read]').disabled = unread === 0;
        this.list.replaceChildren();
        if (!this.items.length) {
            const empty = document.createElement('p');
            empty.className = 'notification-empty';
            empty.textContent = 'No notifications yet. Updates, approval requests, and reminders will appear here.';
            this.list.append(empty);
        }
        this.items.forEach(item => {
            const link = document.createElement('a');
            link.href = this.safeRoute(item.route);
            link.className = `notification-entry${item.read ? '' : ' is-unread'}`;
            const title = document.createElement('strong'); title.textContent = item.title;
            const body = document.createElement('p'); body.textContent = item.body;
            const time = document.createElement('time'); time.textContent = new Date(item.at).toLocaleString();
            link.append(title, body, time);
            link.addEventListener('click', () => { item.read = true; this.save(); });
            this.list.append(link);
        });
    }
}
window.NotificationCenter = NotificationCenter;
