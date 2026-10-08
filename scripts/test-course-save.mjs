import assert from 'node:assert/strict';
import { withCourseCommitRpc } from './fixtures/course-commit-rpc.mjs';
import {
  clearSavedCourseIdForJob,
  courseIdCandidates,
  courseRowBelongsToJob,
  courseWithId,
  rollbackGeneratedCourseSave,
  reconcileGeneratedCourseRun,
  saveGeneratedCourse
} from '../web/api/_lib/course-save.mjs';

const candidates = courseIdCandidates('Code for Designers', 'job-01JABCDEF23456789');
assert.equal(candidates[0], 'code-for-designers');
assert.equal(new Set(candidates).size, candidates.length);
assert.ok(candidates.some(id => id.startsWith('code-for-designers-')));

const renamed = courseWithId(
  { config: { id: 'old-id', storageKeyPrefix: 'old-id', title: 'Course' }, curriculum: {}, modules: {} },
  'new-id'
);
assert.equal(renamed.config.id, 'new-id');
assert.equal(renamed.config.storageKeyPrefix, 'new-id');
assert.equal(renamed.config.title, 'Course');

assert.equal(courseRowBelongsToJob({ _generationJobId: 'job-a' }, 'job-a', null, 'course'), true);
assert.equal(courseRowBelongsToJob({ _generationJobId: 'job-b' }, 'job-a', null, 'course'), false);
assert.equal(courseRowBelongsToJob({ _generationJobId: 'job-b' }, 'job-a', 'course', 'course'), false);
assert.equal(courseRowBelongsToJob({}, 'job-a', null, 'course'), false);
assert.equal(courseRowBelongsToJob({}, 'job-a', 'course', 'course'), false);

