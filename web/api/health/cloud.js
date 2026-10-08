// GET /api/health/cloud
//
// Safe deployment health check. Returns presence/absence of required cloud
// environment variables and required Supabase schema pieces without exposing
// secret values.

import { serviceClient } from '../_lib/supabase-server.mjs';
import { publicAiModelRegistry } from '../_lib/ai-models.mjs';

export const config = { runtime: 'nodejs' };

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'CRON_SECRET'
];
const ADMIN_KEY_NAMES = ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

export const REQUIRED_GENERATION_JOB_COLUMNS = [
  'id',
  'owner_id',
  'user_brief',
  'extracted_urls',
  'brief',
  'outline',
  'research',
  'topics_by_key',
  'failures',
  'review_history',
  'status',
  'stage',
  'message',
  'run_id',
  'recovery_attempts',
  'last_recovery_at',
  'continuation',
  'image_progress',
  'design_progress',
  'topics_done',
  'topics_total',
  'saved_course_id',
  'heartbeat_at',
  'lease_expires_at',
  'completed_at',
  'created_at',
  'started_at',
  'updated_at'
];

export const REQUIRED_USER_COURSE_COLUMNS = [
  'id',
  'owner_id',
  'payload',
  'created_at',
  'updated_at'
];

export const REQUIRED_USER_STATE_COLUMNS = [
  'user_id',
  'state',
  'updated_at'
];

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const env = Object.fromEntries(
    [...REQUIRED, ...ADMIN_KEY_NAMES].map(name => [name, !!process.env[name]])
  );
  const missingEnv = REQUIRED.filter(name => !env[name]);
  if (!ADMIN_KEY_NAMES.some(name => env[name])) {
    missingEnv.push('SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY');
  }

  let schema = {
    ok: false,
    checks: {},
    missing: []
  };
  if (!missingEnv.length) {
    try {
      schema = await checkSchema();
    } catch (err) {
      schema = {
        ok: false,
        checks: {},
        missing: ['Supabase schema check failed'],
        error: err?.message || String(err)
      };
    }
  }

  const missing = [...missingEnv, ...schema.missing];

  return res.status(missing.length ? 503 : 200).json({
    ok: missing.length === 0,
    env,
    ai: publicAiModelRegistry(),
    schema,
    missing
  });
}

export async function checkSchema(supabase = serviceClient()) {
  const checks = {};
  const details = {};

  checks.generation_jobs = await tableReadable(supabase, 'generation_jobs');
  checks.generation_jobs_columns = await columnsReadable(supabase, 'generation_jobs', REQUIRED_GENERATION_JOB_COLUMNS);
  checks.user_state = await tableReadable(supabase, 'user_state', 'user_id');
  checks.user_state_columns = await columnsReadable(supabase, 'user_state', REQUIRED_USER_STATE_COLUMNS);
  checks.user_courses = await tableReadable(supabase, 'user_courses');
  checks.user_courses_columns = await columnsReadable(supabase, 'user_courses', REQUIRED_USER_COURSE_COLUMNS);
  checks.course_uploads_bucket = await storageBucketExists(supabase, 'course-uploads');
  checks.delete_generation_job_rpc = await deleteRpcExists(supabase);
  checks.generation_action_checkpoint_rpc = await deleteRpcExists(supabase, true);
  const workflow = await generationWorkflowConstraints(supabase);
  checks.generation_workflow_constraints = workflow.ok;
  if (!workflow.ok && workflow.details) details.generation_workflow_constraints = workflow.details;

  const labels = {
    generation_jobs: 'generation_jobs table',
    generation_jobs_columns: 'generation_jobs required columns',
    user_state: 'user_state table',
    user_state_columns: 'user_state required columns',
    user_courses: 'user_courses table',
    user_courses_columns: 'user_courses required columns',
    course_uploads_bucket: 'course-uploads storage bucket',
    delete_generation_job_rpc: 'delete_generation_job_for_owner RPC',
    generation_action_checkpoint_rpc: 'delete_generation_job_at_checkpoint RPC (migration 18)',
    generation_workflow_constraints: 'generation workflow constraints'
  };
  const missing = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([key]) => labels[key] || key);

  return {
    ok: missing.length === 0,
    checks,
    details,
    missing
  };
}

async function tableReadable(supabase, table, column = 'id') {
  try {
    const { error } = await supabase.from(table).select(column).limit(1);
    return !error;
  } catch {
    return false;
  }
}

async function columnsReadable(supabase, table, columns) {
  try {
    const { error } = await supabase.from(table).select(columns.join(',')).limit(0);
    return !error;
  } catch {
    return false;
  }
}

async function storageBucketExists(supabase, bucket) {
  try {
    const { error } = await supabase.storage.getBucket(bucket);
    return !error;
  } catch {
    return false;
  }
}

async function deleteRpcExists(supabase, checkpoint = false) {
  try {
    const { error } = await supabase.rpc(checkpoint ? 'delete_generation_job_at_checkpoint' : 'delete_generation_job_for_owner', {
      p_job_id: '__learnable_healthcheck__',
      p_owner_id: '00000000-0000-0000-0000-000000000000',
      ...(checkpoint ? { p_expected_status: 'failed', p_expected_run_id: null } : {})
    });
    return !error;
  } catch {
    return false;
  }
}

async function generationWorkflowConstraints(supabase) {
  try {
    const { data, error } = await supabase.rpc('generation_workflow_health');
    if (error) return { ok: false, details: { error: error.message || String(error) } };
    const ok = data?.status_constraint === true
      && data?.stage_constraint === true
      && data?.job_id_constraint === true
      && data?.counter_constraint === true
      && data?.completion_constraint === true
      && data?.generation_jobs_rls_enabled === true
      && data?.generation_jobs_no_write_policies === true
      && data?.generation_jobs_updated_at_trigger === true
      && data?.user_state_rls_enabled === true
      && data?.user_state_owner_policies === true
      && data?.course_uploads_owner_policy === true
      && data?.user_courses_owner_key === true
      && data?.delete_generation_job_rpc_service_only === true;
    return { ok, details: data || null };
  } catch {
    return { ok: false, details: { error: 'generation_workflow_health failed' } };
  }
}
