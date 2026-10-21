import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createRecord,fromSubmission,readRecord} from '../netlify/lib/records.mts';
import {processQuoteIntake,quoteAutomationEnabled} from '../netlify/lib/quote-intake.mts';
import {DEFAULT_OFFER} from '../netlify/lib/projects-store.mts';
import legacySender from '../netlify/functions/submission-created.mts';

const offer={...DEFAULT_OFFER,active:true,percent:15};
const preview={deploy:{context:'deploy-preview'}},production={deploy:{context:'production'}};
const fixture=(id,extra={})=>({inquiry_id:id,record_source:'kontakt',name:'TEST – Demo Customer',email:'test@example.invalid',telefon:'+41 00 000 00 00',plz:'9000',nachricht:'2 Fenster 120 x 140 cm, 1 Tür 90 x 210 cm',...extra});
async function database(t){
  const db=await PGlite.create();t.after(()=>db.close());
  for(const file of ['20261021010000_admin_records.sql','20261021014500_pending_history.sql','20261021023000_quote_intake.sql'])await db.exec(await readFile(new URL('../netlify/database/migrations/'+file,import.meta.url),'utf8'));
  return db;
}
async function record(db,data){const input=fromSubmission(data);await createRecord(db,input);return input.id;}
function sendingEnv(t){for(const [key,value]of Object.entries({RESEND_API_KEY:'re_local_fixture_not_real',GTT_QUOTE_AUTOMATION:'enabled'})){const old=process.env[key];process.env[key]=value;t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});}}

test('real Postgres preview: one immutable version/outbox/card on repeated and concurrent delivery; no agreement or mail',async t=>{
  const db=await database(t),data=fixture('dedupe');const id=await record(db,data);
  await db.query("UPDATE gtt_records SET document=document || '{\"notes\":\"Keep this admin note\"}'::jsonb WHERE id=$1",[id]);
  let calls=0;
  const options={offer,mode:'preview',useAI:false,fetch:async()=>{calls++;throw new Error('Preview must never send');}};
  const results=await Promise.all(Array.from({length:5},()=>processQuoteIntake(db,id,data,preview,options)));
  assert.equal(new Set(results.map(r=>r.version)).size,1);assert.equal(calls,0);
  const r=await readRecord(db,id);assert.equal(r.document.intake.quote.totalCHF,1026);assert.equal(r.document.quotedPrice,1026);assert.equal(r.document.agreedPrice,null);assert.equal(r.document.status,'Novi upit');assert.equal(r.document.notes,'Keep this admin note');assert.equal(r.document.intake.email.status,'preview_only');assert.equal(r.original.fields.nachricht,data.nachricht);assert.equal(r.history.length,2);
  for(const table of ['gtt_records','gtt_quote_versions','gtt_quote_outbox'])assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,1);
  const again=await processQuoteIntake(db,id,data,preview,{...options,offer:{...offer,percent:30}});
  assert.equal(again.quote.totalCHF,1026);assert.equal(again.reference,results[0].reference);assert.equal(again.emailPreview.html,results[0].emailPreview.html);
});
test('production: provider reservation sends once, persists ID/history and never accepts a contract',async t=>{
  sendingEnv(t);const db=await database(t),data=fixture('send-once'),id=await record(db,data);let calls=0,key,subject;
  const send=async(url,options)=>{calls++;assert.equal(url,'https://api.resend.com/emails');key=options.headers['Idempotency-Key'];const message=JSON.parse(options.body);assert.deepEqual(message.to,['test@example.invalid']);subject=message.subject;return Response.json({id:'local-provider-id'});};
  const options={offer,useAI:false,fetch:send};
  await Promise.all(Array.from({length:4},()=>processQuoteIntake(db,id,data,production,options)));
  assert.equal(calls,1);assert.match(key,/^gtt-quote-/);assert.match(subject,/Ihre Offerte GTT-/);
  const r=await readRecord(db,id);assert.equal(r.document.intake.email.status,'accepted');assert.equal(r.document.intake.email.providerId,'local-provider-id');assert.equal(r.document.status,'Ponuda poslata');assert.equal(r.document.agreedPrice,null);assert.equal(r.document.decisionDate,'');assert.equal(r.history.length,3);
});
test('authentication rejection and unknown transport outcome never become a delivered status or duplicate request',async t=>{
  sendingEnv(t);const db=await database(t);
  for(const outcome of ['failed','unknown']){
    const data=fixture(outcome),id=await record(db,data);let calls=0;
    const options={offer,useAI:false,fetch:async()=>{calls++;if(outcome==='unknown')throw new Error('timeout after provider may have accepted');return Response.json({message:'Invalid credential'},{status:401});}};
    const first=await processQuoteIntake(db,id,data,production,options),again=await processQuoteIntake(db,id,data,production,options);
    assert.equal(first.email.status,outcome);assert.equal(again.email.status,outcome);assert.equal(calls,1);
    assert.equal((await readRecord(db,id)).document.status,'Novi upit');
  }
});
test('clarification, no-email, B2B, historical/manual and runtime gates preserve safe behavior',async t=>{
  sendingEnv(t);const db=await database(t);
  for(const [key,extra]of [['unit',{nachricht:'2 Fenster 120 x 140'}],['email',{email:''}],['b2b',{record_source:'b2b-anfrage'}]]){
    const data=fixture(key,extra),id=await record(db,data);let calls=0,body;
    const result=await processQuoteIntake(db,id,data,production,{offer,useAI:false,fetch:async(u,o)=>{calls++;body=JSON.parse(o.body);return Response.json({id:'local-clarification'});}});
    if(key==='email'){assert.equal(result.email.status,'not_available');assert.equal(calls,0);}
    else{assert.equal(result.status,'needs_clarification');assert.equal(result.quote,null);assert.equal(calls,1);assert.match(body.subject,/Angaben ergänzen/);assert.doesNotMatch(body.html,/Gesamtbetrag<\/td>/);}
    assert.equal((await readRecord(db,id)).document.status,'Novi upit');
  }
  for(const mode of ['historical','manual']){const data=fixture(mode),id=await record(db,data);assert.equal(await processQuoteIntake(db,id,data,production,{mode,offer,useAI:false}),null);}
  const data=fixture('runtime-gate'),id=await record(db,data);delete process.env.GTT_QUOTE_AUTOMATION;
  assert.equal(await processQuoteIntake(db,id,data,production,{offer,useAI:false}),null);assert.equal(quoteAutomationEnabled({deploy:{context:'unknown'}}),false);
  const old=process.env.GTT_RUNTIME_CONTEXT;process.env.GTT_RUNTIME_CONTEXT='production';assert.equal(quoteAutomationEnabled({}),false);process.env.GTT_QUOTE_AUTOMATION='enabled';assert.equal(quoteAutomationEnabled({}),true);if(old===undefined)delete process.env.GTT_RUNTIME_CONTEXT;else process.env.GTT_RUNTIME_CONTEXT=old;
});
test('legacy sender hands ownership to new intake and never sends from previews',async t=>{
  sendingEnv(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('unexpected');});
  const req=()=>new Request('https://gtt-insektenschutz.ch/',{method:'POST',body:JSON.stringify({payload:{form_name:'angebot',data:fixture('legacy')}})});
  assert.match(await (await legacySender(req(),preview)).text(),/Preview/);assert.match(await (await legacySender(req(),production)).text(),/owned by quote intake/);assert.equal(calls,0);
});