function makeSaveStore({ jobs = {}, courses = {}, failJobCourseCheckpoint = false, restampCourseBeforeUpdate = false, rerunCourseBeforeUpdate = false } = {}) {
  return withCourseCommitRpc({
    jobs,
    courses,
    courseReads: new Map(),
    from(table) {
      const builder = {
        op: null,
        patch: null,
        row: null,
        filters: {},
        isFilters: {},
        inFilters: {},
        select(columns) {
          if (!this.op) this.op = 'select';
          this.columns = columns;
          return this;
        },
        update(patch) {
          this.op = 'update';
          this.patch = patch;
          return this;
        },
        insert(row) {
          this.op = 'insert';
          this.row = row;
          return this;
        },
        delete() {
          this.op = 'delete';
          return this;
        },
        eq(column, value) {
          this.filters[column] = value;
          return this;
        },
        is(column, value) {
          this.isFilters[column] = value;
          return this;
        },
        in(column, values) {
          this.inFilters[column] = values;
          return this;
        },
        maybeSingle() {
          if (table === 'generation_jobs') {
            const row = jobs[this.filters.id] || null;
            if (row && row.owner_id !== this.filters.owner_id) return Promise.resolve({ data: null, error: null });
            if (this.op === 'update') {
              if (!row) return Promise.resolve({ data: null, error: null });
              if (this.filters.run_id && row.run_id !== this.filters.run_id) return Promise.resolve({ data: null, error: null });
              const allowedStatuses = this.inFilters.status || null;
              if (allowedStatuses && !allowedStatuses.includes(row.status)) return Promise.resolve({ data: null, error: null });
              if (failJobCourseCheckpoint && this.patch && Object.hasOwn(this.patch, 'saved_course_id')) {
                return Promise.resolve({ data: null, error: null });
              }
              jobs[this.filters.id] = { ...row, ...this.patch };
              return Promise.resolve({ data: { id: this.filters.id }, error: null });
            }
            return Promise.resolve({ data: row, error: null });
          }
          if (table === 'user_courses') {
            const row = courses[this.filters.id] || null;
            if (row && row.owner_id !== this.filters.owner_id) return Promise.resolve({ data: null, error: null });
            if (this.op === 'update') {
              if (!row) return Promise.resolve({ data: null, error: null });
              if (restampCourseBeforeUpdate && !this._restamped) {
                this._restamped = true;
                row.payload = { ...(row.payload || {}), _generationJobId: 'other-job' };
                row.updated_at = new Date().toISOString();
              }
              if (rerunCourseBeforeUpdate && !this._rerun) {
                this._rerun = true;
                row.payload = { ...(row.payload || {}), _generationRunId: 'newer-run' };
                row.updated_at = new Date().toISOString();
              }
              if (this.filters['payload->>_generationJobId'] && row.payload?._generationJobId !== this.filters['payload->>_generationJobId']) {
                return Promise.resolve({ data: null, error: null });
              }
              if (this.filters['payload->>_generationRunId'] && row.payload?._generationRunId !== this.filters['payload->>_generationRunId']) {
                return Promise.resolve({ data: null, error: null });
              }
              if (Object.hasOwn(this.isFilters, 'payload->>_generationRunId') && (row.payload?._generationRunId ?? null) !== this.isFilters['payload->>_generationRunId']) {
                return Promise.resolve({ data: null, error: null });
              }
              if (this.filters.updated_at && row.updated_at !== this.filters.updated_at) return Promise.resolve({ data: null, error: null });
              courses[this.filters.id] = { ...row, ...this.patch };
              return Promise.resolve({ data: { id: this.filters.id }, error: null });
            }
            if (this.op === 'delete') {
              if (!row) return Promise.resolve({ data: null, error: null });
              if (this.filters['payload->>_generationJobId'] && row.payload?._generationJobId !== this.filters['payload->>_generationJobId']) {
                return Promise.resolve({ data: null, error: null });
              }
              if (this.filters['payload->>_generationRunId'] && row.payload?._generationRunId !== this.filters['payload->>_generationRunId']) {
                return Promise.resolve({ data: null, error: null });
              }
              if (this.filters.updated_at && row.updated_at !== this.filters.updated_at) return Promise.resolve({ data: null, error: null });
              delete courses[this.filters.id];
              return Promise.resolve({ data: { id: this.filters.id }, error: null });
            }
            return Promise.resolve({ data: structuredClone(row), error: null });
          }
          return Promise.resolve({ data: null, error: new Error(`Unexpected table ${table}`) });
        },
        then(resolve, reject) {
          try {
            if (table !== 'user_courses') throw new Error(`Unexpected write table ${table}`);
            if (this.op === 'insert') {
              if (courses[this.row.id]) {
                resolve({ error: { code: '23505', message: 'duplicate key' } });
                return;
              }
              courses[this.row.id] = { ...this.row };
            } else if (this.op === 'delete') {
              const row = courses[this.filters.id] || null;
              if (row && row.owner_id === this.filters.owner_id) delete courses[this.filters.id];
            }
            resolve({ error: null });
          } catch (err) {
            reject(err);
          }
        }
      };
      return builder;
    }
  });
}

const baseCourse = {
  config: { id: 'Code for Designers', title: 'Code for Designers' },
  curriculum: {},
  modules: {}
};
const baseBrief = { id: 'Code for Designers', title: 'Code for Designers', modules: [] };

