import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {recordSubmission} from '../netlify/functions/records-event.mts';
import {recordsAPI} from '../netlify/lib/records-api.mts';
import {readRecord} from '../netlify/lib/records.mts';
import {DEFAULT_OFFER} from '../netlify/lib/projects-store.mts';
import legacySender from '../netlify/functions/submission-created.mts';

test('verified contact intake keeps one card and quote, renders the same professional offer, and never accepts a contract',async()=>{
  const db=await PGlite.create();
  try{
    const dir=new URL('../netlify/database/migrations/',import.meta.url);
    for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
    const message='Funktionstest, keine Bestellung, bitte nicht anrufen. PLZ 9000. 2 Fenster je 120 x 140 cm und 1 Tür 90 x 210 cm.';
    const data={record_source:'kontakt',inquiry_id:'integrated-contact-test',name:'TEST · Integracija',email:'test@example.invalid',telefon:'+41 00 000 00 00',nachricht:message};
    const context={deploy:{context:'deploy-preview'}};
    const options={mode:'preview',offer:{...DEFAULT_OFFER,active:true,percent:15},useAI:false};
    const first=await recordSubmission(data,db,context,options);
    const second=await recordSubmission(data,db,context,options);
    assert.equal(first.id,second.id);assert.equal(second.created,false);assert.equal(first.intake.version,second.intake.version);
    const r=await readRecord(db,first.id);assert.equal(r.document.status,'Novi upit');assert.equal(r.document.agreedPrice,null);
    assert.equal(r.original.fields.nachricht,message);assert.equal(r.original.price,null);assert.equal(r.document.quotedPrice,1026);
    assert.equal(r.document.intake.quote.areas.fenster,3.36);assert.equal(r.document.intake.quote.areas.tueren,1.89);assert.equal(r.document.intake.email.status,'preview_only');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_records')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_quote_outbox')).rows[0].n,1);
    const offer=await recordsAPI(new Request('http://local'),db,[first.id,'offer']);const rendered=await offer.json();
    assert.equal(offer.status,200);assert.match(rendered.html,/Gesamtbetrag inkl\. MwSt\./);assert.match(rendered.html.replace(/&#39;/g,"'"),/1[’']026\.00/);assert.match(rendered.html,/CHF 76\.88/);assert.match(rendered.text,/Darin enthaltene MwSt\. \(8\.1 %\): CHF 76\.88/);assert.doesNotMatch(rendered.html+rendered.text,/Rundung/);assert.ok(rendered.reference);
    assert.equal(r.history.length,2);
  }finally{await db.close();}
});

test('both production calculator event paths together produce exactly one customer email and one record/version',async t=>{
  const db=await PGlite.create();
  const oldFlag=process.env.GTT_QUOTE_AUTOMATION,oldKey=process.env.RESEND_API_KEY;
  process.env.GTT_QUOTE_AUTOMATION='enabled';process.env.RESEND_API_KEY='local-fixture-not-a-real-key';
  t.after(()=>{if(oldFlag===undefined)delete process.env.GTT_QUOTE_AUTOMATION;else process.env.GTT_QUOTE_AUTOMATION=oldFlag;if(oldKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldKey;});
  try{
    const dir=new URL('../netlify/database/migrations/',import.meta.url);
    for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
    const data={record_source:'angebot',inquiry_id:'combined-calculator-production-paths',name:'TEST · Obe putanje',email:'test@example.invalid',telefon:'+41 00 000 00 00',plz:'9000',fensterflaeche_m2:'1',tuerflaeche_m2:'0',berechneter_preis:'Fixpreis: CHF 186.–'};
    const context={deploy:{context:'production'}};
    let calls=0;
    const provider=async(url,options)=>{calls++;assert.equal(url,'https://api.resend.com/emails');const body=JSON.parse(options.body);assert.deepEqual(body.to,['test@example.invalid']);return Response.json({id:'combined-path-provider-id'});};
    t.mock.method(globalThis,'fetch',provider);
    const opts={offer:{...DEFAULT_OFFER,active:true,percent:15},useAI:false,fetch:provider};
    const [legacy,created]=await Promise.all([
      legacySender(new Request('http://local',{method:'POST',body:JSON.stringify({payload:{form_name:'angebot',data}})}),context),
      recordSubmission(data,db,context,opts),recordSubmission(data,db,context,opts),
    ]);
    assert.match(await legacy.text(),/owned by quote intake/);assert.equal(calls,1);
    for(const table of ['gtt_records','gtt_quote_versions','gtt_quote_outbox'])assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,1);
    const r=await readRecord(db,created.id);assert.equal(r.document.intake.email.status,'accepted');assert.equal(r.document.status,'Ponuda poslata');assert.equal(r.document.agreedPrice,null);assert.equal(r.document.decisionDate,'');
  }finally{await db.close();}
});
