const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const context = {window: {}, fetch: async () => ({blob: async () => new Blob(['photo'])}), crypto: require('node:crypto').webcrypto};
vm.createContext(context);
vm.runInContext(fs.readFileSync('Javascript/patient-pictures.js', 'utf8'), context);
const Pictures = context.window.PatientPictures;
test('storage upload failure retains successful paths for retry', async () => {
    const editor = Object.create(Pictures.prototype);
    editor.pictures = ['data:image/jpeg;base64,YQ==', 'data:image/jpeg;base64,Yg=='];
    const uploaded = [];
    let fail = true;
    const client = {storage: {from(bucket) {
        assert.equal(bucket, 'PatientRecordUploads');
        return {async upload(path, blob, options) {
            assert.equal(options.upsert, false);
            if (uploaded.length === 1 && fail) return {error: {message: 'Denied'}};
            uploaded.push(path);
            return {error: null};
        }};
    }}};
    await assert.rejects(editor.upload(client), /Picture upload failed: Denied/);
    assert.match(editor.pictures[0], /^records\/.+\.jpg$/);
    assert.match(editor.pictures[1], /^data:/);
    fail = false;
    const paths = await editor.upload(client);
    assert.equal(uploaded.length, 2);
    assert.deepEqual(Array.from(paths), uploaded);
});
test('registration has a working submit button', () => {
    assert.match(fs.readFileSync('Secretary/register.html', 'utf8'), /<button class="primary" type="submit">Save Patient<\/button>/);
});
