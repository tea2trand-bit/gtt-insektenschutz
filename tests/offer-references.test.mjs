import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createRecord,fromSubmission,readRecord,changeRecord} from '../netlify/lib/records.mts';
import {processQuoteIntake} from '../netlify/lib/quote-intake.mts';
import {recordsAPI} from '../netlify/lib/records-api.mts';
import {offerNumber,legacyOfferNumber} from '../netlify/lib/quote-email.mts';
import {DEFAULT_OFFER} from '../netlify/lib/projects-store.mts';
import {renderTeamNotification} from '../netlify/lib/team-notification.mts';

test('offer numbers use the global sequence with at least three digits; legacy aliases remain available',()=>{
  for(const [version,expected]of [[1,'GTT-001'],[4,'GTT-004'],[999,'GTT-999'],[1000,'GTT-1000']]){
    assert.equal(offerNumber('GTT-12345678abcdef',version),expected);
  }
  assert.equal(legacyOfferNumber('GTT-12345678abcdef',4),'GTT-12345678-004');
});

test('admin lists keep short and legacy references for every version, including archived inquiries, without rewriting snapshots',async t=>{
  const db=await PGlite.create();t.after(()=>db.close());
  for(const file of ['20261021010000_admin_records.sql','20261021014500_pending_history.sql','20261021023000_quote_intake.sql'])await db.exec(await readFile(new URL('../netlify/database/migrations/'+file,import.meta.url),'utf8'));
  const data={record_source:'kontakt',inquiry_id:'reference-first',name:'TEST First',email:'test@example.invalid',plz:'9000',nachricht:'1 Fenster 100 x 100 cm'};
  const other={...data,inquiry_id:'reference-other',name:'TEST Other'};
  const first=fromSubmission(data),second=fromSubmission(other);
  await createRecord(db,first);await createRecord(db,second);
  const options={mode:'preview',useAI:false,offer:{...DEFAULT_OFFER,active:true,percent:15}};
  const context={deploy:{context:'deploy-preview'}};
  const v1=await processQuoteIntake(db,first.id,data,context,options);
  const v2=await processQuoteIntake(db,second.id,other,context,options);
  const v3=await processQuoteIntake(db,first.id,{...data,nachricht:'2 Fenster 100 x 100 cm'},context,options);
  assert.deepEqual([v1.version,v2.version,v3.version],[1,2,3]);
  assert.deepEqual([v1.reference,v2.reference,v3.reference],['GTT-001','GTT-002','GTT-003']);
  assert.match(v3.emailPreview.subject,/Ihre Offerte GTT-003/);
  const before=await readRecord(db,first.id);
  const notification=renderTeamNotification(before);
  assert.match(notification.html,/GTT-003/);assert.match(notification.text,/GTT-003/);
  const versionsBefore=(await db.query('SELECT version,snapshot FROM gtt_quote_versions ORDER BY version')).rows;
  const list=await (await recordsAPI(new Request('http://local'),db,[])).json();
  const record=list.records.find(r=>r.id===first.id);
  assert.deepEqual(record.offerReferences,['GTT-001',legacyOfferNumber(first.id,1),'GTT-003',legacyOfferNumber(first.id,3)]);
  assert.deepEqual(list.records.find(r=>r.id===second.id).offerReferences,['GTT-002',legacyOfferNumber(second.id,2)]);
  const rendered=await (await recordsAPI(new Request('http://local'),db,[first.id,'offer'])).json();
  assert.equal(rendered.reference,'GTT-003');
  assert.deepEqual((await readRecord(db,first.id)).document,before.document);
  assert.deepEqual((await db.query('SELECT version,snapshot FROM gtt_quote_versions ORDER BY version')).rows,versionsBefore);
  await changeRecord(db,first.id,{revision:before.revision,action:'archive'});
  const archive=await (await recordsAPI(new Request('http://local?archived=1'),db,[])).json();
  assert.deepEqual(archive.records.find(r=>r.id===first.id).offerReferences,record.offerReferences);
});
