// Real running preview admission checks. No provider connection or generation.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';
import { richComponentCombinations } from './fixtures/component-course.mjs';
import { setupDraft } from '../web/js/setup-model.js';
import { prepareAccountPayload } from '../web/js/setup-account-model.js';
const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
const base = 'http://127.0.0.1:4173';
const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const client = createClient(config.url, config.publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
let owner, checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
try {
  const email = `component-preflight-${randomUUID()}@example.test`, password = `${randomUUID()}Aa9!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.ok(!created.error); owner = created.data.user.id;
  const signed = await client.auth.signInWithPassword({ email, password }); assert.ok(!signed.error);
  const post = async (path, body) => {
    const response = await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${signed.data.session.access_token}`, 'content-type': 'application/json', origin: base }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const value = await response.json(); assert.equal(response.status, 200, value.error); return value;
  };
  for (const [index, components] of [...richComponentCombinations, ['lessons', 'images']].entries()) {
    const draft = setupDraft('Component admission check'); draft.brief.audience = 'New learners'; draft.components = components;
    const prepared = await prepareAccountPayload(draft), id = `setup-preview-components-${randomUUID()}`;
    const saved = await post('/api/setups/store', { id, expectedRevision: 0, payload: prepared.payload });
    check(saved.revision === 1, 'canonical setup save acknowledged');
    const result = await post('/api/setups/generate', { id, revision: saved.revision, action: 'check' });
    check(index < 16 ? result.issues.length === 0 : result.issues.some(issue => issue.step === 'experience'), 'preview accepts supported materials and rejects generated images');
    check(!result.ready && !result.connected, 'no provider connection means no generation permission');
  }
  const jobs = await client.from('generation_jobs').select('id').eq('owner_id', owner); assert.ok(!jobs.error);
  check(jobs.data.length === 0, 'preflight created no AI jobs');
  console.log(`Running preview components: ${checks} checks passed on port 4173; 16 supported sets plus image rejection, no AI requests.`);
} finally { if (owner) assert.ok(!(await admin.auth.admin.deleteUser(owner)).error); }
