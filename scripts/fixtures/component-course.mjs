export const componentCombinations = [['lessons'], ['lessons','quizzes'], ['lessons','flashcards'], ['lessons','quizzes','flashcards']];
export const richComponentCombinations = Array.from({ length: 16 }, (_, mask) => ['lessons', ...['practice', 'checklists', 'quizzes', 'flashcards'].filter((_, index) => mask & (1 << index))]);
export function practiceFixture() {
  return {
    type: 'practice', context: 'general', id: 'compare-light', title: 'Compare two lighting angles',
    guidance: 'Use an ordinary object in a clear indoor space. Keep equipment stable and do not look directly into bright lights.',
    goal: 'Compare two photographs and explain how direction changes the shadows.', durationMinutes: 10,
    equipment: ['A camera or phone', 'An ordinary object'], setup: 'Place the object on a stable surface near indirect window light.',
    steps: [
      { title: 'Notice the first angle', instruction: 'Take a photograph from one side and describe where the shadows fall.', cue: 'Notice the shadows', success: 'You can point to the light and dark sides.' },
      { title: 'Compare another angle', instruction: 'Move the camera slightly and compare the second photograph with the first.', cue: 'Change one thing', success: 'You can describe one difference between the photographs.' }
    ], regressions: ['Compare the two supplied examples before taking your own photographs.'],
    progressions: ['Explain which angle you prefer and connect the choice to the lesson.'],
    safetyStops: ['Pause if the setup is unstable or the light is uncomfortable.'],
    readinessChecks: [{ id: 'explain-direction', label: 'I can explain how direction changes the shadows.' }]
  };
}
export function checklistFixture() {
  return {
    type: 'checklist', id: 'photo-preparation', title: 'Before taking the photograph',
    description: 'Use these checks to prepare a simple comparison, then revisit them for your next attempt.',
    items: [
      { id: 'clear-space', label: 'The surface is stable and the space is clear.' },
      { id: 'single-subject', label: 'One main subject is easy to identify.', detail: 'Remove unnecessary objects from the edge of the frame.' },
      { id: 'notice-light', label: 'I have noticed where the light comes from.' }
    ]
  };
}
export function curriculumFixture() {
  return { id:'component-course',title:'Practical Photography',subtitle:'Learn to use light for better photographs',scope:'single_module',learner_persona:'A new photographer learning simple techniques',learning_objectives:['Recognize natural light','Create a clear composition'],modules:[{id:'foundations',number:1,title:'Light and composition',description:'Learn simple ways to use light and compose a clear photograph.',icon:'book',color:'#4338CA',topics:[1,2,3].map(i=>({id:`lesson-${i}`,title:`Photography lesson ${i}`,quiz_plan:['true-false','fill-in-blank','multiple-choice']}))}] };
}
export function lessonFixture(components = ['lessons','quizzes','flashcards'], topic = {id:'lesson-1',title:'Photography lesson 1'}) {
  const quizzes = [
    {type:'quiz',variant:'true-false',id:'quiz-true',statement:'Soft window light can make a useful portrait.',correct:true,explanation:'Window light can be soft enough to avoid harsh facial shadows.'},
    {type:'quiz',variant:'fill-in-blank',id:'quiz-blank',sentence:'Place your subject near a ___ for natural light.',acceptable_answers:['window'],explanation:'A window provides directional light that helps define your subject.'},
    {type:'quiz',variant:'multiple-choice',id:'quiz-choice',question:'Which change helps simplify a busy composition?',options:[{id:'a',text:'Move closer to the subject'},{id:'b',text:'Add more objects'},{id:'c',text:'Ignore the background'}],correct:'a',explanation:'Moving closer can remove distractions and emphasize the main subject.'}
  ];
  const sections=[{type:'concept',title:'Start with natural light',content:'<p>Place your subject near a window and notice how the light falls across it. Change your angle to see the shadows move.</p>'},{type:'concept',title:'Keep the frame simple',content:'<p>Choose one main subject. Move closer and remove distractions from the edge of the photograph to keep attention on it.</p>'},{type:'callout',variant:'tip',title:'Try a different angle',content:'Make a small change in your position and compare how the light looks.'},{type:'takeaway',points:['Start near a window.','Choose one clear subject.','Compare a second angle.']}];
  if (components.includes('quizzes')) { sections.splice(1,0,quizzes[0]); sections.splice(3,0,quizzes[1]); sections.splice(5,0,quizzes[2]); }
  if (components.includes('practice')) sections.splice(-1, 0, practiceFixture());
  if (components.includes('checklists')) sections.splice(-1, 0, checklistFixture());
  return {id:topic.id,moduleId:'foundations',title:topic.title,estimatedMinutes:10,sections,flashcards:components.includes('flashcards') ? [1,2,3,4].map(i=>({front:`Which lighting technique helps in example ${i}?`,back:'Use a nearby window and compare the direction of the shadows.'})) : [], visual:{decision:'omit',reason:'This synthetic lesson is fully explained by its concise worked examples.'}};
}
