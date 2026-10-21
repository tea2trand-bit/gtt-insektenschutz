import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='https://deploy-preview-20--gtt-insektenschutz.netlify.app';
const password=await readFile(new URL('../.local-records/preview-password.txt',import.meta.url),'utf8');
const login=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
const session=await login.json();assert.equal(login.status,200);assert.ok(session.token);
async function api(path='',method='GET',body){const r=await fetch(base+'/api/admin/records'+path,{method,headers:{Authorization:'Bearer '+session.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();return {status:r.status,...d};}
const noAuth=await fetch(base+'/api/admin/records');assert.equal(noAuth.status,401);
const created=await api('','POST',{requestId:'22222222-2222-4222-8222-222222222222',name:'TEST · Cloud evidencija',phone:'+41 00 000 00 00',quotedPrice:275,channel:'TEST preview'});
assert.ok([200,201].includes(created.status),created.error);let r=created.record;
const duplicate=await api('','POST',{requestId:'22222222-2222-4222-8222-222222222222',name:'TEST · Cloud evidencija',phone:'+41 00 000 00 00',quotedPrice:275});assert.equal(duplicate.record.id,r.id);assert.equal(duplicate.status,200);
if(r.document.status!=='Prihvaćeno'){const accepted=await api('/'+r.id,'PATCH',{revision:r.revision,action:'decision',status:'Prihvaćeno'});assert.equal(accepted.status,200,accepted.error);r=accepted.record;}
const opened=await api('/'+r.id);r=opened.record;assert.equal(r.document.agreedPrice,275);assert.equal(r.original.price,275);assert.ok(r.document.decisionDate);assert.ok(r.history.length>=2);
const concurrent=await Promise.all([api('/'+r.id,'PATCH',{revision:r.revision,patch:{notes:'TEST · cloud save A'}}),api('/'+r.id,'PATCH',{revision:r.revision,patch:{notes:'TEST · cloud save B'}})]);
assert.equal(concurrent.filter(x=>x.status===200).length,1);assert.equal(concurrent.filter(x=>x.status===409).length,1);
const pending=await api('/pending');assert.equal(pending.status,200);
const final=await api('/'+r.id);assert.equal(final.record.history.length,final.record.revision);
const staticSource=await fetch(base+'/netlify/lib/records.mts');assert.equal(staticSource.status,404);
const result={at:new Date().toISOString(),preview:base,recordId:r.id,authenticatedRead:true,unauthenticatedStatus:401,manualCreate:true,duplicatePrevented:true,decisionPrice:275,decisionDate:r.document.decisionDate,reopened:true,conflictStatus:409,historyCount:final.record.history.length,privateReviewTable:true,sourceExposureStatus:404,productionChanged:false};
await writeFile(new URL('../test-results/cloud-preview-check.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
