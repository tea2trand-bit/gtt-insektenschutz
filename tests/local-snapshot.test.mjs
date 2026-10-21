import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {fromSubmission,readRecord} from '../netlify/lib/records.mts';
import {prepareQuoteIntake} from '../netlify/lib/quote-intake.mts';
import {DEFAULT_OFFER} from '../netlify/lib/projects-store.mts';
import {recordsAPI} from '../netlify/lib/records-api.mts';
import {exportAdminSnapshot,importAdminSnapshot} from '../scripts/admin-snapshot.mjs';

test('local snapshot export uses only login and GET reads; import preserves records, history, files and global offer numbers',async t=>{
  const input=fromSubmission({inquiry_id:'local-copy-fixture',record_source:'kontakt',name:'TEST · Local copy',email:'test@example.invalid',plz:'9000',nachricht:'1 Fenster 100 x 100 cm'});
  const intake=await prepareQuoteIntake(input.original.fields,{deploy:{context:'dev'}},{mode:'preview',useAI:false,offer:{...DEFAULT_OFFER,active:true,percent:15}});intake.version=42;intake.quote.version=42;
  const r={...input,revision:3,received_at:input.original.receivedAt,updated_at:input.original.receivedAt,document:{...input.document,intake,notes:'Keep copied note'},history:[{revision:3,at:input.original.receivedAt,actor:'Fixture',kind:'quote_intake',snapshot:{...input.document,intake}}],files:[{id:'11111111-1111-4111-8111-111111111111',name:'TEST.pdf',content_type:'application/pdf',created_at:input.original.receivedAt}]};
  const before=structuredClone(r),calls=[];
  t.mock.method(globalThis,'fetch',async(url,options={})=>{
    const path=new URL(url).pathname,search=new URL(url).search;calls.push({path,method:options.method||'GET'});
    if(path==='/api/admin/login'){assert.equal(JSON.parse(options.body).password,'fixture-only-password');return Response.json({token:'fixture-only-session'});}
    assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'Bearer fixture-only-session');
    if(path==='/api/admin/records')return Response.json({records:search?[]:[r]});
    if(path==='/api/admin/records/'+r.id)return Response.json({record:r});
    if(path.includes('/files/'))return new Response('%PDF-LOCAL-TEST');
    if(path==='/api/admin/items')return Response.json({items:[]});
    if(path==='/api/admin/offer')return Response.json({offer:DEFAULT_OFFER});
    throw Error('Unexpected export route');
  });
  const snapshot=await exportAdminSnapshot('fixture-only-password');
  assert.equal(calls.filter(c=>c.method!=='GET').length,1);assert.equal(calls[0].path,'/api/admin/login');
  assert.ok(!JSON.stringify(snapshot).includes('fixture-only-password'));assert.ok(!JSON.stringify(snapshot).includes('fixture-only-session'));
  assert.deepEqual(r,before);
  const db=await PGlite.create();t.after(()=>db.close());
  const dir=new URL('../netlify/database/migrations/',import.meta.url);
  for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
  const result=await importAdminSnapshot(db,snapshot);assert.equal(result.records,1);
  const local=await readRecord(db,r.id);assert.deepEqual(local.original,r.original);assert.deepEqual(local.document,r.document);assert.equal(local.revision,r.revision);assert.equal(local.history.length,1);
  const file=(await db.query('SELECT content FROM gtt_record_files WHERE record_id=$1',[r.id])).rows[0];assert.equal(Buffer.from(file.content).toString(),'%PDF-LOCAL-TEST');
  const rendered=await (await recordsAPI(new Request('http://local'),db,[r.id,'offer'])).json();assert.equal(rendered.reference,'GTT-042');
  assert.ok(Number((await db.query("SELECT nextval(pg_get_serial_sequence('gtt_quote_versions','version')) AS n")).rows[0].n)>42);
  await assert.rejects(importAdminSnapshot(db,snapshot),/Lokale Änderungen werden nicht überschrieben/);
});

test('a rejected production login cannot export records or continue with unauthenticated reads',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:'Falsches Passwort'}, {status:401});});
  await assert.rejects(exportAdminSnapshot('fixture-only-wrong-password'),/HTTP 401/);assert.equal(calls,1);
});
