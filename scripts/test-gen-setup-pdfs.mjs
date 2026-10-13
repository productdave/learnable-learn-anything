import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {pdfFixture} from './fixtures/source-documents.mjs';
import {setupPdfSources,resolveSetupPdfs} from '../web/api/_lib/gen-setup-pdfs.mjs';
const bytes=pdfFixture(['First page','Second page']),file={id:'file-one',name:'notes.pdf',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
const brief={source_storage_id:'setup-one',source_manifest:{files:[file]}};
const requestBudget={runOperation:fn=>fn(new AbortController().signal)};
test('original bytes, page order and file indices survive native hydration',async()=>{
 const paths=[],supabase={storage:{from:bucket=>{assert.equal(bucket,'setup-sources');return {download:async path=>{paths.push(path);return {data:new Blob([bytes])};}};}}};
 const result=await resolveSetupPdfs(supabase,setupPdfSources(brief),{ownerId:'owner-one',requestBudget,offset:2});
 assert.deepEqual(paths,[`owner-one/setup-one/file-one/${file.sha256}`]);assert.equal(result[0].base64,bytes.toString('base64'));assert.equal(result[0].file_index,2);assert.equal(result[0].pageCount,2);
});
test('plain-text and Word sources do not become fake PDFs',()=>{assert.deepEqual(setupPdfSources({source_storage_id:'setup-one',source_manifest:{files:[{...file,name:'notes.txt'}]}}),[]);assert.deepEqual(setupPdfSources(),[]);});
for(const [name,change]of [['traversal',f=>f.id='../other'],['oversize',f=>f.size=11000000],['forged digest',f=>f.sha256='bad']])test(name+' fails before storage access',()=>{const input=structuredClone(brief);change(input.source_manifest.files[0]);assert.throws(()=>setupPdfSources(input));});
test('missing or mismatched original fails before any native request',async()=>{
 for(const response of [{error:{message:'private-storage-detail'}},{data:new Blob(['wrong'])},{data:new Blob([Buffer.alloc(bytes.length)])}]){
  const client={storage:{from:()=>({download:async()=>response})}};
  await assert.rejects(resolveSetupPdfs(client,setupPdfSources(brief),{ownerId:'owner-one',requestBudget}),/saved PDF original/);
 }
});
