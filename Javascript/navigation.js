document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.querySelector('.navigation-toggle');
    const sidebar = document.getElementById('workspace-navigation');
    if (!toggle || !sidebar) return;

    const mobile = window.matchMedia('(max-width: 980px)');
    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'navigation-backdrop';
    backdrop.setAttribute('aria-label', 'Close navigation');
    backdrop.tabIndex = -1;
    document.body.appendChild(backdrop);

    function setOpen(open, restoreFocus = false) {
        document.body.classList.toggle('navigation-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Collapse navigation' : 'Expand navigation');
        sidebar.inert = !open;
        backdrop.hidden = !open || !mobile.matches;
        if (restoreFocus) toggle.focus();
    }

    document.body.classList.add('navigation-ready');
    toggle.hidden = false;
    setOpen(!mobile.matches);
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    backdrop.addEventListener('click', () => setOpen(false, true));
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
            setOpen(false, true);
        }
    });
    mobile.addEventListener('change', () => setOpen(!mobile.matches, sidebar.contains(document.activeElement)));
});
