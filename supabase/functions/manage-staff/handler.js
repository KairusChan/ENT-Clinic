const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
export function createHandler(client) {
    return async request => {
        const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
        if (request.method === 'OPTIONS') return new Response(null, { headers });
        if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });
        try {
            const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
            if (!token) return reply(401, { error: 'Sign in first.' });
            const { data: { user }, error: authError } = await client.auth.getUser(token);
            if (authError || !user) return reply(401, { error: 'Your session has expired. Sign in again.' });
            const { data: actor, error: actorError } = await client.from('staff').select('role, is_active').eq('id', user.id).maybeSingle();
            if (actorError || !actor?.is_active || !['admin', 'doctor'].includes(actor.role)) return reply(403, { error: 'You cannot manage accounts.' });
            let body;
            try { body = await request.json(); } catch { return reply(400, { error: 'Invalid request.' }); }
            if (!body || typeof body !== 'object') return reply(400, { error: 'Invalid request.' });
            const { action, role, id, password } = body;
            if (!['create', 'delete', 'password'].includes(action)) return reply(400, { error: 'Unknown action.' });
            if (actor.role === 'doctor' && (action !== 'create' || role !== 'secretary')) return reply(403, { error: 'Doctors can only create secretary accounts.' });
            if (action !== 'delete' && (typeof password !== 'string' || password.length < 6 || password.length > 128)) return reply(400, { error: 'Use a password of 8–128 characters.' });
            if (action === 'create') {
                const name = typeof body.full_name === 'string' ? body.full_name.trim() : '';
                const email = typeof body.email === 'string' ? body.email.trim() : '';
                if (!['doctor', 'secretary'].includes(role) || !name || name.length > 150 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'Enter a valid name, email and account role.' });
                // The profile trigger runs in the same transaction as Auth creation.
                const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role }, user_metadata: { full_name: name } });
                if (error) return reply(400, { error: error.message });
                const { data: profile, error: profileError } = await client.from('staff').select('role').eq('id', data.user.id).maybeSingle();
                if (profileError || profile?.role !== role) {
                    const { error: cleanupError } = await client.auth.admin.deleteUser(data.user.id);
                    return reply(500, { error: cleanupError ? 'Staff setup failed and the login could not be removed. Ask the administrator to review this email in Supabase Auth before retrying.' : 'Staff setup is incomplete. Apply the staff accounts migration before creating accounts.' });
                }
                return reply(200, { message: 'Account created. The staff member can now sign in.' });
            }
            if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) || id === user.id) return reply(400, { error: 'Select another staff account.' });
            const { data: target, error: targetError } = await client.from('staff').select('role').eq('id', id).maybeSingle();
            if (targetError) return reply(500, { error: 'Unable to load the staff account.' });
            if (!target || !['doctor', 'secretary'].includes(target.role)) return reply(403, { error: 'Only doctor and secretary accounts can be managed here.' });
            const { error } = action === 'password'
                ? await client.auth.admin.updateUserById(id, { password })
                : await client.auth.admin.deleteUser(id);
            if (error) return reply(400, { error: action === 'delete' ? 'Unable to delete this account. Accounts linked to clinical records or stored files must be retained; disable access from the dashboard instead.' : error.message });
            return reply(200, { message: action === 'delete' ? 'Account deleted.' : 'Password changed.' });
        } catch {
            return reply(500, { error: 'Account service unavailable. Try again.' });
        }
    };
}
