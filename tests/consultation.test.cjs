const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function consultation() {
    const elements = {};
    const context = {
        window: {entStaff:{role:'doctor',id:'doctor-1'},location:{search:'?visit_id=12'},addEventListener(){},confirm:()=>true},
        document: {getElementById:id=>elements[id] ||= {textContent:'',disabled:true,addEventListener(){}},addEventListener(){},querySelectorAll:()=>[]},
        URLSearchParams, Date
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('Javascript/consultation.js','utf8')+'\nthis.Controller = ConsultationController;', context);
    const controller = new context.Controller();
    controller.form.elements = Object.fromEntries(controller.names.map(name=>[name,{value:''}]));
    return {controller, elements, context};
}

test('save sends all eleven note fields including PF atomically and returns to the queue', async () => {
    const {controller,context} = consultation();
    controller.saveButton.disabled = false;
    controller.names.forEach(name=>controller.form.elements[name].value=` ${name} text `);
    controller.dirty = true;
    let call;
    controller.client = {rpc:async(name,args)=>{call={name,args}; return {error:null};}};
    await controller.save({preventDefault(){}});
    assert.equal(call.name,'save_consultation_notes');
    assert.equal(call.args.p_visit_id,'12');
    assert.equal(Object.keys(call.args.p_notes).length,11);
    assert.equal(call.args.p_notes.admitting_orders,'admitting_orders text');
    assert.equal(call.args.p_notes.diagnostic,'medication text');
    assert.equal(call.args.p_notes.medication,undefined);
    assert.equal(call.args.p_notes.rx,'');
    assert.equal(call.args.p_notes.history,'');
    assert.equal(call.args.p_notes.pf,'pf text');
    assert.equal(context.window.location.href,'queue.html');
    assert.equal(controller.saveButton.textContent,'Save Changes');
    assert.equal(controller.fields.disabled,false);
    assert.equal(controller.dirty,false);
});

test('failed saves preserve notes and empty notes never submit', async () => {
    const {controller,context} = consultation();
    controller.saveButton.disabled=false;
    let calls=0;
    controller.client={rpc:async()=>{calls++; return {error:{message:'Connection lost'}};}};
    await controller.save({preventDefault(){}});
    assert.equal(calls,0);
    controller.form.elements.assessment.value='Assessment text';
    controller.dirty=true;
    await controller.save({preventDefault(){}});
    assert.equal(calls,1);
    assert.equal(context.window.location.href,undefined);
    assert.equal(controller.form.elements.assessment.value,'Assessment text');
    assert.equal(controller.fields.disabled,false);
    assert.equal(controller.saveButton.disabled,false);
    assert.equal(controller.dirty,true);
    assert.match(controller.status.textContent,/retry Save Notes/);
});

test('repeated clicks while saving make only one request', async () => {
    const {controller} = consultation();
    controller.saveButton.disabled=false;
    controller.form.elements.plan.value='Follow-up';
    let finish, calls=0;
    controller.client={rpc:()=>{calls++;return new Promise(resolve=>finish=resolve);}};
    const first=controller.save({preventDefault(){}});
    await controller.save({preventDefault(){}});
    assert.equal(calls,1);
    finish({error:null}); await first;
});

test('saved and active notes are writable; missing and unaccepted consultations stay locked', async () => {
    for (const scenario of ['saved','waiting','missing','active']) {
        const {controller,elements} = consultation();
        const visit=scenario==='missing'?null:{patient_id:4,status:scenario==='saved'?'completed':scenario==='active'?'with_doctor':'waiting',checked_in_at:new Date().toISOString(),patients:{first_name:'Ana',last_name:'Cruz'}};
        const note=scenario==='saved'?{subjective:'Saved symptoms',created_at:new Date().toISOString()}:null;
        controller.client={from:table=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:table==='visits'?visit:note,error:null})})};
        await controller.init();
        if (scenario==='saved') {
            assert.equal(controller.form.elements.subjective.value,'Saved symptoms');
            assert.equal(controller.saveButton.disabled,false);
            assert.equal(controller.saveButton.textContent,'Save Changes');
        }
        assert.equal(elements['note-fields'].disabled,!['active','saved'].includes(scenario));
    }
});

