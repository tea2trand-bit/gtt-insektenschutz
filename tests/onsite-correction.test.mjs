import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {fromSubmission,createRecord,readRecord,changeRecord} from '../netlify/lib/records.mts';
import {processQuoteIntake,deliverPreparedQuote} from '../netlify/lib/quote-intake.mts';
import {calculateMeasuredOffer} from '../netlify/lib/admin-measurements.mts';
import {acceptOffer,readAcceptanceOffer} from '../netlify/lib/offer-acceptance.mts';
import {renderQuoteEmail} from '../netlify/lib/quote-email.mts';
const offer={active:true,name:'TEST Aktion',percent:15,fenster:true,tueren:true,validFrom:'',validUntil:'',text:''};
async function setup(t){
 const db=await PGlite.create();t.after(()=>db.close());
 for(const n of (await readdir(new URL('../netlify/database/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL('../netlify/database/migrations/'+n,import.meta.url),'utf8'));
 process.env.GTT_QUOTE_AUTOMATION='enabled';process.env.RESEND_API_KEY='test-only-key';process.env.GTT_OFFER_ACCEPTANCE_SECRET='test-only-link';t.after(()=>{delete process.env.GTT_QUOTE_AUTOMATION;delete process.env.RESEND_API_KEY;delete process.env.GTT_OFFER_ACCEPTANCE_SECRET;});
 const data={record_source:'kontakt',inquiry_id:randomUUID(),name:'TEST Kunde',email:'test@example.invalid',plz:'9000',nachricht:'PLZ 9000. 1 Fenster 100 x 100 cm.'},input=fromSubmission(data);await createRecord(db,input);
 const sent=[];const fetch=async(_url,request)=>{sent.push(JSON.parse(request.body));return Response.json({id:'test-only-'+sent.length});};
 const context={deploy:{context:'production'}};
 const initial=await processQuoteIntake(db,input.id,data,context,{offer,useAI:false,fetch});
 await acceptOffer(db,{r:input.id,q:initial.version});
 const before=await readRecord(db,input.id),body={revision:before.revision,requestId:randomUUID(),measurementSource:'onsite',measurements:[{type:'window',quantity:1,width:120,height:100}]};
 return {db,input,initial,before,body,fetch,sent,context};
}
test('onsite price change sends one revised offer automatically, retains original decision, uses original rates, and requires new confirmation',async t=>{
 const {db,input,initial,before,body,fetch,sent,context}=await setup(t);
 const oldVersion=(await db.query('SELECT snapshot FROM gtt_quote_versions WHERE version=$1',[initial.version])).rows[0].snapshot;
 const result=await calculateMeasuredOffer(db,input.id,body,{offer:{...offer,active:false},context,fetch}),d=result.record.document;
 assert.equal(result.correction.priceChanged,true);assert.equal(sent.length,2);assert.equal(d.status,'Ponuda poslata');assert.equal(d.intake.email.status,'accepted');assert.equal(d.intake.quote.totalCHF,223);assert.deepEqual(d.intake.quote.rates,initial.quote.rates);assert.equal(d.agreedPrice,null);assert.equal(d.customerAcceptance,null);assert.equal(d.correctionPending,true);assert.deepEqual(d.intake.correction.previousAcceptance,before.document.customerAcceptance);assert.ok(d.measuredAt);assert.equal(d.onsite.measurements[0].width,120);assert.deepEqual(result.record.original,before.original);
 assert.match(sent[1].subject,/korrigierte Offerte/);assert.match(sent[1].text,/vor Ort erfassten/);assert.doesNotMatch(sent[1].text,/Termin zum Ausmessen|Ausmessen abstimmen/);assert.match(sent[1].html,/Offerte ablehnen/);assert.match(sent[1].html,/A4-PDF/);
 assert.deepEqual((await db.query('SELECT snapshot FROM gtt_quote_versions WHERE version=$1',[initial.version])).rows[0].snapshot,oldVersion);
 await assert.rejects(readAcceptanceOffer(db,{r:input.id,q:initial.version}),/neuere/);
 const replay=await calculateMeasuredOffer(db,input.id,body,{offer,context,fetch});assert.equal(replay.record.revision,result.record.revision);assert.equal(sent.length,2);
 await assert.rejects(calculateMeasuredOffer(db,input.id,{...body,travelAmountCHF:10},{offer,context,fetch}),/geändert/);
 await deliverPreparedQuote(db,input.id,d.intake.version,context,{fetch});assert.equal(sent.length,2);
 await acceptOffer(db,{r:input.id,q:d.intake.version});
 const accepted=(await readRecord(db,input.id)).document;assert.equal(accepted.agreedPrice,223);assert.equal(accepted.customerAcceptance.intent,'confirm_corrected_offer');assert.equal(accepted.customerAcceptance.pricePreliminary,false);assert.equal(accepted.correctionPending,false);
});
test('unchanged onsite price preserves accepted offer and sends nothing; paid travel is preserved',async t=>{
 const {db,input,before,body,fetch,sent,context}=await setup(t);
 const saved=await calculateMeasuredOffer(db,input.id,{...body,measurements:[{type:'window',quantity:1,width:100,height:100}]},{offer,context,fetch});
 assert.equal(saved.correction.priceChanged,false);assert.equal(sent.length,1);assert.equal(saved.record.document.status,'Prihvaćeno');assert.equal(saved.record.document.intake.version,before.document.intake.version);assert.deepEqual(saved.record.document.customerAcceptance,before.document.customerAcceptance);
 const next=await calculateMeasuredOffer(db,input.id,{...body,revision:saved.record.revision,requestId:randomUUID(),travelAmountCHF:75.5},{offer,context,fetch});
 assert.equal(next.record.document.intake.quote.totalCHF,298.5);
 const subsequent=await calculateMeasuredOffer(db,input.id,{...body,revision:next.record.revision,requestId:randomUUID(),measurements:[{type:'window',quantity:1,width:130,height:100}]},{offer,context,fetch});
 assert.equal(subsequent.record.document.intake.quote.travelCosts.amountCHF,75.5);assert.equal(subsequent.record.document.intake.quote.totalCHF,317.5);
});
test('correction validation, concurrency and transaction failures cannot duplicate or partially save an offer',async t=>{
 const {db,input,before,body,fetch,sent,context}=await setup(t);
 await db.exec("CREATE FUNCTION reject_correction() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='onsite_quote' THEN RAISE EXCEPTION 'test atomic failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_correction_failure BEFORE INSERT ON gtt_record_history FOR EACH ROW EXECUTE FUNCTION reject_correction()");
 await assert.rejects(calculateMeasuredOffer(db,input.id,body,{offer,context,fetch}),/test atomic failure/);assert.deepEqual(await readRecord(db,input.id),before);assert.equal(sent.length,1);assert.equal((await db.query('SELECT count(*)::int n FROM gtt_quote_versions')).rows[0].n,1);
 await db.exec('DROP TRIGGER test_correction_failure ON gtt_record_history');
 const results=await Promise.allSettled([calculateMeasuredOffer(db,input.id,body,{offer,context,fetch}),calculateMeasuredOffer(db,input.id,{...body,requestId:randomUUID()},{offer,context,fetch})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(sent.length,2);assert.equal((await db.query('SELECT count(*)::int n FROM gtt_quote_versions')).rows[0].n,2);
});
test('incomplete corrected offer remains a draft and cannot be advanced without new approval',async t=>{
 const {db,input,before,body,fetch,sent,context}=await setup(t);
 await changeRecord(db,input.id,{revision:before.revision,patch:{postalCode:''}});const current=await readRecord(db,input.id);
 const {record}=await calculateMeasuredOffer(db,input.id,{...body,revision:current.revision},{offer,context,fetch});assert.equal(record.document.intake.email.status,'draft');assert.equal(sent.length,1);assert.equal(record.document.agreedPrice,null);assert.equal(record.document.correctionPending,true);
 await assert.rejects(changeRecord(db,input.id,{revision:record.revision,action:'start-installation'}));
});
