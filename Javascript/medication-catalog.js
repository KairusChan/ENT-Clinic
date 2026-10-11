(() => {
    const key = () => `ent-medication-presets:${window.entStaff?.id || 'guest'}`;
    const defaults = () => Object.entries(window.entMedicationDefaults).map(([name, remarks]) => ({name, remarks}));
    function validate(items) {
        if (!Array.isArray(items)) throw new Error('Invalid medication preset list.');
        const names = new Set();
        for (const item of items) {
            if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200 || /[\r\n]/.test(item.name)) throw new Error('Enter a medicine name of up to 200 characters on one line.');
            if (typeof item.remarks !== 'string' || !item.remarks.trim() || item.remarks.length > 20000) throw new Error('Enter remarks of up to 20,000 characters.');
            const name = item.name.trim().toLowerCase();
            if (names.has(name)) throw new Error('Each medication must have a different name.');
            names.add(name);
        }
    }
    let snapshot = null;
    function seed() {
        try {
            const raw = localStorage.getItem(key());
            const items = raw ? JSON.parse(raw) : defaults();
            validate(items);
            return items;
        } catch { return defaults(); }
    }
    function load() {
        return snapshot || {items: seed(), raw: null, error: 'Medication database is not connected.'};
    }
    async function initialize() {
        const items = seed();
        try {
            const {data, error} = await window.entSupabase.rpc('load_medication_prescriptions', {p_seed: items});
            if (error) throw new Error(error.message || 'Medication database request failed.');
            validate(data.items);
            snapshot = {items:data.items, raw:data.revision};
        } catch (error) {
            snapshot = {items, raw:null, error:`Unable to load medication presets from the database. Apply the medication/recommendation migration if needed, then reload. ${error.message || ''}`};
        }
        return snapshot;
    }
    async function save(items, expected) {
        if (!['doctor', 'admin'].includes(window.entStaff?.role)) throw new Error('Only a doctor or administrator can edit medication presets.');
        validate(items);
        if (expected === null || load().error) throw new Error('Connect the medication database before saving.');
        const {data, error} = await window.entSupabase.rpc('save_medication_prescriptions', {p_items:items, p_expected_revision:expected});
        if (error) throw new Error(error.message || 'Medication database request failed.');
        snapshot = {items:JSON.parse(JSON.stringify(items)), raw:data};
        return data;
    }
    window.entMedicationCatalog = {load, initialize, save, validate};
})();