function queue(role='doctor') {
    const context={window:{entStaff:{role},location:{}},document:{getElementById:()=>({insertAdjacentHTML(){}}),querySelectorAll:()=>[],addEventListener(){}},Date};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('Javascript/queue.js','utf8')+'\nthis.Controller = QueueController;',context);
    return {controller:new context.Controller(),context};
}
test('editing saved notes sends their original values for conflict protection', async () => {
    const {controller,context}=consultation();
    controller.originalNotes=Object.fromEntries(controller.names.map(name=>[name,'']));
    controller.originalNotes.plan='Original plan';
    controller.form.elements.plan.value='Updated plan';
    controller.saveButton.disabled=false;
    controller.client={rpc:async(name,args)=>{
        assert.equal(name,'update_consultation_notes');
        assert.equal(args.p_expected_notes.plan,'Original plan');
        assert.equal(args.p_notes.plan,'Updated plan');
        return {error:null};
    }};
    await controller.save({preventDefault(){}});
    assert.equal(context.window.location.href,'queue.html');
    assert.equal(controller.saveButton.textContent,'Save Changes');
    assert.equal(controller.fields.disabled,false);
});
test('an accepted doctor can type a draft when note storage fails, but cannot save blindly', async () => {
    const {controller}=consultation();
    controller.client={from:table=>({select(){return this;},eq(){return this;},maybeSingle:async()=>table==='visits'
        ? {data:{patient_id:4,status:'with_doctor',checked_in_at:new Date().toISOString()},error:null}
        : {data:null,error:{message:'Notes table unavailable'}}})};
    await controller.init();
    assert.equal(controller.fields.disabled,false);
    assert.equal(controller.saveButton.disabled,true);
    assert.match(controller.status.textContent,/saving is unavailable/);
});
test('doctor queue offers accept, continue and view notes; secretary cannot skip notes', () => {
    const visit={id:12,patient_id:4,kind:'appointment',status:'waiting',checked_in_at:new Date().toISOString(),patients:{first_name:'Ana'}};
    const {controller}=queue();
    assert.match(controller.renderVisit(visit),/Accept Patient/);
    assert.match(controller.renderVisit({...visit,status:'with_doctor'}),/Continue Notes/);
    assert.match(controller.renderVisit({...visit,status:'completed'}),/View Notes/);
    assert.doesNotMatch(controller.renderVisit({...visit,status:'cancelled'}),/Accept Patient|Continue Notes/);
    const secretary=queue('secretary').controller;
    assert.doesNotMatch(secretary.renderVisit({...visit,status:'with_doctor'}),/queue-action|Complete<\/button>/);
});
test('accept redirects only after the server confirms acceptance', async () => {
    const {controller,context}=queue();
    const button={disabled:false,dataset:{id:'12'}};
    controller.client={rpc:async(name,args)=>{assert.equal(name,'accept_consultation');assert.equal(args.p_visit_id,'12');return {error:{message:'Not assigned'}};}};
    await controller.acceptPatient(button);
    assert.equal(context.window.location.href,undefined);assert.equal(button.disabled,false);
    controller.client={rpc:async()=>({error:null})};
    await controller.acceptPatient(button);
    assert.equal(context.window.location.href,'consultation.html?visit_id=12');
});
test('only secretary/admin waiting rows offer Cancel', () => {
    const visit={id:12,patient_id:4,kind:'appointment',checked_in_at:new Date().toISOString()};
    for (const role of ['secretary','admin','doctor']) {
        for (const status of ['waiting','with_doctor','completed','cancelled']) {
            const html=queue(role).controller.renderVisit({...visit,status});
            assert.equal(html.includes('cancel-patient'),role!=='doctor' && status==='waiting');
        }
    }
});
test('cancellation requests deletion of a waiting visit and refreshes only on success', async () => {
    const {controller}=queue('secretary');
    const button={disabled:false,dataset:{id:'12'}};
    let refreshed=0;
    controller.loadVisits=async()=>{refreshed++;};
    let result={data:12,error:null};
    controller.client={rpc:async(name,args)=>{
        assert.equal(name,'cancel_visit');
        assert.equal(args.p_visit_id,'12');
        assert.equal(args.p_expected_status,'waiting');
        return result;
    }};
    await controller.cancelPatient(button);
    assert.equal(refreshed,1);
    button.disabled=false;
    result={data:null,error:{message:'Visit is no longer waiting'}};
    await controller.cancelPatient(button);
    assert.equal(refreshed,1); assert.equal(button.disabled,false);
});


test('all consultation sections are visible without adding them', () => {
    const {controller}=consultation();
    const html=fs.readFileSync('Doctor/consultation.html','utf8');
    assert.doesNotMatch(html,/data-note-preset|Click a section|consultation-presets/);
    for (const name of controller.names) {
        const section=html.match(new RegExp('<section[^>]*id="section-'+name+'"[^>]*>'));
        assert.ok(section, name+' section exists');
        assert.doesNotMatch(section[0],/hidden/);
    }
});

test('retired history and prescription entries survive edits without form fields', async () => {
    const {controller}=consultation();
    controller.originalNotes=Object.fromEntries(controller.storedNames.map(name=>[name,'']));
    controller.originalNotes.history='Previous history';
    controller.originalNotes.rx='Previous prescription';
    controller.form.elements.plan.value='Updated plan';
    controller.saveButton.disabled=false;
    controller.client={rpc:async(name,args)=>{
        assert.equal(args.p_notes.history,'Previous history');
        assert.equal(args.p_notes.rx,'Previous prescription');
        assert.equal(args.p_expected_notes.history,'Previous history');
        return {error:null};
    }};
    assert.equal(controller.form.elements.history,undefined);
    assert.equal(controller.form.elements.rx,undefined);
    await controller.save({preventDefault(){}});
});


