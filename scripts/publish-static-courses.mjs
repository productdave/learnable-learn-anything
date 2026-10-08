import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizePublicAuthor } from '../web/js/public-author.js';

const [inputFile, outputRoot] = process.argv.slice(2);
if (!inputFile || !outputRoot) {
  console.error('Usage: node scripts/publish-static-courses.mjs <sanitized-courses.json> <course-data-directory>');
  process.exit(1);
}

const PUBLIC_COURSE_IDS = [
  'multi-agent-workflow-systems',
  'ai-product-evals-rubrics'
];

const forbiddenTopLevelKeys = [
  'createdBy',
  'createdByUserId',
  '_brief',
  '_research',
  '_generationJobId',
  '_generationRunId',
  '_tokenUsage',
  '_refinementProposal',
  '_lastRefinement',
  '_syncedAt'
];

const courses = JSON.parse(await fs.readFile(inputFile, 'utf8'));
const summaries = [];

for (const id of PUBLIC_COURSE_IDS) {
  const course = courses[id];
  validateCourse(course, id);
  const publicAuthor = normalizePublicAuthor(course.publicAuthor || course.config.publicAuthor);
  const config = { ...course.config, id };
  delete config.publicAuthor;
  if (publicAuthor) config.publicAuthor = publicAuthor;

  const courseDir = path.join(outputRoot, id);
  const modulesDir = path.join(courseDir, 'modules');
  await fs.mkdir(modulesDir, { recursive: true });

  await fs.writeFile(path.join(courseDir, 'course.json'), `${JSON.stringify(config, null, 2)}\n`);
  await fs.writeFile(path.join(courseDir, 'curriculum.json'), `${JSON.stringify(course.curriculum, null, 2)}\n`);

  for (const module of course.curriculum.modules) {
    const number = Number(module.number);
    const moduleData = course.modules[number] || course.modules[String(number)];
    if (!moduleData || typeof moduleData !== 'object') {
      throw new Error(`${id}: missing module data for module ${number}`);
    }
    await fs.writeFile(path.join(modulesDir, `module-${number}.json`), `${JSON.stringify(moduleData)}\n`);
  }

  const firstModule = course.curriculum.modules[0] || {};
  summaries.push({
    id,
    ...(publicAuthor ? { publicAuthor } : {}),
    title: course.config.title || course.config.name || course.curriculum.title,
    subtitle: course.config.subtitle || course.curriculum.subtitle || '',
    modules: course.curriculum.modules.length,
    topics: course.curriculum.modules.reduce((sum, module) => sum + module.topics.length, 0),
    accentColor: firstModule.color || course.config.moduleColorAccents?.[0] || '#4338CA',
    emoji: course.config.emoji || deriveEmoji(course.config.title || course.config.name)
  });
}

const indexPath = path.join(outputRoot, 'index.json');
const catalog = JSON.parse(await fs.readFile(indexPath, 'utf8'));
const publishedIds = new Set(PUBLIC_COURSE_IDS);
catalog.courses = [
  ...summaries,
  ...(catalog.courses || []).filter(course => !publishedIds.has(course.id))
];
await fs.writeFile(indexPath, `${JSON.stringify(catalog, null, 2)}\n`);

console.log(JSON.stringify({ outputRoot, courses: summaries }, null, 2));

function validateCourse(course, id) {
  if (!course?.config || !Array.isArray(course?.curriculum?.modules) || !course?.modules) {
    throw new Error(`${id}: invalid sanitized course payload`);
  }
  for (const key of forbiddenTopLevelKeys) {
    if (Object.hasOwn(course, key)) throw new Error(`${id}: private metadata key ${key} is still present`);
  }
  const serialized = JSON.stringify(course);
  if (/(?:sk-ant-|sk-proj-|AIza)[A-Za-z0-9_-]{8,}/.test(serialized)) {
    throw new Error(`${id}: secret-like value found in course payload`);
  }
  for (const module of course.curriculum.modules) {
    if (!Number.isInteger(Number(module.number)) || !Array.isArray(module.topics)) {
      throw new Error(`${id}: invalid module metadata`);
    }
  }
}

function deriveEmoji(title = '') {
  const value = String(title).toLowerCase();
  if (/eval|rubric|metric/.test(value)) return '📊';
  if (/agent|\bai\b|model|llm/.test(value)) return '🤖';
  return '🎓';
}