{
  const supabase = makeSaveStore({
    jobs: {
      'job-1': {
        id: 'job-1',
        owner_id: 'owner-1',
        status: 'running',
        run_id: 'run-2',
        saved_course_id: 'code-for-designers'
      }
    },
    courses: {
      'code-for-designers': {
        id: 'code-for-designers',
        owner_id: 'owner-1',
        payload: { _generationJobId: 'job-1', _generationRunId: 'run-1', createdAt: 123 },
        updated_at: '2026-01-01T00:00:00.000Z'
      }
    }
  });
  const saved = await saveGeneratedCourse({
    supabase,
    ownerId: 'owner-1',
    jobId: 'job-1',
    runId: 'run-2',
    baseCourseId: 'Code for Designers',
    course: baseCourse,
    brief: baseBrief,
    researchByModule: {},
    ownerEmail: 'dave@example.com'
  });
  assert.equal(saved.courseId, 'code-for-designers');
  assert.equal(saved.inserted, false);
  assert.equal(saved.priorSavedCourseId, 'code-for-designers');
  assert.equal(supabase.courses['code-for-designers'].payload._generationRunId, 'run-2');
  assert.equal(supabase.courses['code-for-designers'].payload.createdAt, 123);
  assert.equal(supabase.jobs['job-1'].saved_course_id, 'code-for-designers');
}

{
  const supabase = makeSaveStore({
    jobs: {
      'job-1': {
        id: 'job-1',
        owner_id: 'owner-1',
        status: 'running',
        run_id: 'run-2',
        saved_course_id: 'code-for-designers'
      }
    },
    courses: {
      'code-for-designers': {
        id: 'code-for-designers',
        owner_id: 'owner-1',
        payload: { _generationJobId: 'job-1', createdAt: 123 },
        updated_at: '2026-01-01T00:00:00.000Z'
      }
    }
  });
  const saved = await saveGeneratedCourse({
    supabase,
    ownerId: 'owner-1',
    jobId: 'job-1',
    runId: 'run-2',
    baseCourseId: 'Code for Designers',
    course: baseCourse,
    brief: baseBrief,
    researchByModule: {},
    ownerEmail: 'dave@example.com'
  });
  assert.equal(saved.courseId, 'code-for-designers');
  assert.equal(saved.inserted, false);
  assert.equal(saved.priorSavedCourseId, 'code-for-designers');
  assert.equal(supabase.courses['code-for-designers'].payload._generationRunId, 'run-2');
  assert.equal(supabase.courses['code-for-designers'].payload.createdAt, 123);
}

{
  const supabase = makeSaveStore({
    jobs: {
      'job-1': {
        id: 'job-1',
        owner_id: 'owner-1',
        status: 'running',
        run_id: 'run-2',
        saved_course_id: null
      }
    },
    courses: {
      'code-for-designers': {
        id: 'code-for-designers',
        owner_id: 'owner-1',
        payload: { _generationJobId: 'job-1', _generationRunId: 'run-1', createdAt: 123 },
        updated_at: '2026-01-01T00:00:00.000Z'
      }
    }
  });
  const saved = await saveGeneratedCourse({
    supabase,
    ownerId: 'owner-1',
    jobId: 'job-1',
    runId: 'run-2',
    baseCourseId: 'Code for Designers',
    course: baseCourse,
    brief: baseBrief,
    researchByModule: {},
    ownerEmail: 'dave@example.com'
  });
  assert.equal(saved.courseId, 'code-for-designers');
  assert.equal(saved.inserted, false);
  assert.equal(saved.priorSavedCourseId, null);
  assert.equal(supabase.courses['code-for-designers'].payload._generationRunId, 'run-2');
  assert.equal(supabase.jobs['job-1'].saved_course_id, 'code-for-designers');
}

{
  const supabase = makeSaveStore({
    restampCourseBeforeUpdate: true,
    jobs: {
      'job-1': {
        id: 'job-1',
        owner_id: 'owner-1',
        status: 'running',
        run_id: 'run-2',
        saved_course_id: 'code-for-designers'
      }
    },
    courses: {
      'code-for-designers': {
        id: 'code-for-designers',
        owner_id: 'owner-1',
        payload: { _generationJobId: 'job-1', _generationRunId: 'run-1', createdAt: 123 },
        updated_at: '2026-01-01T00:00:00.000Z'
      }
    }
  });
  await assert.rejects(
    saveGeneratedCourse({
      supabase,
      ownerId: 'owner-1',
      jobId: 'job-1',
      runId: 'run-2',
      baseCourseId: 'Code for Designers',
      course: baseCourse,
      brief: baseBrief,
      researchByModule: {},
      ownerEmail: 'dave@example.com'
    }),
    /newer revision was saved/
  );
  assert.equal(supabase.courses['code-for-designers'].payload._generationJobId, 'other-job');
  assert.equal(supabase.jobs['job-1'].saved_course_id, 'code-for-designers');
}

