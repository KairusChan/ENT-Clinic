const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
    const state = {visits:[], pending:[], sent:[], cancelled:[], queries:[], values:new Map(), permission:'granted'};
    const storage = {getItem:key=>state.values.get(key), setItem:(key,value)=>state.values.set(key,value), removeItem:key=>state.values.delete(key)};
    const native = {
        checkPermissions:async()=>({display:state.permission}), requestPermissions:async()=>({display:state.permission}), createChannel:async()=>{},
        getPending:async()=>({notifications:state.pending}), removeAllDeliveredNotifications:async()=>{state.cleared=true;},
        cancel:async({notifications})=>{state.cancelled.push(...notifications); state.pending=state.pending.filter(n=>!notifications.some(x=>x.id===n.id));},
        schedule:async({notifications})=>{if(state.scheduleError) throw Error('Native failure'); state.sent.push(...notifications); state.pending.push(...notifications.filter(n=>n.schedule));}
    };
    const query = {select(){return this;},eq(...args){state.queries.push(args);return this;},gte(){return this;},lte(){return this;},order(){return this;},range:async()=>({data:state.visits,error:state.error})};
    const context = {Date, Math, Set, JSON, localStorage:storage}; vm.createContext(context);
    vm.runInContext(fs.readFileSync('mobile/local-alerts.js','utf8').replace(/export /g,'')+'\nthis.Controller=LocalDoctorAlerts;',context);
    state.controller = new context.Controller(native,{from:()=>query},{id:'doctor-1',role:'doctor'},storage);
    return state;
}
const visit = (overrides={}) => ({id:1,doctor_id:'doctor-1',kind:'operation',status:'scheduled',checked_in_at:new Date(Date.now()+3600000).toISOString(),ends_at:new Date(Date.now()+7200000).toISOString(),reminder_minutes:15,...overrides});

test('doctor gets queue alerts and future Android reminders, without other doctors or duplicate refresh alerts', async()=>{
    const s=setup(); s.visits=[visit(),visit({id:2,kind:'appointment',status:'waiting',checked_in_at:new Date().toISOString()}),visit({id:3,doctor_id:'other'})];
    await s.controller.enable();
    assert.equal(s.sent.length,2);
    assert.ok(s.sent.some(n=>n.extra.route==='queue'));
    assert.ok(s.sent.some(n=>n.schedule && n.extra.doctorId==='doctor-1'));
    assert.ok(s.queries.some(([column,value])=>column==='doctor_id' && value==='doctor-1'));
    await s.controller.refresh(); assert.equal(s.sent.length,2);
});
test('rescheduling replaces the old alarm and cancellation removes the replacement', async()=>{
    const s=setup(); s.visits=[visit()]; await s.controller.enable(); const old=s.pending[0].id;
    s.visits=[visit({checked_in_at:new Date(Date.now()+10800000).toISOString()})]; await s.controller.refresh();
    assert.ok(s.cancelled.some(n=>n.id===old)); assert.equal(s.pending.length,1);
    s.visits=[{...s.visits[0],status:'cancelled'}]; await s.controller.refresh(); assert.equal(s.pending.length,0);
});
test('failed Supabase sync retains downloaded reminders and does not claim a successful snapshot', async()=>{
    const s=setup(); s.visits=[visit()]; await s.controller.enable(); const before=s.controller.previous;
    s.error={message:'Offline'}; await assert.rejects(s.controller.refresh());
    assert.equal(s.pending.length,1); assert.equal(s.controller.previous,before);
});
test('already delivered reminders do not repeat after a new controller starts', async()=>{
    const s=setup(); s.visits=[visit({checked_in_at:new Date(Date.now()+1000).toISOString()})];
    await s.controller.enable(); assert.equal(s.sent.length,1);
    s.pending=[];
    const previous = s.controller;
    s.controller = new previous.constructor(previous.native,previous.client,previous.staff,previous.storage);
    await s.controller.refresh(); assert.equal(s.sent.length,1);
});
test('deleted bookings cancel downloaded reminders and notify the doctor', async()=>{
    const s=setup(); s.visits=[visit()]; await s.controller.enable();
    s.visits=[]; await s.controller.refresh();
    assert.equal(s.pending.length,0);
    assert.equal(s.sent.at(-1).title,'Clinic schedule updated');
});
test('sign-out clears downloaded notifications and prevents further scheduling', async()=>{
    const s=setup(); s.visits=[visit()]; await s.controller.enable(); await s.controller.disconnect();
    assert.equal(s.pending.length,0); assert.equal(s.cleared,true);
    await s.controller.refresh(); assert.equal(s.sent.length,1);
});
test('permission denial and non-doctor accounts cannot enable phone alerts', async()=>{
    const s=setup(); s.permission='denied'; await assert.rejects(s.controller.enable(),/Allow notifications/);
    assert.equal(s.sent.length,0); s.controller.staff.role='secretary';
    await assert.rejects(s.controller.enable(),/doctor/);
});
