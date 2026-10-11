import { LocalNotifications } from '@capacitor/local-notifications';
import { LocalDoctorAlerts, clearDoctorNotifications } from './local-alerts.js';

export function installLocalDoctorNotifications() {
    let controller, channel, timer, stopped = false;
    const limitation = 'New updates arrive while the app is open. Downloaded reminders work when closed; reopen to sync changes. Android may delay reminders.';
    const report = text => {
        const status = document.getElementById('doctor-phone-status');
        if (status) status.textContent = text;
    };
    const refresh = async () => {
        if (!controller || stopped) return;
        try {
            if ((await LocalNotifications.checkPermissions()).display !== 'granted') {
                report(`Tap Enable phone notifications to allow doctor alerts. ${limitation}`);
                return;
            }
            await controller.refresh();
            report(`Last synced ${new Date().toLocaleTimeString()}. ${limitation}`);
        } catch { report('Unable to sync doctor alerts. Check your connection and reopen the app. Previously downloaded reminders may be outdated.'); }
    };
    window.entNativePush = {
        mode:'local',
        async enable() {
            if (!controller || stopped) throw Error('Sign in as a doctor first.');
            return controller.enable();
        },
        async disconnect() {
            stopped = true;
            clearInterval(timer);
            if (channel) await window.entSupabase.removeChannel(channel);
            if (controller) await controller.disconnect();
            else await clearDoctorNotifications(LocalNotifications);
        }
    };
    document.addEventListener('DOMContentLoaded', async () => {
        try {
            await LocalNotifications.addListener('localNotificationActionPerformed', async action => {
                try { sessionStorage.setItem('ent-phone-destination', JSON.stringify(action.notification.extra || {})); } catch {}
                if (!await window.entSessionReady || window.entStaff?.role !== 'doctor' || action.notification.extra?.doctorId !== window.entStaff.id) return;
                try { sessionStorage.removeItem('ent-phone-destination'); } catch {}
                const page = action.notification.extra?.route === 'queue' ? 'queue.html' : 'schedule.html';
                location.href = new URL(`../Doctor/${page}`, location.href).href;
            });
            if (!window.entSessionReady || !await window.entSessionReady || window.entStaff?.role !== 'doctor') {
                await clearDoctorNotifications(LocalNotifications);
                return;
            }
            controller = new LocalDoctorAlerts(LocalNotifications, window.entSupabase, window.entStaff);
            try {
                const target = JSON.parse(sessionStorage.getItem('ent-phone-destination') || 'null');
                sessionStorage.removeItem('ent-phone-destination');
                if (target?.doctorId === window.entStaff.id) {
                    const page = target.route === 'queue' ? 'queue.html' : 'schedule.html';
                    const href = new URL(`../Doctor/${page}`, location.href).href;
                    if (href !== location.href) { location.href = href; return; }
                }
            } catch {}
            const panel = document.createElement('section');
            panel.className = 'panel section';
            const heading = document.createElement('h2'); heading.textContent = 'Doctor phone notifications';
            const status = document.createElement('p'); status.id = 'doctor-phone-status'; status.setAttribute('role','status'); status.textContent = limitation;
            const button = document.createElement('button'); button.type = 'button'; button.className = 'outline'; button.textContent = 'Enable phone notifications';
            button.addEventListener('click', async () => {
                button.disabled = true;
                try { report(await window.entNativePush.enable()); }
                catch (error) { report(error.message || 'Unable to enable phone notifications.'); }
                finally { button.disabled = false; }
            });
            const test = document.createElement('button'); test.type = 'button'; test.className = 'outline'; test.textContent = 'Send test notification';
            test.addEventListener('click', async () => {
                test.disabled = true;
                try {
                    await window.entNativePush.enable();
                    await LocalNotifications.schedule({notifications:[controller.notification(2100000001, 'test', 'Doctor notifications are working', 'Your phone can display ENT Clinic alerts.', 'schedule')]});
                    report(`Test notification sent. ${limitation}`);
                } catch (error) { report(error.message || 'Unable to send a test notification.'); }
                finally { test.disabled = false; }
            });
            panel.append(heading, status, button, document.createTextNode(' '), test);
            document.querySelector('main')?.appendChild(panel);
            // Realtime accelerates delivery; polling also works without a publication migration.
            channel = window.entSupabase.channel(`doctor-phone-${window.entStaff.id}`)
                .on('postgres_changes', {event:'*', schema:'public', table:'visits', filter:`doctor_id=eq.${window.entStaff.id}`}, refresh)
                .subscribe();
            timer = setInterval(refresh, 30000);
            document.addEventListener('visibilitychange', () => { if (!document.hidden && !stopped) refresh(); });
            window.addEventListener('pagehide', () => { clearInterval(timer); if (channel) window.entSupabase.removeChannel(channel); }, {once:true});
            if ((await LocalNotifications.checkPermissions()).display === 'granted') report(await controller.enable());
        } catch (error) { report(error.message || 'Unable to initialize phone notifications.'); }
    });
}
