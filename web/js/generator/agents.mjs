// Named course-creation agents.
//
// The generator still runs as one orchestrated pipeline, but every stage now
// has an explicit role. This keeps the product honest: Learnable is one agent
// interface coordinating specialist sub-agents, not a generic SaaS workflow.

export const COURSE_AGENTS = {
  curriculum: {
    id: 'curriculum',
    name: 'Curriculum Designer',
    verb: 'designing',
    stage: 'intake',
    short: 'Designs the course map',
    message: 'Curriculum Designer is mapping the course…',
    systemLine: 'You are the Curriculum Designer. Your job is to turn the learner request into the right scope, modules, topic sequence, and learning objectives.'
  },
  researcher: {
    id: 'researcher',
    name: 'Researcher',
    verb: 'researching',
    stage: 'research',
    short: 'Grounds modules in sources',
    message: 'Researcher is gathering source material…',
    systemLine: 'You are the Researcher. Your job is to ground the module in current, canonical, real-world material, examples, misconceptions, sources, and useful diagrams.'
  },
  lessonWriter: {
    id: 'lessonWriter',
    name: 'Lesson Writer',
    verb: 'writing',
    stage: 'topics',
    short: 'Writes lesson content',
    message: 'Lesson Writer is drafting lessons…',
    systemLine: 'You are the Lesson Writer. Your job is to teach the topic clearly with short explanations, concrete examples, and a deliberate learning arc.'
  },
  practiceDesigner: {
    id: 'practiceDesigner',
    name: 'Practice Designer',
    verb: 'building practice',
    stage: 'topics',
    short: 'Creates quizzes and exercises',
    message: 'Practice Designer is building checks for understanding…',
    systemLine: 'You are also coordinating with the Practice Designer, who turns the lesson into interleaved quizzes, optional exercises, and flashcards that test what was just taught.'
  },
  reviewer: {
    id: 'reviewer',
    name: 'Reviewer',
    verb: 'reviewing',
    stage: 'assemble',
    short: 'Assembles and checks the course',
    message: 'Reviewer is assembling the course…',
    systemLine: 'You are the Reviewer. Your job is to assemble the course, resolve assets, keep valid topics, surface failures clearly, and preserve a usable learning path.'
  }
};

export const COURSE_AGENT_SEQUENCE = [
  COURSE_AGENTS.curriculum,
  COURSE_AGENTS.researcher,
  COURSE_AGENTS.lessonWriter,
  COURSE_AGENTS.practiceDesigner,
  COURSE_AGENTS.reviewer
];

export function agentByStage(stage) {
  if (stage === 'intake') return COURSE_AGENTS.curriculum;
  if (stage === 'research') return COURSE_AGENTS.researcher;
  if (stage === 'topics') return COURSE_AGENTS.lessonWriter;
  if (stage === 'assemble' || stage === 'done') return COURSE_AGENTS.reviewer;
  return COURSE_AGENTS.curriculum;
}

export function agentNameForStage(stage) {
  return agentByStage(stage).name;
}

export function agentMessage(stage, fallback = '') {
  return agentByStage(stage).message || fallback;
}

export function agentSystemLines(...ids) {
  return ids
    .map(id => COURSE_AGENTS[id]?.systemLine)
    .filter(Boolean)
    .join('\n');
}
