const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
function setup(){
 const ids=new Set([...fs.readFileSync('Secretary/pf.html','utf8').matchAll(/id="([^"]+)"/g)].map(match=>match[1]));
 const elements={}; const element=()=>({textContent:'',hidden:false,disabled:false,value:'',dataset:{},children:[],append(...items){this.children.push(...items)},appendChild(item){this.children.push(item)},replaceChildren(){this.children=[]},setAttribute(){}});
 const context={window:{},document:{getElementById:id=>{assert.ok(ids.has(id), `Missing PF element: ${id}`);return elements[id] ||= element()},createElement:element,addEventListener(){},querySelectorAll:()=>[]},Date,Map};
 vm.createContext(context);vm.runInContext(fs.readFileSync('Javascript/professional-fees.js','utf8')+'\nthis.Controller=ProfessionalFeesController;',context);
 const c=new context.Controller();c.date.value='2026-09-25';
 const result={data:[],error:null}; const query={select(){return this},eq(){return this},gte(){return this},lt(){return this},order:async()=>result};c.client={from:()=>query};
 return {c,e:elements,result};
}
test('missing PF schema shows setup state, not empty records or raw database details',async()=>{
 const {c,e,result}=setup();result.error={code:'42703',message:'column Notes_1.pf does not exist'};await c.load();
 assert.equal(c.state,'setup');assert.equal(c.rows.children.length,0);assert.equal(e['pf-count'].textContent,'Consultation fees');assert.match(e['pf-notice-title'].textContent,/setup/);assert.doesNotMatch(e['pf-status'].textContent,/Notes_1/);assert.equal(e['pf-refresh'].disabled,false);
});
test('PF distinguishes a missing charge from a zero fee and renders patient text safely',async()=>{
 const {c,e,result}=setup();result.data=[{id:1,patient_id:2,checked_in_at:'2026-09-25T10:00:00',patients:{first_name:'<img>'},Notes:{pf:'0'}},{id:3,patient_id:4,checked_in_at:'2026-09-25T11:00:00',Notes:[]}];await c.load();
 assert.match(c.rows.children[0].children[3].textContent,/0.00/);assert.equal(c.rows.children[1].children[3].textContent,'Waiting for doctor');assert.equal(c.rows.children.length,2);assert.equal(c.rows.children[0].children[0].children[0].textContent,'<img>');c.search.value='missing';c.render();assert.equal(e['pf-empty-title'].textContent,'No matching consultations');
});
test('failed refresh never represents unavailable fees as a zero-count day',async()=>{
 const {c,e,result}=setup();result.error={message:'Offline'};await c.load();assert.equal(c.state,'error');assert.equal(c.rows.children.length,0);assert.equal(e['pf-count'].textContent,'Consultation fees');assert.equal(e['pf-notice'].hidden,false);
});


test('new and revised doctor fees notify the secretary without changing the entered details',async()=>{
 const {c,e,result}=setup();await c.load();
 result.data=[{id:12,patient_id:2,checked_in_at:'2026-09-25T10:00:00',patients:{first_name:'Ana'},Notes:[{pf:'500'}]}];
 await c.load();
 assert.match(e['pf-status'].textContent,/1 new or updated PF/);
 assert.equal(c.rows.children[0].className,'pf-updated');
 assert.equal(c.rows.children[0].children[3].textContent,c.formatFee('500'));
 result.data[0].Notes[0].pf='700 - consultation';await c.load();
 assert.equal(c.rows.children[0].children[3].textContent,'700 - consultation');
 assert.match(e['pf-status'].textContent,/1 new or updated PF/);
 await c.load();assert.doesNotMatch(e['pf-status'].textContent,/new or updated/);
});

test('a delayed response cannot replace fees for the newly selected date',async()=>{
 const {c}=setup();const pending=[];
 const query={select(){return this},eq(){return this},gte(){return this},lt(){return this},order(){return new Promise(resolve=>pending.push(resolve))}};
 c.client={from:()=>query};const first=c.load();c.date.value='2026-09-24';const second=c.load();
 pending[1]({data:[{id:2,Notes:{pf:'250'}}]});await second;
 pending[0]({data:[{id:1,Notes:{pf:'999'}}]});await first;
 assert.equal(c.visits[0].id,2);assert.equal(c.visits[0].fee,'250');
});
