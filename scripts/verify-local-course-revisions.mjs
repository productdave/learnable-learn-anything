// Actual isolated local Auth/Postgres/RLS; only disposable accounts. No provider.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';
import { commitCourseRow } from '../web/api/_lib/course-commit.mjs';
import { courseRefinementFingerprint } from '../web/api/_lib/course-refinement.mjs';
import { rollbackGeneratedCourseSave } from '../web/api/_lib/course-save.mjs';

const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(config.url, config.secretKey, options);
const anonymous = createClient(config.url, config.publicKey, options);
const accounts = []; let checks = 0;
const check = (ok, label) => { assert.ok(ok, label); checks++; };
try {
  for (let i = 0; i < 2; i++) {
    const email = `revision-${randomUUID()}@example.test`, password = `${randomUUID()}Aa9!`;
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.ok(!made.error);
    const client = createClient(config.url, config.publicKey, options);
    accounts.push({ owner: made.data.user.id, client });
    assert.ok(!(await client.auth.signInWithPassword({ email, password })).error);
  }
  const [a, b] = accounts, courseId = 'revision-qa';
  const read = async () => { const r = await a.client.from('user_courses').select('id,payload,updated_at,write_revision').eq('owner_id', a.owner).eq('id', courseId).single(); assert.ok(!r.error, r.error?.message); return r.data; };
  const commit = (row, payload, supabase = a.client) => commitCourseRow({ supabase, ownerId: a.owner, courseId, row, payload });
  const original = { config: { id: courseId, title: 'Original course' }, lesson: 'Original lesson', _courseRevision: randomUUID(), _courseUpdatedAt: new Date().toISOString() };
  check(!(await a.client.from('user_courses').insert({ owner_id: a.owner, id: courseId, payload: original })).error, 'legacy insert remains compatible');
  let row = await read();
  check(!row.write_revision && !row.payload._courseRevision && !row.payload._courseUpdatedAt, 'legacy cannot forge managed metadata');
  check(!(await a.client.from('user_courses').update({ payload: { ...original, lesson: 'Legacy edit' } }).eq('owner_id', a.owner).eq('id', courseId)).error, 'untouched legacy row still accepts legacy saves');
  const legacy = await read();
  const first = await commit(legacy, { ...legacy.payload, lesson: 'Accepted newer lesson' });
  check(!!first.payload._courseRevision && first.payload._courseRevision === (await read()).write_revision, 'first modern save upgrades atomically');
  check(first.updated_at === (await read()).updated_at && Date.parse(first.payload._courseUpdatedAt) === Date.parse(first.updated_at), 'returned metadata matches actual stored revision');
  check(await commit(legacy, { ...legacy.payload, lesson: 'Stale modern edit' }) === null, 'original legacy timestamp cannot replace accepted content');
  const legacyOverwrite = await a.client.from('user_courses').update({ payload: legacy.payload, updated_at: new Date().toISOString() }).eq('owner_id', a.owner).eq('id', courseId).eq('updated_at', first.updated_at);
  check(legacyOverwrite.error?.code === 'PT409' && legacyOverwrite.status === 409, 'old writer with freshly read timestamp is blocked without retryable SQLSTATE');
  const inheritedMetadata = { ...first.payload, ...legacy.payload, lesson: 'Stale body with current unknown metadata' };
  const oldMerge = await a.client.from('user_courses').update({ payload: inheritedMetadata }).eq('owner_id', a.owner).eq('id', courseId);
  check(oldMerge.error?.code === 'PT409', 'shared-storage metadata merge cannot authorize old direct writes');
  const oldService = await admin.from('user_courses').update({ payload: inheritedMetadata, write_revision: null }).eq('owner_id', a.owner).eq('id', courseId);
  check(oldService.error?.code === 'PT409', 'legacy service writer cannot reset the managed boundary');
  const upsert = await a.client.from('user_courses').upsert({ owner_id: a.owner, id: courseId, payload: legacy.payload });
  check(upsert.error?.code === 'PT409', 'legacy upsert cannot bypass update guard');
  check((await read()).payload.lesson === 'Accepted newer lesson', 'all rejected writes leave accepted content intact');
  check(await commit({ ...first, payload: { ...first.payload, _courseRevision: randomUUID() } }, first.payload) === null, 'wrong revision with current timestamp conflicts');
  check(await commit({ ...first, updated_at: legacy.updated_at }, first.payload) === null, 'right revision with old timestamp conflicts');
  await assert.rejects(commit(first, first.payload, b.client), error => error.code === '42501'); checks++;
  await assert.rejects(commit(first, first.payload, anonymous), error => error.code === '42501'); checks++;
  const racers = await Promise.all([commit(first, { ...first.payload, lesson: 'Device A wins' }), commit(first, { ...first.payload, lesson: 'Device B wins' })]);
  check(racers.filter(Boolean).length === 1, 'two current devices commit exactly one revision');
  row = await read();
  check(row.payload._courseRevision !== first.payload._courseRevision, 'each accepted save changes the revision');
  const fingerprint = courseRefinementFingerprint(row.payload);
  const receipt = await commit(row, { ...row.payload, _refinementProposal: { id: randomUUID(), status: 'queued' } });
  check(courseRefinementFingerprint(receipt.payload) === fingerprint, 'receipt-only revisions do not invalidate their content proposal');
  check(receipt.payload._courseRevision !== row.payload._courseRevision, 'receipt-only saves still exclude stale whole-course writes');
  check(await commit(null, original) === null, 'insert-only save does not replace an existing course');
  check(!await commitCourseRow({ supabase: a.client, ownerId: a.owner, courseId, row: first, action: 'delete' }), 'stale revision cannot delete a newer course during rollback');
  check((await read()).payload._courseRevision === receipt.payload._courseRevision, 'rejected rollback preserves latest revision');
  const written = await commit(await read(), { ...receipt.payload, _generationJobId: 'fixture-job', _generationRunId: 'fixture-run' });
  const replacement = await commit(written, { ...written.payload, lesson: 'A newer accepted edit in the same run' });
  const rollbackArgs = { supabase: admin, ownerId: a.owner, courseId, jobId: 'fixture-job', runId: 'fixture-run', savedRevision: written.payload._courseRevision, savedUpdatedAt: written.updated_at, priorPayload: receipt.payload };
  check(!await rollbackGeneratedCourseSave(rollbackArgs), 'same-run rollback cannot erase a later accepted revision');
  check((await read()).payload.lesson === replacement.payload.lesson, 'newer accepted same-run content remains intact');
  check(await rollbackGeneratedCourseSave({ ...rollbackArgs, savedRevision: replacement.payload._courseRevision, savedUpdatedAt: replacement.updated_at }), 'rollback with its exact committed version restores prior content');
  const restored = await read();
  check(restored.payload.lesson === receipt.payload.lesson && ![receipt.payload._courseRevision, replacement.payload._courseRevision].includes(restored.payload._courseRevision), 'restoring prior content produces a fresh non-reusable revision');
  console.log(`Course revision guard: ${checks} real local Auth/DB checks passed.`);
} finally {
  for (const account of accounts) {
    assert.ok(!(await admin.from('user_courses').delete().eq('owner_id', account.owner)).error);
    assert.ok(!(await admin.auth.admin.deleteUser(account.owner)).error);
  }
  console.log('Removed only disposable revision QA accounts and courses.');
}
