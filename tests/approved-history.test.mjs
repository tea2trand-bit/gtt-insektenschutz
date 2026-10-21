import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {importApprovedHistory,historyInputs} from '../netlify/lib/approved-history.mts';
import {createRecord,fromSubmission,changeRecord} from '../netlify/lib/records.mts';

test('all approved history preserves originals, dates and existing decisions without old emails',async()=>{
  const db=await PGlite.create();
  try{
    for(const file of ['20261021010000_admin_records.sql','20261021014500_pending_history.sql','20261021022000_approved_history_job.sql','20261021023000_quote_intake.sql'])await db.exec(await readFile(new URL('../netlify/database/migrations/'+file,import.meta.url),'utf8'));
    const row=i=>({id:i.toString(16).padStart(24,'0'),form_name:i%2?'kontakt':'angebot',created_at:'2026-07-15T12:00:00.123Z',data:{name:i<4?'TEST · Istorijski primer '+i:'Privatni primer '+i,email:'test@example.invalid',nachricht:'Original '+i,berechneter_preis:'CHF 275'}});
    const submissions=Array.from({length:14},(_,i)=>row(i+1));
    const manifest={version:2,scope:'all_inquiries',expectedCount:14,submissions};
    assert.throws(()=>historyInputs({...manifest,expectedCount:13}),/manifest/);
    assert.throws(()=>historyInputs({...manifest,submissions:[...submissions.slice(0,13),submissions[0]]}),/identity/);
    const existing=fromSubmission(submissions[0].data,{id:submissions[0].id,form:submissions[0].form_name,at:submissions[0].created_at});
    await createRecord(db,existing);
    await changeRecord(db,existing.id,{revision:1,action:'decision',status:'Prihvaćeno'});
    const raw=JSON.stringify(manifest);
    process.env.GTT_HISTORY_IMPORT_SHA256=createHash('sha256').update(raw).digest('hex');
    assert.equal(await importApprovedHistory(db,{deploy:{context:'deploy-preview'}},async()=>raw),null);
    const ctx={deploy:{context:'production'}};
    await assert.rejects(importApprovedHistory(db,ctx,async()=>raw+' '),/checksum/);
    const first=await importApprovedHistory(db,ctx,async()=>raw);assert.equal(first.imported,14);assert.equal(first.tests,3);assert.equal(first.pendingReview,0);
    const second=await importApprovedHistory(db,ctx,async()=>{throw Error('Completed import must not reload source');});assert.equal(second.imported,14);
    const rows=(await db.query('SELECT * FROM gtt_records')).rows;assert.equal(rows.length,14);
    assert.equal(rows.filter(r=>r.document.status==='Novi upit').length,13);
    const preserved=rows.find(r=>r.id===existing.id);assert.equal(preserved.document.status,'Prihvaćeno');assert.equal(preserved.document.agreedPrice,275);assert.equal(preserved.revision,2);
    for(const r of rows){assert.equal(new Date(r.received_at).toISOString(),'2026-07-15T12:00:00.123Z');assert.equal(r.original.receivedAt,'2026-07-15T12:00:00.123Z');assert.match(r.original.fields.nachricht,/Original/);}
    assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_record_history')).rows[0].n,15);
    for(const table of ['gtt_pending_inquiries','gtt_quote_versions','gtt_quote_outbox'])assert.equal((await db.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,0);
  }finally{delete process.env.GTT_HISTORY_IMPORT_SHA256;await db.close();}
});
