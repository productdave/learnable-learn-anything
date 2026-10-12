import { generationProvider } from './generation-provider.mjs';
import { validateOpenRouterPolicy, quoteOpenRouterText, OpenRouterError } from './openrouter-policy.mjs';
const stop=(code,message)=>{throw Object.assign(new OpenRouterError(code,message),{statusCode:409});};
export const usesPlatformGeneration = (env=process.env) => env.LEARNABLE_GENERATION_PROVIDER === 'openrouter';
export async function inspectOpenRouterAccess(supabase,ownerId,{env=process.env,now=Date.now()}={}) {
 if (!usesPlatformGeneration(env)) {
  if (env.LEARNABLE_GENERATION_PROVIDER && env.LEARNABLE_GENERATION_PROVIDER !== 'anthropic') stop('configuration','Course generation configuration needs attention.');
  return null;
 }
 const base={provider:'openrouter',managed:true,connected:false,ready:false,imageConnected:false};
 if (env.LEARNABLE_OPENROUTER_ENABLED!=='1') return {...base,reason:'paused',message:'Course creation is paused. Your saved work is available.'};
 if (!env.OPENROUTER_API_KEY?.trim()) return {...base,reason:'connection',message:'The Learnable connection needs attention. No personal API keys are needed.'};
 let result;
 try {result=await supabase.rpc('inspect_learnable_ai_pilot',{p_owner_id:ownerId});}catch{stop('approval','OpenRouter pilot access could not be confirmed. Your saved setup is retained.');}
 if(result?.error||!result?.data) stop('approval','OpenRouter pilot access could not be confirmed. Your saved setup is retained.');
 if(!result.data.ok) return {...base,reason:result.data.reason,message:result.data.reason==='not_enrolled'?'Course creation is not enabled for this account yet.':'Course creation needs a renewed testing allowance. Your saved work is retained.'};
 let policy;
 try {policy=validateOpenRouterPolicy(result.data.policy,{now});}catch{stop('approval','OpenRouter model settings need operator review. Your saved work is retained.');}
 if (!policy.nativeResearchAccepted || !policy.imagesAccepted) stop('unsupported','The complete OpenRouter course route is not available yet.');
 const remaining=result.data.remainingMicrousd;
 if(!Number.isSafeInteger(remaining)||remaining<quoteOpenRouterText(policy.routes.curriculum,4096))
  return {...base,reason:'budget',message:'The testing allowance cannot cover another course plan. Your saved work is retained.'};
 return {...base,connected:true,ready:true,imageConnected:true,policy,model:policy.routes.curriculum.model,message:'Learnable is ready to create your course. No personal API keys are needed.'};
}
export async function admitOpenRouterJob(supabase,ownerId,jobId,access,{env=process.env,now=Date.now()}={}) {
 if(!access?.ready||!access.policy) stop('approval',access?.message||'OpenRouter pilot access is unavailable.');
 const result=await supabase.rpc('admit_learnable_ai_job',{p_owner_id:ownerId,p_job_id:jobId,p_policy_hash:access.policy.fingerprint});
 if(result?.error||!result?.data?.ok) stop('approval','The course authorization could not be confirmed. Check the saved setup before starting again.');
 const binding={ai_policy:result.data.policy,ai_budget_ids:result.data.budgetIds};
 const provider=generationProvider({id:jobId,owner_id:ownerId,...binding},ownerId,{env,now});
 if(provider.policy.fingerprint!==access.policy.fingerprint) stop('approval','The reviewed settings changed before creation. Check again.');
 return binding;
}
export function publicOpenRouterAccess(access) { const {policy,...visible}=access;return visible; }
