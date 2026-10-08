import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const envNames = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET'
];
const priorEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
for (const name of envNames) delete process.env[name];

const warn = console.warn;
console.warn = () => {};
const url = pathToFileURL(new URL('../web/api/health/cloud.js', import.meta.url).pathname);
url.searchParams.set('test', Date.now().toString(36));
const {
  default: handler,
  checkSchema,
  REQUIRED_GENERATION_JOB_COLUMNS,
  REQUIRED_USER_STATE_COLUMNS,
  REQUIRED_USER_COURSE_COLUMNS
} = await import(url.href);
console.warn = warn;

function createRes() {
  return {
    statusCode: 200,
    body: null,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    }
  };
}

{
  const res = createRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.deepEqual(res.body.schema, { ok: false, checks: {}, missing: [] });
  assert.deepEqual(res.body.missing.sort(), [
    'CRON_SECRET',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_URL'
  ]);
  assert.equal(res.body.env.SUPABASE_SECRET_KEY, false);
  assert.equal(res.body.env.SUPABASE_SERVICE_ROLE_KEY, false);
}

{
  const res = createRes();
  await handler({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.error, 'GET only');
}

function healthyWorkflowHealth(overrides = {}) {
  return {
    status_constraint: true,
    stage_constraint: true,
    job_id_constraint: true,
    counter_constraint: true,
    completion_constraint: true,
    generation_jobs_rls_enabled: true,
    generation_jobs_no_write_policies: true,
    generation_jobs_updated_at_trigger: true,
    user_state_rls_enabled: true,
    user_state_owner_policies: true,
    course_uploads_owner_policy: true,
    user_courses_owner_key: true,
    delete_generation_job_rpc_service_only: true,
    ...overrides
  };
}

function makeSupabaseMock({
  failSelect,
  throwSelect,
  throwBucket,
  throwRpc,
  workflowHealth = healthyWorkflowHealth()
} = {}) {
  const selects = [];
  const rpcs = [];
  return {
    selects,
    rpcs,
    from(table) {
      return {
        select(columns) {
          selects.push({ table, columns });
          if (throwSelect?.({ table, columns })) throw new Error('select exploded');
          return {
            limit() {
              const shouldFail = failSelect?.({ table, columns });
              return Promise.resolve({ error: shouldFail ? new Error('missing column') : null });
            }
          };
        }
      };
    },
    storage: {
      getBucket(bucket) {
        assert.equal(bucket, 'course-uploads');
        if (throwBucket) throw new Error('bucket exploded');
        return Promise.resolve({ error: null });
      }
    },
    rpc(name, args) {
      rpcs.push({ name, args });
      if (throwRpc?.(name)) throw new Error('rpc exploded');
      if (name === 'delete_generation_job_for_owner' || name === 'delete_generation_job_at_checkpoint') {
        assert.equal(args.p_job_id, '__learnable_healthcheck__');
        if (name === 'delete_generation_job_at_checkpoint') { assert.equal(args.p_expected_status, 'failed'); assert.equal(args.p_expected_run_id, null); }
        return Promise.resolve({ error: null });
      }
      if (name === 'generation_workflow_health') {
        return Promise.resolve({ data: workflowHealth, error: null });
      }
      assert.fail(`unexpected RPC ${name}`);
      return Promise.resolve({ error: null });
    }
  };
}

{
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SECRET_KEY = 'secret-key';
  process.env.CRON_SECRET = 'cron';
  const res = createRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.ok(res.body.missing.includes('Supabase schema check failed'));
  assert.equal(res.body.schema.ok, false);
  assert.ok(res.body.schema.error);
  for (const name of envNames) delete process.env[name];
}

{
  const supabase = makeSupabaseMock();
  const schema = await checkSchema(supabase);
  assert.equal(schema.ok, true);
  assert.deepEqual(schema.missing, []);
  assert.ok(supabase.selects.some(s => s.table === 'generation_jobs' && s.columns === REQUIRED_GENERATION_JOB_COLUMNS.join(',')));
  assert.ok(supabase.selects.some(s => s.table === 'user_state' && s.columns === 'user_id'));
  assert.ok(supabase.selects.some(s => s.table === 'user_state' && s.columns === REQUIRED_USER_STATE_COLUMNS.join(',')));
  assert.ok(supabase.selects.some(s => s.table === 'user_courses' && s.columns === REQUIRED_USER_COURSE_COLUMNS.join(',')));
  assert.ok(supabase.rpcs.some(r => r.name === 'generation_workflow_health'));
  assert.ok(supabase.rpcs.some(r => r.name === 'delete_generation_job_at_checkpoint'));
}

{
  const schema = await checkSchema(makeSupabaseMock({ throwRpc: name => name === 'delete_generation_job_at_checkpoint' }));
  assert.equal(schema.ok, false);
  assert.ok(schema.missing.includes('delete_generation_job_at_checkpoint RPC (migration 18)'));
}

for (const requiredColumn of ['run_id', 'continuation']) {
  const supabase = makeSupabaseMock({
    failSelect: ({ table, columns }) => table === 'generation_jobs' && columns.split(',').includes(requiredColumn)
  });
  const schema = await checkSchema(supabase);
  assert.equal(schema.ok, false, `missing ${requiredColumn} must block readiness`);
  assert.equal(schema.checks.generation_jobs_columns, false);
  assert.ok(schema.missing.includes('generation_jobs required columns'));
}

{
  const supabase = makeSupabaseMock({
    throwSelect: ({ table }) => table === 'generation_jobs',
    throwBucket: true,
    throwRpc: (name) => name === 'generation_workflow_health'
  });
  const schema = await checkSchema(supabase);
  assert.equal(schema.ok, false);
  assert.equal(schema.checks.generation_jobs, false);
  assert.equal(schema.checks.generation_jobs_columns, false);
  assert.equal(schema.checks.course_uploads_bucket, false);
  assert.equal(schema.checks.generation_workflow_constraints, false);
  assert.ok(schema.missing.includes('generation_jobs table'));
  assert.ok(schema.missing.includes('generation_jobs required columns'));
  assert.ok(schema.missing.includes('course-uploads storage bucket'));
  assert.ok(schema.missing.includes('generation workflow constraints'));
}

{
  const supabase = makeSupabaseMock({
    failSelect: ({ table, columns }) => table === 'user_state' && columns.includes('state')
  });
  const schema = await checkSchema(supabase);
  assert.equal(schema.ok, false);
  assert.equal(schema.checks.user_state_columns, false);
  assert.ok(schema.missing.includes('user_state required columns'));
}

{
  const supabase = makeSupabaseMock({
    workflowHealth: healthyWorkflowHealth({ job_id_constraint: false })
  });
  const schema = await checkSchema(supabase);
  assert.equal(schema.ok, false);
  assert.equal(schema.checks.generation_workflow_constraints, false);
  assert.equal(schema.details.generation_workflow_constraints.job_id_constraint, false);
  assert.ok(schema.missing.includes('generation workflow constraints'));
}

{
  const supabase = makeSupabaseMock({
    workflowHealth: healthyWorkflowHealth({ counter_constraint: false })
  });
  const schema = await checkSchema(supabase);
  assert.equal(schema.ok, false);
  assert.equal(schema.checks.generation_workflow_constraints, false);
  assert.ok(schema.missing.includes('generation workflow constraints'));
}

{
  const supabase = makeSupabaseMock({
    workflowHealth: healthyWorkflowHealth({ completion_constraint: false })
  });
  const schema = await checkSchema(supabase);
  assert.equal(schema.ok, false);
  assert.equal(schema.checks.generation_workflow_constraints, false);
  assert.ok(schema.missing.includes('generation workflow constraints'));
}

{
  const supabase = makeSupabaseMock({
    workflowHealth: healthyWorkflowHealth({ user_state_rls_enabled: false, user_courses_owner_key: false })
  });
  const schema = await checkSchema(supabase);
  assert.equal(schema.ok, false);
  assert.equal(schema.checks.generation_workflow_constraints, false);
  assert.ok(schema.missing.includes('generation workflow constraints'));
}

{
  const supabase = makeSupabaseMock({
    workflowHealth: healthyWorkflowHealth({ generation_jobs_rls_enabled: false })
  });
  const schema = await checkSchema(supabase);
  assert.equal(schema.ok, false);
  assert.equal(schema.checks.generation_workflow_constraints, false);
  assert.ok(schema.missing.includes('generation workflow constraints'));
}

{
  const supabase = makeSupabaseMock({
    workflowHealth: healthyWorkflowHealth({ user_state_rls_enabled: false })
  });
  const schema = await checkSchema(supabase);
  assert.equal(schema.ok, false);
  assert.equal(schema.checks.generation_workflow_constraints, false);
  assert.ok(schema.missing.includes('generation workflow constraints'));
}

{
  const supabase = makeSupabaseMock({
    workflowHealth: healthyWorkflowHealth({ generation_jobs_updated_at_trigger: false })
  });
  const schema = await checkSchema(supabase);
  assert.equal(schema.ok, false);
  assert.equal(schema.checks.generation_workflow_constraints, false);
  assert.ok(schema.missing.includes('generation workflow constraints'));
}

{
  const supabase = makeSupabaseMock({
    workflowHealth: healthyWorkflowHealth({ user_state_owner_policies: false })
  });
  const schema = await checkSchema(supabase);
  assert.equal(schema.ok, false);
  assert.equal(schema.checks.generation_workflow_constraints, false);
  assert.ok(schema.missing.includes('generation workflow constraints'));
}

{
  const supabase = makeSupabaseMock({
    workflowHealth: healthyWorkflowHealth({ course_uploads_owner_policy: false })
  });
  const schema = await checkSchema(supabase);
  assert.equal(schema.ok, false);
  assert.equal(schema.checks.generation_workflow_constraints, false);
  assert.ok(schema.missing.includes('generation workflow constraints'));
}

{
  const supabase = makeSupabaseMock({
    workflowHealth: healthyWorkflowHealth({ delete_generation_job_rpc_service_only: false })
  });
  const schema = await checkSchema(supabase);
  assert.equal(schema.ok, false);
  assert.equal(schema.checks.generation_workflow_constraints, false);
  assert.ok(schema.missing.includes('generation workflow constraints'));
}

for (const [name, value] of Object.entries(priorEnv)) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

console.log('cloud health endpoint tests passed');
