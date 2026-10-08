import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const accountSourcePaths = ['js/app.js', 'js/auth.js', 'js/workspace-account.js', 'js/setup-generation-client.js', 'js/setup-create.js', 'styles/components.css'];
export const accountBaseNamespace = 'workspace-20260918-candidate3';
export const accountNamespace = 'workspace-account-20260919-r2';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const frontendTreeHash = files => sha(JSON.stringify([...files].map(([path, bytes]) => [path, sha(bytes)]).sort(([a],[b]) => a.localeCompare(b))));

// Derive fresh browser assets from verified staging bytes, never a whole checkout.
// Preserve all older namespaces (including the server's schema imports).
export function applyAccountFrontendOverlay(base, sources, scope) {
  assert.equal(scope.version, 1); assert.equal(scope.purpose, 'workspace-account-connection');
  assert.equal(scope.baseNamespace, accountBaseNamespace); assert.equal(scope.namespace, accountNamespace);
  assert.equal(frontendTreeHash(base), scope.baseTreeSha256, 'Account overlay base drift.');
  assert.deepEqual([...sources.keys()].sort(), [...accountSourcePaths].sort(), 'Exactly six reviewed Account sources are allowed.');
  assert.deepEqual(Object.keys(scope.sources).sort(), [...accountSourcePaths].sort());
  for (const path of accountSourcePaths) assert.equal(sha(sources.get(path)), scope.sources[path], `Account source drift: ${path}`);
  const result = new Map(base);
  const rebased = text => text.replaceAll(`js-${accountBaseNamespace}/`, `js-${accountNamespace}/`).replaceAll(`styles-${accountBaseNamespace}/`, `styles-${accountNamespace}/`);
  const put = (path, bytes) => { assert.ok(!result.has(path), `Fresh namespace required: ${path}`); result.set(path, bytes); };
  let copied = 0;
  for (const [path, bytes] of base) {
    const kind = path.startsWith(`js-${accountBaseNamespace}/`) ? 'js' : path.startsWith(`styles-${accountBaseNamespace}/`) ? 'styles' : null;
    if (!kind) continue;
    const localPath = `${kind}/${path.slice(`${kind}-${accountBaseNamespace}/`.length)}`;
    let text = (sources.get(localPath) || bytes).toString();
    if (localPath === 'js/auth.js') text = text.replaceAll('https://supabase.com/dashboard/project/olzardlkaxgjqvwnjzil/', 'https://supabase.com/dashboard/project/dmnwkrybgggbpqpetuub/');
    put(path.replace(accountBaseNamespace, accountNamespace), Buffer.from(rebased(text))); copied++;
  }
  assert.ok(copied > 70, 'Complete verified workspace namespace required.');
  put(`js-${accountNamespace}/workspace-account.js`, Buffer.from(rebased(sources.get('js/workspace-account.js').toString())));
  const html = base.get('index.html').toString();
  assert.ok(html.includes(`js-${accountBaseNamespace}/app.js`) && html.includes(`styles-${accountBaseNamespace}/components.css`));
  result.set('index.html', Buffer.from(rebased(html)));
  const config = result.get(`js-${accountNamespace}/config.js`).toString();
  assert.ok(config.includes('dmnwkrybgggbpqpetuub.supabase.co') && !config.includes('olzardlkaxgjqvwnjzil'));
  for (const flag of ['CREATION_IMAGES_ENABLED', 'SELF_PUBLISH_ENABLED', 'MODERATION_ENABLED']) assert.match(config, new RegExp(`${flag}\\s*=\\s*false`));
  return result;
}
