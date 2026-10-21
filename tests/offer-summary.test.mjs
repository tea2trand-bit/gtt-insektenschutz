import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {recordsAPI} from '../netlify/lib/records-api.mts';

test('offer KPI counts each active offer once across stages, excluding archive, tests and missing amounts',async t=>{
  const db=await PGlite.create();t.after(()=>db.close());
  for(const file of ['20261021010000_admin_records.sql','20261021023000_quote_intake.sql'])await db.exec(await readFile(new URL('../netlify/database/migrations/'+file,import.meta.url),'utf8'));
  const read=async archived=>(await (await recordsAPI(new Request('http://local'+(archived?'?archived=1':'')),db,[])).json());
  assert.deepEqual((await read()).offerSummary,{total:0,count:0});
  const documents=[
    {quotedPrice:100.25,status:'Novi upit'},
    {quotedPrice:200,agreedPrice:180.5,status:'Prihvaćeno'},
    {quotedPrice:50.1,status:'Završeno',archivedAt:'2026-10-22'},
    {quotedPrice:40,status:'Odbijeno'},
    {quotedPrice:999,isTest:true},
    {quotedPrice:null},
    {quotedPrice:'invalid'},
    {quotedPrice:0},
  ];
  for(const [i,document]of documents.entries())await db.query('INSERT INTO gtt_records(id,source,original,document) VALUES($1,$2,$3::jsonb,$4::jsonb)',['GTT-'+String(i).padStart(24,'0'),'Kontakt','{}',JSON.stringify(document)]);
  const active=await read(),archive=await read(true);
  assert.deepEqual(active.offerSummary,{total:320.75,count:4});
  assert.deepEqual(archive.offerSummary,active.offerSummary);
  assert.equal(active.records.length,7);assert.equal(archive.records.length,1);
  // Pagination affects the list, never the global KPI.
  await db.exec(`INSERT INTO gtt_records(id,source,original,document)
    SELECT 'GTT-'||lpad(n::text,24,'0'),'Kontakt','{}'::jsonb,'{"quotedPrice":1}'::jsonb FROM generate_series(20,1020) n`);
  const limited=await read();
  assert.equal(limited.records.length,1000);
  assert.deepEqual(limited.offerSummary,{total:1321.75,count:1005});
});