{
  const supabase = makeSaveStore({
    rerunCourseBeforeUpdate: true,
    jobs: {
      'job-1': {
        id: 'job-1',
        owner_id: 'owner-1',
        status: 'running',
        run_id: 'run-2',
        saved_course_id: 'code-for-designers'
      }
    },
    courses: {
      'code-for-designers': {
        id: 'code-for-designers',
        owner_id: 'owner-1',
        payload: { _generationJobId: 'job-1', _generationRunId: 'run-1', createdAt: 123 },
        updated_at: '2026-01-01T00:00:00.000Z'
      }
    }
  });
  await assert.rejects(
    saveGeneratedCourse({
      supabase,
      ownerId: 'owner-1',
      jobId: 'job-1',
      runId: 'run-2',
      baseCourseId: 'Code for Designers',
      course: baseCourse,
      brief: baseBrief,
      researchByModule: {},
      ownerEmail: 'dave@example.com'
    }),
    /newer revision was saved/
  );
  assert.equal(supabase.courses['code-for-designers'].payload._generationJobId, 'job-1');
  assert.equal(supabase.courses['code-for-designers'].payload._generationRunId, 'newer-run');
  assert.equal(supabase.courses['code-for-designers'].payload.createdAt, 123);
}

{
  const supabase = makeSaveStore({
    jobs: {
      'job-1': {
        id: 'job-1',
        owner_id: 'owner-1',
        status: 'running',
        run_id: 'run-1',
        saved_course_id: 'code-for-designers'
      }
    },
    courses: {
      'code-for-designers': {
        id: 'code-for-designers',
        owner_id: 'owner-1',
        payload: { _generationJobId: 'other-job', _generationRunId: 'other-run' },
        updated_at: '2026-01-01T00:00:00.000Z'
      }
    }
  });
  const saved = await saveGeneratedCourse({
    supabase,
    ownerId: 'owner-1',
    jobId: 'job-1',
    runId: 'run-1',
    baseCourseId: 'Code for Designers',
    course: baseCourse,
    brief: baseBrief,
    researchByModule: {},
    ownerEmail: 'dave@example.com'
  });
  assert.notEqual(saved.courseId, 'code-for-designers');
  assert.equal(saved.inserted, true);
  assert.equal(saved.priorSavedCourseId, 'code-for-designers');
  assert.equal(supabase.courses['code-for-designers'].payload._generationJobId, 'other-job');
  assert.equal(supabase.courses[saved.courseId].payload._generationJobId, 'job-1');
  assert.equal(supabase.jobs['job-1'].saved_course_id, saved.courseId);
}

{
  const supabase = makeSaveStore({
    jobs: {
      'job-1': {
        id: 'job-1',
        owner_id: 'owner-1',
        status: 'running',
        run_id: 'run-1',
        saved_course_id: 'code-for-designers'
      }
    },
    courses: {
      'code-for-designers': {
        id: 'code-for-designers',
        owner_id: 'owner-1',
        payload: { config: { id: 'code-for-designers' }, title: 'User course without generation stamp' },
        updated_at: '2026-01-01T00:00:00.000Z'
      }
    }
  });
  const saved = await saveGeneratedCourse({
    supabase,
    ownerId: 'owner-1',
    jobId: 'job-1',
    runId: 'run-1',
    baseCourseId: 'Code for Designers',
    course: baseCourse,
    brief: baseBrief,
    researchByModule: {},
    ownerEmail: 'dave@example.com'
  });
  assert.notEqual(saved.courseId, 'code-for-designers');
  assert.equal(saved.inserted, true);
  assert.equal(saved.priorSavedCourseId, 'code-for-designers');
  assert.equal(supabase.courses['code-for-designers'].payload.title, 'User course without generation stamp');
  assert.equal(supabase.courses[saved.courseId].payload._generationJobId, 'job-1');
  assert.equal(supabase.jobs['job-1'].saved_course_id, saved.courseId);
}

