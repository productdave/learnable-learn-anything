import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function assert(name, condition) {
  if (!condition) throw new Error(name);
  console.log(`ok - ${name}`);
}

function includes(path, text) {
  return read(path).includes(text);
}

function excludes(path, text) {
  return !read(path).includes(text);
}

const app = read('web/js/app.js');
const intake = read('web/js/intake.js');
const jobs = read('web/js/jobs.js');
const auth = read('web/js/auth.js');
const cloud = read('web/js/cloud-gen-client.js');
const courseSync = read('web/js/course-sync.js');
const courseLoader = read('web/js/course-loader.js');
const userCourses = read('web/js/user-courses.js');
const search = read('web/js/search.js');
const sync = read('web/js/sync.js');
const generatorIndex = read('web/js/generator/index.js');
const runner = read('web/api/_lib/gen-runner.mjs');
const start = read('web/api/gen/start.js');
const resume = read('web/api/gen/resume.js');
const restart = read('web/api/gen/restart.js');
const sweep = read('web/api/gen/sweep.js');
const recovery = read('web/api/_lib/gen-recovery.mjs');
const briefMeta = read('web/api/_lib/gen-brief.mjs');
const reviewHistory = read('web/api/_lib/gen-review-history.mjs');
const failurePolicy = read('web/api/_lib/gen-failures.mjs');
const researchCheckpoint = read('web/api/_lib/gen-research-checkpoint.mjs');
const courseSave = read('web/api/_lib/course-save.mjs');
const courseCommit = read('web/api/_lib/course-commit.mjs');
const courseRevisionMigration = read('db/19-course-write-revisions.sql');
const requestBudget = read('web/api/_lib/gen-request-budget.mjs');
const groupedRouter = read('scripts/packaging/grouped-router.mjs');
const genState = read('web/api/_lib/gen-state.mjs');
const aiModels = read('web/api/_lib/ai-models.mjs');
const apiKeys = read('web/js/api-keys.js');
const tokenUsage = read('web/api/_lib/token-usage.mjs');
const supabaseServer = read('web/api/_lib/supabase-server.mjs');
const urlExtract = read('web/api/_lib/url-extract.mjs');
const review = read('web/api/gen/review.js');
const credentialsReady = read('web/api/gen/credentials-ready.js');
const cancel = read('web/api/gen/cancel.js');
const deleteJob = read('web/api/gen/delete.js');
const courseGet = read('web/api/courses/get.js');
const researchStage = read('web/js/generator/stages/research.mjs');
const topicStage = read('web/js/generator/stages/topic.mjs');
const vercel = read('web/vercel.json');
const bridgeAuthIdentityBody = app.slice(app.indexOf('function bridgeAuthIdentity()'), app.indexOf('function escapeHTML'));
const rls = read('db/02-rls.sql');
const migration = read('db/04-agentic-workflow.sql');
const policyRepairMigration = read('db/05-clean-generation-job-write-policies.sql');
const packageJson = JSON.parse(read('package.json'));
const webPackageJson = JSON.parse(read('web/package.json'));
const startReviewableGenerationBody = intake.slice(
  intake.indexOf('async function startReviewableGeneration'),
  intake.indexOf('onUserChange((user) => {')
);
const startReviewableGenerationCatchBody = startReviewableGenerationBody.slice(
  startReviewableGenerationBody.indexOf('} catch (err) {')
);

