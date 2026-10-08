import assert from 'node:assert/strict';
import { coursePayloadBelongsToJob, readSavedCourseForUser, requireSafeCourseId, requireSafeRunId } from '../web/api/courses/get.js';

function supabaseMock(rows = []) {
  const calls = [];
  const chain = {
    filters: {},
    select(columns) {
      calls.push({ type: 'select', columns });
      return chain;
    },
    eq(field, value) {
      calls.push({ type: 'eq', field, value });
      chain.filters[field] = value;
      return chain;
    },
    maybeSingle() {
      calls.push({ type: 'maybeSingle' });
      const row = rows.find(item =>
        item.id === chain.filters.id &&
        item.owner_id === chain.filters.owner_id
      ) || null;
      return Promise.resolve({ data: row, error: null });
    }
  };
  return {
    calls,
    client: {
      from(table) {
        calls.push({ type: 'from', table });
        return chain;
      }
    }
  };
}

const row = {
  id: 'code-for-designers',
  owner_id: 'user-1',
  payload: { config: { id: 'code-for-designers', title: 'Code for Designers' }, _generationJobId: 'job-1', _generationRunId: 'run-1' },
  updated_at: '2026-06-27T00:00:00.000Z'
};

{
  const { client, calls } = supabaseMock([row]);
  const result = await readSavedCourseForUser(client, 'user-1', 'code-for-designers');
  assert.equal(result.error, null);
  assert.equal(result.data, row);
  assert.deepEqual(calls, [
    { type: 'from', table: 'user_courses' },
    { type: 'select', columns: 'id, payload, updated_at' },
    { type: 'eq', field: 'id', value: 'code-for-designers' },
    { type: 'eq', field: 'owner_id', value: 'user-1' },
    { type: 'maybeSingle' }
  ]);
}

{
  const { client } = supabaseMock([row]);
  const result = await readSavedCourseForUser(client, 'user-2', 'code-for-designers');
  assert.equal(result.error, null);
  assert.equal(result.data, null);
}

{
  const { client } = supabaseMock([row]);
  const result = await readSavedCourseForUser(client, 'user-1', 'code-for-designers', 'job-1');
  assert.equal(result.error, null);
  assert.equal(result.data, row);
}

{
  const { client } = supabaseMock([row]);
  const result = await readSavedCourseForUser(client, 'user-1', 'code-for-designers', 'job-1', 'run-1');
  assert.equal(result.error, null);
  assert.equal(result.data, row);
}

{
  const { client } = supabaseMock([row]);
  const result = await readSavedCourseForUser(client, 'user-1', 'code-for-designers', 'job-1', 'run-new');
  assert.equal(result.error, null);
  assert.equal(result.data, null);
}

{
  const { client } = supabaseMock([row]);
  const result = await readSavedCourseForUser(client, 'user-1', 'code-for-designers', 'other-job');
  assert.equal(result.error, null);
  assert.equal(result.data, null);
}

assert.equal(coursePayloadBelongsToJob({ _generationJobId: 'job-1' }, 'job-1'), true);
assert.equal(coursePayloadBelongsToJob({ _generationJobId: 'other-job' }, 'job-1'), false);
assert.equal(coursePayloadBelongsToJob({}, 'job-1'), false);
assert.equal(coursePayloadBelongsToJob({ _generationJobId: 'job-1', _generationRunId: 'run-1' }, 'job-1', 'run-1'), true);
assert.equal(coursePayloadBelongsToJob({ _generationJobId: 'job-1', _generationRunId: 'old-run' }, 'job-1', 'run-1'), false);
assert.equal(coursePayloadBelongsToJob({ _generationRunId: 'run-1' }, '', 'run-1'), false);
assert.equal(requireSafeRunId('run-1_ABC'), 'run-1_ABC');
assert.throws(() => requireSafeRunId('../bad'), /Invalid run id/);
assert.equal(requireSafeCourseId('code-for-designers_2026'), 'code-for-designers_2026');
for (const badCourseId of ['', ' ../bad ', 'course/other', 'course.other', '-course', 'course?x=1', 'a'.repeat(161)]) {
  assert.throws(() => requireSafeCourseId(badCourseId), /Invalid course id/);
}

console.log('course get owner, job, and run scope tests passed');
