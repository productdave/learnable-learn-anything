// Stage 1 — Intake → Course Brief
//
// Takes a user brief (topic + variables) and produces a structured CourseBrief
// that decides scope, module breakdown, and topic titles. Single Haiku call,
// forced JSON output via tool use.

import { CourseBriefSchema } from '../schema.mjs';

const TOOL_NAME = 'submit_course_brief';

const briefTool = {
  name: TOOL_NAME,
  description: 'Submit the proposed course brief once you have decided on scope, modules, and topics.',
  input_schema: {
    type: 'object',
    required: ['id', 'title', 'subtitle', 'scope', 'learner_persona', 'learning_objectives', 'modules'],
    properties: {
      id: { type: 'string', description: 'kebab-case identifier for the course, e.g. "pour-over-coffee"' },
      title: { type: 'string', description: 'Short, evocative course title (2-5 words)' },
      subtitle: { type: 'string', description: 'One-sentence promise of what the learner will be able to do' },
      eyebrow: { type: 'string', description: 'Optional small label, e.g. "Free Course"' },
      scope: {
        type: 'string',
        enum: ['single_module', 'mini_course', 'full_course'],
        description: 'single_module = 1 module / 4-6 topics. mini_course = 3 modules / 9-12 topics. full_course = 6 modules / 18-24 topics. Choose based on topic breadth and the learner\'s depth preference.'
      },
      learner_persona: {
        type: 'string',
        description: 'One sentence describing who this is for, in plain English. e.g. "Hobbyist home brewer who just bought their first V60 and wants café-quality results."'
      },
      learning_objectives: {
        type: 'array',
        items: { type: 'string' },
        description: '3-5 concrete things the learner will be able to do after finishing.'
      },
      modules: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          required: ['id', 'number', 'title', 'description', 'icon', 'color', 'topics'],
          properties: {
            id: { type: 'string', description: 'kebab-case module id' },
            number: { type: 'integer', description: '1-indexed module number' },
            title: { type: 'string' },
            description: { type: 'string', description: '1-2 sentence description of what this module covers' },
            icon: {
              type: 'string',
              description: 'One of: target, scale, briefcase, users, repeat, settings, brain, lightbulb, book, compass'
            },
            color: {
              type: 'string',
              description: 'Hex color for the module accent. Pick from: #4338CA, #D97706, #059669, #0EA5E9, #E11D48, #8B5CF6 — use a different color for each module.'
            },
            topics: {
              type: 'array',
              minItems: 3,
              maxItems: 6,
              items: {
                type: 'object',
                required: ['id', 'title'],
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }
};

const SYSTEM = `You are a curriculum designer. Given a learner's topic and constraints, design a course outline that genuinely fits the topic's breadth.

Critical rules:
- SCOPE is yours to decide. Don't default to 6 modules. A narrow practical topic ("pour-over coffee", "negotiating a salary") usually wants single_module. A broad subject ("game theory", "personal finance") may want full_course. Match the topic to the scope honestly.
- Topic titles should be specific and concrete, not generic. "What Makes Good Coffee Good" beats "Introduction to Coffee".
- Module descriptions should preview the *substance*, not just restate the title.
- Pick module colors from the provided palette. Use a DIFFERENT color for each module.
- Use kebab-case ids ("pour-over-basics", not "Pour Over Basics").
- Submit your answer by calling the submit_course_brief tool. Do not write a long preamble.`;

export async function runIntake(client, userBrief) {
  const userMsg = `Design a course based on this learner request:

Topic: ${userBrief.topic}
Goal: ${userBrief.goal || '(unspecified)'}
Starting point: ${userBrief.starting_point || '(unspecified)'}
Depth preference: ${userBrief.depth || 'Solid foundation'}
Time budget: ${userBrief.time_budget || '(unspecified)'}

Decide the right scope (single_module / mini_course / full_course), break the subject into modules, and propose 4-6 topic titles per module. Submit via the tool.`;

  const resp = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: SYSTEM,
    tools: [briefTool],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: userMsg }]
  });

  const toolUse = resp.content.find(b => b.type === 'tool_use' && b.name === TOOL_NAME);
  if (!toolUse) throw new Error('Stage 1: model did not call the brief tool');

  const parsed = CourseBriefSchema.parse(toolUse.input);
  return parsed;
}
