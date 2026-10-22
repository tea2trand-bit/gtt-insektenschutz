import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {fromSubmission,createRecord,readRecord,changeRecord} from '../netlify/lib/records.mts';
import {processQuoteIntake} from '../netlify/lib/quote-intake.mts';
import {renderQuoteEmail} from '../netlify/lib/quote-email.mts';
import {handleOfferAcceptance} from '../netlify/functions/offer-acceptance.mts';
import {notifyTeam,renderTeamNotification} from '../netlify/lib/team-notification.mts';
const origin='https://preview.example.invalid',context={deploy:{context:'deploy-preview'}};
const offer={active:false,name:'',percent:0,fenster:true,tueren:true,validFrom:'',validUntil:'',text:''};
async function setup(t){
 const db=await PGlite.create();t.after(()=>db.close());
 for(const name of (await readdir(new URL('../netlify/database/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL('../netlify/database/migrations/'+name,import.meta.url),'utf8'));
 process.env.GTT_OFFER_ACCEPTANCE_SECRET='test-only-decision-secret';t.after(()=>delete process.env.GTT_OFFER_ACCEPTANCE_SECRET);
 const data={record_source:'kontakt',inquiry_id:'decline-test',name:'TEST Kunde',email:'test@example.invalid',plz:'9000',nachricht:'PLZ 9000. 1 Fenster 100 x 100 cm.'},input=fromSubmission(data);await createRecord(db,input);
 const intake=await processQuoteIntake(db,input.id,data,context,{mode:'preview',offer,useAI:false}),message=renderQuoteEmail(intake,input.id,intake.version,{baseURL:origin});
 return {db,input,intake,message};
}
const post=(url,body='confirm=yes&decision=decline',site=origin)=>new Request(url,{method:'POST',headers:{Origin:site,'Content-Type':'application/x-www-form-urlencoded'},body});
test('customer decline requires explicit version-bound confirmation, is replay safe and preserves prices, original and offer snapshots',async t=>{
 const {db,input,intake,message}=await setup(t),before=await readRecord(db,input.id),versions=(await db.query('SELECT * FROM gtt_quote_versions')).rows;
 assert.match(message.html,/Offerte annehmen/);assert.match(message.html,/Offerte ablehnen/);assert.match(message.text,/Offerte ablehnen:/);
 const draft=renderQuoteEmail({...intake,email:{status:'draft'}},input.id,intake.version,{baseURL:origin});assert.equal(draft.declineURL,null);
 assert.equal((await handleOfferAcceptance(new Request(message.declineURL),context,db)).status,200);assert.deepEqual(await readRecord(db,input.id),before);
 for(const request of [post(message.declineURL,'confirm=yes&decision=decline','https://other.example.invalid'),post(message.declineURL,'decision=decline'),post(message.declineURL,'confirm=yes&decision=accept'),post(message.declineURL,'confirm=yes')])assert.ok([400,403].includes((await handleOfferAcceptance(request,context,db)).status));
 assert.deepEqual(await readRecord(db,input.id),before);
 const responses=await Promise.all([handleOfferAcceptance(post(message.declineURL),context,db),handleOfferAcceptance(post(message.declineURL),context,db)]);assert.ok(responses.every(r=>r.status===303));
 const after=await readRecord(db,input.id);assert.equal(after.document.status,'Odbijeno');assert.equal(after.document.customerDecline.quoteVersion,intake.version);assert.equal(after.document.customerDecline.intent,'decline_offer');assert.equal(after.document.agreedPrice,null);assert.equal(after.document.quotedPrice,before.document.quotedPrice);assert.equal(after.document.appointmentAt,'');assert.deepEqual(after.original,before.original);assert.equal(after.history.filter(h=>h.kind==='customer_decline').length,1);assert.deepEqual((await db.query('SELECT * FROM gtt_quote_versions')).rows,versions);
 assert.equal((await handleOfferAcceptance(post(message.declineURL),context,db)).status,303);assert.equal((await readRecord(db,input.id)).revision,after.revision);
 assert.equal((await handleOfferAcceptance(post(message.acceptanceURL,'confirm=yes&decision=accept'),context,db)).status,409);
 const get=await handleOfferAcceptance(new Request(message.acceptanceURL),context,db);assert.match(await get.text(),/Offerte abgelehnt/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_team_outbox')).rows[0].n,0);
 const mail=renderTeamNotification(after,'customer_decline');assert.match(mail.subject,/Offerte abgelehnt/);assert.match(mail.text,/kein Termin/);
 process.env.GTT_TEAM_NOTIFICATIONS='enabled';process.env.RESEND_API_KEY='test-only-key';t.after(()=>{delete process.env.GTT_TEAM_NOTIFICATIONS;delete process.env.RESEND_API_KEY;});
 let sent=0;const provider=async()=>{sent++;return Response.json({id:'fake-decline-notice'});},prod={deploy:{context:'production'}};
 await Promise.all([notifyTeam(db,input.id,'customer_decline',prod,{fetch:provider}),notifyTeam(db,input.id,'customer_decline',prod,{fetch:provider})]);await notifyTeam(db,input.id,'customer_decline',prod,{fetch:provider});assert.equal(sent,1);
 await changeRecord(db,input.id,{revision:after.revision,action:'archive'});assert.equal((await handleOfferAcceptance(new Request(message.declineURL),context,db)).status,410);
});
test('opposite customer decisions racing on one offer produce exactly one recorded outcome',async t=>{
 const {db,input,message}=await setup(t);
 const result=await Promise.all([handleOfferAcceptance(post(message.acceptanceURL,'confirm=yes&decision=accept'),context,db),handleOfferAcceptance(post(message.declineURL),context,db)]);
 assert.deepEqual(result.map(r=>r.status).sort(),[303,409]);
 const record=await readRecord(db,input.id);assert.equal(record.history.filter(h=>['customer_acceptance','customer_decline'].includes(h.kind)).length,1);assert.equal(Boolean(record.document.customerAcceptance)&&Boolean(record.document.customerDecline),false);
});
