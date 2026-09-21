import { createClient } from 'npm:@supabase/supabase-js@2';
import { SignJWT, importPKCS8 } from 'npm:jose@6';

// Invoked every minute by a server scheduler with x-cron-secret. Not a client API.
Deno.serve(async request => {
    const secret = Deno.env.get('SCHEDULE_PUSH_CRON_SECRET');
    if (request.method !== 'POST' || !secret || request.headers.get('x-cron-secret') !== secret) return new Response('Unauthorized', {status:401});
    try {
        const account = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT') || '{}');
        if (!account.project_id || !account.private_key || !account.client_email) throw Error('Missing Firebase service account');
        const key = await importPKCS8(account.private_key, 'RS256');
        const assertion = await new SignJWT({scope:'https://www.googleapis.com/auth/firebase.messaging'})
            .setProtectedHeader({alg:'RS256'}).setIssuer(account.client_email).setAudience('https://oauth2.googleapis.com/token')
            .setIssuedAt().setExpirationTime('1h').sign(key);
        const oauth = await fetch('https://oauth2.googleapis.com/token', {method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(15000)});
        const credentials = await oauth.json();
        if (!oauth.ok || !credentials.access_token) throw Error('Firebase authorization failed');
        const db = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const {data:jobs,error} = await db.rpc('claim_schedule_push_jobs');
        if (error) throw error;
        let sent = 0;
        for (const job of jobs || []) {
            try {
                const {data:currentJob,error:jobError} = await db.from('schedule_push_jobs').select('id').eq('id',job.id).maybeSingle();
                if (jobError) throw jobError;
                if (!currentJob) continue;
                const {data:staff,error:staffError} = await db.from('staff').select('is_active,role').eq('id',job.user_id).maybeSingle();
                if (staffError) throw staffError;
                const {data:visit,error:visitError} = await db.from('visits').select('doctor_id,kind,status,checked_in_at,ends_at').eq('id',job.visit_id).maybeSingle();
                if (visitError) throw visitError;
                const eligible = staff?.is_active && staff.role === 'doctor' && visit?.doctor_id === job.user_id && ['operation','event'].includes(visit.kind)
                    && (job.category !== 'reminder' || (visit.status === 'scheduled' && new Date(visit.checked_in_at).getTime() === new Date(job.scheduled_start).getTime() && new Date(visit.ends_at) > new Date()));
                if (eligible) {
                    const {data:devices,error:deviceError} = await db.from('push_devices').select('token').eq('user_id',job.user_id);
                    if (deviceError) throw deviceError;
                    for (const device of devices || []) {
                        if (job.sent_tokens.includes(device.token)) continue;
                        // Generic lock-screen content: patient details stay inside the authenticated app.
                        const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
                            method:'POST',headers:{Authorization:`Bearer ${credentials.access_token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
                            body:JSON.stringify({message:{token:device.token,notification:{title:job.category === 'reminder' ? 'Upcoming clinic schedule' : 'Clinic schedule updated',body:'Open My Schedule to review your operations and events.'},data:{visit_id:String(job.visit_id),job_id:String(job.id)},android:{priority:'high',ttl:'300s',notification:{channel_id:'schedule',tag:`schedule-${job.id}`,sound:'default'}}}})
                        });
                        if (!response.ok) {
                            const result = await response.json();
                            const unregistered = result.error?.details?.some((item: {errorCode?:string}) => item.errorCode === 'UNREGISTERED');
                            if (unregistered) {
                                const {error:removeError} = await db.from('push_devices').delete().eq('token',device.token);
                                if (removeError) throw removeError;
                            } else throw Error(`FCM delivery failed (${response.status})`);
                        } else sent++;
                        job.sent_tokens.push(device.token);
                        const {error:progressError} = await db.from('schedule_push_jobs').update({sent_tokens:job.sent_tokens}).eq('id',job.id);
                        if (progressError) throw progressError;
                    }
                }
                const {error:finishError} = await db.from('schedule_push_jobs').update({finished_at:new Date().toISOString()}).eq('id',job.id);
                if (finishError) throw finishError;
            } catch {
                // Retries are bounded; inspect unfinished jobs with attempts >= 8 for failures.
                await db.from('schedule_push_jobs').update({locked_until:null,run_at:new Date(Date.now()+Math.min(3600,2**job.attempts*30)*1000).toISOString()}).eq('id',job.id);
            }
        }
        return Response.json({claimed:jobs?.length || 0,sent});
    } catch {
        return new Response('Push sender configuration or database error', {status:500});
    }
});