{
  const supabase = makeSaveStore({
    jobs: {
      'job-1': {
        id: 'job-1',
        owner_id: 'owner-1',
        status: 'timed_out',
        run_id: 'run-1',
        saved_course_id: null
      }
    }
  });
  await assert.rejects(
    saveGeneratedCourse({
      supabase,
      ownerId: 'owner-1',
      jobId: 'job-1',
      runId: 'run-1',
      baseCourseId: 'Code for Designers',
      course: baseCourse,
      brief: baseBrief,
      researchByModule: {},
      ownerEmail: 'dave@example.com'
    }),
    /Cannot save generated course while job is timed_out/
  );
}

{
  const supabase = makeSaveStore({
    failJobCourseCheckpoint: true,
    jobs: {
      'job-1': {
        id: 'job-1',
        owner_id: 'owner-1',
        status: 'running',
        run_id: 'run-1',
        saved_course_id: null
      }
    }
  });
  await assert.rejects(
    saveGeneratedCourse({
      supabase,
      ownerId: 'owner-1',
      jobId: 'job-1',
      runId: 'run-1',
      baseCourseId: 'Code for Designers',
      course: baseCourse,
      brief: baseBrief,
      researchByModule: {},
      ownerEmail: 'dave@example.com'
    }),
    /Cannot checkpoint saved course/
  );
  assert.equal(supabase.courses['code-for-designers'], undefined);
  assert.equal(supabase.jobs['job-1'].saved_course_id, null);
}

function makeCourseStore(rows = {}, { beforeWrite = null } = {}) {
  let beforeWriteCalled = false;
  for (const [id, row] of Object.entries(rows)) row.payload = { ...row.payload, config: { id }, _courseRevision: '11111111-1111-4111-8111-111111111111' };
  return withCourseCommitRpc({
    rows,
    from(table) {
      assert.equal(table, 'user_courses');
      const builder = {
        op: null,
        patch: null,
        filters: {},
        select() {
          if (!this.op) this.op = 'select';
          return this;
        },
        update(patch) {
          this.op = 'update';
          this.patch = patch;
          return this;
        },
        delete() {
          this.op = 'delete';
          return this;
        },
        eq(column, value) {
          this.filters[column] = value;
          return this;
        },
        maybeSingle() {
          const row = rows[this.filters.id] || null;
          if (row && row.owner_id !== this.filters.owner_id) return Promise.resolve({ data: null, error: null });
          if (this.op === 'select') return Promise.resolve({ data: structuredClone(row), error: null });
          if (!beforeWriteCalled && beforeWrite) {
            beforeWriteCalled = true;
            beforeWrite(rows);
          }
          const current = rows[this.filters.id] || null;
          if (!current || current.owner_id !== this.filters.owner_id) return Promise.resolve({ data: null, error: null });
          if (this.filters.updated_at && current.updated_at !== this.filters.updated_at) return Promise.resolve({ data: null, error: null });
          for (const [field, value] of Object.entries(this.filters)) {
            if (field === 'id' || field === 'owner_id') continue;
            if (field === 'payload->>_generationJobId' && current.payload?._generationJobId !== value) {
              return Promise.resolve({ data: null, error: null });
            }
            if (field === 'payload->>_generationRunId' && current.payload?._generationRunId !== value) {
              return Promise.resolve({ data: null, error: null });
            }
          }
          if (this.op === 'update') {
            rows[this.filters.id] = { ...current, ...this.patch };
          } else if (this.op === 'delete') {
            delete rows[this.filters.id];
          }
          return Promise.resolve({ data: { id: this.filters.id }, error: null });
        }
      };
      return builder;
    }
  });
}
const savedVersion = supabase => ({ savedRevision: supabase.rows.course.payload._courseRevision, savedUpdatedAt: supabase.rows.course.updated_at });

