import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createRecord,fromSubmission,readRecord} from '../netlify/lib/records.mts';
import {calculateMeasuredOffer} from '../netlify/lib/admin-measurements.mts';
import {prepareQuoteIntake} from '../netlify/lib/quote-intake.mts';
import {renderQuoteEmail} from '../netlify/lib/quote-email.mts';
const offer={active:true,name:'TEST Aktion',percent:15,fenster:true,tueren:true,validFrom:'',validUntil:'',text:''};
test('onsite calculation uses website rates, preview writes nothing, saving creates a draft without sending or changing original data',async()=>{
  const db=await PGlite.create();try{
    for(const file of ['20261021010000_admin_records.sql','20261021023000_quote_intake.sql'])await db.exec(await readFile(new URL('../netlify/database/migrations/'+file,import.meta.url),'utf8'));
    const input=fromSubmission({inquiry_id:'onsite-test',record_source:'kontakt',name:'Test Person',email:'test@example.invalid',plz:'9000',adresse:'Teststrasse 1',berechneter_preis:'CHF 100'});await createRecord(db,input);
    const before=await readRecord(db,input.id),body={revision:1,requestId:randomUUID(),measurements:[{type:'window',quantity:2,width:120,height:140},{type:'door',quantity:1,width:90,height:210}]};
    const preview=await calculateMeasuredOffer(db,input.id,{...body,preview:true},{offer});assert.equal(preview.quote.totalCHF,1026);assert.deepEqual(await readRecord(db,input.id),before);
    const {record}=await calculateMeasuredOffer(db,input.id,body,{offer});assert.equal(record.document.quotedPrice,1026);assert.equal(record.document.status,'Novi upit');assert.equal(record.document.intake.email.status,'draft');assert.equal(record.revision,2);assert.deepEqual(record.original,before.original);assert.equal(record.history.length,2);assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_quote_outbox')).rows[0].n,0);
    await assert.rejects(calculateMeasuredOffer(db,input.id,body,{offer}),/geändert/);
    await assert.rejects(calculateMeasuredOffer(db,input.id,{...body,revision:2,measurements:[{type:'window',quantity:1,width:NaN,height:100}]},{offer}),/prüfen/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_quote_versions')).rows[0].n,1);
  }finally{await db.close();}
});
test('request without measurements is routed to onsite measuring without asking customer to supply their own measurements',async()=>{
  const snapshot=await prepareQuoteIntake({record_source:'kontakt',name:'Test Person',email:'test@example.invalid',plz:'9000',nachricht:'Bitte kommen Sie zum Ausmessen.'},{deploy:{context:'dev'}},{mode:'preview',offer,useAI:false});
  assert.equal(snapshot.measurementRequired,true);assert.equal(snapshot.quote,null);
  const message=renderQuoteEmail(snapshot,'GTT-123456789012345678901234',1);
  assert.match(message.subject,/Ausmessen/);assert.match(message.text,/Termin zum Ausmessen/);assert.doesNotMatch(message.html,/benötigen wir noch folgende Angaben/);
});
