import assert from 'node:assert/strict';

// Explicit allowlist: a new/removed endpoint makes the build fail until reviewed.
// Group ceilings never shorten an existing explicit endpoint maxDuration.
export const functionGroups = [
  { id: 'generation', maxDuration: 300, routes: ['gen/start', 'gen/resume', 'gen/restart', 'gen/review', 'gen/credentials-ready', 'gen/sweep'] },
  { id: 'generation-controls', maxDuration: 300, routes: ['gen/cancel', 'gen/delete', 'gen/watchdog'] },
  { id: 'sources', maxDuration: 300, routes: ['setups/store', 'setups/generate', 'gen/sources'] },
  { id: 'courses', maxDuration: 300, routes: ['courses/get', 'courses/refine', 'courses/proposal', 'courses/community', 'courses/publish', 'courses/publication-status', 'courses/public-preview', 'courses/public-image', 'courses/moderation'] },
  { id: 'images', maxDuration: 300, routes: ['courses/images'] },
  { id: 'providers', maxDuration: 300, routes: ['providers/connection', 'providers/openai'] },
  { id: 'media', maxDuration: 20, routes: ['media/resolve-image'] },
  { id: 'health', maxDuration: 300, routes: ['health/cloud'] },
];
export const endpointPaths = functionGroups.flatMap(group => group.routes.map(route => `api/${route}.js`)).sort();

export function validateEndpoints(files) {
  const found = [...files.keys()].filter(path => path.startsWith('api/') && /\.m?js$/.test(path) &&
    !path.split('/').slice(1).some(part => part.startsWith('_'))).sort();
  assert.deepEqual(found, endpointPaths, 'Endpoint inventory changed; review the grouping allowlist.');
  assert.equal(new Set(endpointPaths).size, endpointPaths.length, 'Duplicate grouped endpoint.');
  assert.ok(functionGroups.length <= 12);
  for (const group of functionGroups) for (const route of group.routes) {
    const source = files.get(`api/${route}.js`).toString();
    const duration = source.match(/maxDuration\s*:\s*(\d+)/)?.[1];
    assert.ok(!duration || Number(duration) <= group.maxDuration, `Grouping shortens ${route}'s timeout.`);
  }
}

export function groupEntrypoint(group) {
  // Literal imports let the official Node builder trace every handler. No import
  // specifier comes from a request, and no existing handler is moved or rewritten.
  return `import { createGroupedHandler } from '../_lib/grouped-router.mjs';\n` +
    `export const config = { runtime: 'nodejs', maxDuration: ${group.maxDuration} };\n` +
    `export default createGroupedHandler({\n` + group.routes.map(route =>
      `  ${JSON.stringify('/api/' + route)}: () => import(${JSON.stringify('../' + route + '.js')}),`
    ).join('\n') + '\n});\n';
}

export function buildOutputConfig(vercel) {
  assert.deepEqual(vercel.crons, [{ path: '/api/gen/sweep', schedule: '0 0 * * *' }], 'Review changed cron cadence.');
  assert.ok(!vercel.routes && !vercel.rewrites && !vercel.redirects, 'Review additional routing before packaging.');
  const headers = [];
  for (const rule of vercel.headers || []) {
    assert.equal(rule.source, '/(.*)', 'Review non-global headers before packaging.');
    headers.push({ src: '/(.*)', headers: Object.fromEntries(rule.headers.map(({ key, value }) => [key, value])), continue: true });
  }
  return { version: 3, crons: vercel.crons, routes: [
    ...headers,
    // Do not expose the physical grouped entrypoints, config or private sources.
    { src: '^/(?:_functions|api/_lib|api/_grouped|node_modules|\\.vercel)(?:/.*)?$', status: 404 },
    ...functionGroups.flatMap(group => group.routes.map(route => ({
      src: `^/api/${route}(?:\\.js)?/?$`, dest: `/_functions/${group.id}`, caseSensitive: true,
    }))),
    { src: '^/api(?:/.*)?$', status: 404 },
    { handle: 'filesystem' },
    { src: '^/$', dest: '/index.html' },
  ] };
}

export function staticFile(path) {
  return path === 'index.html' || path === 'favicon.svg' || /^(?:js[^/]*|styles[^/]*|data|assets)\//.test(path);
}
