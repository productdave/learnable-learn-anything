// Zod schemas that target the renderer's existing topic schema.
// Stage 1 produces a CourseBrief; Stage 3 produces Topic content.
// Stage 4 validates everything before writing to disk.
//
// Imports `zod` as a bare specifier so the same file runs in both contexts:
//   • Browser — resolved via the importmap in index.html
//     (mapped to `https://esm.sh/zod@3.23.8`).
//   • Vercel function / Node — resolved via node_modules from web/package.json.

import { z } from 'zod';
import { componentPolicy } from './component-policy.mjs';

// --- Course brief (Stage 1 output) ----------------------------------

export const ScopeEnum = z.enum(['single_module', 'mini_course', 'full_course']);

export const QUIZ_VARIANTS = ['multiple-choice', 'true-false', 'drag-match', 'fill-in-blank', 'short-answer'];

export const CourseBriefTopicSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'topic id must be kebab-case'),
  title: z.string().min(3),
  quiz_plan: z.array(z.enum(QUIZ_VARIANTS))
    .min(3, 'each topic needs at least 3 quizzes')
    .max(5, 'each topic has at most 5 quizzes')
    .refine(arr => new Set(arr).size === arr.length, 'quiz variants must be distinct within a topic')
});

export const CourseBriefModuleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'module id must be kebab-case'),
  number: z.number().int().min(1).max(6),
  title: z.string().min(3),
  description: z.string().min(20),
  icon: z.string().min(2),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  topics: z.array(CourseBriefTopicSchema).min(3).max(8)
});

export const CourseBriefSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(3),
  subtitle: z.string().min(10),
  eyebrow: z.string().optional(),
  emoji: z.string().min(1).max(8).optional(),  // a single emoji that captures the course at a glance
  scope: ScopeEnum,
  learner_persona: z.string().min(20),
  learning_objectives: z.array(z.string()).min(2),
  modules: z.array(CourseBriefModuleSchema).min(1).max(6)
});

export function courseBriefSchemaFor(request) {
  if (componentPolicy(request).quizzes) return CourseBriefSchema;
  const topic = CourseBriefTopicSchema.extend({ quiz_plan: z.array(z.enum(QUIZ_VARIANTS)).length(0, 'Quizzes are not selected') });
  const module = CourseBriefModuleSchema.extend({ topics: z.array(topic).min(3).max(8) });
  return CourseBriefSchema.extend({ modules: z.array(module).min(1).max(6) });
}

// --- Topic content (Stage 3 output) ---------------------------------

const QuizOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1)
});

// One union per supported section type. Renderer accepts these exact shapes.
const ConceptSectionSchema = z.object({
  type: z.literal('concept'),
  title: z.string().min(3),
  content: z.string().min(40), // HTML
  expandable: z.boolean().optional()
});

const CalloutSectionSchema = z.object({
  type: z.literal('callout'),
  variant: z.enum(['example', 'key-insight', 'warning', 'tip']),
  title: z.string().optional(),
  content: z.string().min(20)
});

// --- Quiz variants ---
// The renderer dispatches on `variant`. Each variant has its own required fields.

const QuizMultipleChoiceSchema = z.object({
  type: z.literal('quiz'),
  variant: z.literal('multiple-choice'),
  id: z.string().min(3),
  question: z.string().min(10),
  options: z.array(QuizOptionSchema).min(3).max(5),
  correct: z.string().min(1),
  explanation: z.string().min(20)
});

const QuizTrueFalseSchema = z.object({
  type: z.literal('quiz'),
  variant: z.literal('true-false'),
  id: z.string().min(3),
  statement: z.string().min(10),
  correct: z.boolean(),
  explanation: z.string().min(20)
});

const QuizDragMatchSchema = z.object({
  type: z.literal('quiz'),
  variant: z.literal('drag-match'),
  id: z.string().min(3),
  question: z.string().min(10),
  pairs: z.array(z.object({
    left: z.string().min(1),
    right: z.string().min(1)
  })).min(3).max(6),
  explanation: z.string().min(20)
});

const QuizFillInBlankSchema = z.object({
  type: z.literal('quiz'),
  variant: z.literal('fill-in-blank'),
  id: z.string().min(3),
  sentence: z.string().min(10).refine(s => s.includes('___'), 'sentence must contain ___ as the blank marker'),
  acceptable_answers: z.array(z.string().min(1)).min(1).max(6),
  explanation: z.string().min(20)
});

