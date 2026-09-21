-- Optional: run only after deploying send-schedule-push and enabling pg_cron/pg_net.
-- First create these secrets in Supabase Vault using the Dashboard:
-- schedule_push_url = https://YOUR_PROJECT.supabase.co/functions/v1/send-schedule-push
-- schedule_push_cron_secret = the same SCHEDULE_PUSH_CRON_SECRET used by the Edge Function.
-- Never put the Firebase private key in this SQL or in web assets.
select cron.schedule(
    'ent-schedule-push-every-minute',
    '* * * * *',
    $$
    select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'schedule_push_url'),
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
            (select decrypted_secret from vault.decrypted_secrets where name = 'schedule_push_cron_secret')),
        body := '{}'::jsonb
    );
    $$
);
