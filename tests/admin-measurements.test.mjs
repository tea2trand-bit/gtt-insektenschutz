import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createRecord,fromSubmission,readRecord} from '../netlify/lib/records.mts';
import {calculateMeasuredOffer} from '../netlify/lib/admin-measurements.mts';
import {prepareQuoteIntake} from '../netlify/lib/quote-intake.mts';
import {renderQuoteEmail} from '../netlify/lib/quote-email.mts';
import {recordMessageDE} from '../netlify/lib/record-messages-de.mts';
import {recordsAPI} from '../netlify/lib/records-api.mts';
const offer={active:true,name:'TEST Aktion',percent:15,fenster:true,tueren:true,validFrom:'',validUntil:'',text:''};
test('onsite calculation uses website rates, preview writes nothing, saving creates a draft without sending or changing original data',async()=>{
  const db=await PGlite.create();try{
    for(const file of ['20261021010000_admin_records.sql','20261021023000_quote_intake.sql'])await db.exec(await readFile(new URL('../netlify/database/migrations/'+file,import.meta.url),'utf8'));
    const input=fromSubmission({inquiry_id:'onsite-test',record_source:'kontakt',name:'Test Person',email:'test@example.invalid',plz:'9000',adresse:'Teststrasse 1',berechneter_preis:'CHF 100'});await createRecord(db,input);
    const before=await readRecord(db,input.id),body={revision:1,requestId:randomUUID(),measurements:[{type:'window',quantity:2,width:120,height:140},{type:'door',quantity:1,width:90,height:210}]};
    const preview=await calculateMeasuredOffer(db,input.id,{...body,preview:true},{offer});assert.equal(preview.quote.totalCHF,1026);assert.deepEqual(await readRecord(db,input.id),before);
    const {record}=await calculateMeasuredOffer(db,input.id,{...body,measurementSource:'admin_confirmed'},{offer});assert.equal(record.document.quotedPrice,1026);assert.equal(record.document.status,'Novi upit');assert.equal(record.document.intake.email.status,'draft');assert.equal(record.revision,2);assert.deepEqual(record.original,before.original);assert.equal(record.history.length,2);assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_quote_outbox')).rows[0].n,0);
    assert.equal(record.document.measuredAt,before.document.measuredAt);assert.ok(record.document.dimensionsConfirmedAt);assert.equal(record.document.intake.measurements[0].source,'Im Admin bestätigte Masse');
    await assert.rejects(calculateMeasuredOffer(db,input.id,body,{offer}),/geändert/);
    await assert.rejects(calculateMeasuredOffer(db,input.id,{...body,revision:2,measurements:[{type:'window',quantity:1,width:NaN,height:100}]},{offer}),/prüfen/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_quote_versions')).rows[0].n,1);
  }finally{await db.close();}
});

test('missing postal code permits an indicative draft with a retained warning; included travel requires explicit admin confirmation',async()=>{
  const db=await PGlite.create();try{
    for(const file of ['20261021010000_admin_records.sql','20261021023000_quote_intake.sql'])await db.exec(await readFile(new URL('../netlify/database/migrations/'+file,import.meta.url),'utf8'));
    const input=fromSubmission({inquiry_id:'travel-confirmation-test',record_source:'kontakt',name:'TEST',email:'test@example.invalid'});await createRecord(db,input);
    const before=await readRecord(db,input.id),body={revision:1,requestId:randomUUID(),measurements:[{type:'window',quantity:1,width:42.5,height:209},{type:'window',quantity:1,width:45,height:115.5},{type:'door',quantity:1,width:67,height:209}]};
    const provisional=await calculateMeasuredOffer(db,input.id,{...body,preview:true},{offer});assert.ok(provisional.issues.some(i=>i.code==='missing_postal_code'));assert.equal(provisional.quote.totalCHF,559);
    const confirmed=await calculateMeasuredOffer(db,input.id,{...body,preview:true,travelIncluded:true},{offer});assert.deepEqual(confirmed.issues,[]);assert.equal(confirmed.quote.travelCosts.amountCHF,0);assert.equal(confirmed.quote.travelCosts.confirmedByAdmin,true);assert.equal(confirmed.quote.postalCode,'');assert.equal(confirmed.quote.totalCHF,559);
    assert.deepEqual(await readRecord(db,input.id),before);assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_quote_versions')).rows[0].n,0);assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_quote_outbox')).rows[0].n,0);
    const {record}=await calculateMeasuredOffer(db,input.id,{...body,measurementSource:'admin_confirmed'},{offer});
    assert.equal(record.document.intake.quote.totalCHF,559);assert.equal(record.document.intake.quote.priceKind,'indicative');assert.equal(record.document.intake.email.status,'draft');assert.equal(record.document.intake.quote.travelCosts.status,'requires_review');assert.equal(record.document.intake.quote.travelCosts.amountCHF,null);assert.equal(record.document.postalCode,'');assert.ok(record.document.intake.clarification.some(i=>i.code==='missing_postal_code'));assert.deepEqual(record.original,before.original);assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_quote_outbox')).rows[0].n,0);
    const message=renderQuoteEmail(record.document.intake,input.id,record.document.intake.version);assert.match(message.text,/Anfahrtskosten sind noch abzuklären/);assert.match(message.html,/Anfahrtskosten sind noch abzuklären/);assert.equal(message.acceptanceURL,null);
  }finally{await db.close();}
});