{
  const jobs = {
    'job-1': {
      id: 'job-1',
      owner_id: 'owner-1',
      run_id: 'run-1',
      saved_course_id: 'course'
    }
  };
  const supabase = {
    jobs,
    from(table) {
      assert.equal(table, 'generation_jobs');
      const builder = {
        patch: null,
        filters: {},
        update(patch) {
          this.patch = patch;
          return this;
        },
        eq(column, value) {
          this.filters[column] = value;
          return this;
        },
        select() {
          return this;
        },
        maybeSingle() {
          const row = jobs[this.filters.id] || null;
          if (!row) return Promise.resolve({ data: null, error: null });
          if (row.owner_id !== this.filters.owner_id) return Promise.resolve({ data: null, error: null });
          if (row.run_id !== this.filters.run_id) return Promise.resolve({ data: null, error: null });
          if (row.saved_course_id !== this.filters.saved_course_id) return Promise.resolve({ data: null, error: null });
          jobs[this.filters.id] = { ...row, ...this.patch };
          return Promise.resolve({ data: { id: this.filters.id }, error: null });
        }
      };
      return builder;
    }
  };
  const cleared = await clearSavedCourseIdForJob({
    supabase,
    ownerId: 'owner-1',
    jobId: 'job-1',
    runId: 'run-1',
    courseId: 'course'
  });
  assert.equal(cleared, true);
  assert.equal(supabase.jobs['job-1'].saved_course_id, null);
}

{
  const supabase = makeCourseStore({
    course: {
      owner_id: 'owner-1',
      payload: { _generationJobId: 'job-1', _generationRunId: 'run-1', value: 'new' },
      updated_at: '2026-01-01T00:00:00.000Z'
    }
  });
  const rolledBack = await rollbackGeneratedCourseSave({
    supabase, ...savedVersion(supabase),
    ownerId: 'owner-1',
    courseId: 'course',
    jobId: 'job-1',
    runId: 'run-1'
  });
  assert.equal(rolledBack, true);
  assert.equal(supabase.rows.course, undefined);
}

{
  const priorPayload = { _generationJobId: 'job-1', _generationRunId: 'run-old', value: 'prior' };
  const supabase = makeCourseStore({
    course: {
      owner_id: 'owner-1',
      payload: { _generationJobId: 'job-1', _generationRunId: 'run-2', value: 'new' },
      updated_at: '2026-01-02T00:00:00.000Z'
    }
  });
  const rolledBack = await rollbackGeneratedCourseSave({
    supabase, ...savedVersion(supabase),
    ownerId: 'owner-1',
    courseId: 'course',
    jobId: 'job-1',
    runId: 'run-2',
    priorPayload,
    priorUpdatedAt: '2026-01-01T00:00:00.000Z'
  });
  assert.equal(rolledBack, true);
  assert.equal(supabase.rows.course.payload.value, priorPayload.value);
  assert.equal(supabase.rows.course.payload._generationRunId, priorPayload._generationRunId);
  assert.notEqual(supabase.rows.course.payload._courseRevision, '11111111-1111-4111-8111-111111111111');
  assert.ok(Date.parse(supabase.rows.course.updated_at) > Date.parse('2026-01-02T00:00:00.000Z'), 'rollback restores content without rewinding revisions');
}

