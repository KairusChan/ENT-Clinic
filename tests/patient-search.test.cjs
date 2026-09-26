const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(paging = true) {
 const elements = {};
 const context = {window:{}, document:{getElementById(id){
  if (id === 'patient-pagination' && !paging) return null;
  return elements[id] ||= {value:'', innerHTML:'', textContent:''};
 }, addEventListener(){}}};
 vm.runInNewContext(fs.readFileSync('Javascript/patient-search.js','utf8')+'\nthis.Controller=PatientSearchController;',context);
 const c = new context.Controller();
 c.patients = Array.from({length:8},(_,i)=>({id:i+1,first_name:'Patient',last_name:String(i+1)}));
 return {c,e:elements};
}
test('secretary results show three patients per page and all patients remain reachable',()=>{
 const {c,e}=setup();c.renderResults();
 assert.equal((c.results.innerHTML.match(/class="result"/g)||[]).length,3);
 assert.match(c.results.innerHTML,/profile.html\?id=3/);
 assert.doesNotMatch(c.results.innerHTML,/profile.html\?id=4/);
 assert.equal(e['patient-previous'].disabled,true);
 c.renderResults(1);assert.match(c.results.innerHTML,/profile.html\?id=4/);
 c.renderResults(2);assert.equal((c.results.innerHTML.match(/class="result"/g)||[]).length,2);
 assert.equal(e['patient-next'].disabled,true);
 c.renderResults(1);assert.equal(e['patient-next'].disabled,false);
});
test('search covers every patient and resets paging, including empty results',()=>{
 const {c,e}=setup();c.renderResults(2);c.searchInput.value='8';c.renderResults(2);
 assert.equal(c.page,0);assert.match(c.results.innerHTML,/profile.html\?id=8/);
 assert.equal(e['patient-pagination'].hidden,true);
 c.searchInput.value='missing';c.renderResults();assert.match(c.results.innerHTML,/No patient records found/);
 c.searchInput.value='';c.renderResults();assert.equal(e['patient-pagination'].hidden,false);
});
test('doctor lists without pagination retain all results',()=>{
 const {c}=setup(false);c.renderResults();assert.equal((c.results.innerHTML.match(/class="result"/g)||[]).length,8);
});