test('known measurement errors keep their actionable German reason while unknown internal errors stay private',()=>{
  for(const message of ['Die Anfrage wurde geändert. Bitte neu öffnen.','Bitte eine gültige Gesamtfläche in m² eingeben.','Bitte die Anfahrtskosten als gültigen CHF-Betrag prüfen.'])assert.equal(recordMessageDE(message),message);
  assert.equal(recordMessageDE('database password=private internal failure'),'Die Angaben konnten nicht gespeichert werden. Bitte prüfen und erneut versuchen.');
});
test('request without measurements is routed to onsite measuring without asking customer to supply their own measurements',async()=>{
  const snapshot=await prepareQuoteIntake({record_source:'kontakt',name:'Test Person',email:'test@example.invalid',plz:'9000',nachricht:'Bitte kommen Sie zum Ausmessen.'},{deploy:{context:'dev'}},{mode:'preview',offer,useAI:false});
  assert.equal(snapshot.measurementRequired,true);assert.equal(snapshot.quote,null);
  const message=renderQuoteEmail(snapshot,'GTT-123456789012345678901234',1);
  assert.match(message.subject,/Ausmessen/);assert.match(message.text,/Termin zum Ausmessen/);assert.doesNotMatch(message.html,/benötigen wir noch folgende Angaben/);
});

