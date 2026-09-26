const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(isMobile) {
    const makeElement = () => ({
        attributes: {}, listeners: {}, hidden: true,
        setAttribute(name, value) { this.attributes[name] = value; },
        getAttribute(name) { return this.attributes[name]; },
        addEventListener(name, handler) { this.listeners[name] = handler; },
        focus() { this.focused = true; },
        contains() { return false; }
    });
    const toggle = makeElement(), sidebar = makeElement(), backdrop = makeElement();
    const mobile = { matches: isMobile, addEventListener(name, handler) { this.change = handler; } };
    const listeners = {};
    const context = {
        window: { matchMedia: () => mobile },
        document: {
            querySelector: () => toggle, getElementById: () => sidebar,
            createElement: () => backdrop,
            body: { classList: { add() {}, toggle() {} }, appendChild() {} },
            addEventListener: (name, handler) => { listeners[name] = handler; }
        }
    };
    vm.runInNewContext(fs.readFileSync('Javascript/navigation.js', 'utf8'), context);
    listeners.DOMContentLoaded();
    return { toggle, sidebar, backdrop, mobile, listeners };
}

test('desktop navigation toggles access to links and Escape returns focus to its button', () => {
    const { toggle, sidebar, backdrop, listeners } = setup(false);
    assert.equal(toggle.hidden, false);
    assert.equal(sidebar.inert, false);
    assert.equal(backdrop.hidden, true);
    toggle.listeners.click();
    assert.equal(sidebar.inert, true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    toggle.listeners.click();
    listeners.keydown({ key: 'Escape' });
    assert.equal(sidebar.inert, true);
    assert.equal(toggle.focused, true);
});

test('mobile navigation starts closed, closes from backdrop, and adapts to desktop', () => {
    const { toggle, sidebar, backdrop, mobile } = setup(true);
    assert.equal(sidebar.inert, true);
    toggle.listeners.click();
    assert.equal(backdrop.hidden, false);
    assert.equal(sidebar.inert, false);
    backdrop.listeners.click();
    assert.equal(backdrop.hidden, true);
    assert.equal(sidebar.inert, true);
    mobile.matches = false;
    mobile.change();
    assert.equal(sidebar.inert, false);
    assert.equal(backdrop.hidden, true);
});
