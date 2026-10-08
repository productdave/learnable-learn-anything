import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSetupGenerationClient } from '../web/js/setup-generation-client.js';

let owner = 'owner-a', calls = [], checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const client = createSetupGenerationClient({
  getIdentity: () => ({ id: owner }),
  getClient: async () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: owner }, access_token: 'synthetic-session' } } }) } }),
  fetcher: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ connected: true, model: 'qa-model' }) }; }
});
check(typeof client.connection === 'function', 'Account needs a read-only server-vault status method');
check((await client.connection(owner)).connected, 'status returned from authenticated endpoint');
check(calls[0].url === '/api/providers/connection' && calls[0].init.method === 'GET' && !calls[0].init.body, 'status reads the same vault as Create without sending a key');
check(calls[0].init.cache === 'no-store' && calls[0].init.headers.Authorization === 'Bearer synthetic-session', 'private status is authorized and uncached');
await client.connect(owner, 'synthetic-provider-key');
await client.disconnect(owner);
check(calls.map(call => call.init.method).join(',') === 'GET,POST,DELETE', 'one shared endpoint for status, connect and disconnect');
owner = 'owner-b';
await assert.rejects(client.connection('owner-a'), /account changed/); checks++;
check(calls.length === 3, 'other-owner status never sent');
const late = createSetupGenerationClient({ getIdentity: () => ({ id: owner }),
  getClient: async () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: owner }, access_token: 'synthetic-session' } } }) } }),
  fetcher: async () => ({ ok: true, json: async () => { owner = 'owner-c'; return { connected: true }; } }) });
await assert.rejects(late.connection('owner-b'), /account changed/); checks++;
const auth = readFileSync('web/js/auth.js', 'utf8');
check(auth.indexOf('openWorkspaceAccount(') < auth.indexOf('const m = ensureModal();'), 'signed-in workspace routes before legacy modal is created');
check(auth.includes("document.body.dataset.experience === 'workspace'") && auth.includes('onUserChange'), 'workspace-only route preserves legacy consumers and watches identity');
const ui = readFileSync('web/js/workspace-account.js', 'utf8');
check(!/localStorage|sessionStorage|setProviderKey|flushSync/.test(ui), 'workspace account never uses legacy key persistence');
check(ui.includes('showModal()') && ui.includes('aria-labelledby') && ui.includes('aria-describedby'), 'native labelled modal');
check(ui.includes('learnable-provider-connection-changed') && !/client\.start\(/.test(ui), 'connection changes notify readiness without starting generation');
check(ui.includes('input.value = \'\'') && ui.includes('onUserChange'), 'submitted key clears and identity changes close the dialog');
console.log(`${checks} workspace Account contracts passed (synthetic network only).`);
