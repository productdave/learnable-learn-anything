// Real frontend model/renderer with synthetic job rows and DOM. No provider,
// database, browser network, deployment or existing-course mutation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { COURSE_AGENT_SEQUENCE, agentNameForStage, agentMessage } from '../web/js/generator/agents.mjs';
import { lifecycleSteps, jobPresentation } from '../web/js/home-model.js';
import { inspectSavedCourse } from '../web/js/course-readiness.js';
import { savedCourseReadinessHTML } from '../web/js/course-readiness-view.js';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { briefTitle } from '../web/js/brief-presentation.js';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';

const strip = source => source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '').replace(/^export /gm, '');
let assertions = 0;
const check = (condition, label) => { assert.ok(condition, label); assertions++; };
const now = Date.parse('2026-10-02T12:00:00Z');
class Clock extends Date { static now() { return now; } }
const { document, window } = parseHTML('<html><body><main></main></body></html>');
const calls = [], jobs = new Map(), timers = new Set();
const ui = vm.createContext({ document, window, Date: Clock, navigator: { onLine: true }, console,
  COURSE_AGENT_SEQUENCE, agentNameForStage, agentMessage, briefTitle,
  getJob: id => jobs.get(id), getUser: () => ({ id: 'owner' }), onUserChange() {}, onJobsChange() {},
  hasSavedRequestRestartIntent: () => false, cloudGenAvailable: () => true,
  generationActionSnapshot: job => ({ status: job.status, runId: job.runId }),
  resumeCloudGeneration: async (...args) => calls.push(['resume', ...args]),
  openAccount: (...args) => calls.push(['account', ...args]),
  createCourseImageClient: () => ({ connect: async () => calls.push(['connect-openai']) }),
  setInterval: fn => { timers.add(fn); return fn; }, clearInterval: fn => timers.delete(fn),
});
vm.runInContext(strip(readFileSync('web/js/intake.js', 'utf8')) + '\nglobalThis.uiTest={progressHTML,generationActivityModel,computeProgressPct,wireProgressActions};', ui);
const cloud = vm.createContext({ console, Date: Clock, getJob: id => jobs.get(id), getUser: () => ({ id: 'owner' }), _readAllCourses: () => ({}) });
vm.runInContext(strip(readFileSync('web/js/cloud-gen-client.js', 'utf8')) + '\nglobalThis.cloudTest={jobPatchFromRow,needsApiKeyForRow,slimBriefForCloud};', cloud);
const { progressHTML: html, generationActivityModel: model, computeProgressPct: pct, wireProgressActions: wire } = ui.uiTest;
const { jobPatchFromRow, needsApiKeyForRow, slimBriefForCloud } = cloud.cloudTest;
const brief = { topic: 'Course', materials_policy: 'integrated-visuals-v2', visual_designer_policy: 'learner-experience-v1', components: ['lessons', 'images'], modules: [] };
const row = { id: 'same-job', owner_id: 'owner', run_id: 'run-1', status: 'running', stage: 'design', user_brief: brief, brief,
  topics_done: 3, topics_total: 3, topics_by_key: { 'm/a': {}, 'm/b': {}, 'm/c': {} },
  heartbeat_at: new Date(now).toISOString(), lease_expires_at: new Date(now + 300_000).toISOString(),
  design_progress: { version: 1, status: 'refining', total: 3, completed: 1, reviewed: true, items: { 'm/a': { status: 'saved', revision: 'one' } } } };
const job = { id: row.id, ...jobPatchFromRow(row, null, now) };
jobs.set(job.id, job);
check(job.designProgress === row.design_progress && job.checkpoint.designProgress === row.design_progress, 'durable refinement progress maps into client and checkpoint');
check(slimBriefForCloud(brief, []).visual_designer_policy === 'learner-experience-v1', 'new marker survives client request compaction');
check(!('visual_designer_policy' in slimBriefForCloud({ topic: 'Legacy' }, [])), 'legacy request never gains new policy');
check(model(job).title === 'Refining lessons', 'refinement stage has plain-language task');
check(model(job).saved.includes('3 lessons saved · 1 of 3 lesson refinements saved'), 'last saved result distinguishes draft and refinement');
check(model(job).saved.includes('course-wide review saved'), 'saved course-wide review is explicit');
check(model(job).note.includes('not a rendered visual inspection or human approval'), 'checkpoint progress does not imply visual or human approval');
check(pct(job) === 70, 'saved refinement advances only its weighted stage');
check(pct({ ...job, cloudSeenAt: now + 60_000, heartbeatAt: now + 60_000 }) === 70, 'time and heartbeat alone cannot advance percentage');
check(pct({ ...job, stage: 'topics' }) === 65, 'all saved lesson text leaves room for refinement');
check(pct({ ...job, designProgress: { total: 3, completed: 0 } }) === 65, 'course review alone does not claim saved lesson refinement');
check(pct({ ...job, designProgress: { total: 3, completed: 3 } }) === 80, 'complete refinement reserves image/final-check work');
check(pct({ ...job, designProgress: { total: 0, completed: 0 } }) === 65, 'empty/missing refinement totals are not completion');
check(pct({ ...job, designProgress: { total: 3, completed: 99 } }) === 80, 'refinement checkpoint count is bounded');
const imageJob = { ...job, stage: 'images', imageProgress: { planned: 2, completed: 1, omitted: 1 } };
check(pct(imageJob) === 88 && model(imageJob).title === 'Creating illustrations', 'illustrations follow refined content');
check(pct({ ...imageJob, imageProgress: { planned: 0, completed: 0, omitted: 3 } }) === 95, 'deliberate text-only plan still leaves final checks');
for (const stage of ['topics', 'design', 'images', 'assemble', 'done']) check(pct({ ...imageJob, stage }) < 100, `${stage} cannot claim completed job`);
check(pct({ ...job, status: 'completed', stage: 'done' }) === 100, 'only completed job reaches 100 percent');