test('medication loads from existing storage and saved sections print safely', async () => {
    const {controller,context,elements}=consultation();
    const note={diagnostic:'Medication instructions <script>alert(1)</script>',recommendation:'Rest',referral:'ENT',admitting_orders:'Admit'};
    const buttons=Object.keys(controller.printLabels).map(name=>({dataset:{printNote:name},addEventListener(){}}));
    context.document.querySelectorAll=selector=>selector==='[data-print-note]'?buttons:[];
    controller.client={from:table=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:table==='visits'?{patient_id:4,status:'completed',checked_in_at:'2026-09-23T00:00:00Z',patients:{first_name:'Ana',last_name:'Cruz'}}:note,error:null})})};
    await controller.init();
    assert.equal(controller.form.elements.medication.value,note.diagnostic);
    assert.ok(buttons.every(button=>!button.hidden && !button.disabled));
    const children=[];
    elements['consultation-printout']={replaceChildren(){children.length=0;},appendChild(child){children.push(child);}};
    context.document.createElement=tag=>({tag,textContent:'',children:[],appendChild(child){this.children.push(child);}});
    const flatten=nodes=>nodes.flatMap(node=>[node,...flatten(node.children || [])]);
    let printed=0;
    context.window.print=()=>{printed++;};
    controller.form.elements.medication.value='Unsaved text';
    for (const name of Object.keys(controller.printLabels)) {
        await controller.printSection(name);
        const nodes=flatten(children);
        if (name==='medication' || name==='referral') {
            assert.ok(nodes.some(node=>node.textContent==='ALDRIN BUTZ E. BAMBA, MD, DPBO-HNS'));
            assert.ok(nodes.some(node=>node.textContent==='License No. : 0135273'));
            assert.equal(nodes.filter(node=>node.className==='letterhead-clinic').length,3);
            assert.equal(nodes.find(node=>node.className==='letterhead-content').textContent,note[controller.storageName(name)]);
        } else {
            assert.ok(!nodes.some(node=>node.tag==='h2'));
            assert.equal(children.at(-1).textContent,note[controller.storageName(name)]);
        }
        assert.ok(nodes.some(node=>node.textContent==='Ana Cruz'));
        assert.ok(!nodes.some(node=>node.textContent==='REFERRAL' || node.textContent===controller.printLabels[name]));
    }
    assert.equal(printed,4);
    controller.dirty=true;
    controller.updatePrintButtons();
    assert.ok(buttons.every(button=>button.disabled));
    await controller.printSection('medication');
    assert.equal(printed,4);
    controller.dirty=false;
    controller.originalNotes.referral='';
    controller.updatePrintButtons();
    assert.equal(buttons.find(button=>button.dataset.printNote==='referral').disabled,true);
    await controller.printSection('referral');
    await controller.printSection('subjective');
    assert.equal(printed,4);
});

test('printing remains unavailable until a successful save', async () => {
    const {controller,context}=consultation();
    const button={dataset:{printNote:'medication'}};
    context.document.querySelectorAll=()=>[button];
    controller.updatePrintButtons();
    assert.equal(button.hidden,true);
    controller.saveButton.disabled=false;
    controller.form.elements.medication.value='Medication instructions';
    controller.client={rpc:async()=>({error:{message:'Save failed'}})};
    await controller.save({preventDefault(){}});
    assert.equal(button.hidden,true);
    controller.client={rpc:async()=>({error:null})};
    await controller.save({preventDefault(){}});
    assert.equal(button.hidden,false);
    assert.equal(button.disabled,false);
    assert.equal(controller.originalNotes.diagnostic,'Medication instructions');
    assert.equal(context.window.location.href,'queue.html');
});


test('PF is last and numbered after the other visible note sections', () => {
    const html=fs.readFileSync('Doctor/consultation.html','utf8');
    const sections=[...html.matchAll(/id="section-([^"]+)"/g)].map(match=>match[1]);
    assert.equal(sections.length,9);
    assert.equal(sections.at(-1),'pf');
    assert.match(html,/id="section-pf"><div class="note-heading"><span class="note-number">09/);
});

test('letterhead uses patient address and age at the visit with safe missing values', () => {
    const {controller,context,elements}=consultation();
    context.document.createElement=tag=>({tag,textContent:'',children:[],appendChild(child){this.children.push(child);}});
    const root=context.document.createElement('article');
    elements['consultation-patient']={textContent:'Test Patient'};
    controller.printPatient={date_of_birth:'2000-09-24',sex:'Female',address:'Angeles City'};
    controller.visitDate='2026-09-23T00:00:00Z';
    const flatten=node=>[node,...node.children.flatMap(flatten)];
    controller.renderLetterhead(root,'referral','Refer to specialist');
    let values=flatten(root).filter(node=>node.className==='letterhead-value').map(node=>node.textContent);
    assert.equal(values[0],'Test Patient');
    assert.equal(values[2],'Angeles City');
    assert.equal(values[3],'25 / Female');
    controller.printPatient={};
    controller.visitDate=undefined;
    root.children=[];
    controller.renderLetterhead(root,'medication','Medication');
    values=flatten(root).filter(node=>node.className==='letterhead-value').map(node=>node.textContent);
    assert.deepEqual(values,['Test Patient','','','']);
});