assert('cloud review endpoint exists', existsSync(join(root, 'web/api/gen/review.js')));
assert('cloud credentials-ready endpoint exists', existsSync(join(root, 'web/api/gen/credentials-ready.js')));
assert('cloud restart endpoint exists', existsSync(join(root, 'web/api/gen/restart.js')));
assert('cloud watchdog endpoint exists', existsSync(join(root, 'web/api/gen/watchdog.js')));
assert('cloud health endpoint exists', existsSync(join(root, 'web/api/health/cloud.js')));
assert('cloud delete endpoint exists', existsSync(join(root, 'web/api/gen/delete.js')));
assert('saved course read endpoint exists', existsSync(join(root, 'web/api/courses/get.js')));
assert('cloud sweep endpoint exists', existsSync(join(root, 'web/api/gen/sweep.js')));
assert('cloud e2e checklist exists', existsSync(join(root, 'docs/cloud-generation-e2e-checklist.md')));
assert('cloud recovery policy module exists', existsSync(join(root, 'web/api/_lib/gen-recovery.mjs')));
assert('cloud recovery policy test exists', existsSync(join(root, 'scripts/test-gen-recovery.mjs')));
assert('cloud brief metadata module exists', existsSync(join(root, 'web/api/_lib/gen-brief.mjs')));
assert('cloud brief metadata test exists', existsSync(join(root, 'scripts/test-gen-brief.mjs')));
assert('cloud review history module exists', existsSync(join(root, 'web/api/_lib/gen-review-history.mjs')));
assert('cloud review history test exists', existsSync(join(root, 'scripts/test-gen-review-history.mjs')));
assert('cloud review feedback test exists', existsSync(join(root, 'scripts/test-gen-review-feedback.mjs')));
assert('cloud review transition test exists', existsSync(join(root, 'scripts/test-gen-review-transitions.mjs')) && packageJson.scripts['test:gen-review-transitions'] && packageJson.scripts['verify:cloud-architecture'].includes('test:gen-review-transitions'));
assert('cloud failure policy module exists', existsSync(join(root, 'web/api/_lib/gen-failures.mjs')));
assert('cloud failure policy test exists', existsSync(join(root, 'scripts/test-gen-failures.mjs')));
assert('runner progress recovery reset test exists', existsSync(join(root, 'scripts/test-gen-runner-progress-recovery.mjs')) && packageJson.scripts['test:gen-runner-progress-recovery'] && packageJson.scripts['verify:cloud-architecture'].includes('test:gen-runner-progress-recovery'));
assert('cloud research checkpoint policy module exists', existsSync(join(root, 'web/api/_lib/gen-research-checkpoint.mjs')));
assert('cloud research checkpoint policy test exists', existsSync(join(root, 'scripts/test-gen-research-checkpoint.mjs')) && packageJson.scripts['test:gen-research-checkpoint'] && packageJson.scripts['verify:cloud-architecture'].includes('test:gen-research-checkpoint'));
assert('runner PDF failure persistence test exists', existsSync(join(root, 'scripts/test-gen-runner-pdf-failure.mjs')));
assert('runner lazy PDF recovery test exists', existsSync(join(root, 'scripts/test-gen-runner-lazy-pdf.mjs')) && packageJson.scripts['test:gen-runner-lazy-pdf'] && packageJson.scripts['verify:cloud-architecture'].includes('test:gen-runner-lazy-pdf'));
assert('runner active heartbeat test exists', existsSync(join(root, 'scripts/test-gen-runner-heartbeat.mjs')) && packageJson.scripts['test:gen-runner-heartbeat'] && packageJson.scripts['verify:cloud-architecture'].includes('test:gen-runner-heartbeat'));
assert('cloud URL extraction test exists', existsSync(join(root, 'scripts/test-cloud-url-extraction.mjs')) && packageJson.scripts['test:cloud-url-extraction'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-url-extraction'));
assert('runner final disposition test exists', existsSync(join(root, 'scripts/test-gen-runner-disposition.mjs')));
assert('cloud start idempotency test exists', existsSync(join(root, 'scripts/test-gen-start-idempotency.mjs')));
assert('cloud restart policy test exists', existsSync(join(root, 'scripts/test-gen-restart.mjs')));
assert('cloud cancel storage cleanup test exists', existsSync(join(root, 'scripts/test-gen-cancel-storage.mjs')));
assert('cloud delete storage cleanup test exists', existsSync(join(root, 'scripts/test-gen-delete-storage.mjs')));
assert('cloud course save helper exists', existsSync(join(root, 'web/api/_lib/course-save.mjs')));
assert('cloud course save identity test exists', existsSync(join(root, 'scripts/test-course-save.mjs')));
assert('saved course read owner-scope test exists', existsSync(join(root, 'scripts/test-course-get.mjs')) && packageJson.scripts['test:course-get'] && packageJson.scripts['verify:cloud-architecture'].includes('test:course-get'));
assert('course sync policy test exists', existsSync(join(root, 'scripts/test-course-sync-policy.mjs')));
assert('job brief compaction test exists', existsSync(join(root, 'scripts/test-jobs-brief-compaction.mjs')));
assert('job staleness policy test exists', existsSync(join(root, 'scripts/test-jobs-staleness.mjs')));
assert('source reattach UI test exists', existsSync(join(root, 'scripts/test-source-reattach-ui.mjs')));
assert('source reattach ambiguity test exists', existsSync(join(root, 'scripts/test-cloud-source-restart-ambiguity.mjs')) && packageJson.scripts['test:cloud-source-restart-ambiguity'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-source-restart-ambiguity'));
assert('research review UI test exists', existsSync(join(root, 'scripts/test-research-review-ui.mjs')));
assert('intake start reattach test exists', existsSync(join(root, 'scripts/test-intake-start-reattach.mjs')) && packageJson.scripts['test:intake-start-reattach'] && packageJson.scripts['verify:cloud-architecture'].includes('test:intake-start-reattach'));
assert('cloud start ambiguity test exists', existsSync(join(root, 'scripts/test-cloud-start-ambiguity.mjs')) && packageJson.scripts['test:cloud-start-ambiguity'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-start-ambiguity'));
assert('intake API key sync test exists', existsSync(join(root, 'scripts/test-intake-api-key-sync.mjs')) && packageJson.scripts['test:intake-api-key-sync'] && packageJson.scripts['verify:cloud-architecture'].includes('test:intake-api-key-sync'));
assert('API key cloud-copy truth test exists', existsSync(join(root, 'scripts/test-api-key-copy.mjs')) && packageJson.scripts['test:api-key-copy'] && packageJson.scripts['verify:cloud-architecture'].includes('test:api-key-copy'));
assert('auth course boundary test exists', existsSync(join(root, 'scripts/test-auth-course-boundary.mjs')));
assert('auth login message target test exists', existsSync(join(root, 'scripts/test-auth-login-message-target.mjs')));
assert('auth pending intake test exists', existsSync(join(root, 'scripts/test-auth-pending-intake.mjs')));
assert('legacy service worker retirement test exists', existsSync(join(root, 'scripts/test-legacy-sw-retirement.mjs')) && packageJson.scripts['test:legacy-sw-retirement'] && packageJson.scripts['verify:cloud-architecture'].includes('test:legacy-sw-retirement'));
assert('local generator retirement test exists', existsSync(join(root, 'scripts/test-local-generator-retirement.mjs')) && packageJson.scripts['test:local-generator-retirement'] && packageJson.scripts['verify:cloud-architecture'].includes('test:local-generator-retirement'));
assert('browser cache version test exists', existsSync(join(root, 'scripts/test-browser-cache-versions.mjs')) && packageJson.scripts['test:browser-cache-versions'] && packageJson.scripts['verify:cloud-architecture'].includes('test:browser-cache-versions'));
assert('cloud-only legacy retry bridge test exists', existsSync(join(root, 'scripts/test-cloud-only-legacy-retry.mjs')) && packageJson.scripts['test:cloud-only-legacy-retry'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-only-legacy-retry'));
assert('cloud checkpoint pipeline contract test exists', existsSync(join(root, 'scripts/test-cloud-checkpoint-pipeline.mjs')) && packageJson.scripts['test:cloud-checkpoint-pipeline'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-checkpoint-pipeline'));
assert('cloud health endpoint test exists', existsSync(join(root, 'scripts/test-cloud-health.mjs')));
assert('cloud watchdog owner scope test exists', existsSync(join(root, 'scripts/test-cloud-watchdog-scope.mjs')) && packageJson.scripts['test:cloud-watchdog-scope'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-watchdog-scope'));
assert('cloud watchdog client test exists', existsSync(join(root, 'scripts/test-cloud-watchdog-client.mjs')) && packageJson.scripts['test:cloud-watchdog-client'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-watchdog-client'));
assert('cloud timeout UI test exists', existsSync(join(root, 'scripts/test-cloud-timeout-ui.mjs')) && packageJson.scripts['test:cloud-timeout-ui'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-timeout-ui'));
assert('cloud automatic recovery retry test exists', existsSync(join(root, 'scripts/test-cloud-auto-recovery-retry.mjs')) && packageJson.scripts['test:cloud-auto-recovery-retry'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-auto-recovery-retry'));
assert('cloud sweep expiry scope test exists', existsSync(join(root, 'scripts/test-cloud-sweep-expiry-scope.mjs')) && packageJson.scripts['test:cloud-sweep-expiry-scope'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-sweep-expiry-scope'));
assert('cloud cancelled retention test exists', existsSync(join(root, 'scripts/test-cloud-cancelled-retention.mjs')) && packageJson.scripts['test:cloud-cancelled-retention'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-cancelled-retention'));
assert('cloud refresh rehydration test exists', existsSync(join(root, 'scripts/test-cloud-refresh-rehydration.mjs')) && packageJson.scripts['test:cloud-refresh-rehydration'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-refresh-rehydration'));
assert('cloud rehydrate pruning test exists', existsSync(join(root, 'scripts/test-cloud-rehydrate-prune.mjs')) && packageJson.scripts['test:cloud-rehydrate-prune'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-rehydrate-prune'));
assert('cloud client owner scope test exists', existsSync(join(root, 'scripts/test-cloud-client-owner-scope.mjs')) && packageJson.scripts['test:cloud-client-owner-scope'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-client-owner-scope'));
assert('cloud action preflight test exists', existsSync(join(root, 'scripts/test-cloud-action-preflight.mjs')) && packageJson.scripts['test:cloud-action-preflight'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-action-preflight'));
assert('cloud action conflict reattach test exists', existsSync(join(root, 'scripts/test-cloud-action-conflict-reattach.mjs')) && packageJson.scripts['test:cloud-action-conflict-reattach'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-action-conflict-reattach'));
assert('cloud action success reattach test exists', existsSync(join(root, 'scripts/test-cloud-action-success-reattach.mjs')) && packageJson.scripts['test:cloud-action-success-reattach'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-action-success-reattach'));
assert('cloud review API key recovery test exists', existsSync(join(root, 'scripts/test-cloud-review-api-key-recovery.mjs')) && packageJson.scripts['test:cloud-review-api-key-recovery'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-review-api-key-recovery'));
assert('cloud review missing-key feedback durability test exists', existsSync(join(root, 'scripts/test-cloud-review-feedback-durable-on-key-missing.mjs')) && packageJson.scripts['test:cloud-review-feedback-durable-on-key-missing'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-review-feedback-durable-on-key-missing'));
assert('cloud review success reattach test exists', existsSync(join(root, 'scripts/test-cloud-review-success-reattach.mjs')) && packageJson.scripts['test:cloud-review-success-reattach'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-review-success-reattach'));
assert('cloud partial API key recovery test exists', existsSync(join(root, 'scripts/test-cloud-partial-api-key-recovery.mjs')) && packageJson.scripts['test:cloud-partial-api-key-recovery'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-partial-api-key-recovery'));
assert('API key saved cloud job unblock test exists', existsSync(join(root, 'scripts/test-api-key-saved-unblocks-cloud-jobs.mjs')) && packageJson.scripts['test:api-key-saved-unblocks-cloud-jobs'] && packageJson.scripts['verify:cloud-architecture'].includes('test:api-key-saved-unblocks-cloud-jobs'));
assert('cloud delete mirror test exists', existsSync(join(root, 'scripts/test-cloud-delete-mirror.mjs')));
assert('cloud local cleanup test exists', existsSync(join(root, 'scripts/test-cloud-local-cleanup.mjs')));
assert('cloud local course removal scope test exists', existsSync(join(root, 'scripts/test-cloud-local-course-removal-scope.mjs')) && packageJson.scripts['test:cloud-local-course-removal-scope'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-local-course-removal-scope'));
assert('library delete cloud job test exists', existsSync(join(root, 'scripts/test-library-delete-cloud-job.mjs')) && packageJson.scripts['test:library-delete-cloud-job'] && packageJson.scripts['verify:cloud-architecture'].includes('test:library-delete-cloud-job'));
assert('cloud job row patch test exists', existsSync(join(root, 'scripts/test-cloud-job-patch.mjs')));
assert('cloud completed rehydrate test exists', existsSync(join(root, 'scripts/test-cloud-completed-rehydrate.mjs')) && packageJson.scripts['test:cloud-completed-rehydrate'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-completed-rehydrate'));
assert('cloud completed account ownership test exists', existsSync(join(root, 'scripts/test-cloud-completed-account-ownership.mjs')) && packageJson.scripts['test:cloud-completed-account-ownership'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-completed-account-ownership'));
assert('cloud completed sync action test exists', existsSync(join(root, 'scripts/test-cloud-completed-sync-action.mjs')) && packageJson.scripts['test:cloud-completed-sync-action'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-completed-sync-action'));
assert('cloud PDF cleanup test exists', existsSync(join(root, 'scripts/test-cloud-pdf-cleanup.mjs')));
assert('cloud restart fallback test exists', existsSync(join(root, 'scripts/test-cloud-restart-fallback.mjs')));
assert('cloud restart UI test exists', existsSync(join(root, 'scripts/test-cloud-restart-ui.mjs')) && packageJson.scripts['test:cloud-restart-ui'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-restart-ui'));
assert('cloud subscription idempotency test exists', existsSync(join(root, 'scripts/test-cloud-subscription-idempotency.mjs')));
assert('cloud schema contract test exists', existsSync(join(root, 'scripts/test-cloud-schema-contract.mjs')) && packageJson.scripts['test:cloud-schema-contract'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-schema-contract'));
assert('cloud runtime import test exists', existsSync(join(root, 'scripts/test-cloud-runtime.mjs')));
assert('db setup contract test exists', existsSync(join(root, 'scripts/test-db-setup-contract.mjs')) && packageJson.scripts['test:db-setup-contract'] && packageJson.scripts['verify:cloud-architecture'].includes('test:db-setup-contract'));
assert('cloud state primitive test exists', existsSync(join(root, 'scripts/test-cloud-state-primitives.mjs')) && packageJson.scripts['test:cloud-state-primitives'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-state-primitives'));
assert('AI model registry test exists', existsSync(join(root, 'scripts/test-ai-model-config.mjs')) && packageJson.scripts['test:ai-model-config'] && packageJson.scripts['verify:cloud-architecture'].includes('test:ai-model-config'));
assert('browser and API module syntax test exists', existsSync(join(root, 'scripts/test-module-syntax.mjs')) && packageJson.scripts['test:module-syntax'] && packageJson.scripts['verify:cloud-architecture'].includes('test:module-syntax'));
assert('module syntax test covers cloud runner dependencies', ['web/js/api-keys.js', 'web/js/generator/stages/intake.mjs', 'web/js/generator/stages/research.mjs', 'web/js/generator/stages/topic.mjs', 'web/js/generator/assemble-course.js', 'web/js/generator/anthropic-fetch.js', 'web/api/_lib/url-extract.mjs', 'web/api/_lib/gen-state.mjs', 'web/api/_lib/token-usage.mjs'].every(file => read('scripts/test-module-syntax.mjs').includes(file)));
assert('token usage test exists', existsSync(join(root, 'scripts/test-token-usage.mjs')) && packageJson.scripts['test:token-usage'] && packageJson.scripts['verify:cloud-architecture'].includes('test:token-usage'));
assert('shared course assembly module is not browser-runner named', existsSync(join(root, 'web/js/generator/assemble-course.js')) && !existsSync(join(root, 'web/js/generator/assemble-browser.js')) && runner.includes("from '../../js/generator/assemble-course.js'"));
assert('cloud deploy readiness check exists', existsSync(join(root, 'scripts/check-cloud-deploy-readiness.mjs')));
assert('cloud deploy readiness parser test exists', existsSync(join(root, 'scripts/test-cloud-deploy-readiness.mjs')) && packageJson.scripts['test:cloud-deploy-readiness'] && packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-deploy-readiness'));
assert('server runtime dependencies are declared', !!packageJson.dependencies?.['@supabase/supabase-js'] && !!packageJson.dependencies?.['@vercel/functions'] && !!packageJson.dependencies?.['@mozilla/readability'] && !!packageJson.dependencies?.linkedom);
assert('vercel deploy-root runtime dependencies are declared', !!webPackageJson.dependencies?.['@supabase/supabase-js'] && !!webPackageJson.dependencies?.['@vercel/functions'] && !!webPackageJson.dependencies?.['@mozilla/readability'] && !!webPackageJson.dependencies?.linkedom);
const deployReadiness = read('scripts/check-cloud-deploy-readiness.mjs');
const cloudHealth = read('web/api/health/cloud.js');
const startCloudGenerationBody = cloud.slice(cloud.indexOf('export async function startCloudGeneration'), cloud.indexOf('/** Cancel a running cloud generation.'));
const subscribeToJobBody = cloud.slice(cloud.indexOf('function subscribeToJob(jobId)'), cloud.indexOf('function removeJobSubscription(jobId)'));
const cancelCloudGenerationBody = cloud.slice(cloud.indexOf('export async function cancelCloudGeneration'), cloud.indexOf('/** Delete a cloud generation row'));
const deleteCloudGenerationBody = cloud.slice(cloud.indexOf('export async function deleteCloudGeneration'), cloud.indexOf('/** Resume an interrupted'));
const resumeCloudGenerationBody = cloud.slice(cloud.indexOf('export async function resumeCloudGeneration'), cloud.indexOf('/** Restart a recoverable cloud job'));
const restartCloudGenerationBody = cloud.slice(cloud.indexOf('export async function restartCloudGeneration'), cloud.indexOf('/** Restart a recoverable cloud job after the user reattached lost source files.'));
const restartCloudGenerationWithSourcesBody = cloud.slice(cloud.indexOf('export async function restartCloudGenerationWithSources'), cloud.indexOf('/** Restart a known cloud row'));
const submitCloudReviewBody = cloud.slice(cloud.indexOf('export async function submitCloudReview'), cloud.indexOf('/**\n * Re-subscribe to all actionable cloud jobs.'));
const markStaleCloudJobsBody = cloud.slice(cloud.indexOf('export async function markStaleCloudJobs'), cloud.indexOf('// --------------------------------------------------------------------\n// Realtime subscription'));
const rehydrateCloudSubscriptionsBody = cloud.slice(cloud.indexOf('export async function rehydrateCloudSubscriptions'), cloud.indexOf('/** Ask the backend to mark any expired cloud jobs as timed_out. */'));
const reattachCloudGenerationBody = cloud.slice(cloud.indexOf('export async function reattachCloudGeneration'), cloud.indexOf('export function isMissingCloudJobError'));
const removeCloudJobMirrorBody = cloud.slice(cloud.indexOf('export function removeCloudJobMirror(jobId)'), cloud.indexOf('export function pruneMissingCloudJobMirrors'));
const applyJobRowBody = cloud.slice(cloud.indexOf('function applyJobRow(row)'), cloud.indexOf('export function shouldInstallSavedCourseForJobStatus'));
const keySubmitStart = auth.indexOf("body.querySelectorAll('.auth-keyform')");
const keySubmitBlock = auth.slice(keySubmitStart, auth.indexOf('});', keySubmitStart));
const apiKeySavedBlock = app.slice(app.indexOf("window.addEventListener('learnable-api-key-saved'"), app.indexOf('});', app.indexOf("window.addEventListener('learnable-api-key-saved'")));
const continueAfterKeyBlock = app.slice(app.indexOf('async function continueCloudJobAfterApiKeySaved'), app.indexOf('function isPendingRestartJob', app.indexOf('async function continueCloudJobAfterApiKeySaved')));
const watchdog = read('web/api/gen/watchdog.js');
assert('deploy readiness checks required production env', ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'CRON_SECRET'].every(name => deployReadiness.includes(name) && cloudHealth.includes(name)) && deployReadiness.includes('SUPABASE_SECRET_KEY') && deployReadiness.includes('SUPABASE_SERVICE_ROLE_KEY') && deployReadiness.includes('requiredProductionEnvGroups') && cloudHealth.includes('SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY'));
assert('deploy readiness only accepts production env vars', deployReadiness.includes('export function productionEnvNamesFromVercelOutput') && deployReadiness.includes('trimmed.startsWith(`${name} `)') && deployReadiness.includes('/\\bProduction\\b/.test(trimmed)') && deployReadiness.includes("import.meta.url === pathToFileURL(process.argv[1]).href"));
assert('deploy readiness checks cloud recovery cron wiring', deployReadiness.includes('function checkVercelCron') && deployReadiness.includes("cron?.path === '/api/gen/sweep'") && deployReadiness.includes("sweepCron.schedule !== '0 0 * * *'") && deployReadiness.includes('cloud timeout recovery cron'));
assert('deploy readiness checks production cloud health after env is present', deployReadiness.includes('/api/health/cloud') && deployReadiness.includes('production cloud health passed') && deployReadiness.includes('data.schema.ok'));
assert('deploy readiness output stays ordered on one stream', !deployReadiness.includes('console.error'));
assert('cloud health checks required database schema', cloudHealth.includes('serviceClient') && cloudHealth.includes("tableReadable(supabase, 'generation_jobs')") && cloudHealth.includes("columnsReadable(supabase, 'generation_jobs', REQUIRED_GENERATION_JOB_COLUMNS)") && cloudHealth.includes("tableReadable(supabase, 'user_state', 'user_id')") && cloudHealth.includes("columnsReadable(supabase, 'user_state', REQUIRED_USER_STATE_COLUMNS)") && cloudHealth.includes("tableReadable(supabase, 'user_courses')") && cloudHealth.includes("columnsReadable(supabase, 'user_courses', REQUIRED_USER_COURSE_COLUMNS)") && cloudHealth.includes("storageBucketExists(supabase, 'course-uploads')") && cloudHealth.includes("delete_generation_job_for_owner") && cloudHealth.includes("generation_workflow_health"));
assert('cloud health schema failures stay structured', cloudHealth.includes("missing: ['Supabase schema check failed']") && cloudHealth.includes('async function tableReadable') && cloudHealth.includes('} catch {') && cloudHealth.includes('return false;'));
assert('cloud health checks workflow constraints', cloudHealth.includes('generationWorkflowConstraints') && cloudHealth.includes('details.generation_workflow_constraints') && cloudHealth.includes('status_constraint') && cloudHealth.includes('stage_constraint') && cloudHealth.includes('job_id_constraint') && cloudHealth.includes('counter_constraint') && cloudHealth.includes('completion_constraint') && cloudHealth.includes('generation_jobs_rls_enabled') && cloudHealth.includes('generation_jobs_no_write_policies') && cloudHealth.includes('generation_jobs_updated_at_trigger') && cloudHealth.includes('user_state_rls_enabled') && cloudHealth.includes('user_state_owner_policies') && cloudHealth.includes('course_uploads_owner_policy') && cloudHealth.includes('user_courses_owner_key') && cloudHealth.includes('delete_generation_job_rpc_service_only') && cloudHealth.includes('generation workflow constraints'));
assert('cloud health checks durable workflow columns', ['review_history', 'run_id', 'recovery_attempts', 'last_recovery_at', 'extracted_urls', 'topics_by_key', 'lease_expires_at', 'saved_course_id', 'started_at', 'continuation'].every(column => cloudHealth.includes(`'${column}'`)));
assert('legacy service worker runner file is removed', !existsSync(join(root, 'web/sw.js')));
assert('legacy sw client file is removed', !existsSync(join(root, 'web/js/sw-client.js')));
assert('legacy browser URL extraction helper is removed', !existsSync(join(root, 'web/js/generator/fetch-urls.js')));
assert('legacy public URL extraction endpoint is removed', !existsSync(join(root, 'web/api/fetch-url.js')));
assert('legacy root local generator is retired', packageJson.scripts.generate === 'node scripts/retired-local-generator.mjs' && existsSync(join(root, 'scripts/retired-local-generator.mjs')) && ['generator/index.mjs', 'generator/schema.mjs', 'generator/stages/intake.mjs', 'generator/stages/research.mjs', 'generator/stages/topic.mjs', 'generator/stages/assemble.mjs', 'scripts/edit-annotation-brief.mjs'].every(file => !existsSync(join(root, file))) && read('scripts/retired-local-generator.mjs').includes('generation_jobs pipeline') && read('scripts/test-local-generator-retirement.mjs').includes('local generator retirement tests passed'));
assert('shared stage modules expose only single-step cloud runner primitives', !researchStage.includes('runResearchAll') && !topicStage.includes('runAllTopics') && read('scripts/test-local-generator-retirement.mjs').includes('shared topic stage should not export a local batch pipeline helper'));
assert('legacy generation mirrors retry through cloud instead of local runner errors', app.includes("if (job?.brief && cloudGenAvailable())") && app.includes("await restartOrStartCloudGeneration(id, job.brief, '', expected)") && intake.includes('async function retryCloudFromLocalMirror') && intake.includes('await retryCloudFromLocalMirror(jobId, feedback);') && intake.includes('await restartOrStartCloudGeneration(jobId, j.brief, feedback)') && !intake.includes('retired local runner') && !intake.includes('legacy local generation job cannot be resumed') && read('scripts/test-cloud-only-legacy-retry.mjs').includes('cloud-only legacy retry tests passed'));

assert('app does not import legacy sw-client', excludes('web/js/app.js', 'sw-client.js'));
assert('intake does not import legacy sw-client', excludes('web/js/intake.js', 'sw-client.js'));
assert('app unregisters legacy service workers', app.includes('retireLegacyServiceWorker'));
assert('app exits active legacy service worker control after unregistering', app.includes('navigator.serviceWorker.controller') && app.includes('navigator.serviceWorker.getRegistrations()') && app.includes('reg.unregister()') && app.includes("const reloadKey = 'learnable-sw-retired-reload';") && app.includes('sessionStorage.setItem(reloadKey') && app.includes('window.location.reload();') && app.includes('if (await retireLegacyServiceWorker()) return;') && read('scripts/test-legacy-sw-retirement.mjs').includes('return true;'));
assert('browser generator no longer exports a course pipeline', !generatorIndex.includes('generateCourse') && !generatorIndex.includes('runIntake') && !generatorIndex.includes('runResearch') && !generatorIndex.includes('runTopic'));
assert('intake only imports generator key helpers', intake.includes("from './generator/index.js?v=4'") && intake.includes('hasApiKey') && intake.includes('setApiKey'));
assert('intake run-mode badge is cloud-only', intake.includes('intake-runmode-pill--cloud') && !intake.includes('intake-runmode-pill--browser'));

assert('cloud client exposes review action', cloud.includes('export async function submitCloudReview'));
assert('cloud client exposes restart action', cloud.includes('export async function restartCloudGeneration') && cloud.includes("fetch('/api/gen/restart'"));
assert('cloud client can start from saved brief when restart row is missing', cloud.includes('export async function restartOrStartCloudGeneration') && cloud.includes('isMissingCloudJobError') && cloud.includes('await startCloudGeneration(jobId, userBrief)') && app.includes("restartOrStartCloudGeneration(id, job.brief, '', expected)") && intake.includes("restartOrStartCloudGeneration(jobId, j.brief, '', expected)"));
assert('cloud client can reattach after ambiguous start succeeded server-side', cloud.includes('export async function reattachCloudGeneration') && cloud.includes('isCloudJobStateConflictError') && cloud.includes('await reattachCloudGeneration(jobId)') && cloud.includes(".from('generation_jobs')") && cloud.includes('applyJobRow(row)') && cloud.includes('subscribeToJob(jobId)'));
assert('intake auto-reattaches after ambiguous start failure', intake.includes('reattachCloudGeneration, submitCloudReview') && startReviewableGenerationCatchBody.includes('if (await reattachCloudGeneration(jobId)) return;') && startReviewableGenerationCatchBody.indexOf('if (await reattachCloudGeneration(jobId)) return;') < startReviewableGenerationCatchBody.indexOf("updateJob(jobId, { status: 'failed'"));
assert('ambiguous cloud start keeps uploaded source refs for retry', cloud.includes('updateJob(jobId, { brief: slimBrief })') && cloud.indexOf('updateJob(jobId, { brief: slimBrief })') < cloud.indexOf("fetch('/api/gen/start'") && cloud.indexOf('await removeUploadedPdfRefs(pdfRefs)') > cloud.indexOf('if (!resp.ok)') && !cloud.slice(cloud.indexOf("fetch('/api/gen/start'"), cloud.indexOf('/** Cancel a running cloud generation')).includes('catch (err)') && app.includes("restartOrStartCloudGeneration(id, job.brief, '', expected)"));
assert('cloud endpoint errors preserve HTTP status for recovery routing', cloud.includes('async function apiError') && cloud.includes('err.status = resp.status'));
assert('cloud client exposes backend readiness preflight', cloud.includes('export async function requireCloudBackendReady') && cloud.includes("fetch('/api/health/cloud'"));
assert('cloud client exposes durable delete action', cloud.includes('export async function deleteCloudGeneration'));
assert('cloud client hydrates rows with exact job ids', cloud.includes('ensureJob(row.id') && !cloud.includes('learnable-gen-jobs'));
assert('cloud client owner-scopes direct generation job reads', reattachCloudGenerationBody.includes('const user = getUser();') && reattachCloudGenerationBody.includes('const ownerId = user.id;') && reattachCloudGenerationBody.includes(".eq('owner_id', ownerId)") && rehydrateCloudSubscriptionsBody.includes('const user = getUser();') && rehydrateCloudSubscriptionsBody.includes('const ownerId = user.id;') && rehydrateCloudSubscriptionsBody.includes(".select('id, owner_id, status") && rehydrateCloudSubscriptionsBody.includes(".eq('owner_id', ownerId)") && subscribeToJobBody.includes('const user = getUser();') && subscribeToJobBody.includes('const ownerId = user.id;') && subscribeToJobBody.includes(".eq('owner_id', ownerId)"));
assert('cloud client ignores stale account job responses', cloud.includes('function isCurrentCloudOwner(ownerId)') && cloud.includes('return !!ownerId && getUser()?.id === ownerId;') && cloud.includes("function rowBelongsToCurrentOwner(row, fallbackJobId = '')") && cloud.includes("const ownerId = row?.owner_id || '';") && cloud.includes('if (ownerId) return isCurrentCloudOwner(ownerId);') && cloud.includes("const mirrorOwnerId = fallbackJobId ? getJob(fallbackJobId)?.ownerId || '' : '';") && cloud.includes('return !!mirrorOwnerId && isCurrentCloudOwner(mirrorOwnerId);') && reattachCloudGenerationBody.includes('if (!isCurrentCloudOwner(ownerId)) return false;') && rehydrateCloudSubscriptionsBody.includes('if (!isCurrentCloudOwner(ownerId)) return;') && subscribeToJobBody.includes('if (!isCurrentCloudOwner(ownerId)) {') && subscribeToJobBody.includes('rowBelongsToCurrentOwner(payload.new, jobId)') && subscribeToJobBody.includes('rowBelongsToCurrentOwner(payload.old, jobId)') && markStaleCloudJobsBody.includes('if (!isCurrentCloudOwner(ownerId)) return [];') && read('scripts/test-cloud-client-owner-scope.mjs').includes('stale account responses'));
assert('cloud client removes local mirrors when cloud rows are deleted elsewhere', cloud.includes("event: 'DELETE'") && cloud.includes('removeCloudJobMirror(payload.old?.id || jobId)') && cloud.includes('export function removeCloudJobMirror') && cloud.includes('removeJobSubscription(jobId)') && cloud.includes('removeJob(jobId)') && cloud.includes('if (savedCourseId && localCourseForCurrentUser(savedCourseId, jobId))') && cloud.includes('localCourseIdsForGenerationJob(jobId)') && cloud.includes("course?._generationJobId === jobId") && cloud.includes('_removeCourseLocalSilent(savedCourseId)') && cloud.includes('invalidateCourseCache(savedCourseId)') && removeCloudJobMirrorBody.includes('if (removedCourseIds.size) {') && removeCloudJobMirrorBody.indexOf('if (removedCourseIds.size) {') < removeCloudJobMirrorBody.indexOf('syncCoursesNow().catch(() => {});') && read('scripts/test-cloud-delete-mirror.mjs').includes('other-account-course') && read('scripts/test-cloud-delete-mirror.mjs').includes('orphan-local-course') && read('scripts/test-cloud-delete-mirror.mjs').includes('shared-course') && read('scripts/test-cloud-local-cleanup.mjs').includes('sync courses only after removing current-account local courses'));
assert('cloud local course cleanup is scoped to the current account and matching generation job', cloud.includes('if (savedCourseId && localCourseForCurrentUser(savedCourseId, jobId))') && cloud.includes('_removeCourseLocalSilent(savedCourseId)') && !cloud.includes('removeUserCourse(j.savedCourseId)') && app.includes('function removeUserCourseForCurrentAccount(courseId)') && app.includes("courseCanSyncToAccount(course, user?.email || '', user?.id || '')") && app.includes('removeUserCourseForCurrentAccount(deletedCourseId)') && !app.includes('removeUserCourse(deletedCourseId)') && intake.includes('function removeUserCourseForCurrentAccount(courseId)') && intake.includes("courseCanSyncToAccount(course, user?.email || '', user?.id || '')") && intake.includes('removeUserCourseForCurrentAccount(deletedCourseId)') && !intake.includes('m.removeUserCourse(deletedCourseId)') && read('scripts/test-cloud-local-course-removal-scope.mjs').includes('matching generation job'));
assert('cloud cancel safety cleanup preserves saved course mirrors', !cancelCloudGenerationBody.includes('localCourseForCurrentUser(j.savedCourseId)') && !cancelCloudGenerationBody.includes('_removeCourseLocalSilent(j.savedCourseId)') && cancelCloudGenerationBody.includes('Saved courses are deleted solely through the explicit delete'));
assert('cloud rehydrate prunes remote-deleted mirrors without racing fresh starts', cloud.includes('listCloudJobMirrors') && cloud.includes('const remoteIds = new Set(data.map(row => row.id));') && rehydrateCloudSubscriptionsBody.includes('pruneMissingCloudJobMirrors(remoteIds);') && cloud.includes('export function pruneMissingCloudJobMirrors') && cloud.includes('!job.cloudSeenAt') && cloud.includes('removeCloudJobMirror(job.id)') && cloud.includes('cloudSeenAt: now') && cloud.includes('now = Date.now()') && jobs.includes('export function listCloudJobMirrors'));
assert('cloud rehydrate does not prune local mirrors when the cloud read fails', rehydrateCloudSubscriptionsBody.includes('const { data, error } = await client') && rehydrateCloudSubscriptionsBody.includes('if (error || !Array.isArray(data)) return;') && rehydrateCloudSubscriptionsBody.indexOf('if (error || !Array.isArray(data)) return;') < rehydrateCloudSubscriptionsBody.indexOf('pruneMissingCloudJobMirrors(remoteIds);'));
assert('cloud rehydrate treats cancelled rows as present without deleting saved courses', cloud.includes("'completed', 'cancelled'") && rehydrateCloudSubscriptionsBody.includes(".in('status', CLOUD_REHYDRATE_STATUSES)") && applyJobRowBody.includes("if (row.status === 'cancelled')") && applyJobRowBody.includes('removeJob(row.id);') && !applyJobRowBody.includes('removeCloudJobMirror(row.id)') && read('scripts/test-cloud-rehydrate-prune.mjs').includes('cancelled rows should remove only the job mirror'));
assert('same-device terminal cloud cleanup unsubscribes before removing job mirrors', deleteCloudGenerationBody.includes('removeCloudJobMirror(jobId);') && removeCloudJobMirrorBody.includes('removeJobSubscription(jobId);') && removeCloudJobMirrorBody.indexOf('removeJobSubscription(jobId);') < removeCloudJobMirrorBody.indexOf('removeJob(jobId);') && markStaleCloudJobsBody.includes('removeJobSubscription(id);') && markStaleCloudJobsBody.indexOf('removeJobSubscription(id);') < markStaleCloudJobsBody.indexOf('removeJob(id);'));
assert('cloud client subscribes active and review jobs so cross-device updates land', cloud.includes('active and review-paused jobs subscribed') && rehydrateCloudSubscriptionsBody.includes('applyJobRow(row);\n    if (CLOUD_SUBSCRIBABLE_STATUSES.includes(row.status)) subscribeToJob(row.id);'));
assert('cloud generation path is checkpoint-first and single-pipeline', start.includes("mode: 'curriculum'") && restart.includes("mode: 'curriculum'") && resume.includes('if (isReviewStatus(job.status))') && resume.includes('Use the review action instead of resume.') && runner.includes("if (mode === 'curriculum') return;") && runner.includes("status: 'review_research'") && review.includes("runnerMode: 'research'") && review.includes("runnerMode: 'complete'") && cloud.includes('export async function submitCloudReview') && !existsSync(join(root, 'web/sw.js')) && !existsSync(join(root, 'web/js/sw-client.js')) && !generatorIndex.includes('generateCourse') && read('scripts/test-cloud-checkpoint-pipeline.mjs').includes('cloud checkpoint pipeline contract tests passed'));
assert('cloud client marks subscriptions pending before async work', subscribeToJobBody.includes('const token = Symbol(jobId);') && subscribeToJobBody.includes('subs.set(jobId, { pending: true, token, unsubscribe() {} });') && subscribeToJobBody.indexOf('subs.set(jobId, { pending: true') < subscribeToJobBody.indexOf('const client = await sb();') && subscribeToJobBody.includes('if (isSubscriptionCurrent(jobId, token)) subs.delete(jobId);'));
assert('cloud client ignores stale async subscription setup and callbacks', cloud.includes('function isSubscriptionCurrent(jobId, token)') && cloud.includes('return subs.get(jobId)?.token === token;') && subscribeToJobBody.includes('if (!isSubscriptionCurrent(jobId, token)) return;') && subscribeToJobBody.includes('if (isSubscriptionCurrent(jobId, token) && rowBelongsToCurrentOwner(payload.new, jobId)) applyJobRow(payload.new);') && subscribeToJobBody.includes('if (isSubscriptionCurrent(jobId, token) && rowBelongsToCurrentOwner(payload.old, jobId)) removeCloudJobMirror(payload.old?.id || jobId);'));
assert('cloud subscription bootstrap prunes previously-seen missing rows', subscribeToJobBody.includes('} else if (getJob(jobId)?.cloudSeenAt) {') && subscribeToJobBody.includes('removeCloudJobMirror(jobId);') && subscribeToJobBody.indexOf('} else if (getJob(jobId)?.cloudSeenAt) {') < subscribeToJobBody.indexOf('const channel = client'));
assert('cloud job timeout state is server authoritative', jobs.includes("if (j.runner === 'cloud') continue") && jobs.includes('/api/gen/watchdog marks expired'));
assert('cloud lease and live status primitives are centralized', genState.includes('export const GENERATION_LEASE_MS = 6 * 60 * 1000;') && genState.includes('export const CANCEL_GRACE_MS = 90 * 1000;') && genState.includes("export const LIVE_GENERATION_STATUSES = ['queued', 'running'];") && genState.includes('export const RUNNER_WRITABLE_STATUSES = LIVE_GENERATION_STATUSES;') && genState.includes('export const RUNNER_CANCELLATION_WRITABLE_STATUSES') && genState.includes('export const CANCELLABLE_GENERATION_STATUSES') && genState.includes('export const API_KEY_WAITING_STATUSES') && genState.includes('export function generationCancelLeaseFields') && genState.includes('export function generationCancelledTerminalFields') && genState.includes('export function sameRunFilter') && runner.includes("from './gen-state.mjs'") && runner.includes('RUNNER_CANCELLATION_WRITABLE_STATUSES') && courseSave.includes("from './gen-state.mjs'") && recovery.includes("from './gen-state.mjs'") && cancel.includes("from '../_lib/gen-state.mjs'") && cancel.includes('sameRunFilter') && credentialsReady.includes("from '../_lib/gen-state.mjs'") && credentialsReady.includes('API_KEY_WAITING_STATUSES') && start.includes("from '../_lib/gen-state.mjs'") && resume.includes("from '../_lib/gen-state.mjs'") && restart.includes("from '../_lib/gen-state.mjs'") && review.includes("from '../_lib/gen-state.mjs'") && sweep.includes("from '../_lib/gen-state.mjs'") && watchdog.includes("from '../_lib/gen-state.mjs'") && read('scripts/test-cloud-state-primitives.mjs').includes('cloud state primitive tests passed'));
assert('authenticated watchdog only touches current owner jobs', watchdog.includes('ownerId = auth.user.id') && watchdog.includes('markExpiredLiveJobsTimedOut(supabase, { ownerId, now })') && watchdog.includes('markExpiredCancellingJobsCancelled(supabase, { ownerId, now })') && watchdog.includes("if (ownerId) staleQuery = staleQuery.eq('owner_id', ownerId);") && watchdog.includes('hasCronSecret(req)'));
assert('watchdog stale expiry is exact-run guarded', watchdog.includes('export async function markExpiredLiveJobsTimedOut') && watchdog.includes('export async function markExpiredCancellingJobsCancelled') && watchdog.includes(".select('id,owner_id,run_id,error,message,continuation')") && watchdog.includes('timeoutPatch(row, now)') && watchdog.includes('sameRunFilter(updateQuery, row.run_id)') && read('scripts/test-cloud-watchdog-scope.mjs').includes('run-live') && read('scripts/test-cloud-watchdog-scope.mjs').includes("call.type === 'is' && call.field === 'run_id'"));
assert('cloud client reacts to watchdog cancellations', cloud.includes('data.cancelled') && cloud.includes('for (const id of cancelled) {') && markStaleCloudJobsBody.includes('removeJob(id);'));
assert('cloud client preserves watchdog timeouts as cloud timeout state', cloud.includes('export function markTimedOutJobsFromWatchdog') && markStaleCloudJobsBody.includes('markTimedOutJobsFromWatchdog(ids);') && cloud.includes("status: 'timed_out'") && cloud.includes('hasSavedRequestRestartIntent(prior)') && cloud.includes('Generation timed out while restarting. You can restart from the saved request.') && !cloud.includes("if (s === 'timed_out') return 'interrupted';") && app.includes("const isTimedOut = j.status === 'timed_out';") && intake.includes("const isTimedOut = status === 'timed_out';") && intake.includes("style=\"${needsKey || isFailed || isInterrupted || isTimedOut || isPartial || (isReview && job?.error) ? '' : 'display:none'}\"") && read('scripts/test-cloud-timeout-ui.mjs').includes('intake timeout recovery message should be visible') && read('scripts/test-cloud-timeout-ui.mjs').includes('cloud timeout UI tests passed') && read('scripts/test-cloud-watchdog-client.mjs').includes('Curriculum Designer is restarting from your saved request'));
assert('app periodically rehydrates cloud jobs to repair missed realtime updates', app.includes('async function refreshCloudGenerationState') && app.includes('let cloudGenerationRefreshOwnerId = null;') && app.includes('const ownerId = getUser()?.id || null;') && app.includes('if (cloudGenerationRefresh && cloudGenerationRefreshOwnerId === ownerId) return cloudGenerationRefresh;') && app.includes('const refreshOwnerId = ownerId;') && app.includes('if (cloudGenerationRefreshOwnerId === refreshOwnerId) {') && app.includes('try { await markStaleCloudJobs(); } catch {}') && app.includes('await rehydrateCloudSubscriptions();') && app.indexOf('await markStaleCloudJobs();') < app.indexOf('await rehydrateCloudSubscriptions();') && app.includes('function installCloudGenerationRefreshTriggers') && app.includes("window.addEventListener('online'") && app.includes("window.addEventListener('focus'") && app.includes("document.addEventListener('visibilitychange'") && app.includes("document.visibilityState === 'visible'") && read('scripts/test-cloud-refresh-rehydration.mjs').includes('cloudGenerationRefreshOwnerId = null'));
assert('cloud recovery actions preflight backend readiness before optimistic local state', ['cancelCloudGeneration', 'deleteCloudGeneration', 'resumeCloudGeneration', 'restartCloudGeneration(jobId', 'submitCloudReview'].every(anchor => cloud.slice(cloud.indexOf(`export async function ${anchor}`), cloud.indexOf('fetch(', cloud.indexOf(`export async function ${anchor}`))).includes('await requireCloudBackendReady();')));
assert('cloud cancel does not enter local cancelling before auth is available', cloud.indexOf("if (!token) throw new Error('Sign in to cancel.')") < cloud.indexOf("updateJob(jobId, { status: 'cancelling'"));
assert('cloud rehydration includes curriculum review jobs', cloud.includes("'review_curriculum'"));
assert('cloud rehydration includes research review jobs', cloud.includes("'review_research'"));
assert('cloud rehydration includes durable review history', cloud.includes('review_history') && cloud.includes('reviewHistory: Array.isArray(row.review_history) ? row.review_history : []') && read('scripts/test-cloud-job-patch.mjs').includes('review_history'));
assert('cloud rehydration installs completed saved courses', cloud.includes("const CLOUD_REHYDRATE_STATUSES = [...CLOUD_ACTIVE_STATUSES, ...CLOUD_REVIEW_STATUSES, ...CLOUD_RECOVERABLE_STATUSES, 'completed', 'cancelled'];") && rehydrateCloudSubscriptionsBody.includes(".in('status', CLOUD_REHYDRATE_STATUSES)") && rehydrateCloudSubscriptionsBody.includes('if (CLOUD_SUBSCRIBABLE_STATUSES.includes(row.status)) subscribeToJob(row.id);') && cloud.includes("installSavedCloudCourse(row.saved_course_id, row.id, row.run_id || '')") && read('scripts/test-cloud-completed-rehydrate.mjs').includes('cloud completed rehydrate tests passed'));
assert('completed cloud jobs can retry or dismiss saved course sync', cloud.includes('export async function pullSavedCloudCourseForJob') && app.includes('data-job-action="sync-completed"') && app.includes('await pullSavedCloudCourseForJob(id, courseId)') && app.includes('data-job-action="delete-job" data-job-id="${j.id}">Delete</button>') && cloud.includes('if (!shouldInstallSavedCloudCourse(local, remoteRow, jobId)) {') && cloud.includes('updateJob(jobId, { courseInstalled: true });') && !app.includes('aria-disabled="true">Saving…'));
assert('cloud rehydration is not limited to 24 hours', !cloud.includes(".gte('updated_at'"));
assert('cloud rehydration has no arbitrary actionable job count cap', !rehydrateCloudSubscriptionsBody.includes('.limit('));
assert('cloud rehydration clears stale nullable local fields', cloud.includes('export function jobPatchFromRow') && cloud.includes('const failures = Array.isArray(row.failures) ? row.failures : [];') && cloud.includes('outline: row.outline || null') && cloud.includes('failures,') && cloud.includes('savedCourseId: row.saved_course_id || null') && cloud.includes('error: row.error || null'));
assert('cloud rehydration refreshes durable user brief for cross-device recovery', cloud.includes('brief: row.user_brief || null') && read('scripts/test-cloud-job-patch.mjs').includes('revisedUserBrief') && read('scripts/test-cloud-job-patch.mjs').includes('curriculumPatch.brief'));
assert('missing API key recovery points the UI to account setup', cloud.includes('export function needsApiKeyForRow') && cloud.includes('export function isMissingApiKeyError') && cloud.includes("isMissingApiKeyError(`${row.error || ''}\\n${row.message || ''}`)") && cloud.includes('needsApiKey: needsApiKeyForRow(row)') && app.includes("const needsApiKey = !!j.needsApiKey") && app.includes("retryAction = needsApiKey ? 'api-key'") && app.includes("openAccount({ intent: 'course-generation', jobId: id })") && intake.includes('function needsApiKey(job)') && intake.includes("const recoveryAction = needsKey ? 'api-key'") && intake.includes("openAccount({ intent: 'course-generation', jobId })") && intake.includes('Generation is waiting for an Anthropic API key') && read('scripts/test-cloud-job-patch.mjs').includes('missingKeyPatch.needsApiKey') && read('scripts/test-cloud-job-patch.mjs').includes('Request failed before recovery could start.'));
assert('pending restart API-key recovery keeps restart primary', cloud.includes('pendingRestart: pendingRestartForRow(row)') && cloud.includes('export function pendingRestartForRow') && cloud.includes('export function hasSavedRequestRestartIntent') && app.includes('function isPendingRestartJob(job)') && app.includes('hasSavedRequestRestartIntent(job)') && app.includes("pendingRestart ? 'Restart from request'") && app.includes("pendingRestart ? 'restart'") && intake.includes('function pendingRestart(job)') && intake.includes('hasSavedRequestRestartIntent(job)') && intake.includes("wantsRestart ? 'Restart from request'") && intake.includes("wantsRestart ? 'restart'") && read('scripts/test-cloud-job-patch.mjs').includes('pendingRestartPatch.pendingRestart') && read('scripts/test-api-key-saved-unblocks-cloud-jobs.mjs').includes('pending restart jobs should keep restart as the primary action'));
assert('partial cloud jobs waiting for API key point to account setup', genState.includes('export const API_KEY_WAITING_STATUSES') && credentialsReady.includes(".in('status', API_KEY_WAITING_STATUSES)") && app.includes('} else if (isPartial && j.savedCourseId) {') && app.includes('const needsApiKey = !!j.needsApiKey;') && app.includes('data-job-action="api-key"') && app.includes("needsApiKey || pendingRestart ? ''") && read('scripts/test-cloud-job-patch.mjs').includes("status: 'partial'") && read('scripts/test-cloud-partial-api-key-recovery.mjs').includes('cloud partial API key recovery tests passed'));
assert('saving an API key unblocks and continues waiting cloud job mirrors',
  auth.includes("new CustomEvent('learnable-api-key-saved'") &&
  auth.includes('detail: { intent, jobId }') &&
  keySubmitBlock.includes('let synced = false;') &&
  keySubmitBlock.indexOf('await flushSync();') < keySubmitBlock.indexOf("new CustomEvent('learnable-api-key-saved'") &&
  keySubmitBlock.includes("if (synced && provider === 'anthropic') {") &&
  app.includes("window.addEventListener('learnable-api-key-saved'") &&
  app.includes('function clearApiKeyWaitForCloudJobs') &&
  app.includes('function clearApiKeyWaitForCloudJobs(preferredJobId = \'\', clearedJobIds = null)') &&
  app.includes('const hasClearedFilter = Array.isArray(clearedJobIds);') &&
  app.includes('if (hasClearedFilter && !cleared.has(job.id)) continue;') &&
  app.includes('async function continueCloudJobAfterApiKeySaved') &&
  app.includes('let refreshedAfterCredentialRecovery = false;') &&
  app.includes('const result = await markCloudCredentialsReady(jobId);') &&
  app.includes('const cleared = Array.isArray(result?.cleared) ? result.cleared : [];') &&
  app.includes('const started = Array.isArray(result?.started) ? result.started : [];') &&
  app.includes('clearApiKeyWaitForCloudJobs(jobId, cleared);') &&
  app.includes('if (jobId && started.includes(jobId)) {') &&
  app.includes('await refreshCloudGenerationState();') &&
  app.includes('refreshedAfterCredentialRecovery = true;') &&
  app.includes("if (getJobLazy(jobId)?.runner === 'cloud') openIntakeForJob(jobId);") &&
  app.includes('} else if (jobId && cleared.includes(jobId)) {') &&
  app.includes('if (!refreshedAfterCredentialRecovery) {') &&
  apiKeySavedBlock.indexOf('const result = await markCloudCredentialsReady(jobId);') < apiKeySavedBlock.indexOf('clearApiKeyWaitForCloudJobs(jobId, cleared);') &&
  apiKeySavedBlock.indexOf('clearApiKeyWaitForCloudJobs(jobId, cleared);') < apiKeySavedBlock.indexOf('if (jobId && started.includes(jobId)) {') &&
  apiKeySavedBlock.indexOf('if (jobId && started.includes(jobId)) {') < apiKeySavedBlock.indexOf('await refreshCloudGenerationState();') &&
  apiKeySavedBlock.indexOf('await refreshCloudGenerationState();') < apiKeySavedBlock.indexOf('refreshedAfterCredentialRecovery = true;') &&
  apiKeySavedBlock.indexOf('refreshedAfterCredentialRecovery = true;') < apiKeySavedBlock.indexOf("if (getJobLazy(jobId)?.runner === 'cloud') openIntakeForJob(jobId);") &&
  apiKeySavedBlock.indexOf("if (getJobLazy(jobId)?.runner === 'cloud') openIntakeForJob(jobId);") < apiKeySavedBlock.indexOf('} else if (jobId && cleared.includes(jobId)) {') &&
  apiKeySavedBlock.indexOf('} else if (jobId && cleared.includes(jobId)) {') < apiKeySavedBlock.indexOf('await continueCloudJobAfterApiKeySaved(jobId);') &&
  continueAfterKeyBlock.includes('const job = getJobLazy(jobId);') &&
  continueAfterKeyBlock.includes("job.runner !== 'cloud'") &&
  continueAfterKeyBlock.includes("job.status === 'review_curriculum' || job.status === 'review_research'") &&
  continueAfterKeyBlock.includes('job.needsSourceReattach') &&
  continueAfterKeyBlock.includes('isPendingRestartJob(job)') &&
  continueAfterKeyBlock.includes('await restartOrStartCloudGeneration(jobId, job.brief);') &&
  continueAfterKeyBlock.includes('await resumeCloudGeneration(jobId);') &&
  continueAfterKeyBlock.includes('openIntakeForJob(jobId);') &&
  app.includes('needsApiKey: false') &&
  app.includes('pendingRestart: isPendingRestartJob(job)') &&
  cloud.includes("export async function markCloudCredentialsReady(jobId = '')") &&
  cloud.includes("fetch('/api/gen/credentials-ready'") &&
  cloud.includes('body: JSON.stringify(jobId ? { jobId } : {})') &&
  credentialsReady.includes('apiKey = await readApiKey(supabase, user.id);') &&
  credentialsReady.includes('readJsonBody') &&
  credentialsReady.includes('requireSafeJobId') &&
  credentialsReady.includes('maxDuration: 300') &&
  credentialsReady.includes('let jobId = \'\';') &&
  credentialsReady.includes(".select('*')") &&
  credentialsReady.includes("if (jobId) query = query.eq('id', jobId);") &&
  credentialsReady.includes('export async function clearCredentialWaitsForUser') &&
  credentialsReady.includes('export async function recoverCredentialWaitsForUser') &&
  credentialsReady.includes("isMissingApiKeyText(`${row.error || ''}\\n${row.message || ''}`)") &&
  credentialsReady.includes('const result = await recoverCredentialWaitsForUser(supabase, user.id, jobId') &&
  credentialsReady.includes('startRecoverable: !!jobId') &&
  credentialsReady.includes('startRecoverable = !!jobId') &&
  credentialsReady.includes('res.status(200).json({ ok: true, cleared: result.cleared, started: result.started });') &&
  credentialsReady.includes("background(Promise.all(result.runs.map") &&
  credentialsReady.includes('runGeneration(run)') &&
  credentialsReady.includes('const results = await Promise.all(waiting.map(row => recoverWaitingRow') &&
  credentialsReady.includes('const confirmed = results.filter(Boolean);') &&
  credentialsReady.includes('claimRecoverableWaitingRow') &&
  credentialsReady.includes('startRecoverable && apiKey && isRecoverableStatus(row.status)') &&
  credentialsReady.includes('isRecoverableStatus(row.status)') &&
  credentialsReady.includes("status: 'running'") &&
  credentialsReady.includes('run_id: runId') &&
  credentialsReady.includes('recovery_attempts: 0') &&
  credentialsReady.includes('last_recovery_at: null') &&
  credentialsReady.includes('generationLeaseFields()') &&
  credentialsReady.includes('sameRunFilter(update, row.run_id)') &&
  credentialsReady.includes("sameValueFilter(update, 'error', row.error)") &&
  credentialsReady.includes("sameValueFilter(update, 'message', row.message)") &&
  credentialsReady.includes('function sameValueFilter') &&
  credentialsReady.includes('return result.cleared;') &&
  read('scripts/test-api-key-saved-unblocks-cloud-jobs.mjs').includes("const cleared = await clearCredentialWaitsForUser(supabase, 'owner-1', 'job-target');") &&
  read('scripts/test-api-key-saved-unblocks-cloud-jobs.mjs').includes("const result = await recoverCredentialWaitsForUser(supabase, 'owner-1', 'job-resume-server'") &&
	  read('scripts/test-api-key-saved-unblocks-cloud-jobs.mjs').includes("assert.deepEqual(result.started, ['job-resume-server']);") &&
	  read('scripts/test-api-key-saved-unblocks-cloud-jobs.mjs').includes("assert.deepEqual(result.started, ['job-restart-server']);") &&
	  read('scripts/test-api-key-saved-unblocks-cloud-jobs.mjs').includes("assert.deepEqual(result.started, []);") &&
	  read('scripts/test-api-key-saved-unblocks-cloud-jobs.mjs').includes('Human review should stay paused') &&
	  read('scripts/test-api-key-saved-unblocks-cloud-jobs.mjs').includes("assert.equal(row.status, 'review_research');") &&
	  read('scripts/test-api-key-saved-unblocks-cloud-jobs.mjs').includes("General save should not fan out") &&
  read('scripts/test-api-key-saved-unblocks-cloud-jobs.mjs').includes("assert.deepEqual(supabase.updates.map(update => update.id), ['job-target']);") &&
  read('scripts/test-api-key-saved-unblocks-cloud-jobs.mjs').includes("Schema failed after API key wait was selected.") &&
  credentialsReady.includes(".eq('owner_id', ownerId)") &&
  credentialsReady.includes(".eq('status', row.status)") &&
  read('scripts/test-api-key-saved-unblocks-cloud-jobs.mjs').includes("call.field === 'run_id' && call.value === 'run-target'") &&
  read('scripts/test-api-key-saved-unblocks-cloud-jobs.mjs').includes("call.field === 'run_id' && call.value === null") &&
  credentialsReady.includes(".select('id')") &&
  credentialsReady.includes('.maybeSingle()') &&
  credentialsReady.includes('return data?.id || null;') &&
  app.includes('API key saved. Continue from this checkpoint.') &&
  app.includes('API key saved. Retry missing topics from the saved checkpoint.') &&
  app.includes('API key saved. Resume from the saved checkpoint.') &&
  app.includes('API key saved. Restart from the saved request.') &&
  credentialsReady.includes('isPendingRestartWait(row)') &&
  credentialsReady.includes("from '../_lib/gen-recovery.mjs'") &&
  credentialsReady.includes('return hasPendingRestartIntent(row);') &&
  credentialsReady.includes('API key saved. Restart from the saved request.') &&
  read('scripts/test-api-key-saved-unblocks-cloud-jobs.mjs').includes('Missing API key\\nGeneration is waiting') &&
  read('scripts/test-api-key-saved-unblocks-cloud-jobs.mjs').includes('Curriculum Designer is restarting from your saved request') &&
  read('scripts/test-api-key-saved-unblocks-cloud-jobs.mjs').includes('saving an API key from a cloud job should continue that specific recoverable job'));
assert('recoverable cloud jobs expose restart as a visible escape hatch', app.includes('data-job-action="restart"') && app.includes('Restart from the saved request? Learnable keeps your source context and human feedback') && intake.includes('const canRestart = !!(job?.runner === \'cloud\'') && intake.includes('data-restart') && intake.includes('Restart from request') && intake.includes("async function restart(jobId, expected = generationActionSnapshot(getJob(jobId)))") && read('scripts/test-cloud-restart-ui.mjs').includes('cloud restart UI tests passed'));
assert('cloud rehydration normalizes dashboard progress aliases', cloud.includes('const topicsTotal = row.topics_total || 0;') && cloud.includes('const failedCount = failures.length;') && cloud.includes('ownerId: row.owner_id || null') && cloud.includes('totalTopics: topicsTotal') && cloud.includes('failedCount,') && read('scripts/test-cloud-job-patch.mjs').includes("assert.equal(cleared.ownerId, 'user-owner');"));
assert('completed cloud jobs remain visible until the matching job-stamped saved course is local for the signed-in account and current run', jobs.includes("j.status !== 'completed' || (j.runner === 'cloud' && j.savedCourseId && !j.courseInstalled)") && cloud.includes('courseInstalled: savedCourseRunMatchesCompletedRow(localCourseForCurrentUser(row.saved_course_id, row.id), row)') && cloud.includes('export function isSavedCourseInstalledForCurrentUser(courseId, jobId = \'\')') && cloud.includes('export function savedCourseRunMatchesCompletedRow') && cloud.includes('export function savedCoursePayloadMatchesRun') && cloud.includes('function coursePayloadBelongsToJob(course, jobId)') && cloud.includes('course._generationJobId === jobId') && cloud.includes("if (jobId && !coursePayloadBelongsToJob(local, jobId)) return null;") && cloud.includes("courseCanSyncToAccount(local, user.email || '', user.id || '')") && !cloud.includes('courseVisibleToEmail') && cloud.includes('if (local && savedCoursePayloadMatchesRun(local, expectedRunId)) {') && cloud.includes('if (jobId) updateJob(jobId, { courseInstalled: true });') && intake.includes('j.courseInstalled && !autoJumpedFor.has(renderedJobId)') && read('scripts/test-cloud-completed-account-ownership.mjs').includes('cloud completed account ownership tests passed'));
assert('completed cloud mirrors are removed only after matching job-stamped saved course install for the current run', cloud.includes('function completedCourseAlreadyInstalled(row)') && cloud.includes('function removeCompletedJobMirrorIfInstalled(jobId, courseId)') && cloud.includes('const local = localCourseForCurrentUser(row.saved_course_id, row.id);') && cloud.includes('return savedCourseRunMatchesCompletedRow(local, row);') && cloud.includes('export function savedCourseRunMatchesCompletedRow') && cloud.includes('row?.run_id') && cloud.includes('runId: row.run_id || null') && cloud.includes('isSavedCourseInstalledForCurrentUser(courseId, jobId)') && cloud.includes('if (completedCourseAlreadyInstalled(row)) {') && cloud.indexOf('if (completedCourseAlreadyInstalled(row)) {') < cloud.indexOf('if (!getJob(row.id)) {') && cloud.includes('removeCompletedJobMirrorIfInstalled(jobId, row.id);') && read('scripts/test-cloud-completed-rehydrate.mjs').includes('older run'));
assert('cloud review submission preserves checkpoint status until server transition succeeds', cloud.includes('const pending = reviewPendingForAction(action);') && cloud.includes('updateJob(jobId, { error: null, message: pending.message, reviewPending: pending })') && !submitCloudReviewBody.includes("status: 'running'"));
assert('cloud review submission is client-idempotent per job', cloud.includes('const reviewSubmissions = new Set()') && cloud.includes('if (reviewSubmissions.has(jobId)) return;') && cloud.includes('reviewSubmissions.add(jobId);') && cloud.includes('reviewSubmissions.delete(jobId);'));
assert('cloud review success rehydrates durable row before relying on realtime', submitCloudReviewBody.includes("    }\n    await reattachCloudGeneration(jobId);\n    updateJob(jobId, { reviewRecovery: null });\n    subscribeToJob(jobId);") && read('scripts/test-cloud-review-success-reattach.mjs').includes('cloud review success reattach tests passed'));
assert('cloud restart missing-key failures rehydrate pending restart intent', restartCloudGenerationBody.includes('if (isMissingApiKeyError(err)) {') && restartCloudGenerationBody.indexOf('if (isMissingApiKeyError(err)) {') < restartCloudGenerationBody.indexOf('restoreJobAfterActionError(jobId, prior, err);') && restartCloudGenerationBody.includes('await reattachCloudGeneration(jobId);') && read('scripts/test-cloud-restart-fallback.mjs').includes('pending restart intent on missing API key'));
assert('cloud action success rehydrates durable row before fallback behavior', startCloudGenerationBody.includes('await reattachCloudGeneration(finalJobId);') && startCloudGenerationBody.indexOf('await reattachCloudGeneration(finalJobId);') < startCloudGenerationBody.indexOf('subscribeToJob(finalJobId);') && cancelCloudGenerationBody.includes('await reattachCloudGeneration(jobId);') && cancelCloudGenerationBody.indexOf('await reattachCloudGeneration(jobId);') < cancelCloudGenerationBody.indexOf('setTimeout(async () => {') && resumeCloudGenerationBody.includes('await reattachCloudGeneration(jobId);') && resumeCloudGenerationBody.indexOf('await reattachCloudGeneration(jobId);') < resumeCloudGenerationBody.indexOf('subscribeToJob(jobId);') && restartCloudGenerationBody.includes('await reattachCloudGeneration(jobId);') && restartCloudGenerationBody.indexOf('await reattachCloudGeneration(jobId);') < restartCloudGenerationBody.indexOf('subscribeToJob(jobId);') && restartCloudGenerationWithSourcesBody.includes('await reattachCloudGeneration(jobId);') && restartCloudGenerationWithSourcesBody.indexOf('await reattachCloudGeneration(jobId);') < restartCloudGenerationWithSourcesBody.indexOf('subscribeToJob(jobId);') && read('scripts/test-cloud-action-success-reattach.mjs').includes('start should hydrate the accepted durable job') && read('scripts/test-cloud-action-success-reattach.mjs').includes('cloud action success reattach tests passed'));
assert('cloud review API key failures remain recoverable from checkpoint UI', cloud.includes('const missingApiKey = isMissingApiKeyError(error);') && cloud.includes("...(missingApiKey ? { needsApiKey: true } : {})") && cloud.includes("'review_curriculum', 'review_research'") && submitCloudReviewBody.includes('if (isMissingApiKeyError(err)) {') && submitCloudReviewBody.includes('const reattached = await reattachCloudGeneration(jobId);') && submitCloudReviewBody.includes('if (!reattached) restoreJobAfterActionError(jobId, prior, err);') && submitCloudReviewBody.indexOf("if (isMissingApiKeyError(err)) {") < submitCloudReviewBody.indexOf("if (await reattachAfterActionConflict(jobId, err, prior)) return;") && review.includes('markReviewWaitingForApiKey') && review.includes('transition.patch.review_history') && review.includes('review_history: reviewHistory') && review.includes('Review is waiting for an Anthropic API key. Add one to your account, then continue from this checkpoint.') && review.includes(".eq('status', expectedStatus)") && review.includes('sameRunFilter(query, expectedRunId)') && review.includes(".select('id')") && review.includes('.maybeSingle()') && review.includes('if (!marked) return res.status(409)') && intake.includes('isReview && needsKey') && intake.includes('data-api-key>Add API key') && app.includes("else if (isReview && j.needsApiKey) stageLabel = 'Waiting for API key';") && read('scripts/test-cloud-review-api-key-recovery.mjs').includes('durable checkpoint before falling back') && read('scripts/test-cloud-review-api-key-recovery.mjs').includes('cloud review API key recovery tests passed') && read('scripts/test-cloud-review-feedback-durable-on-key-missing.mjs').includes('cloud review feedback durable on key missing tests passed'));
assert('cloud recovery action failures restore previous local state', cloud.includes('function restoreJobAfterActionError') && cloud.split('restoreJobAfterActionError(jobId, prior, err)').length - 1 >= 3);
assert('cloud recovery conflicts reattach to current server state before restoring stale state', cloud.includes('async function reattachAfterActionConflict') && cloud.includes('isCloudJobStateConflictError(err)') && cloud.includes('return await reattachCloudGeneration(jobId);') && restartCloudGenerationBody.includes("if (await reattachAfterActionConflict(jobId, err, prior)) return;") && restartCloudGenerationBody.indexOf('if (await reattachAfterActionConflict(jobId, err)) return;') < restartCloudGenerationBody.indexOf('restoreJobAfterActionError(jobId, prior, err);') && read('scripts/test-cloud-action-conflict-reattach.mjs').includes('restart') && read('scripts/test-cloud-action-conflict-reattach.mjs').includes('reattach before restoring stale local state'));
assert('cloud delete conflicts reattach without deleting local mirrors', deleteCloudGenerationBody.includes("const err = await apiError(resp, 'Delete request failed');") && deleteCloudGenerationBody.includes("if (await reattachAfterActionConflict(jobId, err, prior)) err.reattached = true;") && deleteCloudGenerationBody.indexOf('throw err;') < deleteCloudGenerationBody.lastIndexOf('removeCloudJobMirror(jobId);') && intake.includes('if (!err.reattached) updateJob(jobId'));
assert('cloud delete removes stale local mirrors when the durable row is already gone without deleting unrelated saved courses', deleteCloudGenerationBody.includes('if (isMissingCloudJobError(err)) {') && deleteCloudGenerationBody.includes('const deletedCourseId = prior?.savedCourseId && localCourseForCurrentUser(prior.savedCourseId, jobId)') && deleteCloudGenerationBody.includes('? prior.savedCourseId') && deleteCloudGenerationBody.includes(': null;') && deleteCloudGenerationBody.includes('removeCloudJobMirror(jobId);') && deleteCloudGenerationBody.includes('return { ok: true, missing: true, deletedCourseId };') && deleteCloudGenerationBody.indexOf("if (isMissingCloudJobError(err)) {") < deleteCloudGenerationBody.indexOf("if (await reattachAfterActionConflict(jobId, err, prior)) err.reattached = true;"));
assert('cloud resume optimism does not force a research-stage message', cloud.includes("message: 'Resuming from saved checkpoint…'") && !cloud.includes("agentMessage('research', 'Resuming…')"));
assert('cloud client surfaces endpoint error bodies for recovery actions', cloud.includes('async function apiErrorMessage') && cloud.includes("apiError(resp, 'Resume request failed')") && cloud.includes("apiError(resp, 'Restart request failed')") && cloud.includes("apiError(resp, 'Review request failed')"));
assert('cloud client surfaces cancel and delete endpoint errors', cloud.includes("apiError(resp, 'Cancel request failed')") && cloud.includes("apiError(resp, 'Delete request failed')"));
assert('cloud client cleans uploaded PDFs after definite start rejection', cloud.includes('export async function removeUploadedPdfRefs') && cloud.includes('await removeUploadedPdfRefs(pdfRefs)') && cloud.includes('await removeUploadedPdfRefs(refs, client)'));
assert('cloud client cleans only unclaimed duplicate-start PDF uploads', cloud.includes('export function unclaimedPdfRefs') && cloud.includes('if (data.existing && uploadedThisCall)') && cloud.includes('unclaimedPdfRefs(pdfRefs, data.pdfRefs || [])') && start.includes(".select('id,status,run_id,lease_expires_at,user_brief,error,message')") && start.includes('pdfRefs: existing.user_brief?.pdfRefs || []'));
assert('cloud PDF uploads cannot overwrite existing job files', cloud.includes('export function pdfUploadPath') && cloud.includes('const uploadToken = uniqueUploadToken();') && cloud.includes('uploadToken') && cloud.includes('upsert: false'));
assert('cloud start keeps incoming brief immutable while splitting PDF refs', start.includes('const { pdfRefs = [], ...inputBrief } = body.brief;') && start.includes('userBrief = creationBrief(inputBrief)') && !start.includes('delete userBrief.pdfRefs'));
assert('cloud delete cleanup recursively removes job upload prefixes', deleteJob.includes('export async function listStorageFilesRecursive') && deleteJob.includes('queue.push(path)') && deleteJob.includes('offset += limit') && read('scripts/test-gen-delete-storage.mjs').includes('job-nested') && read('scripts/test-gen-delete-storage.mjs').includes('job-paged'));
assert('cloud client directly installs completed or partial saved courses only', cloud.includes('installSavedCloudCourse') && cloud.includes('const query = new URLSearchParams({ id: courseId });') && cloud.includes("if (jobId) query.set('jobId', jobId);") && cloud.includes("if (expectedRunId) query.set('runId', expectedRunId);") && cloud.includes('fetch(`/api/courses/get?${query.toString()}`') && cloud.includes("if (expectedRunId && String(row.payload?._generationRunId || '') !== String(expectedRunId)) return false;") && cloud.includes('_installCourseFromRemote') && cloud.includes('learnable-cloud-pulled') && cloud.includes("const CLOUD_INSTALLABLE_COURSE_STATUSES = ['completed', 'partial'];") && cloud.includes('export function shouldInstallSavedCourseForJobStatus') && cloud.includes('return CLOUD_INSTALLABLE_COURSE_STATUSES.includes(status);') && cloud.includes('row.saved_course_id && shouldInstallSavedCourseForJobStatus(row.status)'));
assert('cloud delete returns server-confirmed deleted course id', cloud.includes('return data') && deleteJob.includes('deletedCourseId') && app.includes('result?.deletedCourseId') && intake.includes('result?.deletedCourseId'));
assert('cloud delete callers trust only guarded cloud deletedCourseId for cloud course cleanup', app.includes("let deletedCourseId = j?.runner === 'cloud' ? null : (j?.savedCourseId || null);") && app.includes("let deletedCourseId = j?.runner === 'cloud' ? null : courseId;") && intake.includes("let deletedCourseId = j?.runner === 'cloud' ? null : (j?.savedCourseId || null);") && app.includes('deletedCourseId = result?.deletedCourseId || null;') && intake.includes('deletedCourseId = result?.deletedCourseId || null;') && !app.includes('result?.deletedCourseId || deletedCourseId') && !intake.includes('result?.deletedCourseId || deletedCourseId') && read('scripts/test-cloud-local-course-removal-scope.mjs').includes('stale local delete ids'));
assert('app awaits cloud delete before removing local course state', app.includes("await deleteCloudGeneration(id, expected)") && app.indexOf('await deleteCloudGeneration(id)') < app.indexOf('removeUserCourseForCurrentAccount(deletedCourseId)'));
assert('library delete removes completed cloud generation row before local course', app.includes('const generationJobId = course?._generationJobId || null;') && app.includes("await deleteCloudGeneration(generationJobId, expected);") && app.indexOf('await deleteCloudGeneration(generationJobId);') < app.indexOf('removeUserCourse(id);'));
assert('auth change clears local cloud job mirrors before rehydrating', jobs.includes('export function removeCloudJobs') && app.includes('removeCloudJobs()') && app.includes('refreshCloudGenerationState().catch') && bridgeAuthIdentityBody.indexOf('removeCloudJobs();') < bridgeAuthIdentityBody.indexOf('refreshCloudGenerationState().catch'));
assert('auth change clears stale cloud realtime subscriptions before local mirrors', cloud.includes('export function clearCloudGenerationSubscriptions') && app.includes('clearCloudGenerationSubscriptions();') && bridgeAuthIdentityBody.indexOf('clearCloudGenerationSubscriptions();') < bridgeAuthIdentityBody.indexOf('removeCloudJobs();'));
assert('auth change revalidates active account-owned course route', bridgeAuthIdentityBody.includes('const activeCourseId = getCurrentCourseId();') && bridgeAuthIdentityBody.includes('invalidateCourseCache(activeCourseId);') && bridgeAuthIdentityBody.includes('currentMode = null;') && bridgeAuthIdentityBody.includes('currentCourseSlug = null;') && bridgeAuthIdentityBody.includes('Re-render the current route so account-only courses are revalidated') && bridgeAuthIdentityBody.indexOf('invalidateCourseCache(activeCourseId);') < bridgeAuthIdentityBody.indexOf('renderForCurrentURL();'));
assert('auth login form targets submit feedback message not intent banner', auth.includes('data-auth-submit-msg') && auth.includes("const msg = body.querySelector('[data-auth-submit-msg]');") && !auth.includes("const msg = body.querySelector('.auth-msg');"));
assert('auth pending course intake survives storage fallback', intake.includes('function readPendingCourseCreationRaw()') && intake.includes('try { raw = localStorage.getItem(PENDING_COURSE_CREATION_KEY); } catch {}') && intake.includes('try { raw = sessionStorage.getItem(PENDING_COURSE_CREATION_KEY); } catch {}') && intake.indexOf('try { raw = localStorage.getItem(PENDING_COURSE_CREATION_KEY); } catch {}') < intake.indexOf('try { raw = sessionStorage.getItem(PENDING_COURSE_CREATION_KEY); } catch {}'));
assert('account modal migration SQL points to full agentic workflow setup', auth.includes('For the full cloud course-builder workflow, run db/04-agentic-workflow.sql') && auth.includes('created_at timestamptz not null default now()') && auth.includes('Account course sync needs its table'));
assert('account modal has retired legacy local course recovery controls', !auth.includes('Local courses on this browser') && !auth.includes('Migrate courses from another deployment') && !auth.includes('Import courses') && !auth.includes('Copy my courses') && !auth.includes('Sync all to cloud now') && !auth.includes('Pull from cloud'));
assert('course sync only uploads real local changes after pull', courseSync.includes('shouldUploadCourseAfterPull') && courseSync.includes('hasLocalChangesSinceSync(local)') && courseSync.includes('if (isDifferentGenerationRun(local, remoteRow?.payload)) return false;'));
assert('course sync pull installs authoritative generated runs without trampling unsynced edits', courseSync.includes('if (isDifferentGenerationRun(local, remoteRow?.payload)) {') && courseSync.includes('if (local._syncedAt && hasLocalChangesSinceSync(local)) return false;') && courseSync.includes('return true;') && read('scripts/test-course-sync-policy.mjs').includes('newer generated run should install') && read('scripts/test-course-sync-policy.mjs').includes('newer generated run should not overwrite unsynced local edits'));
assert('course sync pull compares remote rows only against current account local courses', courseSync.includes('export function localCourseForAccount') && courseSync.includes('const local = localCourseForAccount(localAll[row.id], u);') && courseSync.includes('courseCanSyncToAccount(course, user.email, user.id)'));
assert('course sync uploads pull-discovered local courses after login', courseSync.includes('toUpload.forEach(id => schedulePush(id, { force: true }));') && courseSync.includes('function schedulePush(id, options = {})') && courseSync.includes('if (inUserChange && !options.force) return;'));
assert('course sync preserves offline edits and other accounts during remote-delete checks', courseSync.includes('export function shouldRemoveLocalCourseAfterPull') && courseSync.includes('shouldRemoveLocalCourseAfterPull(local, cloudById.get(id), u)') && courseSync.includes('if (!courseCanSyncToAccount(local, user.email, user.id)) return false;') && courseSync.includes('return !hasLocalChangesSinceSync(local);') && courseSync.includes('Local changes win over a missing cloud row'));
assert('course sync retries remote deletes until confirmed', courseSync.includes('const DELETE_RETRY_MS = 5000;') && courseSync.includes("const PENDING_DELETE_KEY = 'learnable-course-pending-deletes';") && courseSync.includes('const deleteTimers = new Map();') && courseSync.includes('function rememberPendingDelete(ownerId, courseId)') && courseSync.includes('function forgetPendingDelete(ownerId, courseId)') && courseSync.includes('function loadPendingDeletesForUser(userId)') && courseSync.includes('for (const id of pendingDeleteIdsForUser(userId)) pendingDeletes.add(id);') && courseSync.includes("async function deleteRemote(id, expectedOwnerId = '')") && courseSync.includes('if (expectedOwnerId && u?.id && u.id !== expectedOwnerId) return;') && courseSync.includes('if (!c || !u) { scheduleDeleteRetry(id, expectedOwnerId); return; }') && courseSync.includes("function scheduleDeleteRetry(id, ownerId = getUser()?.id || currentSyncUserId || '')") && courseSync.includes('if (pendingDeletes.has(id)) deleteRemote(id, ownerId);') && userCourses.includes("_emit({ type: 'removed', id, course });") && courseSync.includes('function scheduleDelete(id, removedCourse = null)') && courseSync.includes("const ownerId = user?.id || '';") && courseSync.includes('if (!ownerId) return;') && courseSync.includes('if (!removedCourse || !courseCanSyncToAccount(removedCourse, user.email, ownerId)) return;') && courseSync.includes('rememberPendingDelete(ownerId, id);') && courseSync.includes('deleteTimers.set(id, setTimeout(() => {') && courseSync.indexOf('pendingDeletes.delete(id);') > courseSync.indexOf("if (error) throw error;") && courseSync.includes('forgetPendingDelete(u.id, id);') && courseSync.includes('if (nextUserId) loadPendingDeletesForUser(nextUserId);') && courseSync.includes('for (const id of pendingDeletes) scheduleDeleteRetry(id, user.id);') && courseSync.includes('deleteTimers.forEach(t => clearTimeout(t));') && courseSync.includes('const activeCloudRows = data.filter(row => !pendingDeletes.has(row.id));') && courseSync.includes('for (const row of activeCloudRows)'));
assert('course sync resets pull session on auth user changes', courseSync.includes('let currentSyncUserId = null') && courseSync.includes('nextUserId !== currentSyncUserId') && courseSync.includes('pulledOnce = false'));
assert('course sync ignores stale pulls after account changes', courseSync.includes('const pullOwnerId = u.id;') && courseSync.includes('function isCurrentPullOwner(ownerId)') && courseSync.includes('getUser()?.id === ownerId && currentSyncUserId === ownerId') && courseSync.indexOf('if (!isCurrentPullOwner(pullOwnerId)) return;') < courseSync.indexOf('data = res.data || [];') && read('scripts/test-course-sync-policy.mjs').includes('stale account pulls should stop before installing cloud courses'));
assert('course sync only pushes courses owned by the signed-in account', courseSync.includes('export function courseCanSyncToAccount') && courseSync.includes('createdByUserId') && courseSync.includes('courseCanSyncToAccount(local, u.email, u.id)') && courseSync.includes('const pushOwnerId = u.id;') && courseSync.includes('courseCanSyncToAccount(course, u.email, pushOwnerId)') && courseSync.includes("p_owner: ownerId"));
assert('course sync claims legacy ownerless courses on first account push', courseSync.includes('export function coursePayloadForAccount') && courseSync.includes('createdByUserId: user.id') && courseSync.includes('createdBy: author || email || course.createdBy') && courseSync.includes('const payload = coursePayloadForAccount(course, u);') && courseSync.includes('payload,') && courseSync.includes("...coursePayloadForAccount(saved.payload, u)") && read('scripts/test-course-sync-policy.mjs').includes("config: { id: 'ownerless' }") && read('scripts/test-course-sync-policy.mjs').includes("createdByUserId: 'user-1'"));
assert('remote cloud course installs are stamped to the signed-in account before local storage', courseSync.includes("const installed = { ...coursePayloadForAccount(row.payload, u), _courseUpdatedAt: row.updated_at, _syncedAt: remoteTs };") && courseSync.includes('_installCourseFromRemote(row.id, installed);') && cloud.includes("_installCourseFromRemote(row.id, { ...coursePayloadForAccount(row.payload, getUser()), _courseUpdatedAt: row.updatedAt, _syncedAt: remoteTs });") && read('scripts/test-course-sync-policy.mjs').includes('remote pulls should stamp legacy ownerless payloads') && read('scripts/test-cloud-completed-account-ownership.mjs').includes('direct completed cloud installs should stamp legacy ownerless payloads'));
assert('course sync ignores stale pushes after account changes', courseSync.includes('function isCurrentSyncOwner(ownerId)') && courseSync.includes('if (!isCurrentSyncOwner(pushOwnerId)) return { pushed: false, failed: false, skipped: true, stale: true };') && courseSync.indexOf('if (!isCurrentSyncOwner(pushOwnerId)) return { pushed: false, failed: false, skipped: true, stale: true };') < courseSync.indexOf('const updated = _readAllCourses();') && read('scripts/test-course-sync-policy.mjs').includes('stale account pushes should stop before stamping local _syncedAt'));
assert('course sync preflights remote rows before local pushes so stale generated runs cannot overwrite completed cloud courses', courseSync.includes('export function shouldPushLocalCourse') && courseSync.includes('const remoteRow = await loadRemoteCourseForPush(c, pushOwnerId, id);') && courseSync.includes('if (!shouldPushLocalCourse(payload, remoteRow)) {') && courseSync.includes('queuePullAfterPushConflict(pushOwnerId);') && courseSync.includes("const saved = await writeRemoteCourseFromPush(c, pushOwnerId, id, payload, remoteRow);") && courseSync.includes("if (!saved) {") && courseSync.includes('return { pushed: false, failed: false, skipped: true, conflict: true };') && courseSync.includes('async function writeRemoteCourseFromPush') && !courseSync.includes(".from('user_courses').upsert") && courseSync.includes("if (data?.error === 'conflict') return null;") && courseSync.includes("client.rpc('commit_user_course'") && courseSync.includes("p_expected_revision: payload._courseRevision || null") && courseSync.includes("p_updated_at: payload._courseUpdatedAt || null") && courseSync.includes('function isDifferentGenerationRun') && courseSync.includes('function queuePullAfterPushConflict(ownerId)') && courseSync.includes('if (isCurrentSyncOwner(ownerId)) pullAll();') && read('scripts/test-course-sync-policy.mjs').includes("_generationRunId: 'run-old'"));
assert('course sync push results distinguish skipped from pushed', courseSync.includes('return { pushed: false, failed: false, skipped: true };') && courseSync.includes("return { pushed: true, failed: false, skipped: false, pending: !unchanged };") && courseSync.includes('return { pushed: false, failed: true, skipped: false };') && courseSync.includes('else skipped++;'));
assert('direct cloud course install reuses course sync timestamp policy with generation run precedence', cloud.includes('export function shouldInstallSavedCloudCourse') && cloud.includes('hasLocalChangesSinceSync(local)') && cloud.includes('remoteRow.payload?._generationRunId') && cloud.includes('remoteRunId && remoteRunId !== localRunId') && cloud.includes('return shouldInstallRemoteCourse(local, remoteRow);') && cloud.includes('courseRemoteTimestamp') && cloud.includes('const remoteTs = courseRemoteTimestamp(remoteRow) || Date.now();') && read('scripts/test-cloud-completed-sync-action.mjs').includes('should not overwrite unsynced local edits'));
assert('local user course reads are account-visible only', userCourses.includes('createdByUserId') && userCourses.includes('export function courseVisibleToEmail') && userCourses.includes('.filter(course => courseVisibleToEmail(course))') && userCourses.includes('return courseVisibleToEmail(course) ? course : null'));
assert('generated courses stamp stable account owner id', userCourses.includes('createdByUserId: course.createdByUserId || ownerId') && courseSave.includes('createdByUserId: priorPayload?.createdByUserId || ownerId || null') && read('web/js/course-loader.js').includes('createdByUserId: c.createdByUserId || null'));
assert('local job mirrors compact heavy PDF payloads', jobs.includes('export function compactBriefForLocalJob') && jobs.includes('compact.pdfs = compact.pdfs.map') && jobs.includes('file_index: pdf.file_index') && jobs.includes('pageThumbs: pdf.pageThumbs || []') && jobs.includes('compactBriefForLocalJob(patch.brief)'));
assert('cloud job ids use collision-resistant UUIDs', jobs.includes('export function createJobId()') && jobs.includes('globalThis.crypto?.randomUUID') && start.includes('const jobId = requestedJobId || `job-${randomUUID()}`;'));
assert('cloud start records uploaded PDF refs in local compact brief before posting', cloud.includes('const existingPdfRefs = userBrief.pdfRefs || []') && cloud.includes('const uploadedThisCall = !existingPdfRefs.length') && cloud.includes('updateJob(jobId, { brief: slimBrief })') && cloud.indexOf('updateJob(jobId, { brief: slimBrief })') < cloud.indexOf("fetch('/api/gen/start'") && cloud.includes('if (uploadedThisCall) {') && cloud.includes('await removeUploadedPdfRefs(pdfRefs)'));
assert('failed pre-start PDF durability asks for source reattach', cloud.includes('needsSourceReattach: true') && cloud.includes('PDF upload failed before the source files were saved.') && cloud.includes('brief: { ...slimBrief, pdfRefs: [] }') && intake.includes("const recoveryAction = needsKey ? 'api-key' : (mustReattach ? 'reattach'") && intake.includes('data-${recoveryAction}') && intake.includes('Reattach source files') && intake.includes('reuseJobIdForSubmit') && app.includes('openIntakeWithDraft') && app.includes("needsSourceReattach ? 'reattach'") && app.includes("openIntakeWithDraft(job?.brief || {}, { reuseJobId: id, expected })"));
assert('failed post-start PDF source errors restart with reattached files', cloud.includes('export async function restartCloudGenerationWithSources') && cloud.includes("body: JSON.stringify({ jobId, feedback, brief: slimBrief, expected })") && cloud.includes('export function needsSourceReattachForRow') && cloud.includes('Could not download PDF|not attached to this generation job') && intake.includes('const replacingSources = !!(reusableJobId && getJob(reusableJobId)?.needsSourceReattach)') && intake.includes("restartCloudGenerationWithSources(jobId, userBrief, '', options.expected)") && restart.includes('mergeRestartBrief') && restart.includes('shouldReuseExtractedUrls'));
assert('ambiguous reattached-source restarts preserve source refs for retry', restartCloudGenerationWithSourcesBody.includes('const existingPdfRefs = userBrief.pdfRefs || [];') && restartCloudGenerationWithSourcesBody.includes('const uploadedThisCall = !existingPdfRefs.length;') && restartCloudGenerationWithSourcesBody.includes('pdfRefs = existingPdfRefs.length') && restartCloudGenerationWithSourcesBody.includes('if (isMissingApiKeyError(err)) {') && restartCloudGenerationWithSourcesBody.indexOf('if (isMissingApiKeyError(err)) {') < restartCloudGenerationWithSourcesBody.indexOf('if (uploadedThisCall) await removeUploadedPdfRefs(pdfRefs);') && restartCloudGenerationWithSourcesBody.includes('if (uploadedThisCall) await removeUploadedPdfRefs(pdfRefs);') && restartCloudGenerationWithSourcesBody.includes('if (await reattachCloudGeneration(jobId)) return;') && restartCloudGenerationWithSourcesBody.includes('The reattached source files are still saved for retry.') && startReviewableGenerationCatchBody.includes('if (await reattachCloudGeneration(jobId)) return;') && !startReviewableGenerationCatchBody.includes('if (!options.replacingSources)') && read('scripts/test-cloud-source-restart-ambiguity.mjs').includes('missing-key reattached-source restarts should hydrate the saved pending restart'));

assert('runner supports curriculum checkpoint mode', runner.includes("mode === 'curriculum'") && runner.includes("status: mode === 'curriculum' ? 'review_curriculum'") && runner.includes("status: 'review_curriculum'") && read('scripts/test-gen-recovery.mjs').includes('runner should recover an existing curriculum checkpoint back to human review'));
assert('runner supports research checkpoint mode', runner.includes("mode === 'research'") && runner.includes("status: 'review_research'"));
assert('runner bounds research module concurrency', runner.includes('const STAGE2_CONCURRENCY = 3;') && runner.includes('const researchWorkers = Array.from({ length: Math.min(STAGE2_CONCURRENCY, brief.modules.length) }') && runner.includes('const researchResults = new Array(brief.modules.length);') && read('scripts/test-gen-runner-disposition.mjs').includes('Research should use a bounded worker pool'));
assert('runner and review share brief metadata helpers', runner.includes('topicCountForBrief') && review.includes('topicCountForBrief') && briefMeta.includes('outlineForBrief'));
assert('review transitions persist durable human feedback history', review.includes('appendReviewHistory') && review.includes('review_history: appendReviewHistory') && review.includes('export function buildReviewTransition') && review.includes('export function appendFeedbackToBrief') && review.includes('export function appendFeedbackToUserBrief') && review.includes('latestReviewFeedback(job?.review_history, action, job?.status)') && reviewHistory.includes('MAX_REVIEW_HISTORY') && reviewHistory.includes('prior.at(-1)') && read('scripts/test-gen-review-history.mjs').includes('run-duplicate-new') && read('scripts/test-gen-review-transitions.mjs').includes('Saved pending review feedback.'));
assert('review transitions dedupe repeated human feedback before prompt reuse', review.includes('if (sourceText.includes(block)) return userBrief;') && review.includes('if (priorItems.includes(clean)) return brief;') && read('scripts/test-gen-review-feedback.mjs').includes('exact repeated curriculum feedback') && read('scripts/test-gen-review-feedback.mjs').includes('exact repeated user-brief feedback'));
assert('review transitions reset stale topic progress', review.includes('topics_done: 0') && review.includes('topics_total: topicCountForBrief(brief)') && review.includes('topics_by_key: {}'));
assert('research checkpoint policy requires every module to have a bundle', researchCheckpoint.includes('export function missingResearchModules') && researchCheckpoint.includes('export function hasCompleteResearchCheckpoint') && researchCheckpoint.includes('modules.length > 0') && researchCheckpoint.includes('missingResearchModules(brief, research).length === 0'));
assert('review approval requires complete module research', review.includes('hasCompleteResearchCheckpoint') && review.includes('export function hasCompleteResearch') && review.includes('Research is incomplete. Rerun research before lesson writing.'));
assert('runner clears stale topic and research failures on successful retry', runner.includes('clearTopicFailure') && runner.includes('pruneResolvedFailures(failures, topicsByKey, researchByModule)') && runner.includes('replaceTopicFailure') && failurePolicy.includes('researchByModule') && read('scripts/test-gen-failures.mjs').includes("Recovered research"));
assert('runner persists research module failures for human review', runner.includes('replaceResearchFailure') && runner.includes('clearResearchFailure') && runner.includes('research failed for') && runner.includes("stage: 'research'") && runner.includes('Review or rerun research'));
assert('runner pauses recovered jobs with incomplete research before lesson writing', runner.includes('missingResearchModules') && runner.includes("if (mode === 'research' || missingResearch.length)") && runner.includes("status: 'review_research'") && runner.includes('still need research before lessons are written'));
assert('runner serializes checkpoint writes before parallel workers can overwrite state', runner.includes('let patchQueue = Promise.resolve()') && runner.includes('patchQueue = patchQueue.then') && runner.includes('stableJsonClone(leasePatch(checkpointPatchFields(fields)))'));
assert('runner treats checkpoint persistence failures as job-level failures', runner.includes('CheckpointWriteError') && runner.includes('isCheckpointWriteError(err)') && runner.includes('Could not persist generation checkpoint; job no longer exists.'));
assert('runner checkpoint writes cannot revive inactive jobs', runner.includes('RUNNER_WRITABLE_STATUSES') && runner.includes(".in('status', RUNNER_WRITABLE_STATUSES)") && runner.includes('refusing to revive it with a late runner write') && !runner.includes("const RUNNER_WRITABLE_STATUSES = ['queued', 'running']"));
assert('runner progress checkpoints reset automatic recovery budget only after durable progress', runner.includes('export function checkpointPatchFields') && runner.includes('function isProgressCheckpoint') && runner.includes('Object.prototype.hasOwnProperty.call(fields, \'brief\')') && runner.includes('Array.isArray(fields.extracted_urls)') && runner.includes('hasObjectKeys(fields.research)') && runner.includes('hasObjectKeys(fields.topics_by_key)') && runner.includes('fields.saved_course_id') && runner.includes('recovery_attempts: 0') && runner.includes('last_recovery_at: null') && runner.includes('leasePatch(checkpointPatchFields(fields))') && runner.includes('.update(leasePatch({}))') && read('scripts/test-gen-runner-progress-recovery.mjs').includes('lease heartbeats should not reset recovery attempts.'));
assert('runner heartbeats renew active leases during long calls only', runner.includes('const ACTIVE_HEARTBEAT_MS = 60 * 1000;') && runner.includes('async function withLeaseHeartbeat') && runner.includes('async function heartbeatLease') && runner.includes('.update(leasePatch({}))') && runner.includes(".eq('run_id', runId)") && runner.includes(".in('status', RUNNER_WRITABLE_STATUSES)") && runner.includes('if (!data) return false;') && runner.includes("if (typeof timer.unref === 'function') timer.unref();") && runner.includes('clearInterval(timer);') && runner.includes("withLeaseHeartbeat('source URL extraction'") && runner.includes('pdfResolutionPromise = withLeaseHeartbeat(label') && runner.includes("withLeaseHeartbeat('curriculum design'") && runner.includes('withLeaseHeartbeat(`research for ${mod.id}`') && runner.includes('withLeaseHeartbeat(`lesson writing for ${key}`') && read('scripts/test-gen-runner-heartbeat.mjs').includes('gen runner heartbeat tests passed'));
assert('runner leaves timed-out/cancelled states alone after late checkpoint failures', runner.includes('shouldLeaveTerminalStateAlone') && runner.includes('!isRunnerWritableStatus(status)'));
assert('runner requires and enforces a per-run lease id', runner.includes('runGeneration({ supabase, jobId, ownerId, runId') && runner.includes('requires runId') && runner.includes(".eq('run_id', runId)") && runner.includes('owned by another runner lease'));
assert('runner startup failures persist to the generation job row', runner.includes('let client = null;') && runner.includes('let tone = null;') && runner.indexOf("try {") < runner.indexOf("client = createAnthropic({ apiKey, requestBudget, beforeDispatch: assertRunnerWritable });") && runner.indexOf('client = createAnthropic({ apiKey, requestBudget, beforeDispatch: assertRunnerWritable });') < runner.indexOf("await ensurePdfsForApi('PDF source resolution for curriculum design')") && read('scripts/test-gen-runner-disposition.mjs').includes('persisted failure boundary'));
assert('runner lazily hydrates PDF documents for model stages only', runner.includes('let pdfThumbs = pdfThumbsFromRefs(pdfRefs);') && runner.includes('let pdfResolutionPromise = null;') && runner.includes('async function ensurePdfsForApi') && runner.includes("const pdfs = await resolvePdfs(supabase, pdfRefs, { ownerId, jobId, requestBudget });") && runner.indexOf('const sourceUrls = (userBrief.source_urls || []).filter(Boolean);') < runner.indexOf("await ensurePdfsForApi('PDF source resolution for curriculum design')") && runner.includes('await ensurePdfsForApi(`PDF source resolution for research ${mod.id}`)') && runner.includes('runTopic(client, brief, mod, topic, bundle, tone, {') && runner.includes('model: aiModels.lesson.model') && runner.includes('function pdfThumbsFromRefs(pdfRefs = [])') && runner.includes("withLeaseHeartbeat('image embedding', () => requestBudget.runOperation(signal =>") && runner.includes("embedWebImagesInTopicResults(topicResults, { signal, onProgress: results => { imageResolvedTopicResults = results; } })") && runner.includes('assembleCourse(brief, imageResolvedTopicResults, { pdfThumbs })') && read('scripts/test-gen-runner-lazy-pdf.mjs').includes('topic-only recovery should not require source PDF downloads'));
assert('runner stops cancelled jobs before source URL extraction', runner.indexOf('if (await bailIfInactive()) return;') < runner.indexOf('const sourceUrls = (userBrief.source_urls || []).filter(Boolean);') && read('scripts/test-gen-runner-disposition.mjs').includes('Cancelled or superseded runners should stop before source resolution.'));
assert('runner stops superseded leases before expensive model calls without racing worker cursors', runner.includes('async function runnerStopReason()') && runner.includes("return 'superseded';") && runner.includes('const i = researchCursor++;') && runner.includes('if (i >= brief.modules.length) return;') && runner.includes('const i = cursor++;') && runner.includes('if (i >= work.length) return;') && runner.indexOf('if (await runnerStopReason()) return;') < runner.indexOf('withLeaseHeartbeat(`research for ${mod.id}`') && runner.includes('withLeaseHeartbeat(`lesson writing for ${key}`') && read('scripts/test-gen-runner-disposition.mjs').includes('claim the cursor before awaiting'));
assert('runner validates service-signed PDF refs belong to the job', runner.includes('assertPdfRefBelongsToJob') && runner.includes('const expectedPrefix = `${ownerId}/${jobId}/`;') && runner.includes('path.startsWith(expectedPrefix)'));
assert('runner bounds PDF source downloads', runner.includes('const PDF_FETCH_TIMEOUT_MS = 15_000;') && runner.includes('const MAX_PDF_BYTES = 12 * 1024 * 1024;') && runner.includes('export async function fetchPdfBuffer') && runner.includes('readStreamWithLimit') && read('scripts/test-gen-runner-pdf-failure.mjs').includes('too-large.pdf') && read('scripts/test-gen-runner-pdf-failure.mjs').includes('slow.pdf'));
assert('runner persists PDF resolution failures as job failures', runner.indexOf('try {', runner.indexOf('export async function runGeneration')) < runner.indexOf('const pdfs = await resolvePdfs') && runner.indexOf('const pdfs = await resolvePdfs') < runner.indexOf('console.error(`[gen ${jobId}] FAILED:', runner.indexOf('const pdfs = await resolvePdfs')));
assert('runner extracts source URLs directly in cloud process', runner.includes("import { extractUrlContent } from './url-extract.mjs';") && runner.includes('export async function serverFetchUrls') && runner.includes("const extract = signal => extractUrlContent(url, { ...options, fetchImpl: (input, init) =>") && !runner.includes('/api/fetch-url') && !runner.includes('VERCEL_URL') && urlExtract.includes('export async function extractUrlContent') && urlExtract.includes('export function isSafeUrl'));
assert('runner checkpoints source URL extraction incrementally and resumes only missing URLs', runner.includes('const pendingSourceUrls = sourceUrls.filter(url => !sourceUrlHasResult(url, extractedUrls));') && runner.includes('onProgress: async partialResults =>') && runner.includes('extractedUrls = mergeSourceUrlResults(extractedUrls, partialResults);') && runner.includes('await patch({ extracted_urls: extractedUrls });') && runner.includes('export function sourceUrlHasResult') && runner.includes('export function mergeSourceUrlResults') && read('scripts/test-cloud-url-extraction.mjs').includes('progressSnapshots') && read('scripts/test-cloud-url-extraction.mjs').includes("sourceUrlHasResult('https://example.com/a', incrementalResults)"));
assert('runner keeps source URL extraction failures per URL instead of failing the job', runner.includes("...(await (options.requestBudget ? options.requestBudget.runOperation(extract) : extract()))") && runner.includes('results[i] = {') && runner.includes('ok: false,\n          requestedUrl: url,\n          url,') && runner.includes('return [...results, ...skipped];') && read('scripts/test-cloud-url-extraction.mjs').includes('unexpectedFailureResults'));
assert('runner bounds source URL extraction fanout', runner.includes('const SOURCE_URL_LIMIT = 10;') && runner.includes('const SOURCE_URL_CONCURRENCY = 4;') && runner.includes('const skipped = all.slice(SOURCE_URL_LIMIT).map') && runner.includes('const workers = Array.from({ length: Math.min(SOURCE_URL_CONCURRENCY, list.length) }') && read('scripts/test-cloud-url-extraction.mjs').includes('at most 10 source URLs'));
assert('failure policy dedupes topic and research failures by stable keys', failurePolicy.includes('topicFailureKey') && failurePolicy.includes('researchFailureKey') && failurePolicy.includes('replaceTopicFailure') && failurePolicy.includes('replaceResearchFailure'));
assert('course save helper writes completed courses to user_courses', courseSave.includes(".from('user_courses')") && courseSave.includes("commitCourseRow({ supabase, ownerId, courseId") && courseCommit.includes("p_owner: ownerId, p_id: courseId"));
assert('runner uses collision-safe course save helper', runner.includes("from './course-save.mjs'") && runner.includes('saveGeneratedCourse'));
assert('course save helper stamps generation job id', courseSave.includes('_generationJobId: jobId'));
assert('course save helper stamps and enforces generation run lease', courseSave.includes('_generationRunId: runId') && courseSave.includes('assertJobStillOwnedByRun') && courseSave.includes('another runner owns this job') && courseSave.includes('RUNNER_WRITABLE_STATUSES') && !courseSave.includes('COURSE_SAVE_WRITABLE_STATUSES') && runner.includes('runId,') && runner.includes('baseCourseId: brief.id'));
assert('course save helper commits owned job rows against their original revision and timestamp', courseCommit.includes("export async function commitCourseRow") && courseCommit.includes("p_expected_revision: row?.payload?._courseRevision || null") && courseCommit.includes("p_owner: ownerId, p_id: courseId") && courseCommit.includes("p_updated_at: row?.updated_at || null") && courseRevisionMigration.includes("course.updated_at is distinct from p_updated_at or course.write_revision is distinct from p_expected_revision") && courseCommit.includes("if (data?.error === 'conflict') return null;") && courseSave.includes(".select('id')") && courseSave.includes("if (existing?.payload && !courseRowBelongsToJob(existing.payload, jobId, existingJobCourseId, courseId)) continue;") && read('scripts/test-course-save.mjs').includes('restampCourseBeforeUpdate') && read('scripts/test-course-save.mjs').includes('rerunCourseBeforeUpdate'));
assert('course save helper preserves resumed saved course id', courseSave.includes('savedCourseId') && courseSave.includes('generation_jobs'));
assert('course save helper claims by insert and only reuses job-stamped rows', courseSave.includes("commitCourseRow({ supabase, ownerId, courseId, payload })") && courseRevisionMigration.includes("insert into public.user_courses(id,owner_id,payload) values(p_id,p_owner,p_payload)") && courseRevisionMigration.includes("exception when unique_violation then return jsonb_build_object('error','conflict');") && courseSave.includes('if (payload?._generationJobId === jobId) return true;') && courseSave.includes('return false;') && read('scripts/test-course-save.mjs').includes("payload: { _generationJobId: 'other-job'") && read('scripts/test-course-save.mjs').includes('User course without generation stamp'));
assert('runner conditionally rolls back the exact saved revision, retaining courses after uncertain replies', courseSave.includes('export async function rollbackGeneratedCourseSave') && courseSave.includes('export async function clearSavedCourseIdForJob') && courseSave.includes("current.payload._generationJobId !== jobId") && courseSave.includes("current.payload._generationRunId !== runId") && courseSave.includes("current.payload._courseRevision !== savedRevision") && courseSave.includes("current.updated_at !== savedUpdatedAt") && courseSave.includes("payload: priorPayload, action: priorPayload ? 'save' : 'delete'") && runner.includes("if (courseSaveAttempt && err?.code !== GENERATION_IO_UNCERTAIN)") && courseSave.includes('saved_course_id: null') && courseSave.includes('priorSavedCourseId: existingJobCourseId || null') && runner.includes('rollbackGeneratedCourseSave') && runner.includes('clearSavedCourseIdForJob') && runner.includes('courseSaveAttempt.priorPayload') && runner.includes('courseSaveAttempt.inserted || courseSaveAttempt.priorSavedCourseId !== courseSaveAttempt.courseId') && read('scripts/test-course-save.mjs').includes('priorSavedCourseId, null') && read('scripts/test-course-save.mjs').includes('beforeWrite(rows)') && read('scripts/test-gen-runner-disposition.mjs').includes('saved_course_id pointer introduced by that failed save attempt'));
assert('runner does not save fully failed courses to account', runner.includes('export function finalGenerationDisposition') && runner.includes('total === 0 || failed >= total') && runner.includes('shouldSaveCourse: false') && runner.includes('if (shouldSaveCourse)') && runner.includes("...(courseRowId ? { saved_course_id: courseRowId } : {})"));
assert('runner cleans completed source uploads only after durable finalization', runner.includes('export function shouldCleanupSourceUploadsAfterFinalize') && runner.includes("return status === 'completed';") && runner.includes('if (shouldCleanupSourceUploadsAfterFinalize(status)) {') && runner.includes('await removePdfUploadsForJob(supabase, ownerId, jobId);') && runner.indexOf('if (!finalRow) {') < runner.indexOf('if (shouldCleanupSourceUploadsAfterFinalize(status)) {') && read('scripts/test-gen-runner-disposition.mjs').includes("shouldCleanupSourceUploadsAfterFinalize('partial'), false"));
assert('runner terminal failures include user recovery guidance', runner.includes('export function failurePatch') && runner.includes('resume from the saved checkpoint') && runner.includes('restart from the original request') && runner.includes('failurePatch(err)') && read('scripts/test-gen-runner-disposition.mjs').includes('failurePatch(new Error'));
assert('saved course read endpoint is owner, generation-job, and generation-run scoped', courseGet.includes('export async function readSavedCourseForUser') && courseGet.includes("from('user_courses')") && courseGet.includes(".eq('owner_id', userId)") && courseGet.includes('userFromRequest') && courseGet.includes('requireSafeJobId') && courseGet.includes('requireSafeRunId') && courseGet.includes('requireSafeCourseId') && courseGet.includes("const runIdParam = String(url.searchParams.get('runId') || '').trim();") && courseGet.includes('runId requires jobId') && courseGet.includes('readSavedCourseForUser(supabase, user.id, courseId, jobId, runId)') && courseGet.includes('coursePayloadBelongsToJob(result.data.payload, jobId, runId)') && courseGet.includes('return { data: null, error: null };') && read('scripts/test-course-get.mjs').includes('other-job') && read('scripts/test-course-get.mjs').includes('run-new') && read('scripts/test-course-get.mjs').includes("requireSafeCourseId('code-for-designers_2026')"));
assert('runner job writes are owner scoped', runner.includes(".eq('id', jobId).eq('owner_id', ownerId)") || runner.includes(".eq('id', jobId)\n        .eq('owner_id', ownerId)"));
assert('review transitions are owner scoped', review.includes('updateJobFromStatus(supabase, jobId, user.id') && review.includes(".eq('owner_id', ownerId)"));
assert('resume transition is owner scoped', resume.includes(".eq('owner_id', user.id)") && resume.includes('RECOVERABLE_STATUSES'));
assert('restart transition is owner scoped', restart.includes(".eq('owner_id', user.id)") && restart.includes('RECOVERABLE_STATUSES') && restart.includes("admin = serviceClient"));
assert('cancel and delete are owner scoped', cancel.includes(".eq('owner_id', user.id)") && deleteJob.includes('p_owner_id: user.id') && migration.includes('and owner_id = p_owner_id'));
assert('cancel endpoint only cancels the exact active or review-paused run it inspected', cancel.includes('CANCELLABLE_GENERATION_STATUSES') && cancel.includes(".select('status,run_id')") && cancel.includes(".eq('status', job.status)") && cancel.includes('sameRunFilter(query, job.run_id)') && !cancel.includes(".in('status', CANCELLABLE_GENERATION_STATUSES)") && cancel.includes('only active or review-paused jobs can be cancelled') && read('scripts/test-gen-cancel-storage.mjs').includes("cancel.includes('sameRunFilter(query, job.run_id)')"));
assert('cancel endpoint signals active jobs before terminal cleanup', cancel.includes('ACTIVE_GENERATION_STATUSES.includes(job.status)') && cancel.includes('generationCancelLeaseFields()') && cancel.includes('generationCancelledTerminalFields()') && cancel.includes("data.status === 'cancelled'") && cancel.indexOf('generationCancelLeaseFields()') < cancel.indexOf("data.status === 'cancelled'"));
assert('cancel cleanup runs only after terminal cancellation', cancel.includes("import { removePdfUploadsForJob } from './delete.js'") && cancel.includes('deletedUploads') && cancel.includes("data.status === 'cancelled'") && runner.includes("import { removePdfUploadsForJob } from '../gen/delete.js';") && runner.includes('await removePdfUploadsForJob(supabase, ownerId, jobId);') && watchdog.includes('markExpiredCancellingJobsCancelled(supabase, { ownerId, now })') && watchdog.includes('removePdfUploadsForJob(supabase, row.owner_id, row.id)') && sweep.slice(sweep.indexOf('export async function markExpiredJobs'), sweep.indexOf('export async function markExpiredCancels')).includes(".select('id,owner_id,run_id,error,message,continuation')") && sweep.slice(sweep.indexOf('export async function markExpiredJobs'), sweep.indexOf('export async function markExpiredCancels')).includes('sameRunFilter(update, row.run_id)') && !sweep.slice(sweep.indexOf('export async function markExpiredJobs'), sweep.indexOf('export async function markExpiredCancels')).includes('removePdfUploadsForJob') && sweep.slice(sweep.indexOf('export async function markExpiredCancels'), sweep.indexOf('async function loadTimedOutJobs')).includes(".select('id,owner_id')") && sweep.slice(sweep.indexOf('export async function markExpiredCancels'), sweep.indexOf('async function loadTimedOutJobs')).includes('if (!data) continue;') && sweep.slice(sweep.indexOf('export async function markExpiredCancels'), sweep.indexOf('async function loadTimedOutJobs')).includes('removePdfUploadsForJob(supabase, row.owner_id, row.id)'));
assert('delete endpoint refuses active cloud jobs', deleteJob.includes('JOB_NOT_DELETABLE') && deleteJob.includes('cancel active jobs before deleting them') && migration.includes("v_status not in ('review_curriculum', 'review_research', 'partial', 'failed', 'timed_out', 'cancelled', 'completed')"));
assert('delete endpoint uses atomic database cleanup', deleteJob.includes("rpc('delete_generation_job_at_checkpoint'") && deleteJob.includes("p_expected_status: expected.status") && deleteJob.includes("p_expected_run_id: expected.runId") && read('db/18-generation-action-checkpoints.sql').includes("public.delete_generation_job_at_checkpoint") && migration.includes('create or replace function public.delete_generation_job_for_owner') && migration.includes('for update'));
assert('delete endpoint removes only job-stamped saved account courses with the job', migration.includes('delete from public.user_courses') && migration.includes("payload->>'_generationJobId' = p_job_id") && migration.includes('order by (uc.id = v_saved_course_id) desc, uc.updated_at desc') && !migration.includes('id = deleted_course_id') && deleteJob.includes('deletedCourseId') && read('scripts/test-library-delete-cloud-job.mjs').includes('before saved_course_id was finalized'));
assert('delete endpoint removes uploaded PDFs for the job prefix', deleteJob.includes('removePdfUploadsForJob') && deleteJob.includes("storage.from('course-uploads')") && deleteJob.includes('pdfUploadPrefixForJob(ownerId, jobId)') && deleteJob.includes('deletedUploads') && deleteJob.includes("if (!data) {\n    const deletedUploads = await removePdfUploadsForJob(supabase, user.id, jobId);\n    return res.status(404).json({ error: 'Job not found', deletedUploads });\n  }") && read('scripts/test-gen-delete-storage.mjs').includes('durable job row is already gone'));
assert('cloud claim endpoints mint run leases before invoking runner', start.includes("import { randomUUID } from 'node:crypto'") && start.includes('run_id: runId') && start.includes('runId,') && resume.includes('run_id: runId') && restart.includes('run_id: runId') && review.includes('run_id: runId') && sweep.includes('run_id: runId'));
assert('cloud generation endpoints validate browser-supplied job ids', supabaseServer.includes('export function requireSafeJobId') && supabaseServer.includes('/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)') && start.includes('requestedJobId = requireSafeJobId(body.jobId)') && start.indexOf('requestedJobId = requireSafeJobId(body.jobId)') < start.indexOf('apiKey = await readApiKey') && [resume, restart, review, cancel, deleteJob, credentialsReady].every(source => source.includes('requireSafeJobId')) && read('scripts/test-cloud-job-id-validation.mjs').includes('web/api/gen/credentials-ready.js') && read('scripts/test-cloud-job-id-validation.mjs').includes('cloud job id validation tests passed'));
assert('cloud start and restart validate uploaded PDF refs before durable mutation', supabaseServer.includes('export function requirePdfRefsBelongToJob') && supabaseServer.includes("const expectedPrefix = `${ownerId}/${jobId}/`;") && supabaseServer.includes('path.includes(\'..\')') && start.includes('requirePdfRefsBelongToJob(pdfRefs, { ownerId: user.id, jobId })') && start.indexOf('requirePdfRefsBelongToJob(pdfRefs, { ownerId: user.id, jobId })') < start.indexOf('apiKey = await readApiKey') && start.indexOf('requirePdfRefsBelongToJob(pdfRefs, { ownerId: user.id, jobId })') < start.indexOf("supabase.from('generation_jobs').insert") && restart.includes('requirePdfRefsBelongToJob(userBrief.pdfRefs || [], { ownerId: user.id, jobId })') && restart.indexOf('requirePdfRefsBelongToJob(userBrief.pdfRefs || [], { ownerId: user.id, jobId })') < restart.indexOf('apiKey = await readApiKey') && restart.indexOf('requirePdfRefsBelongToJob(userBrief.pdfRefs || [], { ownerId: user.id, jobId })') < restart.indexOf(".from('generation_jobs')\n    .update") && read('scripts/test-cloud-job-id-validation.mjs').includes('owner-2/job-1/0-source.pdf') && read('scripts/test-cloud-job-id-validation.mjs').includes('Invalid pdfRefs'));
assert('generation job writes use server service role', start.includes("admin = serviceClient") && resume.includes("admin = serviceClient") && restart.includes("admin = serviceClient") && review.includes("admin = serviceClient") && cancel.includes('serviceClient()') && deleteJob.includes('serviceClient()') && read('web/api/gen/watchdog.js').includes('serviceClient()'));
assert('base RLS leaves generation_jobs to the agentic workflow migration', rls.includes('generation_jobs is owned by db/04-agentic-workflow.sql') && !rls.includes('on public.generation_jobs'));
assert('client RLS cannot mutate generation job state machine', migration.includes('create policy "Owners read their jobs"') && migration.includes('on public.generation_jobs for select') && !migration.includes('create policy "Owners insert their jobs"') && !migration.includes('create policy "Owners update their jobs"') && !migration.includes('create policy "Owners delete their jobs"'));

assert('shared recovery policy chooses mode by saved checkpoint', recovery.includes('export function resumeModeFor') && recovery.includes("return 'curriculum'") && recovery.includes("return 'research'") && recovery.includes("return 'complete'") && recovery.includes('export function recoveryModeFor') && recovery.includes('hasPendingRestartIntent(job)') && recovery.includes('export function recoveryCheckpointForJob') && recovery.includes('export function recoveryStageFor') && read('scripts/test-gen-recovery.mjs').includes('pendingRestartCheckpoint'));
assert('shared recovery policy caps automatic retries', recovery.includes('MAX_AUTO_RECOVERY_ATTEMPTS') && recovery.includes('canAutoRecover') && sweep.includes('canAutoRecover(job)') && sweep.includes('recovery_attempts: recoveryAttemptsFor(job) + 1'));
assert('automatic recovery failures stay timed-out through retry budget', recovery.includes('export function autoRecoveryFailurePatch') && recovery.includes('export function autoRecoveryExhaustedPatch') && recovery.includes('export const AUTO_RECOVERY_EXHAUSTED_ERROR') && recovery.includes('recovery_attempts: attempted') && recovery.includes('autoRecoveryRetryMessage(job)') && recovery.includes('autoRecoveryPausedMessage(job)') && recovery.includes("status: 'timed_out'") && recovery.includes('willRetry') && recovery.includes('Learnable will retry from the saved checkpoint') && recovery.includes('Learnable will retry from the saved request') && sweep.includes('AUTO_RECOVERY_EXHAUSTED_ERROR') && sweep.includes('autoRecoveryFailurePatch(job, err)') && sweep.includes('autoRecoveryExhaustedPatch(row, now)') && sweep.includes("const RECOVERY_WRITABLE_STATUSES = ['running', 'failed'];") && sweep.includes(".eq('run_id', runId)") && sweep.includes(".in('status', RECOVERY_WRITABLE_STATUSES)") && sweep.includes(".select('id,owner_id,run_id,error,message,continuation')") && sweep.split(".neq('error', AUTO_RECOVERY_EXHAUSTED_ERROR)").length - 1 >= 2 && sweep.includes('sameRunFilter(query, row.run_id)') && read('scripts/test-cloud-auto-recovery-retry.mjs').includes('manually restart from the saved request') && read('scripts/test-cloud-auto-recovery-retry.mjs').includes('automatic recovery failures should not immediately become hard failed jobs.'));
assert('shared recovery policy owns timeout patches for every timeout path', recovery.includes('export function timeoutPatch') && recovery.includes('Generation timed out while restarting. You can restart from the saved request.') && recovery.includes('restart(?:ing)? from (?:the |your )?saved request') && start.includes('timeoutPatch(job, now)') && start.includes(".select('id,status,run_id,lease_expires_at,user_brief,error,message')") && sweep.includes('timeoutPatch(row, now)') && sweep.includes(".select('id,owner_id,run_id,error,message,continuation')") && watchdog.includes('timeoutPatch(row, now)') && watchdog.includes(".select('id,owner_id,run_id,error,message,continuation')") && read('scripts/test-gen-recovery.mjs').includes('Curriculum Designer is restarting from your saved request'));
assert('resume endpoint uses shared recovery policy', resume.includes("from '../_lib/gen-recovery.mjs'") && resume.includes('checkpointForJob(job)'));
assert('resume claim persists the recovered stage immediately', resume.includes('stage: resumeStageFor(job)') && resume.indexOf('stage: resumeStageFor(job)') < resume.indexOf("message: agentMessage(resumeStageFor(job)"));
assert('manual resume persists missing-key recovery context', resume.includes('await markRecoverableWaitingForApiKey(supabase, jobId, user.id, job.status, job.run_id') && resume.includes('export async function markRecoverableWaitingForApiKey') && resume.includes('Generation is waiting for an Anthropic API key. Add one to your account, then resume from the saved checkpoint.') && resume.includes(".eq('status', expectedStatus)") && resume.includes('sameRunFilter(query, expectedRunId)') && resume.includes(".select('id')") && resume.includes('.maybeSingle()') && resume.includes('if (!marked) return res.status(409)') && read('scripts/test-gen-recovery.mjs').includes('manual resume should persist missing-key recovery context'));
assert('manual recovery claims are exact-status-and-run guarded', resume.includes(".eq('status', job.status)") && resume.includes('sameRunFilter(transitionQuery, job.run_id)') && restart.includes(".eq('status', job.status)") && restart.includes('sameRunFilter(transitionQuery, job.run_id)') && !resume.includes(".in('status', RECOVERABLE_STATUSES)") && !restart.includes(".in('status', RECOVERABLE_STATUSES)") && read('scripts/test-gen-recovery.mjs').includes('manual resume should only claim the exact recoverable status and run it inspected') && read('scripts/test-gen-restart.mjs').includes('restart should only claim the exact recoverable status and run it inspected'));
assert('restart endpoint keeps source and human checkpoint context while clearing generated checkpoints', restart.includes('export function appendRestartFeedback') && restart.includes('export function collectRestartHumanFeedback') && restart.includes('job.review_history') && restart.includes('checkpointBrief: job.brief') && restart.includes('Prior human review feedback') && restart.includes('restartCheckpointForBriefs(originalBrief, userBrief, job.extracted_urls || [])') && restart.includes('extracted_urls: checkpoint.extracted_urls') && restart.includes('brief: null') && restart.includes('research: {}') && restart.includes('topics_by_key: {}') && restart.includes("mode: 'curriculum'"));
assert('restart endpoint persists durable restart history', restart.includes('appendReviewHistory') && restart.includes("action: 'restart_generation'") && restart.includes('feedback: restartFeedback') && restart.includes('fromStatus: job.status') && restart.includes('runId') && restart.includes('latestRestartFeedback(job.review_history)') && read('scripts/test-gen-restart.mjs').includes('saved pending restart feedback') && read('scripts/test-gen-review-history.mjs').includes('actual-run'));
assert('restart endpoint persists pending restart intent when API key is missing', restart.includes('await markRestartWaitingForApiKey(supabase, jobId, user.id, job.status, job.run_id') && restart.includes('export async function markRestartWaitingForApiKey') && restart.includes('Generation is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.') && restart.includes(".eq('status', expectedStatus)") && restart.includes('sameRunFilter(query, expectedRunId)') && restart.includes(".select('id')") && restart.includes('.maybeSingle()') && restart.includes('if (!marked) return res.status(409)') && restart.includes('user_brief: userBrief') && restart.includes('extracted_urls: extractedUrls') && restart.includes('review_history: reviewHistory') && read('scripts/test-gen-restart.mjs').includes('restart should persist a pending restart intent'));
assert('restart endpoint can replace broken source refs while preserving restart context', restart.includes('const replacementBrief = body.brief') && restart.includes('mergeRestartBrief(originalBrief, replacementBrief)') && restart.includes('pdfRefs: Array.isArray(replacementBrief.pdfRefs)') && restart.includes('export function restartCheckpointForBriefs'));
assert('restart endpoint does not erase original notes or URLs when replacement fields are blank', restart.includes('const replacementSourceText = String(replacementBrief.source_text || \'\').trim();') && restart.includes('const replacementUrls = Array.isArray(replacementBrief.source_urls)') && restart.includes('source_text: replacementSourceText || existingBrief.source_text') && restart.includes('source_urls: replacementUrls.length') && restart.includes(': (existingBrief.source_urls || [])'));
assert('restart endpoint dedupes repeated human feedback before appending to source text', restart.includes('function restartFeedbackBlock') && restart.includes('export function dedupeFeedbackAlreadyInSource') && restart.includes('function stripKnownFeedbackLabel') && restart.includes('.filter(block => block && !sourceText.includes(block))') && read('scripts/test-gen-restart.mjs').includes('const repeatedRestart = appendRestartFeedback') && read('scripts/test-gen-restart.mjs').includes('const repeatedDurableRestart'));
assert('sweep endpoint uses shared recovery policy', sweep.includes("from '../_lib/gen-recovery.mjs'") && sweep.includes('recoveryCheckpointForJob(job)') && sweep.includes('recoveryModeFor(job)') && sweep.includes('hasPendingRestartIntent(job)'));
assert('sweep claim persists the recovered stage immediately', sweep.includes('const stage = recoveryStageFor(job);') && sweep.includes('stage,') && sweep.indexOf('const stage = recoveryStageFor(job);') < sweep.indexOf("message: pendingRestart"));
assert('sweep pending restart recovery clears stale checkpoints', sweep.includes('const pendingRestart = hasPendingRestartIntent(job);') && sweep.includes("message: pendingRestart") && sweep.includes("user_brief: job.user_brief || {}") && sweep.includes('brief: null') && sweep.includes('outline: null') && sweep.includes('research: {}') && sweep.includes('topics_by_key: {}') && sweep.includes('Automatic recovery is waiting for an Anthropic API key. Add one, then restart from the saved request.') && read('scripts/test-gen-recovery.mjs').includes('restarting from the saved request'));
assert('sweep preflights API key before claiming recovery jobs', sweep.includes('async function preflightRecoveryCredentials') && sweep.includes("await preflightRecoveryCredentials(supabase, job, requestBudget)") && sweep.includes('const marked = await markRecoveryWaitingForApiKey(supabase, job, preflight.error);') && sweep.indexOf('await preflightRecoveryCredentials(supabase, job, requestBudget)') < sweep.indexOf('await claimTimedOutJob(supabase, job)') && sweep.includes(".eq('status', 'timed_out')") && sweep.includes('sameRunFilter(query, job.run_id)') && sweep.includes(".select('id')") && sweep.includes('.maybeSingle()') && read('scripts/test-gen-recovery.mjs').includes("await preflightRecoveryCredentials(supabase, job, requestBudget)"));
assert('sweep timed-out recovery claims are status-and-run guarded', sweep.includes('export async function claimTimedOutJob') && sweep.includes('export async function markRecoveryWaitingForApiKey') && sweep.includes('sameRunFilter(query, job.run_id)') && read('scripts/test-gen-recovery.mjs').includes('run-timed-out') && read('scripts/test-cloud-auto-recovery-retry.mjs').includes('claim and mark only the exact timed-out run it inspected'));
assert('sweep expiry transitions are exact-run guarded', sweep.includes('export async function markExpiredJobs') && sweep.includes('export async function markExpiredCancels') && sweep.includes(".select('id,owner_id,run_id,error,message,continuation')") && sweep.includes('timeoutPatch(row, now)') && sweep.includes('sameRunFilter(update, row.run_id)') && sweep.includes('if (!data) continue;') && read('scripts/test-cloud-sweep-expiry-scope.mjs').includes('cloud sweep expiry scope tests passed'));
assert('resume refuses direct resume while waiting for human review', resume.includes('isReviewStatus(job.status)') && resume.includes('Use the review action instead of resume'));
assert('resume is limited to recoverable terminal states', recovery.includes("['failed', 'timed_out', 'partial']") && resume.includes('RECOVERABLE_STATUSES'));
assert('review transitions are status-and-run guarded', read('web/api/gen/review.js').includes('export async function updateJobFromStatus') && review.includes('sameRunFilter(query, expectedRunId)') && read('scripts/test-gen-review-transitions.mjs').includes('checkpoint-run') && read('scripts/test-gen-review-transitions.mjs').includes('run_id'));
assert('start endpoint is idempotent for duplicate job ids', start.includes("insertErr.code === '23505'") && start.includes('existing: true') && start.includes('pdfRefs: existing.user_brief?.pdfRefs || []') && start.includes('if (!existingErr && !existing)') && start.includes('return res.status(409).json({') && start.includes('its id is already in use') && read('scripts/test-gen-start-idempotency.mjs').includes('its id is already in use'));
assert('start endpoint expires stale duplicate jobs before rehydration', start.includes('export async function expireExistingJobIfStale') && start.includes(".lt('lease_expires_at', now)") && start.includes('timeoutPatch(job, now)') && start.includes('generationCancelledTerminalFields(new Date(nowMs))'));
assert('start duplicate stale expiry is exact-run guarded', start.includes(".select('id,status,run_id,lease_expires_at,user_brief,error,message')") && start.includes('sameRunFilter(query, job.run_id)') && read('scripts/test-gen-start-idempotency.mjs').includes('run-stale-running') && read('scripts/test-gen-start-idempotency.mjs').includes("call.type === 'is' && call.field === 'run_id'"));
assert('start duplicate stale cancel cleanup removes uploads', start.includes("import { removePdfUploadsForJob } from './delete.js';") && start.includes("if (data?.status === 'cancelled')") && start.includes('await removePdfUploadsForJob(supabase, ownerId, job.id);') && read('scripts/test-gen-start-idempotency.mjs').includes('stale-cancel path'));
assert('sweep endpoint is secret protected', sweep.includes('hasSweepSecret') && sweep.includes('CRON_SECRET'));
assert('sweep resumes timed-out jobs only', sweep.includes(".eq('status', 'timed_out')") && sweep.includes("eq('status', 'timed_out')"));
assert('sweep stops automatic recovery after repeated attempts', sweep.includes(".lt('recovery_attempts', MAX_AUTO_RECOVERY_ATTEMPTS)") && sweep.includes('export async function markRecoveryExhausted') && sweep.includes('autoRecoveryExhaustedPatch(row, now)') && sweep.split(".neq('error', AUTO_RECOVERY_EXHAUSTED_ERROR)").length - 1 >= 2 && sweep.includes('sameRunFilter(query, row.run_id)'));
assert('sweep uses service client and same runner', sweep.includes('serviceClient') && sweep.includes('runGeneration'));
assert('sweep does not revive cancelling jobs', sweep.includes('LIVE_GENERATION_STATUSES') && sweep.includes('markExpiredCancels'));
assert('sweep recovery failure cannot overwrite newer user-owned states', sweep.includes("const RECOVERY_WRITABLE_STATUSES = ['running', 'failed']") && sweep.includes(".eq('owner_id', job.owner_id)") && sweep.includes(".eq('run_id', runId)") && sweep.includes(".in('status', RECOVERY_WRITABLE_STATUSES)"));
assert('sweep prunes old cancelled jobs through atomic cleanup', sweep.includes('const CANCELLED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;') && sweep.includes('export async function pruneOldCancelledJobs') && sweep.includes("eq('status', 'cancelled')") && sweep.includes("rpc('delete_generation_job_for_owner'") && sweep.includes('removePdfUploadsForJob(supabase, row.owner_id, row.id)') && read('scripts/test-cloud-cancelled-retention.mjs').includes('cloud cancelled retention tests passed'));
assert('vercel cron calls cloud sweeper on a Hobby-compatible daily schedule', vercel.includes('"/api/gen/sweep"') && vercel.includes('"0 0 * * *"'));

assert('migration has durable review statuses', migration.includes("'review_curriculum'") && migration.includes("'review_research'"));
assert('migration self-heals user_state for cloud API keys', migration.includes('create table if not exists public.user_state') && migration.includes('state jsonb not null default') && migration.includes('alter table public.user_state enable row level security') && migration.includes('create policy "Users update own state"'));
assert('migration has account course timestamps', migration.includes('created_at timestamptz not null default now()') && migration.includes('alter table public.user_courses add column if not exists created_at'));
assert('migration has generation job timestamps expected by health checks', migration.includes('created_at timestamptz not null default now()') && migration.includes('started_at timestamptz not null default now()') && migration.includes('alter table public.generation_jobs add column if not exists created_at') && migration.includes('alter table public.generation_jobs add column if not exists started_at'));
assert('migration has heartbeat lease columns', migration.includes('heartbeat_at') && migration.includes('lease_expires_at') && migration.includes('completed_at'));
assert('migration has per-run lease token column', migration.includes('run_id text') && migration.includes('add column if not exists run_id text'));
assert('migration has automatic recovery accounting columns', migration.includes('recovery_attempts int not null default 0') && migration.includes('last_recovery_at timestamptz'));
assert('migration has durable human review history column', migration.includes("review_history jsonb not null default '[]'::jsonb") && migration.includes('add column if not exists review_history jsonb'));
assert('migration has extracted URL checkpoint column', migration.includes('extracted_urls jsonb'));
assert('migration removes stale generation job write policies', migration.includes('stale_policy') && migration.includes("cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')") && migration.includes("drop policy if exists %I on public.generation_jobs"));
assert('repair migration removes stale generation job write policies without touching constraints', policyRepairMigration.includes("cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')") && policyRepairMigration.includes("drop policy if exists %I on public.generation_jobs") && !policyRepairMigration.includes('add constraint'));
assert('migration is rerunnable for generation job policies', migration.includes('drop policy if exists "Owners update their jobs" on public.generation_jobs'));
assert('migration refreshes generation job status and stage constraints on rerun', migration.includes('drop constraint if exists generation_jobs_status_check') && migration.includes('drop constraint if exists generation_jobs_stage_check') && ['intake', 'research', 'topics', 'assemble', 'done'].every(stage => migration.includes(`'${stage}'`)));
assert('migration enforces safe generation job ids', migration.includes('generation_jobs_id_safe_check') && migration.includes("id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'") && migration.includes("'job_id_constraint'") && migration.includes("pg_get_constraintdef(oid) like '%A-Za-z0-9%'") && read('scripts/test-cloud-job-id-validation.mjs').includes('cloud job id validation tests passed'));
assert('migration enforces sane generation counters', migration.includes('generation_jobs_counters_check') && migration.includes('recovery_attempts = greatest(0, recovery_attempts)') && migration.includes('topics_total = greatest(greatest(0, topics_total), greatest(0, topics_done))') && migration.includes('recovery_attempts >= 0') && migration.includes('topics_done <= topics_total') && migration.includes("'counter_constraint'") && migration.includes("pg_get_constraintdef(oid) like '%topics_done <= topics_total%'"));
assert('migration enforces completion timestamps by terminal status', migration.includes('generation_jobs_completion_check') && migration.includes("set completed_at = null") && migration.includes("status in ('queued', 'running', 'review_curriculum', 'review_research', 'cancelling')") && migration.includes("status in ('completed', 'partial', 'failed', 'cancelled', 'timed_out')") && migration.includes('completed_at is null') && migration.includes('completed_at is not null') && migration.includes("'completion_constraint'") && migration.includes("lower(pg_get_constraintdef(oid)) like '%completed_at is not null%'"));
assert('migration self-heals updated_at trigger helper', migration.includes('create or replace function public.set_updated_at()') && migration.includes('new.updated_at = now();') && migration.includes('generation_jobs_set_updated_at'));
assert('migration exposes service-role workflow health RPC', migration.includes('create or replace function public.generation_workflow_health()') && migration.includes('generation_jobs_status_check') && migration.includes('generation_jobs_stage_check') && migration.includes('generation_jobs_id_safe_check') && migration.includes('generation_jobs_counters_check') && migration.includes('generation_jobs_completion_check') && migration.includes('generation_jobs_rls_enabled') && migration.includes('generation_jobs_no_write_policies') && migration.includes('generation_jobs_updated_at_trigger') && migration.includes('pg_trigger') && migration.includes('generation_jobs_set_updated_at') && migration.includes('user_state_rls_enabled') && migration.includes('user_state_owner_policies') && migration.includes('course_uploads_owner_policy') && migration.includes("qual like '%storage.foldername(name)%'") && migration.includes("with_check like '%storage.foldername(name)%'") && migration.includes('user_courses_owner_key') && migration.includes("array['id', 'owner_id']") && migration.includes('delete_generation_job_rpc_service_only') && migration.includes("p.prosecdef = true") && migration.includes("has_function_privilege('service_role', 'public.delete_generation_job_for_owner(text, uuid)', 'EXECUTE')") && migration.includes("not has_function_privilege('authenticated', 'public.delete_generation_job_for_owner(text, uuid)', 'EXECUTE')") && migration.includes('grant execute on function public.generation_workflow_health() to service_role') && migration.includes('revoke all on function public.generation_workflow_health() from authenticated'));
assert('migration restricts atomic delete RPC to service role', migration.includes('grant execute on function public.delete_generation_job_for_owner(text, uuid) to service_role') && migration.includes('revoke all on function public.delete_generation_job_for_owner(text, uuid) from authenticated'));
assert('migration avoids legacy generation_jobs index-name collisions', migration.includes('generation_jobs_v2_owner_idx') && migration.includes('create index if not exists generation_jobs_v2_status_idx'));

assert('intake routes review approvals to cloud endpoint', intake.includes('submitCloudReview') && intake.includes('approve_curriculum') && intake.includes('approve_research'));
assert('intake routes review revisions to cloud endpoint', intake.includes('revise_curriculum') && intake.includes('rerun_research'));
assert('intake shows durable checkpoint feedback history', intake.includes('function reviewHistoryHTML(history = [])') && intake.includes('Previous feedback') && intake.includes('reviewActionLabel(entry.action)') && intake.includes('curriculumReviewHTML(job.review?.brief, job.reviewHistory || [], job.reviewPending)') && intake.includes('researchReviewHTML(job, job.reviewHistory || [], job.reviewPending)') && read('scripts/test-research-review-ui.mjs').includes('reviewHistoryHTML'));
assert('intake disables research approval until every module has research', intake.includes("const evidence = researchEvidence(job);") && intake.includes("const hasCompleteResearch = evidence.complete;") && read('web/js/research-evidence.js').includes("complete: modules.length > 0 && missing === 0") && intake.includes('continueDisabled: !hasCompleteResearch') && intake.includes("Rerun incomplete research before lesson writing."));
assert('intake review action failures do not discard checkpoints', intake.includes("catch (err) { updateJob(jobId, { reviewPending: null, error: err.message || String(err),") && intake.includes("err.code === 'GENERATION_CHANGED' && feedback.trim() ? { reviewRecovery: { feedback } }") && !intake.includes("catch (err) { updateJob(jobId, { status: 'failed', error: err.message || String(err) }); }"));
assert('intake flushes API key before cloud start', intake.includes('await flushSync()') && intake.indexOf('await flushSync()') < intake.indexOf('startReviewableGeneration(job.id, userBrief'));
assert('intake pulls account API key before missing-key rejection', sync.includes('export async function pullSyncNow') && intake.includes('await pullSyncNow();') && intake.indexOf('await pullSyncNow();') < intake.indexOf("err.textContent = 'An Anthropic API key is required.'"));
assert('intake checks cloud backend readiness before creating or reusing job cards', intake.includes('await requireCloudBackendReady({ force: true })') && intake.indexOf('await requireCloudBackendReady({ force: true })') < intake.indexOf('const reusableJobId = reuseJobIdForSubmit'));
assert('sync exposes immediate flush for cloud generation key race', sync.includes('export async function flushSync') && sync.includes('throwOnError') && sync.includes('if (error) throw error'));
assert('sync isolates API keys and first pull across account switches',
  sync.includes("let currentSyncUserId = null;") &&
  sync.includes("getUser()?.id === context.owner && currentSyncUserId === context.owner && store.scope().epoch === context.epoch") &&
  sync.includes("if (next !== currentSyncUserId) {") &&
  sync.includes("clearPendingPush();") &&
  sync.includes("clearAllProviderKeys();") &&
  sync.includes("store.setOwner(next);") &&
  sync.includes("queue = Promise.resolve(); revision++;") &&
  sync.includes("if (!isCurrent(context)) return;") &&
  sync.includes("store.applyRemote(data?.state || {}, context);") &&
  sync.includes("writeLearningSnapshot(client, context.owner, store.exportSnapshot(), {") &&
  sync.includes("isCurrent: () => isCurrent(context), providerKeys: getAllProviderKeys()") &&
  sync.includes("if (!state || !isCurrent(context)) return;") &&
  read('scripts/test-sync-account-boundary.mjs').includes("await import('./test-sync-learning.mjs');") &&
  read('scripts/test-sync-learning.mjs').includes("late A pull cannot replace B progress or provider keys") &&
  read('scripts/test-sync-learning.mjs').includes("initial account cannot inherit guest progress") &&
  read('scripts/test-sync-learning.mjs').includes("sign-out clears scheduled writes, keys and account view"));
assert('provider API keys are user-configurable and future-provider ready', apiKeys.includes('API_KEY_PROVIDERS') && apiKeys.includes("'anthropic'") && apiKeys.includes("'openai'") && apiKeys.includes("'google'") && apiKeys.includes('https://platform.openai.com/api-keys') && apiKeys.includes('https://aistudio.google.com/apikey') && auth.includes('Model API keys') && auth.includes('Temporary testing setup: you bring your own provider keys.') && auth.includes('Dashboard') && auth.includes('How to create a key') && sync.includes("setAllProviderKeys({ ...(remote._apiKeys || {}), ...(remote._apiKey ? { anthropic: remote._apiKey } : {}), ...getAllProviderKeys() });") && supabaseServer.includes('export async function readProviderApiKey') && supabaseServer.includes('data?.state?._apiKeys?.[provider]') && generatorIndex.includes('getAnthropicKey'));
assert('course generation token usage is captured and shown in the library', tokenUsage.includes('export function createTokenUsageLedger') && tokenUsage.includes('export function recordTokenUsage') && tokenUsage.includes('cache_creation_input_tokens') && runner.includes('createTokenUsageLedger()') && runner.includes('recordTokenUsage(tokenUsage') && runner.includes('compactTokenUsage(tokenUsage)') && courseSave.includes('_tokenUsage: tokenUsage || priorPayload?._tokenUsage || null') && courseLoader.includes('tokenUsage: c._tokenUsage || null') && app.includes('function tokenUsageLabel') && app.includes('Approximate tokens consumed while generating this course') && read('scripts/test-token-usage.mjs').includes('token usage tests passed'));
assert('AI model routing is centralized and exposed through cloud health', aiModels.includes('export function getAiModelRegistry') && aiModels.includes('LEARNABLE_AI_TEXT_MODEL') && aiModels.includes('curriculum') && aiModels.includes('research') && aiModels.includes('lesson') && aiModels.includes('image') && aiModels.includes('search') && runner.includes('getAiModelRegistry()') && runner.includes('assertCloudGenerationModelSupport(aiModels)') && runner.includes('model: aiModels.curriculum.model') && runner.includes('model: aiModels.research.model') && runner.includes('model: aiModels.lesson.model') && read('web/api/health/cloud.js').includes('publicAiModelRegistry()') && read('scripts/test-ai-model-config.mjs').includes('AI model config tests passed'));
assert('generation stage model names are injected from task config', read('web/js/generator/stages/intake.mjs').includes("modelForTask('curriculum')") && read('web/js/generator/stages/research.mjs').includes("modelForTask('research')") && read('web/js/generator/stages/topic.mjs').includes("modelForTask('lesson')") && !read('web/js/generator/stages/intake.mjs').includes("model: 'claude-sonnet") && !read('web/js/generator/stages/research.mjs').includes("model: 'claude-sonnet") && !read('web/js/generator/stages/topic.mjs').includes("model: 'claude-sonnet"));
const browserGraph = app + intake + cloud + courseSync + courseLoader + userCourses + search + sync + read('web/index.html') + auth + apiKeys + read('web/js/chat.js') + read('web/js/flashcards.js') + read('web/js/components/topic-view.js') + read('web/js/components/sidebar.js');
assert('browser module graph has no unversioned dynamic js imports', !/import\(['"]\.\/[^'"]+\.js['"]\)/.test(browserGraph));
assert('browser module graph has no URL extraction fallback endpoint', !browserGraph.includes('/api/fetch-url') && !browserGraph.includes('fetchExtractedUrls'));
const staleImports = [
  'sync.js?v=4',
  'sync.js?v=5',
  'sync.js?v=6',
  'sync.js?v=7',
  'sync.js?v=8',
  'sync.js?v=9',
  'sync.js?v=10',
  'sync.js?v=11',
  'sync.js?v=13',
  'sync.js?v=14',
  'sync.js?v=15',
  'sync.js?v=16',
  'sync.js?v=17',
  'sync.js?v=18',
  'auth.js?v=9',
  'auth.js?v=10',
  'auth.js?v=11',
  'auth.js?v=12',
  'auth.js?v=13',
  'auth.js?v=14',
  'auth.js?v=15',
  'auth.js?v=16',
  'auth.js?v=17',
  'auth.js?v=18',
  'auth.js?v=21',
  'auth.js?v=22',
  'auth.js?v=23',
  'auth.js?v=24',
  'auth.js?v=25',
  'course-sync.js?v=5',
  'course-sync.js?v=6',
  'course-sync.js?v=7',
  'course-sync.js?v=8',
  'course-sync.js?v=9',
  'course-sync.js?v=10',
  'course-sync.js?v=11',
  'course-sync.js?v=12',
  'course-sync.js?v=13',
  'course-sync.js?v=14',
  'course-sync.js?v=15',
  'course-sync.js?v=16',
  'course-sync.js?v=17',
  'course-sync.js?v=18',
  'course-sync.js?v=19',
  'course-sync.js?v=20',
  'course-sync.js?v=21',
  'course-sync.js?v=22',
  'auth.js?v=19',
  'auth.js?v=20',
  'sync.js?v=12',
  "from './course-loader.js'",
  "from './user-courses.js'",
  "from './jobs.js'",
  'jobs.js?v=2',
  'cloud-gen-client.js?v=11',
  'cloud-gen-client.js?v=12',
  'cloud-gen-client.js?v=13',
  'cloud-gen-client.js?v=14',
  'cloud-gen-client.js?v=15',
  'cloud-gen-client.js?v=16',
  'cloud-gen-client.js?v=17',
  'cloud-gen-client.js?v=18',
  'cloud-gen-client.js?v=19',
  'cloud-gen-client.js?v=20',
  'cloud-gen-client.js?v=21',
  'cloud-gen-client.js?v=22',
  'cloud-gen-client.js?v=23',
  'cloud-gen-client.js?v=24',
  'cloud-gen-client.js?v=25',
  'cloud-gen-client.js?v=26',
  'cloud-gen-client.js?v=27',
  'cloud-gen-client.js?v=28',
  'cloud-gen-client.js?v=29',
  'cloud-gen-client.js?v=30',
  'cloud-gen-client.js?v=31',
  'cloud-gen-client.js?v=32',
  'cloud-gen-client.js?v=33',
  'cloud-gen-client.js?v=34',
  'cloud-gen-client.js?v=35',
  'cloud-gen-client.js?v=36',
  'cloud-gen-client.js?v=37',
  'cloud-gen-client.js?v=38',
  'cloud-gen-client.js?v=39',
  'cloud-gen-client.js?v=40',
  'cloud-gen-client.js?v=41',
  'cloud-gen-client.js?v=42',
  'cloud-gen-client.js?v=43',
  'cloud-gen-client.js?v=44',
  'cloud-gen-client.js?v=45',
  'cloud-gen-client.js?v=46',
  'cloud-gen-client.js?v=47',
  'cloud-gen-client.js?v=48',
  'cloud-gen-client.js?v=49',
  'cloud-gen-client.js?v=50',
  'cloud-gen-client.js?v=51',
  'cloud-gen-client.js?v=52',
  'cloud-gen-client.js?v=53',
  'cloud-gen-client.js?v=54',
  'cloud-gen-client.js?v=55',
  'cloud-gen-client.js?v=56',
  'cloud-gen-client.js?v=57',
  'cloud-gen-client.js?v=58',
  'cloud-gen-client.js?v=59',
  'cloud-gen-client.js?v=60',
  'cloud-gen-client.js?v=61',
  'cloud-gen-client.js?v=62',
  'cloud-gen-client.js?v=63',
  'cloud-gen-client.js?v=64',
  'cloud-gen-client.js?v=65',
  'cloud-gen-client.js?v=66',
  'cloud-gen-client.js?v=67',
  'cloud-gen-client.js?v=68',
  'cloud-gen-client.js?v=69',
  'cloud-gen-client.js?v=70',
  'cloud-gen-client.js?v=71',
  'cloud-gen-client.js?v=72',
  'cloud-gen-client.js?v=73',
  'cloud-gen-client.js?v=74',
  'cloud-gen-client.js?v=75',
  'cloud-gen-client.js?v=76',
  'cloud-gen-client.js?v=77',
  'cloud-gen-client.js?v=78',
  'intake.js?v=27',
  'intake.js?v=28',
  'intake.js?v=29',
  'intake.js?v=30',
  'intake.js?v=31',
  'intake.js?v=32',
  'intake.js?v=33',
  'intake.js?v=34',
  'intake.js?v=35',
  'intake.js?v=36',
  'intake.js?v=37',
  'intake.js?v=38',
  'intake.js?v=39',
  'intake.js?v=40',
  'intake.js?v=41',
  'intake.js?v=42',
  'intake.js?v=43',
  'intake.js?v=44',
  'intake.js?v=45',
  'intake.js?v=46',
  'intake.js?v=47',
  'intake.js?v=48',
  'intake.js?v=49',
  'intake.js?v=50',
  'intake.js?v=51',
  'intake.js?v=52',
  'intake.js?v=53',
  'intake.js?v=54',
  'intake.js?v=55',
  'intake.js?v=56',
  'intake.js?v=57',
  'intake.js?v=58',
  'intake.js?v=59',
  'intake.js?v=60',
  'intake.js?v=61',
  'intake.js?v=62',
  'intake.js?v=63',
  'intake.js?v=64',
  'intake.js?v=65',
  'intake.js?v=66',
  'intake.js?v=67',
  'intake.js?v=68',
  'intake.js?v=69',
  'intake.js?v=70',
  'intake.js?v=71',
  'intake.js?v=72',
  'intake.js?v=73',
  'chat.js?v=3',
  'chat.js?v=4',
  'chat.js?v=5',
  'chat.js?v=6',
  'chat.js?v=7',
  'chat.js?v=8',
  'chat.js?v=9',
  'chat.js?v=10',
  'chat.js?v=11',
  'chat.js?v=12',
  'chat.js?v=13',
  'chat.js?v=14',
  'chat.js?v=15',
  'flashcards.js?v=5',
  'flashcards.js?v=6',
  'flashcards.js?v=7',
  'flashcards.js?v=8',
  'flashcards.js?v=9',
  'flashcards.js?v=10',
  'flashcards.js?v=11',
  'flashcards.js?v=12',
  'flashcards.js?v=13',
  'flashcards.js?v=14',
  'flashcards.js?v=15',
  'flashcards.js?v=16',
  'flashcards.js?v=17',
  'topic-view.js?v=12',
  'topic-view.js?v=13',
  'topic-view.js?v=14',
  'topic-view.js?v=15',
  'topic-view.js?v=16',
  'topic-view.js?v=17',
  'topic-view.js?v=18',
  'topic-view.js?v=19',
  'topic-view.js?v=20',
  'topic-view.js?v=21',
  'topic-view.js?v=22',
  'topic-view.js?v=23',
  'topic-view.js?v=24',
  'topic-view.js?v=25',
  'topic-view.js?v=26',
  'app.js?v=53',
  'app.js?v=54',
  'app.js?v=55',
  'app.js?v=56',
  'app.js?v=57',
  'app.js?v=58',
  'app.js?v=59',
  'app.js?v=60',
  'app.js?v=61',
  'app.js?v=62',
  'app.js?v=63',
  'app.js?v=64',
  'app.js?v=65',
  'app.js?v=66',
  'app.js?v=67',
  'app.js?v=68',
  'app.js?v=69',
  'app.js?v=70',
  'app.js?v=71',
  'app.js?v=72',
  'app.js?v=73',
  'app.js?v=74',
  'app.js?v=75',
  'app.js?v=76',
  'app.js?v=77',
  'app.js?v=78',
  'app.js?v=79',
  'app.js?v=80',
  'app.js?v=81',
  'app.js?v=82',
  'app.js?v=83',
  'app.js?v=84',
  'app.js?v=85',
  'app.js?v=86',
  'app.js?v=87',
  'app.js?v=88',
  'app.js?v=89',
  'app.js?v=90',
  'app.js?v=91',
  'app.js?v=92',
  'app.js?v=93',
  'app.js?v=94',
  'app.js?v=95',
  'app.js?v=96',
  'app.js?v=97',
  'app.js?v=98',
  'app.js?v=99',
  'app.js?v=100',
  'app.js?v=101',
  'app.js?v=102',
  'app.js?v=103',
  'app.js?v=104',
  'app.js?v=105',
  'app.js?v=106',
  'app.js?v=107',
  'app.js?v=108',
  'app.js?v=109',
  'app.js?v=110',
  'app.js?v=111',
  'app.js?v=112',
  'app.js?v=113',
  'app.js?v=114',
  'app.js?v=115',
  'app.js?v=116',
  'app.js?v=117',
  'app.js?v=118',
  'app.js?v=119',
  'app.js?v=120',
  'app.js?v=121',
  'app.js?v=122',
  'app.js?v=123',
  'app.js?v=124',
  'course-loader.js?v=3'
];
assert('browser module graph has no stale sync/auth imports', staleImports.every(token => !browserGraph.includes(token)));

assert('grouped generation preserves the invocation clock before loading handlers',
  groupedRouter.includes("Object.defineProperty(req, Symbol.for('learnable.generation.startedAt')") &&
  groupedRouter.indexOf('value: now()') < groupedRouter.indexOf('await loaded.get(canonical)') &&
  requestBudget.includes("request?.[Symbol.for('learnable.generation.startedAt')]") &&
  [start, resume, restart, review, credentialsReady, sweep, read('web/api/setups/generate.js')]
    .every(source => source.includes('const requestBudget = createBudget({ request: req });')));

console.log('cloud architecture invariants verified');
