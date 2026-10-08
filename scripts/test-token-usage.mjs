import assert from 'node:assert/strict';
import { withCourseCommitRpc } from './fixtures/course-commit-rpc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { compactTokenUsage, createTokenUsageLedger, recordTokenUsage } from '../web/api/_lib/token-usage.mjs';
import { saveGeneratedCourse } from '../web/api/_lib/course-save.mjs';

const root = process.cwd();
const runner = readFileSync(join(root, 'web/api/_lib/gen-runner.mjs'), 'utf8');
const intakeStage = readFileSync(join(root, 'web/js/generator/stages/intake.mjs'), 'utf8');
const researchStage = readFileSync(join(root, 'web/js/generator/stages/research.mjs'), 'utf8');
const topicStage = readFileSync(join(root, 'web/js/generator/stages/topic.mjs'), 'utf8');
const courseLoader = readFileSync(join(root, 'web/js/course-loader.js'), 'utf8');
const app = readFileSync(join(root, 'web/js/app.js'), 'utf8');

{
  const ledger = createTokenUsageLedger();
  recordTokenUsage(ledger, {
    task: 'lesson',
    provider: 'anthropic',
    model: 'claude-test',
    usage: {
      input_tokens: 100,
      output_tokens: 40,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 5
    },
    meta: { moduleId: 'm1', topicId: 't1' }
  });
  recordTokenUsage(ledger, {
    task: 'research',
    provider: 'anthropic',
    model: 'claude-test',
    usage: { input_tokens: 20, output_tokens: 10 }
  });
  const usage = compactTokenUsage(ledger);
  assert.equal(usage.total.inputTokens, 120);
  assert.equal(usage.total.outputTokens, 50);
  assert.equal(usage.total.cacheCreationInputTokens, 10);
  assert.equal(usage.total.cacheReadInputTokens, 5);
  assert.equal(usage.total.totalTokens, 185);
  assert.equal(usage.total.calls, 2);
  assert.equal(usage.byTask.lesson.totalTokens, 155);
  assert.equal(usage.calls[0].topicId, 't1');
}

function makeSaveStore() {
  const jobs = {
    'job-usage': {
      id: 'job-usage',
      owner_id: 'owner-1',
      status: 'running',
      run_id: 'run-1',
      saved_course_id: null
    }
  };
  const courses = {};
  return {
    jobs,
    courses,
    from(table) {
      const builder = {
        op: 'select',
        row: null,
        patch: null,
        filters: {},
        inFilters: {},
        select() { return this; },
        insert(row) { this.op = 'insert'; this.row = row; return this; },
        update(patch) { this.op = 'update'; this.patch = patch; return this; },
        eq(column, value) { this.filters[column] = value; return this; },
        is() { return this; },
        in(column, values) { this.inFilters[column] = values; return this; },
        maybeSingle() {
          if (table === 'generation_jobs') {
            const row = jobs[this.filters.id] || null;
            if (!row || row.owner_id !== this.filters.owner_id) return Promise.resolve({ data: null, error: null });
            if (this.op === 'update') {
              if (this.filters.run_id && row.run_id !== this.filters.run_id) return Promise.resolve({ data: null, error: null });
              if (this.inFilters.status && !this.inFilters.status.includes(row.status)) return Promise.resolve({ data: null, error: null });
              jobs[this.filters.id] = { ...row, ...this.patch };
              return Promise.resolve({ data: { id: this.filters.id }, error: null });
            }
            return Promise.resolve({ data: row, error: null });
          }
          if (table === 'user_courses') {
            return Promise.resolve({ data: courses[this.filters.id] || null, error: null });
          }
          return Promise.resolve({ data: null, error: new Error(`unexpected table ${table}`) });
        },
        then(resolve) {
          courses[this.row.id] = { ...this.row };
          resolve({ error: null });
        }
      };
      return builder;
    }
  };
}

{
  const tokenUsage = {
    total: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, calls: 3 },
    byTask: {},
    calls: []
  };
  const supabase = withCourseCommitRpc(makeSaveStore());
  const saved = await saveGeneratedCourse({
    supabase,
    ownerId: 'owner-1',
    jobId: 'job-usage',
    runId: 'run-1',
    baseCourseId: 'usage course',
    course: { config: { id: 'usage-course', title: 'Usage Course' }, curriculum: { modules: [] }, modules: {} },
    brief: { id: 'usage-course', modules: [] },
    researchByModule: {},
    ownerEmail: 'dave@example.com',
    tokenUsage
  });
  assert.equal(saved.payload._tokenUsage.total.totalTokens, 1500);
}

assert.ok(runner.includes('createTokenUsageLedger()'));
assert.ok(runner.includes('recordTokenUsage(tokenUsage'));
assert.ok(runner.includes('compactTokenUsage(tokenUsage)'));
assert.ok(intakeStage.includes('opts.onUsage?.(resp.usage'));
assert.ok(researchStage.includes('opts.onUsage?.(resp.usage'));
assert.ok(topicStage.includes('opts.onUsage?.(resp.usage'));
assert.ok(courseLoader.includes('tokenUsage: c._tokenUsage || null'));
assert.ok(app.includes('function tokenUsageLabel'));
assert.ok(app.includes('Approximate tokens consumed while generating this course'));

console.log('token usage tests passed');