const QuizShortAnswerSchema = z.object({
  type: z.literal('quiz'),
  variant: z.literal('short-answer'),
  id: z.string().min(3),
  question: z.string().min(10),
  sample_answer: z.string().min(40),
  key_points: z.array(z.string()).min(2).max(5),
  explanation: z.string().min(20)
});

const QuizSectionSchema = z.discriminatedUnion('variant', [
  QuizMultipleChoiceSchema,
  QuizTrueFalseSchema,
  QuizDragMatchSchema,
  QuizFillInBlankSchema,
  QuizShortAnswerSchema
]);

const ExerciseSectionSchema = z.object({
  type: z.literal('exercise'),
  id: z.string().min(3),
  title: z.string().min(3),
  prompt: z.string().min(30),
  hints: z.array(z.string()).min(2).max(5)
});

const TakeawaySectionSchema = z.object({
  type: z.literal('takeaway'),
  points: z.array(z.string()).min(3).max(6)
});

const PracticeSectionSchema = z.object({
  type: z.literal('practice'),
  context: z.enum(['general', 'learning', 'swimming']).optional(),
  guidance: z.string().trim().min(20).max(1000).optional(),
  id: z.string().min(3),
  title: z.string().min(3),
  goal: z.string().min(20),
  durationMinutes: z.number().int().min(5).max(30),
  equipment: z.array(z.string().min(1)).min(1).max(8),
  setup: z.string().min(20),
  steps: z.array(z.object({
    title: z.string().min(3),
    instruction: z.string().min(20),
    cue: z.string().min(2),
    repetitions: z.string().optional(),
    success: z.string().min(10)
  })).min(2).max(8),
  regressions: z.array(z.string().min(5)).min(1).max(5),
  progressions: z.array(z.string().min(5)).min(1).max(5),
  safetyStops: z.array(z.string().min(5)).min(1).max(8),
  readinessChecks: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    label: z.string().min(10)
  })).min(1).max(6)
});

const ChecklistSectionSchema = z.object({
  type: z.literal('checklist'),
  id: z.string().regex(/^[a-z0-9-]{3,100}$/),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(20).max(600),
  items: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]{3,100}$/),
    label: z.string().trim().min(5).max(200),
    detail: z.string().trim().min(5).max(600).optional()
  })).min(3).max(8).refine(items => new Set(items.map(item => item.id)).size === items.length, 'Checklist item IDs must be unique')
});

// Image section — embeds a diagram, chart, or screenshot inline in a topic.
// After assemble, `src` is always a resolved URL (http(s):// or data:image/...).
// Before assemble, Stage 3 may emit either:
//   - { type:'image', ref_kind:'web', url, alt, caption, source_title?, source_url? }
//   - { type:'image', ref_kind:'pdf', file_index, page, alt, caption }
// assemble-course.js resolves the pdf ref against the in-memory PDF thumb cache
// and produces the renderer-facing shape below.
// Accepts BOTH lifecycle shapes of an image section:
//   • Pre-assemble (what Stage 3 emits): { ref_kind:'web', url } or
//     { ref_kind:'pdf', file_index, page } — refs into the research bundle.
//   • Post-assemble (what the renderer reads): { src } — a resolved URL or
//     data URL.
// Validation runs at Stage 3 parse time (before assemble), so the schema MUST
// admit the ref shapes; assemble-course.js normalises to `src` and drops
// unresolvable refs.
const ImageSectionSchema = z.object({
  type: z.literal('image'),
  asset_id: z.string().uuid().optional(),
  image_slot: z.literal('instruction').optional(),
  generated_by: z.literal('openai').optional(),
  src: z.string().min(1).optional(),
  ref_kind: z.enum(['web', 'pdf']).optional(),
  url: z.string().optional(),
  file_index: z.number().int().min(0).optional(),
  page: z.number().int().min(1).optional(),
  alt: z.string().min(1),
  caption: z.string().optional(),
  source_title: z.string().optional(),
  source_url: z.string().optional()
}).refine(
  s => s.asset_id ? s.generated_by === 'openai' && s.image_slot === 'instruction' && !s.src && !s.url : s.src || s.url || (s.file_index !== undefined && s.page !== undefined),
  'image section needs src, url, or a pdf {file_index, page} ref'
);

