import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createRecord,fromSubmission,readRecord,changeRecord,deleteArchivedTestRecord} from '../netlify/lib/records.mts';
import {recordsAPI} from '../netlify/lib/records-api.mts';
import {processQuoteIntake} from '../netlify/lib/quote-intake.mts';
import {DEFAULT_OFFER} from '../netlify/lib/projects-store.mts';

async function database(t){
  const db=await PGlite.create();t.after(()=>db.close());
  const dir=new URL('../netlify/database/migrations/',import.meta.url);
  for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
  return db;
}
async function record(db,seed,name='TEST · Disposable'){
  const data={record_source:'kontakt',inquiry_id:seed,name,email:'test@example.invalid',plz:'9000',nachricht:'1 Fenster 100 x 100 cm'};
  const input=fromSubmission(data);await createRecord(db,input);return {input,data};
}
const deletion=(db,r,extra={})=>recordsAPI(new Request('http://local',{method:'DELETE',body:JSON.stringify({revision:r.revision,confirmRecordId:r.id,...extra})}),db,[r.id]);

test('permanent deletion rejects active/non-test records, stale revisions and missing confirmation',async t=>{
  const db=await database(t);
  const {input}=await record(db,'delete-gates');
  let r=await readRecord(db,input.id);
  await assert.rejects(deletion(db,r),err=>err.status===403);
  r=await changeRecord(db,r.id,{revision:r.revision,action:'archive'});
  await assert.rejects(deletion(db,r,{confirmRecordId:'wrong-record'}),err=>err.status===400);
  await assert.rejects(deletion(db,r,{revision:r.revision-1}),err=>err.status===409);
  const real=await record(db,'delete-real','Ordinary Customer');
  const archivedReal=await changeRecord(db,real.input.id,{revision:1,action:'archive'});
  await assert.rejects(deletion(db,archivedReal,{isTest:true}),err=>err.status===403);
  assert.ok((await readRecord(db,r.id)).document.archivedAt);
  assert.ok((await readRecord(db,archivedReal.id)).document.archivedAt);
  await db.query("UPDATE gtt_records SET document=jsonb_set(document,'{isTest}','\"true\"'::jsonb) WHERE id=$1",[r.id]);
  await assert.rejects(deletion(db,r),err=>err.status===403);
});

test('deletion removes dependent admin data atomically, rolls back on any FK failure, and keeps source/import receipts and the sequence',async t=>{
  const db=await database(t),{input,data}=await record(db,'delete-related');
  const intake=await processQuoteIntake(db,input.id,data,{deploy:{context:'deploy-preview'}},{mode:'preview',useAI:false,offer:{...DEFAULT_OFFER,active:true,percent:15}});
  const r=await changeRecord(db,input.id,{revision:(await readRecord(db,input.id)).revision,action:'archive'});
  await db.query("INSERT INTO gtt_record_files(id,record_id,name,content_type,content) VALUES('11111111-1111-4111-8111-111111111111',$1,'TEST.pdf','application/pdf',$2)",[r.id,Buffer.from('%PDF-TEST')]);
  await db.query('INSERT INTO gtt_pending_inquiries(id,source,received_at,original) VALUES($1,$2,$3,$4::jsonb)',[r.id,input.source,input.original.receivedAt,JSON.stringify(input.original)]);
  await db.query("INSERT INTO gtt_team_outbox(id,record_id,quote_version,kind,message,status) VALUES('test-team-delete',$1,$2,'new_inquiry','{}','accepted')",[r.id,intake.version]);
  await db.query("INSERT INTO gtt_admin_import_jobs(id,source_sha256,receipt) VALUES('test-import-receipt','local-test','{}')");
  await db.exec('CREATE TABLE deletion_guard(record_id text REFERENCES gtt_records(id))');
  await db.query('INSERT INTO deletion_guard VALUES($1)',[r.id]);
  const tables=['gtt_records','gtt_record_history','gtt_record_files','gtt_pending_inquiries','gtt_quote_versions','gtt_quote_outbox','gtt_team_outbox'];
  const counts=async()=>Promise.all(tables.map(async table=>(await db.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n));
  const before=await counts();
  let network=0;t.mock.method(globalThis,'fetch',async()=>{network++;throw Error('Deletion must not contact external services');});
  await assert.rejects(deletion(db,r),err=>err.code==='23503');
  assert.deepEqual(await counts(),before);
  assert.deepEqual((await readRecord(db,r.id)).document,r.document);
  await db.query('DELETE FROM deletion_guard WHERE record_id=$1',[r.id]);
  const result=await deletion(db,r);assert.equal(result.status,200);assert.deepEqual(await result.json(),{deleted:r.id});
  assert.deepEqual(await counts(),tables.map(()=>0));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_admin_import_jobs')).rows[0].n,1);
  assert.equal(network,0);
  await assert.rejects(readRecord(db,r.id),err=>err.status===404);
  const next=await db.query("SELECT nextval(pg_get_serial_sequence('gtt_quote_versions','version')) AS version");
  assert.ok(Number(next.rows[0].version)>intake.version);
});

test('queued/processing email work blocks deletion and a concurrent restore leaves all data intact',async t=>{
  const db=await database(t),{input,data}=await record(db,'delete-race');
  await processQuoteIntake(db,input.id,data,{deploy:{context:'deploy-preview'}},{mode:'preview',useAI:false,offer:{...DEFAULT_OFFER,active:true,percent:15}});
  let r=await changeRecord(db,input.id,{revision:(await readRecord(db,input.id)).revision,action:'archive'});
  for(const status of ['queued','processing']){
    await db.query('UPDATE gtt_quote_outbox SET status=$1 WHERE record_id=$2',[status,r.id]);
    await assert.rejects(deletion(db,r),err=>err.status===409);
    assert.ok((await readRecord(db,r.id)).document.archivedAt);
  }
  await db.query("UPDATE gtt_quote_outbox SET status='preview_only' WHERE record_id=$1",[r.id]);
  let restored=false;
  const race={query:async(sql,params)=>{
    if(sql.startsWith('WITH target')&&!restored){restored=true;await changeRecord(db,r.id,{revision:r.revision,action:'restore'});}
    return db.query(sql,params);
  }};
  await assert.rejects(deleteArchivedTestRecord(race,r.id,r.revision),err=>err.status===409);
  const after=await readRecord(db,r.id);assert.equal(after.document.archivedAt,'');assert.equal(after.revision,r.revision+1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_quote_versions')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_quote_outbox')).rows[0].n,1);
});
