class SupabaseClientFactory {
    static create() {
        const config = window.ENT_SUPABASE_CONFIG;
        const isConfigured = config
            && !config.url.startsWith('YOUR_')
            && !config.anonKey.startsWith('YOUR_');

        if (!isConfigured || !window.supabase) {
            return null;
        }

        return window.supabase.createClient(config.url, config.anonKey);
    }
}

window.entSupabase = SupabaseClientFactory.create();
