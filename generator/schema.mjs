// Zod schemas that target the renderer's existing topic schema.
// Stage 1 produces a CourseBrief; Stage 3 produces Topic content.
// Stage 4 validates everything before writing to disk.

import { z } from 'zod';

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
  scope: ScopeEnum,
  learner_persona: z.string().min(20),
  learning_objectives: z.array(z.string()).min(2),
  modules: z.array(CourseBriefModuleSchema).min(1).max(6)
});

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

// Outer schema must be z.union (not discriminatedUnion) because QuizSectionSchema
// is itself a discriminated union on `variant` — Zod can't nest those.
export const SectionSchema = z.union([
  ConceptSectionSchema,
  CalloutSectionSchema,
  QuizSectionSchema,
  ExerciseSectionSchema,
  TakeawaySectionSchema
]);

export const FlashcardSchema = z.object({
  front: z.string().min(5),
  back: z.string().min(5)
});

export const TopicContentSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  moduleId: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(3),
  estimatedMinutes: z.number().int().min(5).max(60),
  sections: z.array(SectionSchema).min(5).max(13),
  flashcards: z.array(FlashcardSchema).min(3).max(8)
});

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

export const ResearchBundleSchema = z.object({
  module_id: z.string(),
  key_concepts: z.array(z.string()).min(2),
  examples: z.array(z.string()).min(2),
  experts: ExpertField,
  misconceptions: z.array(z.string()).default([]),
  sources: SourceField
});
