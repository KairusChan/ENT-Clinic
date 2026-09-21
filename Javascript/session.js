window.entSessionReady = (async () => {
    const client = window.entSupabase;
    if (!client) return false;
    try {
        const { data: { user }, error } = await client.auth.getUser();
        if (error || !user) { location.replace('../index.html'); return false; }
        const { data: staff, error: staffError } = await client.from('staff').select('id, role, is_active').eq('id', user.id).maybeSingle();
        if (staffError || !staff?.is_active) { location.replace('../index.html'); return false; }
        const folders = { doctor: 'Doctor', secretary: 'Secretary', admin: 'Admin' };
        const folder = folders[staff.role];
        if (!folder) { location.replace('../index.html'); return false; }
        if (!location.pathname.includes('/' + folder + '/') && staff.role !== 'admin') {
            location.replace('../' + folder + '/index.html'); return false;
        }
        window.entStaff = staff;
        return true;
    } catch { location.replace('../index.html'); return false; }
})();
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.logout-link').forEach(link => link.addEventListener('click', async event => {
        event.preventDefault();
        try { if (window.entNativePush) await window.entNativePush.disconnect(); }
        catch {
            window.alert('Unable to disconnect phone notifications. Check your connection and try signing out again.');
            return;
        }
        if (window.entSupabase) await window.entSupabase.auth.signOut();
        location.replace('../index.html');
    }));
    if (!window.entSupabase) {
        const message = document.createElement('p');
        message.textContent = 'Connect Supabase to use the clinic workspace.';
        document.querySelector('main')?.prepend(message);
    }
});
