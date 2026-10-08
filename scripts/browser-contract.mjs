// Test-only checks for literal browser imports. Computed imports and real browser
// cache behaviour still need browser acceptance; version numbers alone prove neither.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';

export const minimumBrowserVersions = {
  'js/learning-store.js': 3, 'js/user-courses.js': 4, 'js/flashcards.js': 29, 'js/store.js': 5,
  'js/course-editor.js': 7, 'js/course-refinement-client.js': 7, 'styles/course-editor.css': 3,
  'js/course-images.js': 5, 'js/course-image-client.js': 5, 'js/private-course-images.js': 5, 'js/openai-connection.js': 3, 'styles/course-images.css': 2,
  'js/app.js': 179, 'styles/components.css': 28, 'styles/home.css': 28,
  'js/public-course-preview.js': 7, 'js/public-preview-client.js': 4, 'js/course-publishing.js': 6, 'js/shared-course-images.js': 3, 'styles/public-course-preview.css': 4,
  'js/publication-card.js': 4,'js/publication-status-client.js': 4,
  'js/moderation.js': 3,'js/moderation-client.js': 3,
  'js/community-catalog.js':1,'js/community-browser.js': 3,
  'js/intake.js': 97, 'js/cloud-gen-client.js': 92, 'js/auth.js': 33,
  'js/sync.js': 27, 'js/course-loader.js': 8, 'js/course-sync.js': 31,
  'js/components/topic-view.js': 45, 'js/components/diagram.js': 1,
  'js/draft-store.js': 5, 'js/setup-account-client.js': 12,
  'js/home-model.js': 7, 'js/home.js': 29, 'js/course-setup.js': 25,
  'js/home-draft.js': 7, 'js/course-description.js': 1, 'js/setup-account-model.js': 7,
  'js/course-readiness.js': 8, 'js/course-readiness-view.js': 10,
  'js/setup-create.js': 13, 'js/setup-signin.js': 14, 'js/delete-draft.js': 5, 'js/brief-presentation.js': 1, 'js/setup-components.js': 10, 'js/setup-model.js': 7,
  'js/image-progress.js': 2, 'js/image-cost.js': 2, 'js/generator/agents.mjs': 2,
  'js/setup-list.js': 5, 'js/research-evidence.js': 6,
};

export function moduleReferences(source) {
  return [...source.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+)["']/g)].map(match => match[1]);
}

export function assertReferenceVersion(references, specifier, minimum) {
  const matches = references.filter(ref => ref.split('?')[0] === specifier);
  assert.ok(matches.length, `Missing browser reference: ${specifier}`);
  for (const ref of matches) {
    const query = ref.split('?')[1] || '';
    assert.match(query, /^v=[1-9]\d*$/, `Expected numeric cache version: ${ref}`);
    assert.ok(Number(query.slice(2)) >= minimum, `${ref} predates the required v${minimum} contract`);
  }
  assert.equal(new Set(matches).size, 1, `Conflicting references to ${specifier}`);
}

export function assertModuleVersion(source, specifier, minimum) {
  assertReferenceVersion(moduleReferences(source), specifier, minimum);
}

export function htmlAssets(source) {
  return [...source.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
}

export function readBrowserGraph(root = process.cwd(), entryPoints = ['js/app.js']) {
  const web = resolve(root, 'web'), pending = entryPoints.map(entry => resolve(web, entry));
  const sources = new Map(), imports = new Map();
  while (pending.length) {
    const file = pending.pop();
    if (sources.has(file)) continue;
    const source = readFileSync(file, 'utf8');
    sources.set(file, source);
    for (const specifier of moduleReferences(source)) {
      if (!specifier.startsWith('.')) continue;
      const [pathname, query = ''] = specifier.split('?');
      const target = resolve(dirname(file), pathname);
      assert.ok(!relative(web, target).startsWith('..'), `Browser import escapes web: ${specifier}`);
      const entries = imports.get(target) || [];
      entries.push({ query, from: relative(web, file), specifier });
      imports.set(target, entries);
      if (/\.m?js$/.test(pathname)) pending.push(target);
    }
  }
  return { web, sources, imports };
}

export function assertGraphConsistency(graph) {
  for (const [target, entries] of graph.imports) {
    assert.equal(new Set(entries.map(entry => entry.query)).size, 1,
      `Browser singleton has conflicting URLs: ${relative(graph.web, target)}\n${JSON.stringify(entries, null, 2)}`);
    const minimum = minimumBrowserVersions[relative(graph.web, target)];
    if (minimum) assertReferenceVersion(entries.map(entry => `target?${entry.query}`), 'target', minimum);
  }
}
