const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('supabase/functions/manage-staff/handler.js', 'utf8');
const handlerModule = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const targetId = '11111111-1111-4111-8111-111111111111';
async function run(body, options = {}) {
 const calls = [];
 const client = { auth: { getUser: async () => ({ data: { user: options.invalid ? null : { id: 'actor' } } }), admin: {
  createUser: async args => { calls.push(['create', args]); return { data: { user: { id: targetId } }, error: options.createError ? { message: 'Email already exists' } : null }; },
  updateUserById: async (...args) => { calls.push(['password', ...args]); return {}; },
  deleteUser: async id => { calls.push(['delete', id]); return { error: options.deleteError ? { message: 'Foreign key' } : null }; }
 } }, from: () => ({ select: () => ({ eq: (_, id) => ({ maybeSingle: async () => ({ data: id === 'actor' ? { role: options.actor || 'admin', is_active: !options.inactive } : options.missingProfile ? null : { role: options.target || body.role || 'doctor' } }) }) }) }) };
 const handler = (await handlerModule).createHandler(client);
 const response = await handler(new Request('https://example.test', { method: 'POST', headers: options.noToken ? {} : { Authorization: 'Bearer test' }, body: JSON.stringify(body) }));
 return { status: response.status, body: await response.json(), calls };
}
const create = { action: 'create', role: 'secretary', full_name: 'Test Staff', email: 'staff@example.test', password: 'long-password' };
test('unauthenticated, inactive and secretary callers cannot mutate accounts', async () => {
 for (const options of [{ noToken: true }, { invalid: true }, { inactive: true }, { actor: 'secretary' }]) {
  const result = await run(create, options); assert.ok([401, 403].includes(result.status)); assert.equal(result.calls.length, 0);
 }
});
test('doctor can create secretary but cannot create doctor or admin, delete or reset passwords', async () => {
 assert.equal((await run(create, { actor: 'doctor' })).status, 200);
 for (const body of [{ ...create, role: 'doctor' }, { ...create, role: 'admin' }, { action: 'delete', id: targetId }, { action: 'password', id: targetId, password: 'long-password' }]) {
  const result = await run(body, { actor: 'doctor' }); assert.equal(result.status, 403); assert.equal(result.calls.length, 0);
 }
});
test('admin creates both roles using trusted metadata and no client session change', async () => {
 for (const role of ['doctor', 'secretary']) {
  const result = await run({ ...create, role }); assert.equal(result.status, 200); assert.equal(result.calls[0][1].app_metadata.role, role); assert.equal(result.calls[0][1].user_metadata.role, undefined);
 }
});
test('admin can change password and delete eligible accounts', async () => {
 assert.equal((await run({ action: 'password', id: targetId, password: 'long-password' })).calls[0][0], 'password');
 assert.equal((await run({ action: 'delete', id: targetId })).status, 200);
});
test('administrator targets and invalid input cannot be changed', async () => {
 for (const body of [{ ...create, role: 'admin' }, { ...create, password: 'short' }, { ...create, email: 'invalid' }, { action: 'password', id: targetId, password: 'short' }, { action: 'delete', id: 'actor' }, { action: 'unknown' }]) assert.equal((await run(body)).status, 400);
 assert.equal((await run({ action: 'delete', id: targetId }, { target: 'admin' })).status, 403);
});
test('duplicate email, missing migration and linked records report failure', async () => {
 assert.equal((await run(create, { createError: true })).status, 400);
 const missing = await run(create, { missingProfile: true }); assert.equal(missing.status, 500); assert.equal(missing.calls[1][0], 'delete');
 const linked = await run({ action: 'delete', id: targetId }, { deleteError: true }); assert.equal(linked.status, 400); assert.match(linked.body.error, /clinical records/);
});
