// Zod schemas that target the renderer's existing topic schema.
// Stage 1 produces a CourseBrief; Stage 3 produces Topic content.
// Stage 4 validates everything before writing to disk.

import { z } from 'zod';

// --- Course brief (Stage 1 output) ----------------------------------

export const ScopeEnum = z.enum(['single_module', 'mini_course', 'full_course']);

export const CourseBriefTopicSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'topic id must be kebab-case'),
  title: z.string().min(3)
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

const QuizSectionSchema = z.object({
  type: z.literal('quiz'),
  variant: z.literal('multiple-choice'),
  id: z.string().min(3),
  question: z.string().min(10),
  options: z.array(QuizOptionSchema).min(3).max(5),
  correct: z.string().min(1),
  explanation: z.string().min(20)
});

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

export const SectionSchema = z.discriminatedUnion('type', [
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
  sections: z.array(SectionSchema).min(4).max(10),
  flashcards: z.array(FlashcardSchema).min(3).max(8)
});

// --- Research bundle (Stage 2 output) -------------------------------

export const ResearchBundleSchema = z.object({
  module_id: z.string(),
  key_concepts: z.array(z.string()).min(2),
  examples: z.array(z.string()).min(2),
  experts: z.array(z.object({
    name: z.string(),
    note: z.string()
  })).default([]),
  misconceptions: z.array(z.string()).default([]),
  sources: z.array(z.object({
    title: z.string(),
    url: z.string().optional()
  })).default([])
});
