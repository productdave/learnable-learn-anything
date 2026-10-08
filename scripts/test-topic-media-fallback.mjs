import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderDiagram } from '../web/js/components/diagram.js';

const topicView = readFileSync('web/js/components/topic-view.js', 'utf8');
const app = readFileSync('web/js/app.js', 'utf8');
const css = readFileSync('web/styles/components.css', 'utf8');

assert.ok(
  topicView.includes('const src = section?.src || section?.url;'),
  'image sections should render older url-only shapes as well as assembled src shapes.'
);
assert.ok(
  topicView.includes('class="topic-image-fallback"') &&
    topicView.includes("img.addEventListener('error', markFailed") &&
    topicView.includes("figure.classList.add('topic-image--failed')"),
  'image sections should swap broken external images into a visible fallback.'
);
assert.ok(
  css.includes('.topic-image--failed img { display: none; }') &&
    css.includes('.topic-image--failed .topic-image-fallback'),
  'broken image fallback should be styled instead of exposing browser alt text.'
);

assert.doesNotThrow(() => renderDiagram({ type: 'flow', data: {} }));
assert.match(
  renderDiagram({ type: 'flow', data: {} }),
  /diagram-fallback/,
  'malformed generated diagrams should render a fallback block.'
);

{
  const routeStart = app.indexOf('async function renderRoute()');
  const loadCourseCall = app.indexOf('if (courseId) await loadCourse(courseId);', routeStart);
  const getCurriculumCall = app.indexOf('const curriculum = getCurriculum();', routeStart);
  assert.ok(
    routeStart >= 0 && loadCourseCall > routeStart && getCurriculumCall > loadCourseCall,
    'hash/topic routing should reload the course before reading curriculum after media repair invalidates cache.'
  );
}

console.log('topic media fallback tests passed');
