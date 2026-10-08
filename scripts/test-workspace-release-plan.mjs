import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planRelease, digest, readTree, releaseName, assertSafePath, transform } from './plan-workspace-release.mjs';

const js = `js-${releaseName}/`, css = `styles-${releaseName}/`;
const catalog = JSON.stringify({ courses: [{ id: 'existing' }] });
const bytes = text => Buffer.from(text);
function fixture() {
  const baselineFiles = new Map(Object.entries({
    'index.html': '<script src="js-matching-release/app.js"></script>',
    'js/app.js': '// original', 'js-dinner-release/app.js': '// dinner', 'js-matching-release/app.js': '// matching',
    'styles/components.css': '/* original */', 'styles/components-matching-release.css': '/* matching */',
    'data/courses/catalog-dinner-release.json': catalog, 'data/courses/index.json': catalog,
    'data/courses/existing/course.json': '{"id":"existing"}', 'data/courses/existing/assets/photo.png': 'PNG fixture',
    'api/gen/start.js': '// original endpoint', 'package.json': '{}', 'package-lock.json': '{}', 'vercel.json': '{}',
  }).map(([p, text]) => [p, bytes(text)]));
  const workspaceFiles = new Map(Object.entries({
    'index.html': '<link href="styles/components.css?v=28"><script src="js/app.js?v=167"></script>',
    'js/app.js': "import './config.js'; import './course-loader.js?v=8';",
    'js/config.js': ['CREATION_IMAGES_ENABLED','SELF_PUBLISH_ENABLED','MODERATION_ENABLED'].map(f => `export const ${f} = false;`).join('\n'),
    'js/course-loader.js': "fetch('data/courses/index.json');",
    'js/community-catalog.js': "fetch('data/courses/index.json');",
    'js/shared.js': "import '../api/_lib/models.mjs';",
    'styles/components.css': '/* new */',
    'api/_lib/models.mjs': '// models', 'api/gen/start.js': "import '../../js/shared.js';",
    'package.json': '{"type":"module","engines":{"node":"^22.13.0"}}', 'package-lock.json': '{}',
    'vercel.json': '{"crons":[{"path":"/api/gen/sweep","schedule":"0 0 * * *"}]}',
    'data/courses/index.json': catalog,
  }).map(([p, text]) => [p, bytes(text)]));
  return { baselineFiles, workspaceFiles,
    baseline: { schemaVersion: 1, deploymentId: 'fixture', verifiedAt: 'fixture', files: Object.fromEntries([...baselineFiles].map(([p, b]) => [p, digest(b, 'sha1')])) },
    migrations: new Map(Array.from({ length: 21 }, (_, i) => [`${String(i+1).padStart(2,'0')}-fixture.sql`, bytes('-- not executed')])) };
}
let checks = 0;
function check(name, run) { run(); checks++; }
function rejects(name, mutate, pattern) { check(name, () => { const input = fixture(); mutate(input); assert.throws(() => planRelease(input), pattern); }); }
const input = fixture(), plan = planRelease(input);
check('planning only', () => assert.equal(plan.status, 'planning-only-not-deployable'));
check('no dropped baseline paths', () => { for (const path of input.baselineFiles.keys()) assert.ok(plan.files[path]); });
check('legacy bytes unchanged', () => { for (const [path, rec] of Object.entries(plan.files)) if (rec.action === 'preserve') assert.equal(rec.sha256, digest(input.baselineFiles.get(path))); });
check('old and new CSS coexist', () => { assert.equal(plan.files['styles/components.css'].action, 'preserve'); assert.equal(plan.files[css+'components.css'].action, 'add'); });
check('HTML new graph', () => assert.equal(plan.files['index.html'].sha256, digest(bytes(`<link href="${css}components.css?v=28"><script src="${js}app.js?v=167"></script>`))));
check('API imports matching new contract', () => assert.equal(plan.files['api/gen/start.js'].sha256, digest(bytes(`import '../../${js}shared.js';`))));
check('catalog physical path', () => assert.equal(plan.files[js+'course-loader.js'].sha256, digest(bytes(`fetch('data/courses/catalog-${releaseName}.json');`))));
check('both loaders transformed', () => assert.deepEqual(plan.files[js+'community-catalog.js'].transforms, ['physical-catalog-url']));
check('catalog copied from verified active source', () => { const p=plan.files[`data/courses/catalog-${releaseName}.json`]; assert.equal(p.origin,'baseline'); assert.equal(p.source,'data/courses/catalog-dinner-release.json'); });
check('server-only module may reference API', () => assert.equal(plan.browserModulesChecked, 3));
check('all forward migrations hashed', () => { assert.equal(plan.migrations.length,21); assert.ok(plan.migrations.every(m=>m.status.includes('not-applied')&&m.sha256.length===64)); });
check('server includes use physical namespace', () => {
  const config = JSON.parse(transform('vercel.json', bytes('{"functions":{"api/setups/generate.js":{"includeFiles":"{js/{setup-model,draft-store}.js,node_modules/pdfjs-dist/legacy/build/**}"}}}')));
  assert.equal(config.functions['api/setups/generate.js'].includeFiles, `{${js}{setup-model,draft-store}.js,node_modules/pdfjs-dist/legacy/build/**}`);
});
check('deterministic', () => assert.deepEqual(planRelease(fixture()), plan));
check('source drift changes manifest', () => { const f=fixture(); f.workspaceFiles.set('js/app.js',bytes(f.workspaceFiles.get('js/app.js')+'\n// changed')); assert.notDeepEqual(planRelease(f),plan); });
rejects('baseline drift', f=>f.baselineFiles.set('js/app.js',bytes('changed')), /baseline drift/);
rejects('missing baseline', f=>f.baselineFiles.delete('js/app.js'), /inventory/);
rejects('extra baseline', f=>f.baselineFiles.set('unexpected.txt',bytes('extra')), /inventory/);
rejects('course edits excluded', f=>f.workspaceFiles.set('data/courses/index.json',bytes('[]')), /Out-of-scope asset/);
rejects('new course excluded', f=>f.workspaceFiles.set('data/courses/new/course.json',bytes('{}')), /Out-of-scope asset/);
rejects('unknown public file excluded', f=>f.workspaceFiles.set('debug.html',bytes('private')), /Out-of-scope asset/);
rejects('old API needs explicit retirement', f=>f.workspaceFiles.delete('api/gen/start.js'), /retirement decision/);
rejects('missing import', f=>f.workspaceFiles.set('js/app.js',bytes("import './missing.js';")), /Missing module/);
rejects('browser cannot import API', f=>f.workspaceFiles.set('js/app.js',bytes("import '../api/_lib/models.mjs';")), /leaves new graph/);
rejects('conflicting singleton', f=>f.workspaceFiles.set('js/app.js',bytes("import './config.js?v=1'; import './config.js?v=2';")), /Conflicting browser/);
rejects('missing HTML asset', f=>f.workspaceFiles.set('index.html',bytes('<script src="js/app.js"></script><link href="styles/missing.css">')), /Missing HTML asset/);
rejects('wrong entry graph', f=>f.workspaceFiles.set('index.html',bytes('<script src="js-matching-release/app.js"></script>')), /new browser graph/);
rejects('unexpected catalog code', f=>f.workspaceFiles.set('js/course-loader.js',bytes("fetch('other.json');")), /requires review/);
rejects('feature enablement forbidden', f=>f.workspaceFiles.set('js/config.js',bytes(f.workspaceFiles.get('js/config.js').toString().replace('SELF_PUBLISH_ENABLED = false','SELF_PUBLISH_ENABLED = true'))), /Unapproved feature/);
rejects('cron scope', f=>f.workspaceFiles.set('vercel.json',bytes('{"crons":[]}')), /Cron scope/);
rejects('runtime major', f=>f.workspaceFiles.set('package.json',bytes('{"engines":{"node":">=24"}}')), /Runtime major/);
rejects('reader includes', f=>f.workspaceFiles.set('api/gen/review.js',bytes('// reader route')), /Missing namespaced shared includes/);
rejects('possible key', f=>f.workspaceFiles.set('js/config.js',bytes(f.workspaceFiles.get('js/config.js')+'\nconst key="sk-proj-'+'a'.repeat(30)+'";')), /Possible provider secret/);
rejects('migration inventory', f=>f.migrations.delete('18-fixture.sql'), /Migration order/);
rejects('secret path', f=>f.workspaceFiles.set('.env',bytes('SECRET=fixture')), /Excluded path/);
check('unsafe path variants', () => { for (const p of ['/etc/passwd','../secret','.vercel/config','api/../secret','a\\b','output/file','a.pem','node_modules/a']) assert.throws(()=>assertSafePath(p)); });

const dir = mkdtempSync(join(tmpdir(), 'learnable-release-plan-test-'));
try {
  mkdirSync(join(dir,'.vercel')); writeFileSync(join(dir,'.vercel','private'), 'never read');
  writeFileSync(join(dir,'.env'), 'never read'); writeFileSync(join(dir,'safe.js'), '// safe');
  check('environment files excluded', () => assert.deepEqual([...readTree(dir).keys()], ['safe.js']));
  symlinkSync(join(dir,'safe.js'), join(dir,'link.js'));
  check('symlinks rejected', () => assert.throws(()=>readTree(dir), /symlink/));
} finally { rmSync(dir, { recursive:true, force:true }); }
console.log(`workspace release-plan contracts passed (${checks} checks; no deploy or network)`);
