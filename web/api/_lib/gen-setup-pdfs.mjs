import {createHash} from 'node:crypto';
import {normalizeAccountPayload,setupIdentifier,sourcePath} from '../../js/setup-account-model.js';
import {readDocument} from './document-reader.mjs';

// Saved setup files use a separate, owner-scoped bucket from legacy job uploads.
// Derive paths from validated metadata; never accept a stored URL or bucket name.
export function setupPdfSources(userBrief = {}) {
  const files=userBrief.source_manifest?.files;
  if(!files?.length)return [];
  const normalized=normalizeAccountPayload({schemaVersion:1,
    brief:{topic:'Saved course sources',audience:'Course owner',goal:'',starting_point:'',context:'',depth:'',experience:''},
    components:['lessons'],sources:{notes:[],links:[],files}});
  const storageId=setupIdentifier(userBrief.source_storage_id || userBrief.setup_reference?.id);
  return normalized.sources.files.filter(f=>f.type==='application/pdf').map(file=>({file,storageId}));
}

export async function resolveSetupPdfs(supabase,sources,{ownerId,requestBudget,offset=0}) {
  const result=[];
  for(const {file,storageId} of sources){
    const path=sourcePath(ownerId,storageId,file);
    const pdf=await requestBudget.runOperation(async signal=>{
      const {data,error}=await supabase.storage.from('setup-sources').download(path);
      signal.throwIfAborted();
      if(error||!data||data.size!==file.size)throw new Error('The saved PDF original could not be read. Your sources are retained.');
      const bytes=Buffer.from(await data.arrayBuffer());
      if(bytes.length!==file.size||createHash('sha256').update(bytes).digest('hex')!==file.sha256)
        throw new Error('The saved PDF original no longer matches the reviewed source.');
      const document=await readDocument(bytes,'pdf',{timeoutMs:8000});
      signal.throwIfAborted();
      return {file_index:offset+result.length,name:file.name,base64:bytes.toString('base64'),pageCount:document.pages};
    },{timeoutMs:15000});
    result.push(pdf);
  }
  return result;
}
