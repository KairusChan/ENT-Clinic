(() => {
    const template = `To: 
> Please admit to  under my service
> Secure consent for admission and management
> Diet: 
> IVF: 
> Diagnostics: 
> Therapeutics: 
> Plan/Procedure: 
> Referrals: 
> Additional orders: 
> Vital signs monitoring and record
> Please inform me once the patient is admitted
> Refer`;
    const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));
    const blank = value => escape(value.replace(/_{3,}/g, '').trim());
    function body(text) {
        return String(text).split('\n').map(line => {
            const match = line.match(/^(?:>\s*)?(To|Diet|IVF|Diagnostics|Therapeutics|Plan\/Procedure|Referrals|Additional orders):\s*(.*)$/i);
            if (match) {
                const large = /^(Diagnostics|Therapeutics|Plan\/Procedure|Referrals|Additional orders)$/i.test(match[1]);
                return `<div class="admit-row${large ? ' admit-row-large' : ''}"><span>${match[1].toLowerCase() === 'to' ? '' : '&gt; '}${escape(match[1])}:</span><span class="admit-line">${blank(match[2])}</span></div>`;
            }
            const admission = line.match(/^>\s*Please admit to (.*?) under my service$/i);
            if (admission) return `<div class="admit-row"><span>&gt; Please admit to</span><span class="admit-line">${blank(admission[1])}</span><span>under my service</span></div>`;
            return `<div class="admit-instruction">${escape(line) || '&nbsp;'}</div>`;
        }).join('');
    }
    function render(text, patient = {}, visit = {}, section = 'admitting_orders') {
        const date = new Date(visit.checked_in_at);
        const validDate = !Number.isNaN(date.getTime());
        const birth = new Date(`${patient.date_of_birth}T00:00:00`);
        let age = '';
        if (validDate && !Number.isNaN(birth.getTime()) && birth <= date) {
            age = date.getFullYear() - birth.getFullYear();
            if (date.getMonth() < birth.getMonth() || (date.getMonth() === birth.getMonth() && date.getDate() < birth.getDate())) age--;
        }
        const field = (label, value) => `<div class="admit-detail"><span>${label}:</span><span class="admit-line">${escape(value)}</span></div>`;
        const name = [patient.first_name, patient.middle_name, patient.last_name, patient.suffix].filter(Boolean).join(' ');
        const medication = section === 'medication';
        const certificate = section === 'recommendation' && window.entMedicalCertificate;
        return `<article class="admit-document${certificate ? ' medical-certificate' : ''}">
            <header class="admit-header"><img src="../css/images/clinic-caduceus.png" alt="Medical emblem"><div>
                <h1>ALDRIN BUTZ E. BAMBA, MD, DPBO-HNS</h1>
                <strong>Diplomate, Otorhinolaryngology - Head and Neck Surgery</strong>
                <div>Specialist in Ears, Nose, Throat, Sinuses, Mouth and Throat Diseases</div>
                <div>Tumor Surgery of the Head and Neck</div><div>Voice, Swallowing and Breathing Disorders</div>
                <div>Diagnostic and Therapeutic Upper Aerodigestive Tract Endoscopy</div><div>Hearing and Balance Disorders</div>
                <div>Cleft Lip and Palate Surgery</div><div>Facial Trauma, Maxillofacial and Reconstructive Surgery of the Head and Neck</div>
            </div></header>
            ${certificate ? certificate.content(text, patient, visit) : `<div class="admit-details">${field('Name', name)}${field('Date', validDate ? date.toLocaleDateString('en-PH', {year:'numeric', month:'long', day:'numeric'}) : '')}${field('Address', patient.address || '')}${field('Age/Sex', [age, patient.sex || ''].filter(value => value !== '').join(' / '))}</div>
            ${medication ? `<img class="medication-print-rx" src="../css/images/prescription-rx.png" alt="Rx"><div class="medication-print-content">${escape(text)}</div>` : `<h2>${section === 'diagnostic' ? 'DIAGNOSTIC' : section === 'recommendation' ? 'RECOMMENDATION' : 'ADMITTING ORDERS'}</h2><div class="admit-orders${['recommendation', 'diagnostic'].includes(section) ? ' recommendation-content' : ''}">${['recommendation', 'diagnostic'].includes(section) ? escape(text) : body(text)}</div>`}`}
            <footer class="admit-footer"><div class="admit-signature"><strong>Aldrin Butz E. Bamba, MD, DPBOHNS</strong><div>License No.: 0135273</div><div>PTR No.: ____________________</div><div>S2 No.: _____________________</div></div>
                <div class="admit-clinics">
                    <div><strong>UB Healthcare Clinic</strong><br>Mc Arthur Hiway, San Francisco, Mabalacat City<br>Tuesday - Thursday - Saturday<br>9:00am to 12:00nn<br>Secretary: 0917-139-6050</div>
                    <div><strong>St. Catherine of Alexandria Foundation<br>and Medical Center, Room 106</strong><br>Rizal Street Ext., Brgy. Cutcut, Angeles City<br>Wednesday &amp; Friday 1:00pm to 4:00pm<br>Secretary: 0991-481-7667</div>
                    <div><strong>Maxicare Primary Care Clinic</strong><br>G/F, SM City Clark, Tech Hub 6<br>M.A. Roxas Hiway, Angeles City<br>Friday 4:00pm to 7:00pm<br>Sunday 7:00am to 10:00am</div>
                </div>
            </footer>
        </article>`;
    }
    function underlineInput(text) {
        let continuation = false;
        return String(text).split('\n').map(line => {
            const labelled = line.match(/^((?:>\s*)?(?:To|Diet|IVF|Diagnostics|Therapeutics|Plan\/Procedure|Referrals|Additional orders):[ \t]*)(.*)$/i);
            const admission = line.match(/^(>\s*Please admit to[ \t]+)(.*?)([ \t]+under my service)$/i);
            if (labelled || admission) {
                const parts = labelled || admission;
                continuation = Boolean(labelled);
                return escape(parts[1]) + `<span class="admit-typed-value">${escape(parts[2])}</span>` + escape(parts[3] || '');
            }
            if (/^>/.test(line)) continuation = false;
            return continuation ? `<span class="admit-typed-value">${escape(line)}</span>` : escape(line);
        }).join('\n');
    }
    window.entAdmittingOrders = {template, render, underlineInput};
    document.addEventListener('DOMContentLoaded', () => {
        const button = document.getElementById('use-admitting-template');
        const field = document.getElementById('note-admitting_orders');
        if (!button || !field) return;
        const mirror = field.parentElement?.querySelector('.admit-input-mirror');
        const redraw = () => {
            if (!mirror) return;
            const style = getComputedStyle(field);
            for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'wordBreak', 'overflowWrap']) mirror.style[property] = style[property];
            mirror.style.width = `${field.clientWidth}px`;
            mirror.style.height = `${field.clientHeight}px`;
            mirror.style.top = `${field.offsetTop + field.clientTop}px`;
            mirror.style.left = `${field.offsetLeft + field.clientLeft}px`;
            mirror.innerHTML = underlineInput(field.value) + '\n';
            mirror.scrollTop = field.scrollTop;
            mirror.scrollLeft = field.scrollLeft;
        };
        field.addEventListener('scroll', redraw);
        if (mirror && typeof ResizeObserver !== 'undefined') new ResizeObserver(redraw).observe(field);
        button.addEventListener('click', () => {
            if (field.value.trim()) return;
            field.value = template;
            field.dispatchEvent(new Event('input', {bubbles: true}));
            field.focus();
        });
        const update = () => { button.hidden = Boolean(field.value.trim()); redraw(); };
        field.addEventListener('input', update);
        field.addEventListener('admitting-loaded', () => {
            field.value = field.value.split('\n').map(line => {
                if (/^(?:>\s*)?(?:To|Diet|IVF|Diagnostics|Therapeutics|Plan\/Procedure|Referrals|Additional orders):/.test(line) || /^>\s*Please admit to /.test(line)) {
                    return line.replace(/_{3,}/g, '');
                }
                return line;
            }).join('\n');
            update();
        });
        redraw();
    });
})();
