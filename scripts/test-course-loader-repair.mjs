import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  setItem(key, value) {
    store.set(key, String(value));
  },
  removeItem(key) {
    store.delete(key);
  }
};
globalThis.window = {
  location: { search: '?course=multi-agent-workflow-systems' }
};

const {
  loadCourse,
  loadModule,
  getCourseConfig,
  normalizeSavedCourse
} = await import('../web/js/course-loader.js?test=repair');

const brokenSavedCourse = {
  config: {
    id: 'multi-agent-workflow-systems',
    title: 'Multi-Agent Workflow Systems'
  },
  curriculum: {},
  modules: {
    1: {
      'agent-fundamentals': {
        id: 'agent-fundamentals',
        title: 'Agent Fundamentals',
        sections: []
      }
    }
  },
  _brief: {
    id: 'multi-agent-workflow-systems',
    title: 'Multi-Agent Workflow Systems',
    subtitle: 'Build intelligent agent teams.',
    modules: [
      {
        id: 'architecture',
        number: 1,
        title: 'Agent Fundamentals & Architecture',
        description: 'Understand the system shape.',
        topics: [
          { id: 'agent-fundamentals', title: 'Agent Fundamentals' }
        ]
      }
    ]
  }
};

localStorage.setItem('learnable-user-courses', JSON.stringify({
  'multi-agent-workflow-systems': brokenSavedCourse
}));

const normalized = normalizeSavedCourse(brokenSavedCourse, 'multi-agent-workflow-systems');
assert.equal(normalized.curriculum.title, 'Multi-Agent Workflow Systems');
assert.equal(normalized.curriculum.modules.length, 1);
assert.equal(normalized.curriculum.modules[0].topics[0].id, 'agent-fundamentals');

const loaded = await loadCourse('multi-agent-workflow-systems');
assert.equal(loaded.config.name, 'Multi-Agent Workflow Systems');
assert.equal(loaded.curriculum.modules[0].id, 'architecture');
assert.equal(loaded.curriculum.modules[0].topics.length, 1);

const moduleData = await loadModule('architecture', 'multi-agent-workflow-systems');
assert.equal(moduleData['agent-fundamentals'].title, 'Agent Fundamentals');

const unrecoverable = normalizeSavedCourse({
  config: { id: 'empty', title: 'Empty' },
  curriculum: {}
}, 'empty');
assert.deepEqual(unrecoverable.curriculum.modules, []);

const otherCourse={...brokenSavedCourse,config:{id:'cards-off',title:'Cards off',components:['lessons']}};
localStorage.setItem('learnable-user-courses',JSON.stringify({'multi-agent-workflow-systems':brokenSavedCourse,'cards-off':otherCourse}));
await loadCourse('cards-off');
assert.deepEqual(getCourseConfig().components,['lessons']);
await loadCourse('multi-agent-workflow-systems');
assert.equal(getCourseConfig().id,'multi-agent-workflow-systems','returning to a cached course restores the active config');
await loadCourse('cards-off');
assert.deepEqual(getCourseConfig().components,['lessons'],'cached cards-off course restores its own component policy');

console.log('course loader repair tests passed');
