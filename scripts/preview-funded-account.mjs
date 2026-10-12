// Synthetic, loopback-only visual fixture. Serves allowlisted browser assets;
// no API calls, credentials, hosted data, generation or purchases.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
const root=resolve('web');
const html=`<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Learnable · Funded Account preview</title>
<link rel="stylesheet" href="/styles/tokens.css"><link rel="stylesheet" href="/styles/base.css"><link rel="stylesheet" href="/styles/components.css"><link rel="stylesheet" href="/styles/themes.css">
<style>body{padding:32px;background:var(--bg-primary);color:var(--text-primary)}body>button,body>a,body>label select{min-height:44px;padding:10px;margin:4px}iframe{border:1px solid #aaa;height:760px;width:375px;max-width:100%}</style></head><body><h1>Funded Account preview</h1><p>Synthetic accounts. No payments or generation.</p><label>Account state <select id="state"><option>included</option><option>empty</option><option>not_invited</option><option>paused</option><option>expired</option><option>revoked</option><option>unavailable</option><option>loading</option><option>legacy</option></select></label><button id="account">Open account</button><button id="theme">Toggle theme</button><a href="/?phone=1">375px preview</a><p id="status"></p>
<script type="module">
import { openWorkspaceAccount } from '/js/workspace-account.js';
const params=new URLSearchParams(location.search);if(params.has('phone')){document.body.innerHTML='<h1>375px preview</h1><iframe title="375px Account" src="/?embedded=1"></iframe>';}
else{const state=document.querySelector('#state');state.value=params.get('state')||'included';let user={id:'synthetic-a',email:'learner@example.test'},listeners=new Set();
const client={access:async()=>{if(state.value==='loading')await new Promise(()=>{});if(state.value==='unavailable')throw Error('Synthetic outage');return state.value==='legacy'?{mode:'legacy'}:{mode:'platform',status:state.value,balance:state.value==='not_invited'?null:{available:state.value==='empty'?0:500,reserved:0,used:0},canCreate:false};},connection:async()=>({connected:true,model:'Legacy course model'})};
function open(){user={id:'synthetic-a',email:'learner@example.test'};openWorkspaceAccount({getUser:()=>user,onUserChange:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},signOut:async()=>{user=null;listeners.forEach(fn=>fn());document.querySelector('#status').textContent='Signed out';},client});}
document.querySelector('#account').onclick=open;document.querySelector('#theme').onclick=()=>document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';if(params.has('embedded')||params.has('state'))open();}
</script></body></html>`;
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}if(!/^\/(js|styles)\//.test(url.pathname))throw Error('Not found');const path=resolve(root,'.'+url.pathname);if(!path.startsWith(root+'/'))throw Error('Not found');const type={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'}[extname(path)];if(!type)throw Error('Not found');res.setHeader('Content-Type',type);res.end(await readFile(path));}catch{res.statusCode=404;res.end('Not found');}});
server.listen(0,'127.0.0.1',()=>console.log('Synthetic funded Account preview: http://127.0.0.1:'+server.address().port));