// Image refs as they come back from Stage 2 (research bundle) — discriminated
// on `kind`. Stage 3 picks a subset of these and emits image sections that
// either point to the URL directly (web) or carry the {file_index, page}
// pointer that assemble will resolve to a data URL (pdf).
const WebImageRefSchema = z.object({
  kind: z.literal('web'),
  url: z.string().url(),
  alt: z.string().min(1),
  caption: z.string().optional(),
  source_title: z.string().optional(),
  source_url: z.string().optional()
});
const PdfImageRefSchema = z.object({
  kind: z.literal('pdf'),
  file_index: z.number().int().min(0),
  page: z.number().int().min(1),
  alt: z.string().min(1),
  caption: z.string().optional()
});
export const ImageRefSchema = z.discriminatedUnion('kind', [WebImageRefSchema, PdfImageRefSchema]);

// Outer schema must be z.union (not discriminatedUnion) because QuizSectionSchema
// is itself a discriminated union on `variant` — Zod can't nest those.
export const SectionSchema = z.union([
  ConceptSectionSchema,
  CalloutSectionSchema,
  QuizSectionSchema,
  ExerciseSectionSchema,
  PracticeSectionSchema,
  ChecklistSectionSchema,
  TakeawaySectionSchema,
  ImageSectionSchema
]);

export const FlashcardSchema = z.object({
  front: z.string().min(5),
  back: z.string().min(5)
});

// A teaching decision, not an image checkbox. Keep omission explicit so that
// an intentionally text-only lesson is distinguishable from unfinished work.
export const LESSON_VISUAL_REASON_LIMIT = 600;
export const LessonVisualSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('omit'), reason: z.string().trim().min(10).max(LESSON_VISUAL_REASON_LIMIT) }).strict(),
  z.object({
    decision: z.literal('generate'), reason: z.string().trim().min(10).max(LESSON_VISUAL_REASON_LIMIT),
    prompt: z.string().trim().min(30).max(3600), alt: z.string().trim().min(10).max(300),
    caption: z.string().trim().min(10).max(500), afterSectionIndex: z.number().int().min(0).max(14)
  }).strict()
]);

export const TopicContentSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  moduleId: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(3),
  estimatedMinutes: z.number().int().min(5).max(60),
  // Bumped max to 15 to allow up to 2 image sections per topic on top of the
  // existing concept/quiz/callout/takeaway mix.
  sections: z.array(SectionSchema).min(5).max(15),
  flashcards: z.array(FlashcardSchema).min(3).max(8),
  visual: LessonVisualSchema.optional()
});

