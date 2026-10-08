import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { frontendTreeHash } from './account-frontend-overlay.mjs';

export const recoverySource = 'js/course-setup.js';
export const recoveryBaseNamespace = 'workspace-account-20260919-r2';
export const recoveryNamespace = 'workspace-source-recovery-20260919';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

// One reviewed browser module only. All prior namespaces/server inputs survive.
export function applySourceRecoveryOverlay(base, source, scope) {
  assert.equal(scope.version,1);assert.equal(scope.purpose,'source-original-notice');
  assert.equal(scope.baseNamespace,recoveryBaseNamespace);assert.equal(scope.namespace,recoveryNamespace);
  assert.equal(frontendTreeHash(base),scope.baseTreeSha256,'Recovery base drift');
  assert.deepEqual(Object.keys(scope.sources),[recoverySource]);
  assert.equal(sha(source),scope.sources[recoverySource],'Recovery source drift');
  const result=new Map(base);
  const rebase=text=>text.replaceAll(`js-${recoveryBaseNamespace}/`,`js-${recoveryNamespace}/`).replaceAll(`styles-${recoveryBaseNamespace}/`,`styles-${recoveryNamespace}/`);
  let copied=0;
  for(const [path,bytes]of base){
    const kind=path.startsWith(`js-${recoveryBaseNamespace}/`)?'js':path.startsWith(`styles-${recoveryBaseNamespace}/`)?'styles':null;
    if(!kind)continue;
    const localPath=kind+'/'+path.slice(`${kind}-${recoveryBaseNamespace}/`.length);
    const target=path.replace(recoveryBaseNamespace,recoveryNamespace);
    assert.ok(!result.has(target),'Fresh namespace required');
    result.set(target,Buffer.from(rebase((localPath===recoverySource?source:bytes).toString())));copied++;
  }
  assert.ok(copied>70,'Complete Account namespace required');
  const html=base.get('index.html').toString();assert.ok(html.includes(`js-${recoveryBaseNamespace}/app.js`));
  result.set('index.html',Buffer.from(rebase(html)));
  return result;
}
