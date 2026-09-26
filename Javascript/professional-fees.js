class ProfessionalFeesController {
    constructor() {
        this.client = window.entSupabase;
        this.date = document.getElementById('pf-date');
        this.search = document.getElementById('pf-search');
        this.status = document.getElementById('pf-status');
        this.rows = document.getElementById('pf-rows');
        this.visits = [];
        this.request = 0;
        this.previous = new Map();
        this.loaded = false;
        this.state = 'loading';
    }
    today() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    init() {
        this.date.value = this.today();
        this.date.addEventListener('change', () => { this.previous.clear(); this.loaded = false; this.load(); });
        this.search.addEventListener('input', () => this.render());
        document.getElementById('pf-refresh').addEventListener('click', () => this.load());
        document.getElementById('pf-today').addEventListener('click', () => { this.date.value=this.today(); this.previous.clear(); this.loaded=false; this.load(); });
        document.getElementById('pf-clear').addEventListener('click', () => { this.search.value=''; this.render(); });
        this.load();
        const timer = setInterval(() => { if (this.state !== 'loading') this.load(); }, 30000);
        window.addEventListener('pagehide', () => clearInterval(timer), {once:true});
    }
    async load() {
        const request = ++this.request;
        const start = new Date(`${this.date.value}T00:00:00`);
        if (Number.isNaN(start.getTime())) { this.state='date'; this.visits=[]; this.render(); this.status.textContent='Choose a consultation date.'; return; }
        const end = new Date(start); end.setDate(end.getDate()+1);
        this.state='loading';
        this.render();
        this.status.textContent='Checking for updated fees…';
        const refresh=document.getElementById('pf-refresh');
        refresh.disabled=true;
        try {
            const {data,error} = await this.client.from('visits')
                .select('id, patient_id, checked_in_at, patients(first_name, middle_name, last_name, suffix), staff!visits_doctor_id_fkey(full_name), Notes(pf)')
                .eq('kind','appointment').eq('status','completed')
                .gte('checked_in_at',start.toISOString()).lt('checked_in_at',end.toISOString())
                .order('checked_in_at',{ascending:false});
            if (request!==this.request) return;
            if (error) throw error;
            let changed=0;
            this.visits=(data || []).map(visit => {
                const note=Array.isArray(visit.Notes)?visit.Notes[0]:visit.Notes;
                const fee=String(note?.pf ?? '').trim();
                const updated=this.loaded && fee !== (this.previous.get(String(visit.id)) ?? '') && !!fee;
                if(updated) changed++;
                return {...visit,fee,updated};
            });
            this.loaded=true;
            this.previous=new Map(this.visits.map(visit=>[String(visit.id),visit.fee]));
            this.state='ready';
            this.render();
            this.status.textContent=`${changed ? `${changed} new or updated PF amount(s). ` : ''}Updated ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`;
        } catch(error) {
            if(request!==this.request) return;
            this.state = ['42703','PGRST204'].includes(error.code) || /column.*pf.*does not exist/i.test(error.message || '') ? 'setup' : 'error';
            this.visits=[];
            this.render();
            this.status.textContent=this.state==='setup'?'Fee setup is needed before charges can be shown.':'Fees could not be refreshed. Please try again.';
        } finally { if(request===this.request) refresh.disabled=false; }
    }
    formatFee(fee) {
        if (!fee) return 'Waiting for doctor';
        // Preserve any existing fee details exactly as the doctor entered them.
        if (!/^\d+(?:\.\d{1,2})?$/.test(fee)) return fee;
        return Number(fee).toLocaleString('en-PH', {style:'currency', currency:'PHP'});
    }
    render() {
        const ready=this.state==='ready';
        const el=id=>document.getElementById(id);
        const notice=el('pf-notice');
        notice.hidden=!['setup','error'].includes(this.state);
        el('pf-notice-title').textContent=this.state==='setup'?'Professional fees need a one-time setup':'We couldn’t load the fees';
        el('pf-notice-body').textContent=this.state==='setup'?'Ask your system administrator to finish setting up professional fees. Patient records are safe. Refresh this page once setup is complete.':'Check your connection, then select Refresh fees. No charges have been changed.';
        const term=this.search.value.trim().toLowerCase();
        const name=v=>[v.patients?.first_name,v.patients?.middle_name,v.patients?.last_name,v.patients?.suffix].filter(Boolean).join(' ') || 'Unknown patient';
        const filtered=ready?this.visits.filter(v=>`${name(v)} ${v.staff?.full_name || ''} ${v.patient_id}`.toLowerCase().includes(term)):[];
        el('pf-count').textContent=ready?`${filtered.length} ${filtered.length===1?'consultation':'consultations'} shown`:'Consultation fees';
        this.rows.replaceChildren();
        const cell=(row,value,label,className='')=>{
            const td=document.createElement('td'); td.textContent=value; td.className=className; td.dataset.label=label; row.appendChild(td); return td;
        };
        for(const v of filtered) {
            const row=document.createElement('tr');
            if(v.updated) row.className='pf-updated';
            const patient=cell(row,'','Patient');
            const strong=document.createElement('strong'); strong.textContent=name(v);
            const small=document.createElement('small'); small.textContent=`Patient #${v.patient_id} · Visit #${v.id}`; patient.append(strong,small);
            cell(row,v.staff?.full_name || 'Not available','Doctor');
            cell(row,new Date(v.checked_in_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}),'Visit time');
            cell(row,this.formatFee(v.fee),'PF to collect','pf-charge');
            this.rows.appendChild(row);
        }
        el('pf-empty').hidden=filtered.length>0;
        let title='No completed consultations yet', body='Completed visits for this date will appear here. Choose another date to view earlier consultations.';
        if(this.state==='loading') {title='Loading consultation fees…';body='Please wait while we check the doctor’s saved charges.';}
        else if(this.state==='setup') {title='Fees aren’t available yet';body='Once setup is complete, the doctor’s saved charges will appear here.';}
        else if(this.state==='error') {title='Your fee list is temporarily unavailable';body='Select Refresh fees to try again.';}
        else if(this.state==='date') {title='Choose a date to get started';body='Select a consultation date above, or choose Today.';}
        else if(term) {title='No matching consultations';body='Try another name or clear the search.';}
        el('pf-empty-title').textContent=title; el('pf-empty-body').textContent=body;
        el('pf-clear').hidden=!(ready && term);
    }
}
document.addEventListener('DOMContentLoaded',async()=>{
    if(!await window.entSessionReady) return;
    if(!['secretary','admin'].includes(window.entStaff?.role)) return;
    new ProfessionalFeesController().init();
});