export function topicContentSchemaFor(brief, topicMeta = {}, { allowGeneratedAssets = true } = {}) {
  const policy = componentPolicy(brief);
  if (!policy.explicit) return TopicContentSchema;
  return TopicContentSchema.extend({
    sections: z.array(SectionSchema).min(4).max(policy.integratedVisuals ? 16 : 15),
    visual: policy.integratedVisuals ? LessonVisualSchema : LessonVisualSchema.optional(),
    flashcards: policy.flashcards ? z.array(FlashcardSchema).min(3).max(8) : z.array(FlashcardSchema).length(0, 'Flashcards are not selected')
  }).superRefine((topic, ctx) => {
    const issue = message => ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sections'], message });
    if (!allowGeneratedAssets && topic.sections.some(s => s.type === 'image' && (s.asset_id || s.generated_by))) issue('Do not invent generated assets. Return a visual plan; the server creates the image.');
    if (policy.integratedVisuals && topic.visual?.decision === 'generate') {
      // Indices refer to the authored lesson before generated assets are inserted.
      const authored = topic.sections.filter(s => !(s.type === 'image' && s.generated_by === 'openai'));
      if (authored[topic.visual.afterSectionIndex]?.type !== 'concept') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['visual', 'afterSectionIndex'], message: 'Place the illustration immediately after a concept section it teaches.' });
      }
    }
    const quizzes = topic.sections.filter(s => s.type === 'quiz');
    if (!policy.quizzes && quizzes.length) issue('Quizzes are not selected; do not include quiz sections.');
    if (policy.quizzes && (quizzes.length < 3 || quizzes.length > 5)) issue('Quizzes are selected: include 3–5 interleaved quizzes.');
    if (policy.quizzes && topicMeta.quiz_plan?.length && JSON.stringify(quizzes.map(q => q.variant)) !== JSON.stringify(topicMeta.quiz_plan)) issue('Include exactly one quiz per planned variant, in order.');
    if (topic.sections.filter(s => s.type === 'concept').length < 2) issue('Include at least two teaching concepts.');
    if (!topic.sections.some(s => s.type === 'callout')) issue('Include a worked example, tip or other callout.');
    if (topic.sections.filter(s => s.type === 'takeaway').length !== 1) issue('Include exactly one takeaway.');
    if (topic.sections.some(s => s.type === 'exercise')) issue('Free-text exercise sections are not selected. Use only the selected components.');
    for (const [type, selected, label] of [['practice', policy.practice, 'Practice activities'], ['checklist', policy.checklists, 'Checklists']]) {
      const sections = topic.sections.filter(s => s.type === type);
      if (selected && sections.length !== 1) issue(`${label} are selected: include exactly one ${type} section per lesson.`);
      if (!selected && sections.length) issue(`${label} are not selected; do not include ${type} sections.`);
    }
    const ids = topic.sections.filter(s => s.id).map(s => s.id);
    if (new Set(ids).size !== ids.length) issue('Interactive section IDs must be unique within a lesson.');
    for (const section of topic.sections.filter(s => s.type === 'practice')) {
      if (section.context !== 'general' || !section.guidance) issue('Generated practice requires context "general" and topic-specific guidance; never inherit swimming example instructions.');
      if (new Set(section.readinessChecks.map(check => check.id)).size !== section.readinessChecks.length) issue('Practice readiness check IDs must be unique.');
      const text = [section.title, section.goal, section.setup, ...section.equipment, ...section.regressions, ...section.progressions, ...section.safetyStops, ...section.readinessChecks.map(check => check.label), ...section.steps.flatMap(step => [step.title, step.instruction, step.cue, step.success])];
      if (text.some(value => !value.trim())) issue('Practice instructions, stop rules and readiness checks must not be blank.');
    }
  });
}

export function compatibleTopicCheckpoint(brief, saved = {}) {
  if (!componentPolicy(brief).explicit) return { ...saved };
  const compatible = {};
  for (const mod of brief.modules) for (const topic of mod.topics) {
    const key = `${mod.id}/${topic.id}`;
    if (saved[key] && topicContentSchemaFor(brief, topic).safeParse(saved[key]).success) compatible[key] = saved[key];
  }
  return compatible;
}

// --- Research bundle (Stage 2 output) -------------------------------

// Permissive: the model sometimes returns experts/sources as a single string
// instead of an array of objects. Accept both shapes and normalise upstream
// rather than rejecting the whole bundle and losing all research.
const ExpertField = z.union([
  z.array(z.object({ name: z.string(), note: z.string() })),
  z.string().transform(s => [{ name: s, note: '' }]),
  z.null().transform(() => [])
]).default([]);

const SourceField = z.union([
  z.array(z.object({ title: z.string(), url: z.string().optional() })),
  z.string().transform(s => [{ title: s }]),
  z.null().transform(() => [])
]).default([]);

const StringArrayField = z.union([
  z.array(z.string()),
  z.string().transform(s => [s]),
  z.null().transform(() => [])
]).default([]);

// Images optional — Stage 2 returns an array of image refs (web URLs and/or
// PDF page pointers) that Stage 3 may choose from. Permissive: drop malformed
// entries individually rather than rejecting the whole bundle.
const ImagesField = z.union([
  z.array(z.any()).transform(arr =>
    arr.map(item => {
      const r = ImageRefSchema.safeParse(item);
      return r.success ? r.data : null;
    }).filter(Boolean)
  ),
  z.null().transform(() => []),
  z.undefined().transform(() => [])
]).default([]);

export const ResearchBundleSchema = z.object({
  module_id: z.string(),
  key_concepts: z.array(z.string()).min(2),
  examples: z.array(z.string()).min(2),
  experts: ExpertField,
  misconceptions: StringArrayField,
  sources: SourceField,
  images: ImagesField
});
