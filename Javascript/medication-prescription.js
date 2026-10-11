document.addEventListener('DOMContentLoaded', async () => {
    if (!await window.entSessionReady) return;
    const form = document.getElementById('medication-preset-form');
    const fields = document.getElementById('medication-preset-fields');
    const choices = document.getElementById('medication-preset-choices');
    const status = document.getElementById('medication-preset-status');
    const name = document.getElementById('preset-name');
    const remarks = document.getElementById('preset-remarks');
    const loaded = await window.entMedicationCatalog.initialize();
    let items = loaded.items;
    let expected = loaded.raw;
    let selected = items.length ? 0 : -1;
    let dirty = false;
    const render = () => {
        choices.replaceChildren();
        items.forEach((item, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'medication-choice';
            button.textContent = item.name;
            button.setAttribute('aria-pressed', String(index === selected));
            button.addEventListener('click', () => {
                if (dirty) { status.textContent = 'Save or cancel your changes before selecting another medication.'; return; }
                selected = index;
                show();
            });
            choices.appendChild(button);
        });
    };
    const show = () => {
        name.value = items[selected]?.name || '';
        remarks.value = items[selected]?.remarks || '';
        document.getElementById('delete-preset').disabled = selected < 0;
        dirty = false;
        render();
    };
    fields.disabled = Boolean(loaded.error) || !['doctor', 'admin'].includes(window.entStaff.role);
    status.textContent = loaded.error || 'Select a medication button to edit its name and preset remarks.';
    show();
    form.addEventListener('input', () => { dirty = true; status.textContent = 'Unsaved changes.'; });
    document.getElementById('cancel-preset').addEventListener('click', () => { if (selected < 0) selected = items.length ? 0 : -1; show(); status.textContent = 'Changes cancelled.'; });
    document.getElementById('add-preset').addEventListener('click', () => {
        if (dirty) { status.textContent = 'Save or cancel your changes before adding a medication.'; return; }
        selected = -1;
        show();
        status.textContent = 'Enter the new medicine name and remarks, then save.';
        name.focus();
    });
    document.getElementById('delete-preset').addEventListener('click', async () => {
        if (fields.disabled || selected < 0) return;
        if (dirty) { status.textContent = 'Save or cancel your changes before deleting this medication.'; return; }
        const removed = items[selected];
        const updated = items.filter((item, index) => index !== selected);
        fields.disabled = true;
        try {
            expected = await window.entMedicationCatalog.save(updated, expected);
            items = updated;
            selected = items.length ? Math.min(selected, items.length - 1) : -1;
            show();
            status.textContent = `${removed.name} deleted from the presets. Saved patient prescriptions are unchanged.`;
        } catch (error) { status.textContent = `Unable to delete: ${error.message}`; } finally { fields.disabled = false; }
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (fields.disabled || !form.reportValidity()) return;
        const entry = {name:name.value.trim(), remarks:remarks.value.trim()};
        const updated = selected < 0 ? [...items, entry] : items.map((item, index) => index === selected ? entry : item);
        fields.disabled = true;
        try {
            expected = await window.entMedicationCatalog.save(updated, expected);
            if (selected < 0) selected = updated.length - 1;
            items = updated;
            show();
            status.textContent = `${items[selected].name} saved. New consultations on your devices will use this preset.`;
        } catch (error) { status.textContent = `Unable to save: ${error.message}`; } finally { fields.disabled = false; }
    });
    window.addEventListener('beforeunload', event => { if (dirty || fields.disabled) { event.preventDefault(); event.returnValue = ''; } });
});
