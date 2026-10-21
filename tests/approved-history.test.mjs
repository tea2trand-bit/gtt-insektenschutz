import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {importApprovedHistory} from '../netlify/lib/approved-history.mts';

test('approved history creates only 3 test cards, privately stages 11, and repeats safely',async()=>{
  const db=await PGlite.create();
  try{
    for(const file of ['20261021010000_admin_records.sql','20261021014500_pending_history.sql','20261021022000_approved_history_job.sql'])await db.exec(await readFile(new URL('../netlify/database/migrations/'+file,import.meta.url),'utf8'));
    const row=i=>({id:i.toString(16).padStart(24,'0'),form_name:'kontakt',created_at:'2026-10-01T12:00:00Z',data:{name:i<4?'TEST · Istorijski primer '+i:'Privatni primer '+i,email:'test@example.invalid'}});
    const raw=JSON.stringify({version:1,tests:[1,2,3].map(row),pending:Array.from({length:11},(_,i)=>row(i+4))});
    process.env.GTT_HISTORY_IMPORT_SHA256=createHash('sha256').update(raw).digest('hex');
    assert.equal(await importApprovedHistory(db,{deploy:{context:'deploy-preview'}},async()=>raw),null);
    const ctx={deploy:{context:'production'}};
    await assert.rejects(importApprovedHistory(db,ctx,async()=>raw+' '),/checksum/);
    const first=await importApprovedHistory(db,ctx,async()=>raw);assert.equal(first.tests,3);assert.equal(first.pendingReview,11);
    const second=await importApprovedHistory(db,ctx,async()=>{throw Error('Completed import must not reload source');});assert.equal(second.tests,3);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_records')).rows[0].n,3);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM gtt_records WHERE document->>'status'='Novi upit'")).rows[0].n,3);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_record_history')).rows[0].n,3);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_pending_inquiries')).rows[0].n,11);
  }finally{delete process.env.GTT_HISTORY_IMPORT_SHA256;await db.close();}
});
