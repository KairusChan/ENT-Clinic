const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
function profile(noteResult) {
    const elements = {};
    const queries = [];
    const visits = [
        {id: 2, reason: 'Follow-up', status: 'completed', checked_in_at: '2026-09-24T01:00:00Z'},
        {id: 1, reason: 'First visit', status: 'completed', checked_in_at: '2026-09-23T01:00:00Z'}
    ];
    const context = {URLSearchParams, window: {location: {search: '?id=7'}, entStaff: {role: 'secretary'}, entSupabase: {
        from(table) {
            return {select() { return this; }, eq(key, value) {
                queries.push([table, key, value]);
                return table === 'Notes' ? Promise.resolve(noteResult) : this;
            }, order() { return Promise.resolve({data: visits}); }};
        }
    }}, document: {getElementById: id => elements[id] ||= {}, querySelectorAll: () => [], addEventListener() {}}};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('Javascript/patient-profile.js', 'utf8') + '\nthis.Controller = PatientProfileController;', context);
    return {controller: new context.Controller(), elements, queries};
}
test('secretary sees notes matched to visits, latest expanded, escaped and read-only', async () => {
    const {controller, elements, queries} = profile({data: [{visit_id: 1, assessment: 'Older assessment'}, {visit_id: 2, diagnostic: 'Medication\nSecond line', assessment: '<script>bad</script>', history: 'Legacy history', rx: 'Legacy prescription', pf: '500'}]});
    await controller.loadVisits();
    const html = elements['patient-visits'].innerHTML;
    assert.match(html, /Latest visit: Follow-up/);
    assert.equal((html.match(/ open>/g) || []).length, 1);
    assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
    assert.match(html, /Medication\nSecond line/);
    assert.match(html, /Legacy history/);
    assert.match(html, /Legacy prescription/);
    assert.match(html, /500/);
    assert(html.indexOf('Older assessment') > html.indexOf('First visit'));
    assert(!html.includes('consultation.html'));
    assert.deepEqual(queries, [['visits', 'patient_id', '7'], ['Notes', 'patient_id', '7']]);
});
test('notes failure preserves visit history and shows a loading error', async () => {
    const {controller, elements} = profile({error: {message: 'Unavailable'}});
    await controller.loadVisits();
    assert.match(elements['patient-visits'].innerHTML, /Follow-up/);
    assert.match(elements['patient-visits'].innerHTML, /Unable to load doctor's notes/);
});
test('visits without accessible saved notes show an explicit empty state', async () => {
    const {controller, elements} = profile({data: []});
    await controller.loadVisits();
    assert.match(elements['patient-visits'].innerHTML, /No saved doctor notes are available/);
});