{
  const priorPayload = { _generationJobId: 'job-1', _generationRunId: 'run-old', value: 'prior' };
  const supabase = makeCourseStore({
    course: {
      owner_id: 'owner-1',
      payload: { _generationJobId: 'job-1', _generationRunId: 'run-2', value: 'new' },
      updated_at: '2026-01-02T00:00:00.000Z'
    }
  }, {
    beforeWrite(rows) {
      rows.course.payload = { _generationJobId: 'job-1', _generationRunId: 'newer-run', value: 'newer' };
      rows.course.updated_at = '2026-01-03T00:00:00.000Z';
    }
  });
  const rolledBack = await rollbackGeneratedCourseSave({
    supabase, ...savedVersion(supabase),
    ownerId: 'owner-1',
    courseId: 'course',
    jobId: 'job-1',
    runId: 'run-2',
    priorPayload,
    priorUpdatedAt: '2026-01-01T00:00:00.000Z'
  });
  assert.equal(rolledBack, false);
  assert.equal(supabase.rows.course.payload.value, 'newer');
  assert.equal(supabase.rows.course.updated_at, '2026-01-03T00:00:00.000Z');
}

{
  const supabase = makeCourseStore({
    course: {
      owner_id: 'owner-1',
      payload: { _generationJobId: 'job-1', _generationRunId: 'run-1', value: 'new' },
      updated_at: '2026-01-01T00:00:00.000Z'
    }
  }, {
    beforeWrite(rows) {
      rows.course.payload = { _generationJobId: 'job-1', _generationRunId: 'newer-run', value: 'newer' };
      rows.course.updated_at = '2026-01-03T00:00:00.000Z';
    }
  });
  const rolledBack = await rollbackGeneratedCourseSave({
    supabase, ...savedVersion(supabase),
    ownerId: 'owner-1',
    courseId: 'course',
    jobId: 'job-1',
    runId: 'run-1'
  });
  assert.equal(rolledBack, false);
  assert.equal(supabase.rows.course.payload.value, 'newer');
}

{
  const supabase = makeCourseStore({
    course: {
      owner_id: 'owner-1',
      payload: { _generationJobId: 'job-1', _generationRunId: 'newer-run', value: 'newer' },
      updated_at: '2026-01-03T00:00:00.000Z'
    }
  });
  const rolledBack = await rollbackGeneratedCourseSave({
    supabase, ...savedVersion(supabase),
    ownerId: 'owner-1',
    courseId: 'course',
    jobId: 'job-1',
    runId: 'stale-run'
  });
  assert.equal(rolledBack, false);
  assert.equal(supabase.rows.course.payload.value, 'newer');
}

{
  const payload = { _generationJobId: 'job-r', _generationRunId: 'old-run',
    modules: { 1: { lesson: { sections: [{ type: 'image', asset_id: 'retained' }] } } },
    _visualDesign: { status: 'complete' } };
  const db = makeSaveStore({ jobs: { 'job-r': { owner_id: 'owner-r', status: 'running', run_id: 'new-run', saved_course_id: 'course-r' } },
    courses: { 'course-r': { owner_id: 'owner-r', payload, updated_at: '2026-10-05T00:00:00Z' } } });
  const args = { supabase: db, ownerId: 'owner-r', jobId: 'job-r', runId: 'new-run', courseId: 'course-r' };
  assert.equal(await reconcileGeneratedCourseRun(args), true);
  assert.equal(db.courses['course-r'].payload._generationRunId, 'new-run');
  assert.deepEqual(db.courses['course-r'].payload.modules, payload.modules);
  assert.deepEqual(db.courses['course-r'].payload._visualDesign, payload._visualDesign);
  assert.equal(await reconcileGeneratedCourseRun(args), false, 'already-current finalization is a no-op');
  await assert.rejects(reconcileGeneratedCourseRun({ ...args, runId: 'old-run' }), /another runner/);
  db.jobs['job-r'].status = 'completed';
  await assert.rejects(reconcileGeneratedCourseRun(args), /completed/);
}
console.log('course save identity tests passed');
