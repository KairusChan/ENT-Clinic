const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
test('consultations go to the queue with a fixed kind, and failures retain input', async () => {
    const button = {disabled:false};
    const form = {fields:{patient_id:'7',doctor_id:'doctor-1',reason:' Ear pain ',kind:'event'},querySelector:()=>button};
    const status = {textContent:''};
    const context = {window:{location:{}},document:{addEventListener(){},getElementById:id=>id==='appointment-form'?form:status},FormData:class {constructor(form){return Object.entries(form.fields);}}};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('Javascript/appointment.js','utf8')+'\nthis.Controller = AppointmentController;',context);
    const controller = new context.Controller();
    let saved;
    controller.client = {from:()=>({insert:async data=>{saved=data;return {error:{message:'Offline'}};}})};
    await controller.save({preventDefault(){}});
    assert.equal(saved.kind,'appointment'); assert.equal(saved.status,'waiting'); assert.equal(saved.reason,'Ear pain');
    assert.equal(saved.checked_in_at,undefined); assert.equal(saved.ends_at,undefined);
    assert.equal(button.disabled,false); assert.equal(form.fields.patient_id,'7');
    assert.match(status.textContent,/Check today's queue/);
    controller.client = {from:()=>({insert:async()=>({error:null})})};
    await controller.save({preventDefault(){}});
    assert.equal(context.window.location.href,'queue.html');
});
test('editing a selected patient clears its ID and stale searches cannot replace newer results', async () => {
    const listeners = {};
    const input = {value:'',form:{addEventListener(){}},addEventListener:(name,fn)=>listeners[name]=fn,setCustomValidity(value){this.validation=value;}};
    const value = {value:''};
    const results = {children:[],replaceChildren(){this.children=[];},append(child){this.children.push(child);}};
    const status = {textContent:''};
    const root = {querySelector:selector=>({'[data-patient-search]':input,'[name="patient_id"]':value,'[data-patient-results]':results,'[role="status"]':status})[selector]};
    const context = {window:{},setTimeout:()=>1,clearTimeout(){},document:{createElement:()=>({addEventListener(){}})}};
    vm.createContext(context);vm.runInContext(fs.readFileSync('Javascript/patient-picker.js','utf8'),context);
    const pending=[];
    const query={select(){return this;},or(){return this;},order(){return this;},limit(){return new Promise(resolve=>pending.push(resolve));}};
    const picker=new context.window.PatientPicker(root,{from:()=>query});
    picker.choose({id:7,first_name:'Ana',last_name:'Cruz',date_of_birth:'2000-01-01'});
    assert.equal(value.value,7); assert.match(input.value,/2000-01-01/);
    input.value='Ana';listeners.input();assert.equal(value.value,'');assert.match(input.validation,/Choose/);
    const old=picker.search(picker.request);
    input.value='Maria';listeners.input();const fresh=picker.search(picker.request);
    pending[1]({data:[{id:8,first_name:'Maria',last_name:'Cruz'}]});await fresh;
    pending[0]({data:[{id:7,first_name:'Ana',last_name:'Cruz'}]});await old;
    assert.equal(results.children.length,1);assert.match(results.children[0].textContent,/Maria/);
});
function schedule(role = 'secretary') {
    const elements = {};
    const context = { window: { entStaff: { role, id: 'doctor-1' } }, document: {
        getElementById: id => elements[id] ||= { textContent: '', value: '', innerHTML: '', querySelectorAll: () => [] }, addEventListener() {}
    }, Date, URLSearchParams, location: {search:''}, FormData: class { constructor(form) { return Object.entries(form.fields); } } };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('Javascript/schedule.js', 'utf8') + '\nthis.Controller = ScheduleController;', context);
    const controller = new context.Controller();
    const button = {disabled:false};
    controller.form = {querySelector: () => button, reset() { this.didReset = true; }, fields: {
        patient_id:'2', doctor_id:'doctor-1', kind:'operation', reason:'Procedure', clinic_location:'Clinic',
        starts_at: new Date(Date.now() + 3600000).toISOString(), ends_at: new Date(Date.now() + 7200000).toISOString()
    }};
    controller.refresh = async () => {};
    return {controller, elements, button};
}
test('schedule Cancel deletes through the cancellation procedure and retains state on failure', async () => {
    const {controller}=schedule();
    let refreshed=0;
    controller.refresh=async()=>{refreshed++;};
    let error=null;
    controller.client={rpc:async(name,args)=>{
        assert.equal(name,'cancel_visit');
        assert.equal(args.p_visit_id,'8');
        assert.equal(args.p_expected_status,'scheduled');
        return {error};
    }};
    const button={disabled:false,dataset:{id:'8',action:'cancelled'}};
    await controller.update(button);
    assert.equal(refreshed,1);
    error={message:'Visit changed'};
    await controller.update(button);
    assert.equal(refreshed,1);
    assert.equal(button.disabled,false);
    assert.match(controller.status.textContent,/Visit changed/);
});
test('booking persists operation, doctor, times and reminder; only resets on success', async () => {
    const {controller, elements, button} = schedule();
    let saved;
    controller.client = {from: () => ({insert: async value => {saved=value; return {error:null};}})};
    await controller.book({preventDefault(){}});
    assert.equal(saved.kind, 'operation'); assert.equal(saved.status, 'scheduled');
    assert.equal(saved.doctor_id, 'doctor-1'); assert.equal(saved.reminder_minutes, 15);
    assert.ok(new Date(saved.ends_at) > new Date(saved.checked_in_at));
    assert.equal(controller.form.didReset, true); assert.equal(button.disabled, false);
    assert.match(elements['booking-status'].textContent, /Booked/);
});
test('invalid times never submit; overlapping booking retains form and explains conflict', async () => {
    const {controller, elements, button} = schedule();
    controller.client = {from: () => {throw Error('must not submit');}};
    controller.form.fields.ends_at = controller.form.fields.starts_at;
    await controller.book({preventDefault(){}});
    assert.match(elements['booking-status'].textContent, /end time/);
    controller.form.fields.ends_at = new Date(Date.now()+7200000).toISOString();
    controller.client = {from: () => ({insert: async () => ({error:{code:'23P01'}})})};
    await controller.book({preventDefault(){}});
    assert.match(elements['booking-status'].textContent, /already has a booking/);
    assert.equal(controller.form.didReset, undefined); assert.equal(button.disabled, false);
});
test('doctor schedule is read only, secretary can queue today and cancel, names escaped', () => {
    const visit = {id:1, patient_id:2, status:'scheduled', checked_in_at:new Date().toISOString(), patients:{first_name:'<script>', last_name:'Smith',suffix:'Jr.'}};
    const doctor = schedule('doctor').controller.render(visit);
    assert.doesNotMatch(doctor, /data-action/); assert.match(doctor, /&lt;script&gt;/); assert.match(doctor, /Jr\./);
    const secretary = schedule().controller.render(visit);
    assert.match(secretary, /data-action="waiting"/); assert.match(secretary, /data-action="cancelled"/);
    visit.checked_in_at = new Date(Date.now()+86400000*2).toISOString();
    assert.doesNotMatch(schedule().controller.render(visit), /data-action="waiting"/);
});
test('doctor schedule query filters by authenticated doctor', () => {
    const {controller} = schedule('doctor');
    const calls = [];
    const query = {select(){return this;},eq(...args){calls.push(args);return this;}};
    controller.client = {from: () => query}; controller.query();
    assert.deepEqual(calls, [['doctor_id','doctor-1']]);
});
test('session rejects inactive staff and redirects wrong workspace', async () => {
    for (const [staff, expected, allowed] of [[{role:'doctor',is_active:false},'../index.html',false],[{role:'doctor',is_active:true},'../Doctor/index.html',false],[{role:'secretary',is_active:true},undefined,true]]) {
        let redirected;
        const context = {window: {entSupabase:{auth:{getUser:async()=>({data:{user:{id:'1'}}})},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:staff})})}},location:{pathname:'/Secretary/index.html',replace:value=>redirected=value},document:{addEventListener(){}}};
        vm.createContext(context); vm.runInContext(fs.readFileSync('Javascript/session.js','utf8'),context);
        assert.equal(await context.window.entSessionReady,allowed); assert.equal(redirected,expected);
    }
});
test('reminders include due bookings, exclude later bookings, and show connection failures', async () => {
    const {controller, elements} = schedule('doctor');
    delete controller.refresh;
    controller.date.value = '2026-09-12';
    const now = Date.now();
    const due = {id:1, patient_id:2, status:'scheduled', kind:'operation', reminder_minutes:15, checked_in_at:new Date(now+600000).toISOString(),ends_at:new Date(now+3600000).toISOString(),patients:{first_name:'Due'},staff:{full_name:'Doctor'}};
    const later = {...due,id:2,checked_in_at:new Date(now+7200000).toISOString(),patients:{first_name:'Later'}};
    let count = 0;
    controller.query = () => {
        const result = count++ === 0 ? {data:[]} : {data:[due,later]};
        return {gte(){return this;},lt(){return this;},eq(){return this;},gt(){return this;},lte(){return this;},order(){return Promise.resolve(result);}};
    };
    await controller.refresh();
    assert.match(elements['schedule-reminders'].innerHTML, /Due/);
    assert.doesNotMatch(elements['schedule-reminders'].innerHTML, /Later/);
    controller.query = () => {throw Error('offline');};
    await controller.refresh();
    assert.match(elements['schedule-status'].textContent, /offline/);
    assert.match(elements['schedule-reminders'].textContent, /unavailable/);
});
test('My Schedule and dashboard apply separate kind filters to the shared schedule query', () => {
    for (const kinds of [['operation','event'], ['appointment']]) {
        const {controller} = schedule('doctor');
        controller.kinds = kinds;
        const calls = [];
        const query = {select(){return this;},eq(...args){calls.push(['eq',...args]);return this;},in(...args){calls.push(['in',...args]);return this;}};
        controller.client = {from: () => query};
        controller.query();
        assert.deepEqual(calls, [['eq','doctor_id','doctor-1'], ['in','kind',kinds]]);
    }
});
test('events can book without a patient and do not expose patient links or queue actions', async () => {
    const {controller} = schedule();
    controller.form.fields.kind = 'event';
    controller.form.fields.patient_id = '';
    let saved;
    controller.client = {from: () => ({insert: async value => {saved=value; return {error:null};}})};
    await controller.book({preventDefault(){}});
    assert.equal(saved.kind,'event'); assert.equal(saved.patient_id,null);
    const html = controller.render({id:1,kind:'event',reason:'Team meeting',status:'scheduled',checked_in_at:new Date().toISOString()});
    assert.match(html,/Team meeting/);
    assert.doesNotMatch(html,/profile.html|data-action="waiting"/);
    assert.match(html,/data-action="cancelled"/);
});
function alertsHarness() {
    const elements = {};
    const store = new Map();
    const context = {window:{entStaff:{id:'doctor-1'},entSupabase:{}},document:{getElementById:id=>elements[id] ||= {textContent:'',hidden:true}},sessionStorage:{getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)},Date};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('Javascript/schedule-alerts.js','utf8'),context);
    const controller = {loading:false,refresh(){this.refreshes=(this.refreshes||0)+1;}};
    return {alerts:new context.window.ScheduleAlerts(controller),elements,controller};
}
test('live alerts filter appointments/other doctors and refresh while busy without dropping changes', () => {
    const {alerts,elements,controller} = alertsHarness();
    alerts.changed({new:{doctor_id:'other',kind:'event'}});
    alerts.changed({new:{doctor_id:'doctor-1',kind:'appointment'}});
    assert.equal(elements['schedule-alert-title'],undefined);
    controller.loading=true;
    alerts.changed({eventType:'INSERT',new:{id:3,doctor_id:'doctor-1',kind:'operation',status:'scheduled',updated_at:'a'}});
    assert.equal(controller.refreshPending,true);
    assert.equal(elements['schedule-alert-title'].textContent,'Operation booked');
    assert.equal(elements['schedule-alert-toast'].hidden,false);
    assert.doesNotMatch(elements['schedule-alert-body'].textContent,/patient/i);
});
test('due alerts are deduplicated, but a rescheduled item gets a new reminder', () => {
    const {alerts,elements} = alertsHarness();
    const visit={id:1,kind:'event',checked_in_at:new Date().toISOString(),reminder_minutes:15};
    alerts.remind([visit]);
    elements['schedule-alert-toast'].hidden=true;
    alerts.remind([visit]);
    assert.equal(elements['schedule-alert-toast'].hidden,true);
    alerts.remind([{...visit,checked_in_at:new Date(Date.now()+60000).toISOString()}]);
    assert.equal(elements['schedule-alert-toast'].hidden,false);
});
test('Android permission registers a doctor token and sign-out unregisters the device', async () => {
    const callbacks = {};
    const calls = [];
    const context = {
        Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'android'},
        PushNotifications:{
            createChannel:async()=>{},addListener:async(name,fn)=>callbacks[name]=fn,
            checkPermissions:async()=>({receive:'prompt'}),requestPermissions:async()=>({receive:'granted'}),
            register:async()=>{ await callbacks.registration({value:'test-device-token'}); },
            unregister:async()=>calls.push('unregister'),removeAllDeliveredNotifications:async()=>{}
        },window:{entStaff:{id:'doctor-1',role:'doctor'},entSupabase:{from:()=>({
            upsert:async value=>{calls.push(value);return {error:null};},
            delete:()=>({eq:async()=>{calls.push('delete');return {error:null};}})
        })}},document:{addEventListener(){}},setTimeout,clearTimeout,URL,location:{href:'https://localhost/Doctor/schedule.html'}
    };
    vm.createContext(context);
    const source=fs.readFileSync('mobile/push.js','utf8').replace(/^import .*;\r?\n/gm,'');
    vm.runInContext(source,context);
    await context.window.entNativePush.enable();
    assert.equal(calls[0].user_id,'doctor-1'); assert.equal(calls[0].token,'test-device-token');
    await context.window.entNativePush.disconnect();
    assert.deepEqual(calls.slice(1),['unregister','delete']);
    context.PushNotifications.requestPermissions=async()=>({receive:'denied'});
    await assert.rejects(context.window.entNativePush.enable(),/Allow notifications/);
});
test('APK without Firebase installs the Supabase local notification flow', async () => {
    let calledNative = false;
    const context = {Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'android'},ENT_FIREBASE_CONFIGURED:false,
        PushNotifications:{unregister:async()=>{calledNative=true;}},installLocalDoctorNotifications:()=>{calledNative='local';},window:{},document:{addEventListener(){}},setTimeout,clearTimeout};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('mobile/push.js','utf8').replace(/^import .*;\r?\n/gm,''),context);
    assert.equal(calledNative,'local');
});
const pictureContext = { window: {}, document: {addEventListener() {}}, URL, Image: class {} };
vm.createContext(pictureContext);
vm.runInContext(fs.readFileSync('Javascript/patient-pictures.js', 'utf8'), pictureContext);
const Pictures = pictureContext.window.PatientPictures;
test('capture and retake request the Android camera while upload uses the file picker', () => {
    const inputs = [];
    pictureContext.document.createElement = () => {
        const input = {setAttribute(key,value) {this[key]=value;}, addEventListener() {}, click() {this.clicked=true;}};
        inputs.push(input);
        return input;
    };
    const editor = Object.create(Pictures.prototype);
    editor.pick(true);
    editor.pick(true, 1);
    editor.pick(false);
    for (const input of inputs.slice(0,2)) {
        assert.equal(input.accept,'image/*');
        assert.equal(input.capture,'environment');
        assert.equal(input.multiple,false);
        assert.equal(input.clicked,true);
    }
    assert.equal(inputs[2].capture,undefined);
    assert.equal(inputs[2].multiple,true);
    assert.equal(inputs[2].accept,'image/jpeg,image/png,image/webp');
});
function pictureEditor(existing = []) {
    const editor = Object.create(Pictures.prototype);
    Object.assign(editor, {pictures: [...existing], busy:false, status:{textContent:''}, render() {}});
    return editor;
}
test('picture limit and failed retakes preserve existing pictures', async () => {
    const editor = pictureEditor(['a','b','c','d']);
    await editor.addFiles([{type:'image/jpeg',size:1}]);
    assert.equal(editor.pictures.length,4);
    assert.match(editor.status.textContent,/four/);
    await editor.addFiles([{type:'text/plain',size:1}],1);
    assert.deepEqual(editor.pictures,['a','b','c','d']);
    assert.equal(editor.busy,false);
    await editor.addFiles([],1);
    assert.equal(editor.pictures[1],'b');
});
test('retake replaces one picture and batch preparation failure is atomic', async () => {
    const original = Pictures.encode;
    Pictures.encode = async file => {if(file.bad) throw Error('Invalid picture'); return file.value;};
    try {
        const editor = pictureEditor(['a','b']);
        await editor.addFiles([{value:'replacement'}],0);
        assert.deepEqual(editor.pictures,['replacement','b']);
        await editor.addFiles([{value:'c'},{bad:true}]);
        assert.deepEqual(editor.pictures,['replacement','b']);
    } finally {Pictures.encode = original;}
});
