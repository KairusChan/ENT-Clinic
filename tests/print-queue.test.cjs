const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(role = 'secretary', tracking = true) {
    const elements = {};
    const calls = [];
    const rows = [{id: 1, visit_id: 7, patient_id: 2, doctor_id: 'doctor-1', diagnostic: 'Saved', recommendation: 'Advice', referral: 'Specialist', admitting_orders: 'Admit', assessment: 'Do not print', created_at: '2026-09-26T01:00:00Z', patients: {first_name: '<Patient>'}, visits: {reason: 'Checkup'}, staff: {full_name: 'Doctor'}}];
    const receipts = [];
    let rpcError = null;
    let printed = 0;
    const client = {
        from(table) {
            const query = {select() {return this;}, eq(key, value) {calls.push([table,key,value]); return this;}, order() {return this;}, range() {return Promise.resolve({data: rows});},
                in() { return Promise.resolve(tracking ? {data: receipts} : {error: {message: 'missing table'}}); }, maybeSingle() { return Promise.resolve({data: rows[0]}); }};
            return query;
        },
        rpc(name, args) { calls.push([name, args]); return Promise.resolve({error: rpcError}); }
    };
    const element = id => elements[id] ||= {value: 'pending', textContent: '', innerHTML: '', hidden: true, querySelectorAll: () => [], scrollIntoView() {}, addEventListener() {}};
    const context = {console, URLSearchParams, setInterval, clearInterval, PatientProfileController: class {
        escapeHtml(value) {return String(value).replaceAll('<','&lt;').replaceAll('>','&gt;');}
        renderNotes(note) {return JSON.stringify(note);}
    }, window: {entSupabase: client, entStaff: {role, id: 'doctor-1'}, print() {printed++;}}, document: {getElementById: element, addEventListener() {}}};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('Javascript/print-queue.js','utf8') + '\nthis.Controller = PrintQueueController;', context);
    return {controller: new context.Controller(), rows, receipts, calls, elements, setError(error) {rpcError = error;}, printed: () => printed};
}
test('saved notes appear automatically; receipt hides only the printed revision and edits requeue', async () => {
    const s = setup();
    await s.controller.refresh();
    assert.match(s.controller.list.innerHTML, /Waiting to print/);
    assert.match(s.controller.list.innerHTML, /&lt;Patient&gt;/);
    for (const section of Object.keys(s.controller.sections)) s.receipts.push({note_id: 1, section, content: s.rows[0][section]});
    await s.controller.refresh();
    assert.match(s.controller.list.innerHTML, /No notes waiting/);
    s.rows[0].diagnostic = 'Changed';
    await s.controller.refresh();
    assert.match(s.controller.list.innerHTML, /Waiting to print/);
    s.controller.filter.value = 'all';
    s.controller.render();
    assert.match(s.controller.list.innerHTML, /Preview \/ Print/);
});
test('doctor queries are scoped to their own notes; secretary queue includes accessible notes', async () => {
    const doctor = setup('doctor'), secretary = setup();
    await doctor.controller.refresh();
    await secretary.controller.refresh();
    assert(doctor.calls.some(call => call[1] === 'doctor_id' && call[2] === 'doctor-1'));
    assert(!secretary.calls.some(call => call[1] === 'doctor_id'));
});
test('missing print tracking keeps saved notes printable and disables marking', async () => {
    const s = setup('secretary', false);
    await s.controller.refresh();
    await s.controller.open(1, 'diagnostic');
    assert.match(s.controller.status.textContent, /tracking is unavailable/);
    assert.equal(s.controller.completeButton.disabled, true);
    await s.controller.complete();
    assert(!s.calls.some(call => call[0] === 'mark_note_section_printed'));
});
test('opening print dialog does not mark notes printed and refreshes saved content first', async () => {
    const s = setup();
    await s.controller.refresh();
    await s.controller.open(1, 'diagnostic');
    s.rows[0] = {...s.rows[0], diagnostic: 'Latest'};
    await s.controller.print();
    assert.equal(s.printed(), 1);
    assert.match(s.elements['print-queue-output'].innerHTML, /Latest/);
    assert(!s.calls.some(call => call[0] === 'mark_note_section_printed'));
});
test('mark printed sends preview revision; server failure keeps the preview and notes', async () => {
    const s = setup();
    await s.controller.refresh();
    await s.controller.open(1, 'diagnostic');
    s.setError({message: 'Notes changed. Refresh first'});
    await s.controller.complete();
    assert.equal(s.controller.preview.hidden, false);
    assert.match(s.controller.previewStatus.textContent, /Notes changed/);
    const call = s.calls.find(call => call[0] === 'mark_note_section_printed');
    assert.equal(call[1].p_expected_content, 'Saved');
    assert.equal(call[1].p_section, 'diagnostic');
});
test('doctor and secretary pages have print links and icons; doctor account tools have a divider', () => {
    for (const folder of ['Doctor', 'Secretary']) for (const file of fs.readdirSync(folder).filter(file => file.endsWith('.html'))) {
        const html = fs.readFileSync(`${folder}/${file}`, 'utf8');
        if (!html.includes('id="workspace-navigation"')) continue; // Legacy redirect pages have no sidebar.
        const nav = html.match(/<nav>[\s\S]*?<\/nav>/)[0];
        assert.equal((nav.match(/href="print-queue.html"/g) || []).length, 1, file);
        for (const link of nav.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)) assert.match(link[0], /<svg/, `${folder}/${file}`);
        if (folder === 'Doctor') assert.match(nav, /<hr class="navigation-divider"><a\s+class="nav-item(?: active)?" href="accounts.html"/);
    }
});

test('four populated sections have separate queue entries and previews exclude other notes', async () => {
 const s = setup(); await s.controller.refresh();
 assert.equal(s.controller.items().length, 4);
 await s.controller.open(1, 'diagnostic');
 assert.equal(s.elements['print-document-preview'].innerHTML, JSON.stringify({diagnostic:'Saved'}));
 s.receipts.push({note_id:1, section:'diagnostic', content:'Saved'});
 await s.controller.refresh();
 assert(!s.controller.list.innerHTML.includes('data-section="diagnostic"'));
 assert(s.controller.list.innerHTML.includes('data-section="referral"'));
 s.rows[0].referral = '  ';
 assert.equal(s.controller.items().length, 3);
 s.rows[0].assessment = 'Unrelated edit';
 assert(s.controller.isPrinted(s.rows[0], 'diagnostic'));
});
