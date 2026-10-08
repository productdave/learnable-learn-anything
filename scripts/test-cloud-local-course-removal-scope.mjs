import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const app = readFileSync(join(root, 'web/js/app.js'), 'utf8');
const intake = readFileSync(join(root, 'web/js/intake.js'), 'utf8');
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function body(source, start, end) {
  const startIx = source.indexOf(start);
  assert.notEqual(startIx, -1, `${start} not found`);
  const endIx = source.indexOf(end, startIx);
  assert.notEqual(endIx, -1, `${end} not found after ${start}`);
  return source.slice(startIx, endIx);
}

function assertScopedRemovalHelper(source, name) {
  assert.ok(source.includes('courseCanSyncToAccount'), `${name} should import/use courseCanSyncToAccount`);
  assert.ok(source.includes('function removeUserCourseForCurrentAccount(courseId)'), `${name} should define scoped removal helper`);
  const helper = body(source, 'function removeUserCourseForCurrentAccount(courseId)', '\n}');
  assert.ok(helper.includes('const course = getUserCourse(courseId);'), `${name} should read the visible local course`);
  assert.ok(helper.includes('const user = getUser();'), `${name} should use current auth identity`);
  assert.ok(helper.includes("courseCanSyncToAccount(course, user?.email || '', user?.id || '')"), `${name} should require exact account ownership`);
  assert.ok(helper.includes('removeUserCourse(courseId);'), `${name} should remove only after ownership check`);
  assert.ok(helper.includes('invalidateCourseCache(courseId);'), `${name} should invalidate cache only after ownership check`);
}

assertScopedRemovalHelper(app, 'app');
assertScopedRemovalHelper(intake, 'intake');

assert.ok(app.includes('removeUserCourseForCurrentAccount(deletedCourseId)'), 'app job cleanup should use scoped removal');
assert.equal(app.includes('removeUserCourse(deletedCourseId)'), false, 'app job cleanup should not directly remove by course id');
assert.ok(intake.includes('removeUserCourseForCurrentAccount(deletedCourseId)'), 'intake job cleanup should use scoped removal');
assert.equal(intake.includes('m.removeUserCourse(deletedCourseId)'), false, 'intake job cleanup should not dynamically remove by course id');
assert.equal(intake.includes('removeUserCourse(deletedCourseId)'), false, 'intake job cleanup should not directly remove by course id');

assert.ok(app.includes("let deletedCourseId = j?.runner === 'cloud' ? null : (j?.savedCourseId || null);"), 'app delete-job should not seed cloud cleanup from a stale local savedCourseId');
assert.ok(app.includes("let deletedCourseId = j?.runner === 'cloud' ? null : courseId;"), 'app delete-partial should not seed cloud cleanup from a stale local courseId');
assert.ok(intake.includes("let deletedCourseId = j?.runner === 'cloud' ? null : (j?.savedCourseId || null);"), 'intake delete should not seed cloud cleanup from a stale local savedCourseId');
assert.ok(app.includes('deletedCourseId = result?.deletedCourseId || null;'), 'app should trust only the guarded cloud delete result for cloud cleanup');
assert.ok(intake.includes('deletedCourseId = result?.deletedCourseId || null;'), 'intake should trust only the guarded cloud delete result for cloud cleanup');
assert.equal(app.includes('result?.deletedCourseId || deletedCourseId'), false, 'app should not fall back to stale local delete ids after cloud delete');
assert.equal(intake.includes('result?.deletedCourseId || deletedCourseId'), false, 'intake should not fall back to stale local delete ids after cloud delete');

const cancelBody = body(cloud, 'export async function cancelCloudGeneration', '/** Delete a cloud generation row');
assert.equal(cancelBody.includes('localCourseForCurrentUser(j.savedCourseId)'), false, 'cancel safety cleanup should not remove saved course mirrors');
assert.equal(cancelBody.includes('_removeCourseLocalSilent(j.savedCourseId)'), false, 'cancel safety cleanup should not silently remove saved courses');
assert.equal(cancelBody.includes('removeUserCourse(j.savedCourseId)'), false, 'cancel safety cleanup should not directly remove by course id');

const deleteMirrorBody = body(cloud, 'export function removeCloudJobMirror(jobId)', 'export function pruneMissingCloudJobMirrors');
assert.ok(deleteMirrorBody.includes('if (savedCourseId && localCourseForCurrentUser(savedCourseId, jobId))'), 'delete mirror cleanup should require current-account ownership and matching generation job');
assert.ok(deleteMirrorBody.includes('_removeCourseLocalSilent(savedCourseId)'), 'delete mirror cleanup should use silent local removal after account and job check');
assert.ok(deleteMirrorBody.includes('for (const courseId of localCourseIdsForGenerationJob(jobId))'), 'delete mirror cleanup should remove every local course stamped with the generation job');
assert.equal(deleteMirrorBody.includes('removeUserCourse(savedCourseId)'), false, 'delete mirror cleanup should not directly remove by course id');
assert.ok(deleteMirrorBody.includes('if (removedCourseIds.size) {'), 'delete mirror cleanup should gate course-sync work on actual local course removal');
assert.ok(
  deleteMirrorBody.indexOf('if (removedCourseIds.size) {') <
  deleteMirrorBody.indexOf('syncCoursesNow().catch(() => {});'),
  'delete mirror cleanup should not sync after removing only a job card'
);

const deleteGenerationBody = body(cloud, 'export async function deleteCloudGeneration(', '/** Resume an interrupted');
assert.ok(deleteGenerationBody.includes('removeCloudJobMirror(jobId);'), 'successful cloud delete should reuse job-stamped local mirror cleanup');
assert.equal(deleteGenerationBody.includes('removeJobSubscription(jobId);\n  removeJob(jobId);'), false, 'successful cloud delete should not bypass job-stamped local mirror cleanup');

assert.ok(packageJson.scripts['test:cloud-local-course-removal-scope'], 'package script should expose this regression test');
assert.ok(packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-local-course-removal-scope'), 'cloud architecture verify should run this test');

console.log('cloud local course removal scope tests passed');
