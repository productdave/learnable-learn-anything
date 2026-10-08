import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const app = readFileSync(join(root, 'web/js/app.js'), 'utf8');
const migration = readFileSync(join(root, 'db/04-agentic-workflow.sql'), 'utf8');

const wireLibraryCards = app.slice(
  app.indexOf('function wireLibraryCards'),
  app.indexOf('// Identity comes from Supabase auth')
);

assert.ok(wireLibraryCards.includes("btn.addEventListener('click', async (e) => {"));
assert.ok(wireLibraryCards.includes('const course = getUserCourse(id);'));
assert.ok(wireLibraryCards.includes('const generationJobId = course?._generationJobId || null;'));
assert.ok(wireLibraryCards.includes('if (generationJobId && cloudGenAvailable()) {'));
assert.ok(wireLibraryCards.includes('await deleteCloudGeneration(generationJobId, expected);'));
assert.ok(
  wireLibraryCards.indexOf('await deleteCloudGeneration(generationJobId, expected);') <
  wireLibraryCards.indexOf('removeUserCourse(id);'),
  'library deletion should delete the completed cloud job before removing the local course.'
);
assert.ok(wireLibraryCards.includes('btn.disabled = true;'));
assert.ok(wireLibraryCards.includes('btn.disabled = false;'));

assert.ok(
  migration.includes("v_status not in ('review_curriculum', 'review_research', 'partial', 'failed', 'timed_out', 'cancelled', 'completed')"),
  'completed generation jobs should be deletable so deleting a finished course also removes its durable job row.'
);
assert.ok(
  migration.includes("uc.payload->>'_generationJobId' = p_job_id") &&
    migration.includes('order by (uc.id = v_saved_course_id) desc, uc.updated_at desc') &&
    migration.includes("and payload->>'_generationJobId' = p_job_id"),
  'atomic job deletion should also remove courses saved by this job before saved_course_id was finalized.'
);
assert.ok(
  !migration.includes('id = deleted_course_id'),
  'atomic job deletion must not delete a course by saved_course_id unless that course payload belongs to the job.'
);

console.log('library delete cloud job tests passed');
