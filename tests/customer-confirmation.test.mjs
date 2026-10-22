import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {fromSubmission,createRecord,readRecord,changeRecord} from '../netlify/lib/records.mts';
import {processQuoteIntake} from '../netlify/lib/quote-intake.mts';
import {renderQuoteEmail} from '../netlify/lib/quote-email.mts';
import {createAcceptanceLink,verifyAcceptanceToken} from '../netlify/lib/offer-acceptance-token.mts';
import {handleOfferAcceptance} from '../netlify/functions/offer-acceptance.mts';
import {notifyTeam,renderTeamNotification} from '../netlify/lib/team-notification.mts';
import {prepareSmallinvoiceDraft} from '../netlify/lib/smallinvoice-preparation.mts';
const origin='https://preview.example.invalid';
const context={deploy:{context:'deploy-preview'}};
const offer={active:true,name:'Aktion',percent:15,fenster:true,tueren:true,validFrom:'2026-01-01',validUntil:'2027-12-31',text:''};
async function database(){const db=await PGlite.create();for(const name of (await readdir(new URL('../netlify/database/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL('../netlify/database/migrations/'+name,import.meta.url),'utf8'));return db;}

test('customer link: GET and unchecked/cross-origin POST never accept; explicit confirmation is version-bound, atomic and replay-safe',async()=>{
 process.env.GTT_OFFER_ACCEPTANCE_SECRET='test-only-offer-link-secret-with-more-than-32-characters';
 const db=await database();
 try{
  const data={record_source:'kontakt',inquiry_id:'customer-confirmation-test',name:'TEST Kunde',email:'test@example.invalid',telefon:'+41 00 000 00 00',nachricht:'PLZ 9000. 2 Fenster je 120 x 140 cm und 1 Tür 90 x 210 cm.'};
  const input=fromSubmission(data);await createRecord(db,input);
  const intake=await processQuoteIntake(db,input.id,data,context,{mode:'preview',offer,useAI:false});
  let record=await readRecord(db,input.id);const original=structuredClone(record.original);
  const link=createAcceptanceLink(intake,input.id,intake.version,origin),url=new URL(link),token=url.searchParams.get('token');
  assert.equal(verifyAcceptanceToken(token,origin).q,intake.version);
  assert.throws(()=>verifyAcceptanceToken(token,'https://other.example.invalid'),/Ungültiger/);
  const [payload,signature]=token.split('.');assert.throws(()=>verifyAcceptanceToken(payload+'.'+(signature[0]==='a'?'b':'a')+signature.slice(1),origin),/Ungültiger/);
  assert.throws(()=>verifyAcceptanceToken(token,origin,Date.now()+31*86400000),/abgelaufen/);
  const get=await handleOfferAcceptance(new Request(url),context,db);assert.equal(get.status,200);const html=await get.text();assert.match(html,/1[’']026|1&#39;026/);assert.match(html,/type="checkbox"/);assert.doesNotMatch(html,/test@example.invalid/);
  assert.equal((await readRecord(db,input.id)).document.status,'Novi upit');
  const request=(headers={},body='confirm=yes')=>new Request(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...headers},body});
  assert.equal((await handleOfferAcceptance(request({},'confirm=yes'),context,db)).status,403);
  assert.equal((await handleOfferAcceptance(request({Origin:origin},''),context,db)).status,400);
  const responses=await Promise.all([handleOfferAcceptance(request({Origin:origin}),context,db),handleOfferAcceptance(request({Origin:origin}),context,db)]);assert.ok(responses.every(r=>r.status===303));
  record=await readRecord(db,input.id);assert.equal(record.document.status,'Prihvaćeno');assert.equal(record.document.agreedPrice,1026);assert.equal(record.document.customerAcceptance.intent,'request_measurement');assert.equal(record.document.customerAcceptance.pricePreliminary,true);assert.equal(record.document.intake.contractAccepted,false);assert.equal(record.document.appointmentAt,'');assert.deepEqual(record.original,original);
  assert.equal(record.history.filter(h=>h.kind==='customer_acceptance').length,1);
  const revision=record.revision;assert.equal((await handleOfferAcceptance(request({Origin:origin}),context,db)).status,303);assert.equal((await readRecord(db,input.id)).revision,revision);
  const rendered=renderQuoteEmail(intake,input.id,intake.version,{baseURL:origin});assert.match(rendered.html,/Offerte annehmen/);assert.equal(new URL(rendered.acceptanceURL).origin,origin);
  await changeRecord(db,input.id,{revision,action:'archive'});assert.equal((await handleOfferAcceptance(new Request(url),context,db)).status,410);
  const newerData={...data,inquiry_id:'newer-quote-test'};const newer=fromSubmission(newerData);await createRecord(db,newer);
  const first=await processQuoteIntake(db,newer.id,newerData,context,{mode:'preview',offer,useAI:false});
  const oldLink=createAcceptanceLink(first,newer.id,first.version,origin);
  await processQuoteIntake(db,newer.id,{...newerData,nachricht:'PLZ 9000. 1 Fenster 100 x 100 cm.'},context,{mode:'preview',offer,useAI:false});
  assert.equal((await handleOfferAcceptance(new Request(oldLink),context,db)).status,409);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_team_outbox')).rows[0].n,0);
 }finally{delete process.env.GTT_OFFER_ACCEPTANCE_SECRET;await db.close();}
});

test('internal email reports source, customer, price and actual send state; reservation sends once and preserves old recipients',async()=>{
 const db=await database();
 process.env.GTT_TEAM_NOTIFICATIONS='enabled';process.env.GTT_ADMIN_NOTIFICATION_TO='team1@example.invalid,team2@example.invalid';process.env.RESEND_API_KEY='test-only-provider';
 try{
  const input=fromSubmission({record_source:'kontakt',inquiry_id:'internal-mail-test',name:'TEST <script>alert(1)</script>',email:'test@example.invalid',telefon:'+41 00 000 00 00',nachricht:'PLZ 9000. 2 Fenster je 120 x 140 cm und 1 Tür 90 x 210 cm.'});await createRecord(db,input);
  await processQuoteIntake(db,input.id,input.original.fields,context,{mode:'preview',offer,useAI:false});
  await db.query("UPDATE gtt_records SET document=jsonb_set(document,'{intake,email}','{\"status\":\"accepted\",\"providerId\":\"test-id\"}'::jsonb) WHERE id=$1",[input.id]);
  const record=await readRecord(db,input.id),message=renderTeamNotification(record);
  assert.match(message.subject,/Neue Anfrage/);assert.match(message.html,/Kontaktformular/);assert.match(message.html,/Offerte wurde an den Kunden versendet/);assert.match(message.html,/Karte öffnen/);assert.doesNotMatch(message.html,/<script>/);assert.doesNotMatch(message.html,/Record Source|Inquiry:/);
  let sent=0;const provider=async(url,options)=>{sent++;const body=JSON.parse(options.body);assert.deepEqual(body.to,['team1@example.invalid','team2@example.invalid']);assert.ok(options.headers['Idempotency-Key']);return Response.json({id:'team-provider-id'});};
  const prod={deploy:{context:'production'}};await Promise.all([notifyTeam(db,input.id,'new_inquiry',prod,{fetch:provider}),notifyTeam(db,input.id,'new_inquiry',prod,{fetch:provider})]);await notifyTeam(db,input.id,'new_inquiry',prod,{fetch:provider});assert.equal(sent,1);
  const job=(await db.query('SELECT * FROM gtt_team_outbox')).rows[0];assert.equal(job.status,'accepted');assert.equal(job.provider_id,'team-provider-id');
  assert.equal((await readRecord(db,input.id)).document.status,'Novi upit');
 }finally{delete process.env.GTT_TEAM_NOTIFICATIONS;delete process.env.GTT_ADMIN_NOTIFICATION_TO;delete process.env.RESEND_API_KEY;await db.close();}
});

test('Smallinvoice preparation makes an offline draft only from a completed priced job',()=>{
 assert.throws(()=>prepareSmallinvoiceDraft({id:'test',document:{status:'Novi upit',agreedPrice:1026}}),/Abschluss/);
 assert.throws(()=>prepareSmallinvoiceDraft({id:'test',document:{status:'Završeno',agreedPrice:null}}),/Betrag/);
 const draft=prepareSmallinvoiceDraft({id:'test',document:{status:'Završeno',agreedPrice:1026,name:'TEST Kunde',email:'test@example.invalid'}});
 assert.equal(draft.totalCHF,1026);assert.equal(draft.currency,'CHF');assert.equal(draft.language,'de');assert.equal(draft.sendAutomatically,false);assert.ok(draft.requiredAccountConfiguration.includes('vat_configuration'));assert.equal('vat' in draft.positions[0],false);
});
