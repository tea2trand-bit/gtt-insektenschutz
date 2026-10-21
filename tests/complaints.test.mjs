import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {fromSubmission,createRecord,readRecord} from '../netlify/lib/records.mts';
import {receiveComplaint,publicComplaintAPI,complaintsAdminAPI,complaintLookup,matchComplaint,renderComplaintMessage} from '../netlify/lib/complaints.mts';
import publicHandler from '../netlify/functions/complaints-public.mts';
import {dispatchPendingComplaints,dispatchComplaintNotification} from '../netlify/lib/complaint-notification.mts';

const input=(patch={})=>({requestId:randomUUID(),lookup:'GTT-042',email:'test@example.invalid',description:'TEST: Die Tür schliesst nicht richtig.',...patch});
async function setup(){
  const db=await PGlite.create();
  for(const file of ['20261021010000_admin_records.sql','20261021023000_quote_intake.sql','20261021210000_complaints_preview.sql','20261021213000_complaint_delivery.sql'])await db.exec(await readFile(new URL('../netlify/database/migrations/'+file,import.meta.url),'utf8'));
  const customer=fromSubmission({inquiry_id:'complaint-test-customer',record_source:'kontakt',name:'Test Müller',email:'test@example.invalid',telefon:'+41 00 000 00 00',berechneter_preis:'CHF 186'});
  await createRecord(db,customer);
  await db.query('INSERT INTO gtt_quote_versions(version,record_id,source_fingerprint,snapshot) OVERRIDING SYSTEM VALUE VALUES(42,$1,$2,$3::jsonb)',[customer.id,'test-version','{}']);
  return {db,id:customer.id};
}
test('duplicate complaint creates one case and one preview email; original customer and prices stay untouched',async()=>{
  const {db,id}=await setup();try{
    const original=await readRecord(db,id),body=input();
    await Promise.all([receiveComplaint(db,body,{baseURL:'http://localhost:4403',useAI:false}),receiveComplaint(db,body,{baseURL:'http://localhost:4403',useAI:false})]);
    await receiveComplaint(db,{...body,requestId:randomUUID()},{baseURL:'http://localhost:4403',useAI:false});
    const cases=(await db.query('SELECT * FROM gtt_complaints')).rows,jobs=(await db.query('SELECT * FROM gtt_complaint_outbox')).rows;
    assert.equal(cases.length,1);assert.equal(jobs.length,1);assert.equal(jobs[0].status,'preview_only');assert.equal(cases[0].record_id,id);assert.equal(cases[0].match_status,'matched');
    assert.deepEqual(jobs[0].message.to,['info@gttgroup.ch']);assert.equal(jobs[0].message.reply_to,body.email);
    assert.deepEqual(await readRecord(db,id),original);
  }finally{await db.close();}
});
test('reference and name matching require the same email; ambiguous names and wrong references stay unassigned',async()=>{
  const {db,id}=await setup();try{
    assert.equal((await matchComplaint(db,input({lookup:'gtt-042'}),{useAI:false})).recordId,id);
    const legacy='GTT-'+id.slice(4,12).toUpperCase()+'-042';
    assert.equal((await matchComplaint(db,input({lookup:legacy}),{useAI:false})).recordId,id);
    assert.equal((await matchComplaint(db,input({lookup:'test muller'}),{useAI:false})).recordId,id);
    for(const patch of [{email:'other@example.invalid'},{lookup:'GTT-999'},{lookup:'Someone Else'}])assert.equal((await matchComplaint(db,input(patch),{useAI:false})).status,'review');
    await createRecord(db,fromSubmission({inquiry_id:'second-job',record_source:'kontakt',name:'Test Müller',email:'test@example.invalid'}));
    assert.equal((await matchComplaint(db,input({lookup:'Test Müller'}),{useAI:false})).recordId,null);
  }finally{await db.close();}
});
test('AI extracts explicit text only, cannot invent customers, receives no database contents and falls back safely',async()=>{
  const calls=[];const client=value=>({responses:{create:async request=>{calls.push(request);return {status:'completed',output_text:JSON.stringify({lookup:value})};}}});
  assert.equal((await complaintLookup('Mein Name ist Test Müller',{aiClient:client('Test Müller'),model:'test-model'})).value,'Test Müller');
  assert.equal((await complaintLookup('Mein Name ist Test Müller',{aiClient:client('Different Person'),model:'test-model'})).ai,'rejected');
  assert.equal(calls[0].store,false);assert.equal(calls[0].input[1].content,'Mein Name ist Test Müller');assert.equal(calls[0].text.format.strict,true);
  assert.equal((await complaintLookup('Test Person',{aiClient:{responses:{create:async()=>{throw Error('offline');}}},model:'test-model'})).value,'Test Person');
});
test('public responses reveal no customer, matching result or case ID; origin, honeypot, size and production gates apply',async()=>{
  const {db}=await setup();try{
    const request=(body,origin='http://localhost:4403')=>new Request('http://localhost:4403/api/reklamationen',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const matched=await publicComplaintAPI(request(input()),db,{useAI:false});const unmatched=await publicComplaintAPI(request(input({email:'missing@example.invalid'})),db,{useAI:false});
    assert.deepEqual(await matched.json(),{ok:true});assert.deepEqual(await unmatched.json(),{ok:true});
    assert.equal((await publicComplaintAPI(request(input(),'https://other.invalid'),db)).status,403);
    assert.equal((await publicComplaintAPI(request(input({description:'x'.repeat(17000)})),db)).status,413);
    const count=(await db.query('SELECT count(*)::int AS n FROM gtt_complaints')).rows[0].n;
    assert.equal((await publicComplaintAPI(request({...input(),website:'bot'}),db)).status,200);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_complaints')).rows[0].n,count);
    assert.equal((await publicHandler(request(input()),{deploy:{context:'production'}})).status,503);
  }finally{await db.close();}
});
test('private complaint workflow requires revision and a resolution, renders safe email and preserves original records',async()=>{
  const {db,id}=await setup();try{
    const before=await readRecord(db,id);
    await receiveComplaint(db,input({description:'<script>alert(1)</script> Defekt'}),{baseURL:'http://localhost:4403',useAI:false});
    const c=(await db.query('SELECT * FROM gtt_complaints')).rows[0];
    const message=renderComplaintMessage(c,'http://localhost:4403');assert.doesNotMatch(message.html,/<script>/);assert.match(message.html,/&lt;script&gt;/);assert.match(message.text,/admin\?reklamation=/);
    const update=body=>complaintsAdminAPI(new Request('http://localhost:4403/api/admin/complaints/'+c.id,{method:'PATCH',body:JSON.stringify(body)}),db,[c.id]);
    assert.equal((await update({revision:1,status:'Erledigt'})).status,422);
    assert.equal((await update({revision:1,status:'In Bearbeitung'})).status,200);
    assert.equal((await update({revision:1,status:'Offen'})).status,409);
    assert.equal((await update({revision:2,status:'Erledigt',resolution:'TEST: Problem behoben.'})).status,200);
    assert.deepEqual(await readRecord(db,id),before);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_complaint_outbox')).rows[0].n,1);
  }finally{await db.close();}
});

test('production delivery reserves once for concurrent submissions, retries with the same provider key and never dispatches local previews',async()=>{
  const previous=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='test-only-provider-key';
  const {db,id}=await setup();try{
    const before=await readRecord(db,id),calls=[],context={deploy:{context:'production'}},body=input();
    const sender=async(url,options)=>{calls.push({url,key:options.headers['Idempotency-Key'],body:JSON.parse(options.body)});return Response.json({id:'test-provider-'+calls.length});};
    const options={baseURL:'https://gtt-insektenschutz.ch',useAI:false,deliveryContext:context,fetch:sender};
    await Promise.all([receiveComplaint(db,body,options),receiveComplaint(db,body,options)]);
    await receiveComplaint(db,body,options);
    assert.equal(calls.length,1);assert.deepEqual(calls[0].body.to,['info@gttgroup.ch']);assert.equal(calls[0].body.reply_to,body.email);assert.match(calls[0].body.text,/https:\/\/gtt-insektenschutz.ch\/admin\?reklamation=/);
    let job=(await db.query('SELECT * FROM gtt_complaint_outbox')).rows[0];assert.equal(job.status,'accepted');assert.equal(job.attempts,1);
    const retryInput=input({description:'TEST: Ein zweites Fenster ist betroffen.'});let first=true;const retryCalls=[];
    const flaky=async(url,options)=>{retryCalls.push({key:options.headers['Idempotency-Key'],body:options.body});if(first){first=false;throw Error('test connection interrupted');}return Response.json({id:'test-recovered-provider'});};
    await receiveComplaint(db,retryInput,{...options,fetch:flaky});
    job=(await db.query("SELECT * FROM gtt_complaint_outbox WHERE status='unknown'")).rows[0];assert.ok(job);
    await dispatchPendingComplaints(db,context,{fetch:flaky});assert.equal(retryCalls.length,2);assert.deepEqual(retryCalls[0],retryCalls[1]);
    assert.equal((await db.query('SELECT status FROM gtt_complaint_outbox WHERE complaint_id=$1',[job.complaint_id])).rows[0].status,'accepted');
    await receiveComplaint(db,input({description:'TEST: Nur lokale Vorschau, kein Versand.'}),{baseURL:'http://localhost:4403',useAI:false});
    await dispatchPendingComplaints(db,context,{fetch:sender});assert.equal(calls.length,1);
    await dispatchComplaintNotification(db,job.complaint_id,{deploy:{context:'dev'}},{fetch:sender});assert.equal(calls.length,1);
    assert.deepEqual(await readRecord(db,id),before);
  }finally{await db.close();if(previous===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=previous;}
});
