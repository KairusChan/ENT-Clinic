const entMedicationRemarkPresets = {
    PND: 'otic drops\nSig: 3 drops 3x/day x 7 days',
    Ofloxacin: 'otic drops\nSig: 3 drops 3x/day x 7 days',
    ESSPRIN: 'Throat Spray\nSig: 2 sprays 3x /day x 7 days',
    NASAFLO: 'nasal spray\n50mcg/Actuation \nSig: 2 spray 2x a day x 1 month',
    ZYKAST: 'Levocetirizine + Montelukast\nSig: 1 tab once a day x 2 weeks',
    Czymocort: 'nasal spray\n500mcg/ml \nSig: 2 spray 2x/day 1 month each nasal cavity',
    ALLERKAST: 'Levocetirizine + Montelukast\nSig: 1 tab once a day x 2 weeks',
    Coamoxiclav: '625mg/tab\nSig: 1 tab 2x/day x 7 days',
    Cefuroxime: '500mg/tab\nSig: 1 tab 2x/day x 7 days',
    Pantoprazole: '40mg/tab\nSig: 1 tab once a day x 2 weeks',
    Methylprednisolone: '16mg/tab\nSig: 1 tab 2x/day x 5 days',
    Celecoxib: '200mg/tab\nSig: 1 tab 2x/day',
    Betahistine: '24mg/tab\nSig: 1 tab 2x/day x 7 days'
};

class MedicationForm {
    constructor(output) {
        this.presets = window.entMedicationCatalog ? window.entMedicationCatalog.load().items : Object.entries(entMedicationRemarkPresets).map(([name, remarks]) => ({name, remarks}));
        this.output = output;
        this.list = document.getElementById('medication-cards');
        this.template = document.getElementById('medication-card-template');
        this.nextId = 0;
        document.getElementById('add-medication').addEventListener('click', () => this.add());
        output.readOnly = true;
        this.load(output.value);
    }
    load(value) {
        this.list.replaceChildren();
        // Reopen recognized preset entries as cards; preserve other saved text verbatim.
        const blocks = value ? value.split('\n\n') : [''];
        for (const block of blocks) {
            const [heading, ...lines] = block.split('\n');
            const match = heading.match(/^(.+?)(?: — Quantity: ([1-9]\d*))?$/i);
            if (match && (Object.keys(entMedicationRemarkPresets).some(name => name.toUpperCase() === match[1].toUpperCase()) || this.presets?.some(item => item.name.toUpperCase() === match[1].toUpperCase()))) {
                this.add(lines.join('\n'), match[1], match[2] || '');
            } else {
                this.add(block);
            }
        }
    }
    add(savedText = '', savedName = '', savedQuantity = '') {
        const card = this.template.content.firstElementChild.cloneNode(true);
        const id = ++this.nextId;
        for (const field of card.querySelectorAll('[data-field]')) {
            field.id = `medicine-${id}-${field.dataset.field}`;
            card.querySelector(`[data-label="${field.dataset.field}"]`).htmlFor = field.id;
        }
        const name = card.querySelector('[data-field="name"]');
        const remarks = card.querySelector('[data-field="remarks"]');
        name.value = savedName;
        card.querySelector('[data-field="quantity"]').value = savedQuantity;
        remarks.value = savedText;
        const choices = card.querySelector('.medication-choices');
        for (const [medicine, preset] of this.presets.map(item => [item.name, item.remarks])) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'medication-choice';
            button.textContent = medicine;
            button.setAttribute('aria-pressed', 'false');
            button.addEventListener('click', () => {
                name.value = medicine;
                remarks.value = preset;
                updateSelection();
                this.sync();
            });
            choices.appendChild(button);
        }
        const updateSelection = () => {
            for (const button of choices.children) button.setAttribute('aria-pressed', String(button.textContent === name.value));
        };
        updateSelection();
        card.addEventListener('input', () => { updateSelection(); this.sync(); });
        card.querySelector('.medication-remove').addEventListener('click', () => {
            card.remove();
            this.renumber();
            this.sync();
            document.getElementById('add-medication').focus();
        });
        this.list.appendChild(card);
        this.renumber();
        if (!savedText && this.list.children.length > 1) name.focus();
    }
    renumber() {
        Array.from(this.list.children).forEach((card, index) => {
            card.querySelector('.medication-title').textContent = `Medicine ${index + 1}`;
            card.querySelector('.medication-remove').setAttribute('aria-label', `Remove medicine ${index + 1}`);
        });
    }
    sync() {
        this.output.value = Array.from(this.list.children).map(card => {
            const value = field => card.querySelector(`[data-field="${field}"]`).value.trim();
            const heading = [value('name'), value('quantity') ? `Quantity: ${value('quantity')}` : ''].filter(Boolean).join(' — ');
            return [heading, value('remarks')].filter(Boolean).join('\n');
        }).filter(Boolean).join('\n\n');
        this.output.dispatchEvent(new Event('input', {bubbles: true}));
    }
}
window.MedicationForm = MedicationForm;

window.entMedicationDefaults = entMedicationRemarkPresets;
