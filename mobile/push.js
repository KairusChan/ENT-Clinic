import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { installLocalDoctorNotifications } from './local-notifications.js';
if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    const firebaseConfigured = typeof ENT_FIREBASE_CONFIGURED === 'undefined' || ENT_FIREBASE_CONFIGURED;
    window.entLoginNotifications = {
        async check() {
            const permission = firebaseConfigured ? await PushNotifications.checkPermissions() : await LocalNotifications.checkPermissions();
            return permission.receive || permission.display;
        },
        async request() {
            const permission = firebaseConfigured ? await PushNotifications.requestPermissions() : await LocalNotifications.requestPermissions();
            return permission.receive || permission.display;
        }
    };
    if (!firebaseConfigured) {
        installLocalDoctorNotifications();
    } else {
    let setup;
    let token;
    let registrationResolve;
    let registrationReject;
    let inFlight;
    const performRegistration = async () => {
        await (setup ||= (async () => {
            await PushNotifications.createChannel({id:'schedule',name:'Clinic schedule',description:'Operations and events',importance:4,visibility:0,sound:'default'});
            await PushNotifications.addListener('registration', async result => {
                token = result.value;
                try {
                    const staff = window.entStaff;
                    if (!staff || staff.role !== 'doctor') throw Error('Sign in as a doctor first.');
                    const {error} = await window.entSupabase.from('push_devices').upsert({token,user_id:staff.id,updated_at:new Date().toISOString()},{onConflict:'token'});
                    if (error) throw error;
                    registrationResolve?.();
                } catch(error) { registrationReject?.(error); }
            });
            await PushNotifications.addListener('registrationError', () => registrationReject?.(Error('Android push registration failed. Check Firebase configuration.')));
            await PushNotifications.addListener('pushNotificationActionPerformed', action => {
                const page = action.notification.data?.route === 'queue' ? 'queue.html' : 'schedule.html';
                location.href = new URL(`../Doctor/${page}`, location.href).href;
            });
        })());
        return new Promise((resolve,reject) => {
            const timer = setTimeout(() => reject(Error('Push registration timed out. Check your connection and Firebase setup.')),20000);
            registrationResolve = () => {clearTimeout(timer);resolve();};
            registrationReject = error => {clearTimeout(timer);reject(error);};
            PushNotifications.register().catch(registrationReject);
        });
    };
    const register = () => inFlight ||= performRegistration().finally(() => { inFlight = undefined; });
    window.entNativePush = {
        async enable() {
            if (!firebaseConfigured) throw Error('This test APK has no Firebase configuration. Add google-services.json and rebuild to enable phone notifications.');
            let permission = await PushNotifications.checkPermissions();
            if (permission.receive !== 'granted') permission = await PushNotifications.requestPermissions();
            if (permission.receive !== 'granted') throw Error('Allow notifications in Android app settings to enable phone alerts.');
            await register();
        },
        async disconnect() {
            if (!firebaseConfigured) return;
            // Unregister with Firebase before ending the clinic session.
            await PushNotifications.unregister();
            await PushNotifications.removeAllDeliveredNotifications();
            if (token && window.entSupabase) {
                const {error} = await window.entSupabase.from('push_devices').delete().eq('token',token);
                if (error) throw error;
            }
        }
    };
    document.addEventListener('DOMContentLoaded', async () => {
        if (!firebaseConfigured) return;
        if (!window.entSessionReady || !await window.entSessionReady || window.entStaff?.role !== 'doctor') return;
        try { if ((await PushNotifications.checkPermissions()).receive === 'granted') await register(); }
        catch { /* The explicit enable button reports setup failures and allows retry. */ }
    });
    }
}