const card = document.querySelector('main');
const longTitleJob = { ...job, title: '😀'.repeat(5000) };
card.innerHTML = html(longTitleJob);
check(Array.from(card.querySelector('.intake-title').textContent).length === 96, 'progress title uses the real Unicode-safe short-label helper');
check(longTitleJob.title.length === 10000, 'progress rendering retains the full original description');
card.innerHTML = html(job);
check([...card.querySelectorAll('[data-stage]')].map(el => el.dataset.stage).join(',') === 'intake,research,topics,design,images,done', 'six-stage plan/research/lessons/refine/images/ready sequence');
check(card.querySelector('[data-stage="design"]').textContent.includes('Refine 1/3'), 'refinement count is visible in tracker');
check([...card.querySelectorAll('.intake-agent.active')].some(el => el.textContent.includes('Visual Designer')), 'existing Visual Designer is active while refining');
card.innerHTML = html(imageJob);
check([...card.querySelectorAll('.intake-agent.active')].some(el => el.textContent.includes('Visual Designer')), 'same Visual Designer stays active for images');
check(agentNameForStage('design') === 'Visual Designer' && agentNameForStage('images') === 'Visual Designer', 'server messages use the same named role');
check(agentMessage('images').includes('illustrations') && agentMessage('design').includes('refining'), 'role messages distinguish refinement and image work');
check(lifecycleSteps(job).map(step => step.label).join(',') === 'Plan,Research,Lessons,Refine,Images,Ready', 'Home lifecycle includes refinement for new cohort');
check(lifecycleSteps(job).find(step => step.label === 'Refine').state === 'current', 'Home does not skip ahead to image completion');
check(jobPresentation(job).label === 'Refining lessons', 'Home card uses refinement stage');

const legacyBrief = { ...brief }; delete legacyBrief.visual_designer_policy;
const legacy = { ...job, stage: 'topics', brief: legacyBrief, checkpoint: { ...job.checkpoint, brief: legacyBrief } };
check(pct(legacy) === 75, 'prior integrated cohort retains earlier weights');
check(!html(legacy).includes('data-stage="design"') && !lifecycleSteps(legacy).some(step => step.label === 'Refine'), 'legacy job has no automatic refinement stage');
const initial = jobPatchFromRow({ ...row, design_progress: { ...row.design_progress, completed: 0, reviewed: false, items: {} } }, null, now);
const reviewed = jobPatchFromRow({ ...row, design_progress: { ...row.design_progress, completed: 0, items: {} } }, initial, now + 5000);
check(reviewed.activityObservation.changedAt === now + 5000, 'saved whole-course review is a durable result change');
const revised = jobPatchFromRow(row, reviewed, now + 10000);
check(revised.activityObservation.changedAt === now + 10000, 'saved revision advances observed progress');
const polled = jobPatchFromRow({ ...row, heartbeat_at: new Date(now + 15000).toISOString() }, revised, now + 15000);
check(polled.activityObservation.changedAt === revised.activityObservation.changedAt, 'heartbeat is not another revision');

