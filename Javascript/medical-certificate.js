(() => {
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
    function parse(text) {
        const match = String(text || '').match(/^Clinical impression:\n([\s\S]*?)\nMedical attention\/rest:\n([\s\S]*?)\nFurther recommendations:(?:\n([\s\S]*))?$/i);
        return match ? {impression:match[1], rest:match[2], further:match[3] || ''} : {impression:'', rest:'', further:text || ''};
    }
    function serialize(data) {
        if (![data.impression, data.rest, data.further].some(value => value.trim())) return '';
        return `Clinical impression:\n${data.impression}\nMedical attention/rest:\n${data.rest}\nFurther recommendations:\n${data.further}`;
    }
    function content(text, patient, visit) {
        const data = parse(text);
        const date = new Date(visit.checked_in_at);
        const valid = !Number.isNaN(date.getTime());
        const birth = new Date(`${patient.date_of_birth}T00:00:00`);
        let age = '';
        if (valid && !Number.isNaN(birth.getTime()) && birth <= date) {
            age = date.getFullYear() - birth.getFullYear();
            if (date.getMonth() < birth.getMonth() || (date.getMonth() === birth.getMonth() && date.getDate() < birth.getDate())) age--;
        }
        const formattedDate = valid ? date.toLocaleDateString('en-PH', {year:'numeric',month:'long',day:'numeric'}) : '';
        const name = [patient.last_name, [patient.first_name, patient.middle_name, patient.suffix].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        return `<div class="certificate-date">Date: <span class="certificate-inline">${escape(formattedDate)}</span></div>
            <h2 class="certificate-title">MEDICAL CERTIFICATE</h2>
            <div class="certificate-body"><p>This is to certify that <span class="certificate-inline certificate-name">${escape(name)}</span>,
            <span class="certificate-inline certificate-age">${escape(age)}</span> years of age, consulted on <span class="certificate-inline">${escape(formattedDate)}</span>
            with the following clinical impression:</p>
            <div class="certificate-ruled certificate-impression">${escape(data.impression)}</div>
            <p>And would need medical attention/rest for <span class="certificate-inline certificate-rest">${escape(data.rest)}</span> barring complications.</p>
            <p>Further Recommendations:</p><div class="certificate-ruled certificate-further">${escape(data.further)}</div>
            <p class="certificate-disclaimer">This certificate is being issued upon the request of the above-mentioned for whatever purpose it may serve, except those of a medico-legal-nature.</p></div>`;
    }
    class Editor {
        constructor(field) {
            this.field = field;
            this.controls = {};
            const container = document.createElement('div');
            container.className = 'certificate-editor';
            for (const [key, title, rows] of [['impression','Clinical impression',3], ['rest','Medical attention / rest period',1], ['further','Further recommendations',2]]) {
                const label = document.createElement('label');
                const input = document.createElement('textarea');
                input.id = `certificate-${key}`;
                input.rows = rows;
                input.maxLength = 20000;
                input.className = 'certificate-ruled-input';
                label.htmlFor = input.id;
                label.textContent = title;
                container.append(label, input);
                this.controls[key] = input;
                input.addEventListener('input', () => {
                    this.resize(input);
                    field.value = serialize(Object.fromEntries(Object.entries(this.controls).map(([key, input]) => [key, input.value])));
                    field.dispatchEvent(new Event('input', {bubbles:true}));
                });
            }
            field.hidden = true;
            field.before(container);
            this.load(field.value);
            if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => Object.values(this.controls).forEach(input => this.resize(input))).observe(container);
        }
        resize(input) {
            input.style.height = 'auto';
            input.style.height = `${Math.max(input.rows * 28 + 2, input.scrollHeight + 2)}px`;
        }
        load(text) {
            const data = parse(text);
            for (const [key, input] of Object.entries(this.controls)) {
                input.value = data[key];
                this.resize(input);
            }
        }
    }
    window.entMedicalCertificate = {parse, serialize, content, Editor};
})();
