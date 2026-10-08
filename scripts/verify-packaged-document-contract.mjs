// Run the unchanged document-source assertions against actual packaged server
// and browser modules. Import paths only are remapped; the 8s reader limit stays.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const artifact=resolve(process.argv[2]),report=JSON.parse(readFileSync(artifact+'/packaging-report.json'));
const group=report.groups.find(g=>g.files['api/_lib/setup-generation.mjs']&&g.files['api/_lib/document-reader.mjs']);
assert.ok(group);
const qa=mkdtempSync(join(tmpdir(),'learnable-parser-contract-'));
cpSync(join(artifact,`.vercel/output/functions/_functions/${group.id}.func`),join(qa,'bundle'),{recursive:true});
const browser=join(artifact,`.vercel/output/static/js-${report.groundingOverlay?.namespace || report.sourceRecoveryOverlay?.scope.namespace || report.accountFrontendOverlay.scope.namespace}`);
let source=readFileSync('scripts/test-document-sources.mjs','utf8');
const imports={
  '../web/api/_lib/document-reader.mjs':join(qa,'bundle/api/_lib/document-reader.mjs'),
  './fixtures/source-documents.mjs':resolve('scripts/fixtures/source-documents.mjs'),
  '../web/api/_lib/setup-generation.mjs':join(qa,'bundle/api/_lib/setup-generation.mjs'),
  '../web/js/setup-account-model.js':join(browser,'setup-account-model.js'),
  '../web/js/setup-model.js':join(browser,'setup-model.js'),
  '../web/js/setup-source-review.js':join(browser,'setup-source-review.js'),
  '../web/js/generator/agents.mjs':join(browser,'generator/agents.mjs')
};
for(const [from,to]of Object.entries(imports)){assert.equal(source.split("'"+from+"'").length,2);source=source.replace("'"+from+"'",JSON.stringify(pathToFileURL(to).href));}
const file=join(qa,'contract.mjs');writeFileSync(file,source,{flag:'wx'});
const output=execFileSync(process.execPath,[file],{encoding:'utf8',env:{PATH:process.env.PATH},timeout:180000});
const count=Number(output.match(/Document sources: (\d+) checks passed/)?.[1]);assert.ok(count>40);
const result={at:new Date().toISOString(),status:'passed-packaged-document-contract',checks:count,assertions:'unchanged; import paths remapped only',readerLimitMs:8000,network:'container disabled',qa};
writeFileSync(artifact+'/document-contract-qa.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