test('total square metres use the same price as individual sizes; production sizes stay separate and do not double the area',async()=>{
  const db=await PGlite.create();try{
    for(const file of ['20261021010000_admin_records.sql','20261021023000_quote_intake.sql'])await db.exec(await readFile(new URL('../netlify/database/migrations/'+file,import.meta.url),'utf8'));
    const input=fromSubmission({inquiry_id:'area-only-test',record_source:'kontakt',name:'TEST',email:'test@example.invalid',plz:'9000'});await createRecord(db,input);
    const body={revision:1,requestId:randomUUID(),measurementSource:'admin_confirmed',measurements:[{type:'window',mode:'area',areaM2:3.36},{type:'door',mode:'area',areaM2:1.89}],productionMeasurements:[{type:'window',quantity:2,width:120,height:140},{type:'door',quantity:1,width:90,height:210}]};
    const preview=await calculateMeasuredOffer(db,input.id,{...body,preview:true},{offer});assert.equal(preview.quote.totalCHF,1026);assert.deepEqual(preview.quote.areas,{fenster:3.36,tueren:1.89});
    const withTravel=await calculateMeasuredOffer(db,input.id,{...body,preview:true,travelAmountCHF:75.5},{offer});assert.equal(withTravel.quote.totalCHF,1101.5);assert.equal(withTravel.quote.travelCosts.amountCHF,75.5);assert.equal(withTravel.quote.discount.percent,15);
    const message=renderQuoteEmail({status:'priced',processedAt:new Date().toISOString(),measurements:body.measurements,quote:withTravel.quote,customer:{name:'TEST'},email:{status:'draft'}},input.id,1);assert.match(message.html,/Anfahrtskosten/);assert.match(message.text,/Anfahrtskosten .*CHF 75\.50/);assert.match(message.text,/1[’']101\.50/);
    for(const n of [NaN,-1,100001])await assert.rejects(calculateMeasuredOffer(db,input.id,{...body,preview:true,travelAmountCHF:n},{offer}),/Anfahrtskosten/);
    await assert.rejects(calculateMeasuredOffer(db,input.id,{...body,preview:true,travelIncluded:true,travelAmountCHF:10},{offer}),/Anfahrtskosten/);
    for(const n of [NaN,-1,0,10001])await assert.rejects(calculateMeasuredOffer(db,input.id,{...body,preview:true,measurements:[{type:'window',mode:'area',areaM2:n}]},{offer}),/Gesamtfläche/);
    const {record}=await calculateMeasuredOffer(db,input.id,body,{offer});assert.equal(record.document.intake.measurements.length,2);assert.equal(record.document.intake.productionMeasurements.length,2);assert.equal(record.document.intake.quote.totalCHF,1026);assert.equal(record.document.measuredAt,'');assert.match(record.document.products,/3.36 m²/);assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_quote_outbox')).rows[0].n,0);
  }finally{await db.close();}
});

test('contact save refreshes an unsent draft and its PLZ warning atomically, preserves prices and old versions, and never sends',async()=>{
  const db=await PGlite.create();try{
    for(const file of ['20261021010000_admin_records.sql','20261021023000_quote_intake.sql'])await db.exec(await readFile(new URL('../netlify/database/migrations/'+file,import.meta.url),'utf8'));
    const input=fromSubmission({inquiry_id:'contact-draft-refresh',record_source:'kontakt',name:'TEST',email:'test@example.invalid'});await createRecord(db,input);
    const {record:before}=await calculateMeasuredOffer(db,input.id,{revision:1,requestId:randomUUID(),measurementSource:'admin_confirmed',measurements:[{type:'window',mode:'area',areaM2:2.024},{type:'door',mode:'area',areaM2:1.8063}]},{offer});
    const version=before.document.intake.version,old=(await db.query('SELECT snapshot FROM gtt_quote_versions WHERE version=$1',[version])).rows[0].snapshot;
    const patch=(revision,fields)=>new Request('https://example.invalid/api/admin/records/'+input.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update',revision,patch:fields})});
    const response=await recordsAPI(patch(2,{postalCode:'9000',address:'TEST Strasse 1'}),db,[input.id],{offer:{...offer,active:false}}),{record}=await response.json();
    assert.equal(record.revision,3);assert.equal(record.document.postalCode,'9000');assert.equal(record.document.intake.postalCode,'9000');assert.equal(record.document.intake.quote.postalCode,'9000');assert.deepEqual(record.document.intake.clarification,[]);assert.equal(record.document.intake.quote.travelCosts.status,'included');assert.equal(record.document.intake.customer.address,'TEST Strasse 1');assert.equal(record.document.quotedPrice,759);assert.deepEqual(record.document.intake.quote.rates,before.document.intake.quote.rates);assert.deepEqual(record.document.intake.quote.discount,before.document.intake.quote.discount);assert.equal(record.document.dimensionsConfirmedAt,before.document.dimensionsConfirmedAt);assert.equal(record.document.measuredAt,'');assert.deepEqual(record.original,before.original);assert.equal(record.document.intake.email.status,'draft');assert.notEqual(record.document.intake.version,version);
    assert.deepEqual((await db.query('SELECT snapshot FROM gtt_quote_versions WHERE version=$1',[version])).rows[0].snapshot,old);assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_quote_versions')).rows[0].n,2);assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_quote_outbox')).rows[0].n,0);
    await assert.rejects(recordsAPI(patch(2,{postalCode:'8000'}),db,[input.id],{offer}),/geändert/);assert.equal((await readRecord(db,input.id)).document.postalCode,'9000');
    await db.exec("CREATE TABLE test_refresh_guard(record_id text REFERENCES gtt_records(id),revision integer CHECK(revision<4))");await db.exec("CREATE FUNCTION test_refresh_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO test_refresh_guard VALUES(NEW.id,NEW.revision); RETURN NEW; END $$; CREATE TRIGGER test_refresh_failure AFTER UPDATE ON gtt_records FOR EACH ROW EXECUTE FUNCTION test_refresh_fail()");
    await assert.rejects(recordsAPI(patch(3,{postalCode:'3000'}),db,[input.id],{offer}));assert.deepEqual(JSON.parse(JSON.stringify(await readRecord(db,input.id))),record);assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_quote_versions')).rows[0].n,2);
  }finally{await db.close();}
});