for (const status of ['failed', 'partial', 'interrupted', 'timed_out']) {
  const failed = { ...job, status, error: 'Refinement interrupted' };
  card.innerHTML = html(failed);
  check(card.querySelector('[data-resume]')?.textContent === 'Resume course creation', `${status} resumes same creation`);
  check(card.textContent.includes('saved draft and completed refinements are kept'), `${status} explains retained draft`);
  check(!card.querySelector('[data-image-reconnect]'), `${status} refinement does not request an OpenAI image key`);
  check(model(failed).state === 'attention', `${status} shows attention rather than active provider`);
  check(lifecycleSteps(failed).find(step => step.label === 'Refine').state === 'current', `${status} preserves refinement checkpoint in lifecycle`);
}
const failed = { ...job, status: 'failed' }; jobs.set(job.id, failed); card.innerHTML = html(failed); wire(card, failed.id, { status: 'failed', runId: 'run-1' });
check(calls.length === 0, 'rendering and wiring progress cannot dispatch work');
card.querySelector('[data-resume]').click(); await new Promise(resolve => setImmediate(resolve));
check(calls.length === 1 && calls[0][0] === 'resume' && calls[0][1] === 'same-job', 'explicit Resume dispatches existing job once');
check(needsApiKeyForRow({ ...row, status: 'failed', error: 'Missing API key' }), 'design requires Anthropic text key');
check(needsApiKeyForRow({ ...row, status: 'failed', stage: 'images', error: 'Missing API key' }), 'unfinished refinement cannot bypass Anthropic through image stage');
check(needsApiKeyForRow({ ...row, status: 'failed', stage: 'assemble', error: 'Missing API key', image_progress: { status: 'complete' } }), 'unfinished refinement cannot bypass Anthropic through final assembly');
check(!needsApiKeyForRow({ ...row, status: 'failed', stage: 'images', error: 'Missing API key', design_progress: { status: 'complete' } }), 'completed refinement allows image-only key recovery');
check(!needsApiKeyForRow({ ...row, status: 'failed', stage: 'assemble', error: 'Missing API key', image_progress: { status: 'complete' }, design_progress: { status: 'complete' } }), 'refined image final save does not require text key');
check(!needsApiKeyForRow({ ...row, user_brief: legacyBrief, brief: legacyBrief, status: 'failed', stage: 'images', error: 'Missing API key' }), 'earlier integrated image-only recovery still bypasses Anthropic');
card.innerHTML = html({ ...failed, needsApiKey: true });
check(card.textContent.includes('Anthropic API key') && card.querySelector('[data-api-key]') && !card.querySelector('[data-image-reconnect]'), 'design missing key uses existing account connection action');
card.innerHTML = html({ ...imageJob, status: 'failed' });
check(card.querySelector('[data-image-reconnect]') && !card.querySelector('[data-api-key]'), 'image recovery keeps existing OpenAI connection action');
check(calls.length === 1, 'read-only recovery rendering never reconnects or retries');

const baseBrief = retainComponentChoices(curriculumFixture(), { components: ['lessons'] });
const course = assembleCourse(baseBrief, baseBrief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(['lessons'], topic) }))));
course._brief = baseBrief;
const before = JSON.stringify(course);
check(!inspectSavedCourse(course).designProgress.selected, 'existing saved course has no refinement demand');
check(!savedCourseReadinessHTML(course).includes('ready-design-heading'), 'existing saved course gains no invented refinement result');
check(JSON.stringify(course) === before, 'legacy readiness inspection is read-only');
course.config.visual_designer_policy = 'learner-experience-v1';
check(inspectSavedCourse(course).needsAttention && !inspectSavedCourse(course).designProgress.complete, 'policy marker without saved revisions is not ready');
course._visualDesign = { version: 1, policy: 'learner-experience-v1', status: 'complete', review: {}, items: {} };
check(!inspectSavedCourse(course).designProgress.complete, 'complete status alone does not certify refinement coverage');
for (const mod of course.curriculum.modules) for (const topic of mod.topics) course._visualDesign.items[`${mod.id}/${topic.id}`] = { status: 'saved' };
let report = inspectSavedCourse(course);
check(report.designProgress.complete && report.designProgress.saved === report.total, 'saved review and per-lesson revisions verify refinement checkpoint');
check(savedCourseReadinessHTML(course).includes('AI-refined draft for your review, not a rendered visual inspection or human approval'), 'completed checkpoint retains quality-review caveat');
const firstKey = Object.keys(course._visualDesign.items)[0];
course._visualDesign.review.flags = [{ kind: 'assumption', message: 'Check the assumed audience.' }];
course._visualDesign.items[firstKey].flags = [{ kind: 'alignment', message: '<script>unsafe</script> Check the quiz explanation.' }];
const reviewNotes = savedCourseReadinessHTML(course), notesDOM = parseHTML(reviewNotes).document;
check(inspectSavedCourse(course).designProgress.flags.length === 2 && reviewNotes.includes('Review notes · 2'), 'course and lesson review flags remain visible');
check(!notesDOM.querySelector('script') && reviewNotes.includes('&lt;script&gt;'), 'review flags are escaped, not interpreted as HTML');
check(reviewNotes.includes('not resolved by completing this draft'), 'completion does not hide unresolved review flags');
course._visualDesign.pending = { key: firstKey };
check(!inspectSavedCourse(course).designProgress.complete, 'pending operation cannot be presented as complete refinement');
delete course._visualDesign.pending;
course._visualDesign.items[firstKey].status = 'pending';
report = inspectSavedCourse(course);
check(!report.designProgress.complete && report.needsAttention, 'unfinished refinement cannot be called ready');
check(savedCourseReadinessHTML(course, { jobAvailable: true, recoveryAvailable: true }).includes('Resume above to continue refinement in the same course creation'), 'saved-course recovery points to existing job controls');
delete course._visualDesign.review;
check(!inspectSavedCourse(course).designProgress.reviewed, 'absent whole-course review is not invented');
check(readFileSync('web/styles/home.css', 'utf8').includes('.intake-stages:has([data-stage="design"]) { grid-template-columns: repeat(6'), 'desktop tracker supports all six stages');
console.log(JSON.stringify({ suite: 'visual-designer-ui', assertions, passed: true, providerCalls: 0 }));
