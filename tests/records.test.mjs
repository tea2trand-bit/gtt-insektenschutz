import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {fromSubmission,createRecord,readRecord,changeRecord} from '../netlify/lib/records.mts';
import {recordsAPI} from '../netlify/lib/records-api.mts';

test('real Postgres engine: deduplication, prices, status audit, concurrent saves, complaints, payments and private files',async()=>{
  const db=await PGlite.create();
  try{
    await db.exec(await readFile(new URL('../netlify/database/migrations/20261021010000_admin_records.sql',import.meta.url),'utf8'));
    for(const form of ['angebot','b2b-anfrage','kontakt']){
      const input=fromSubmission({inquiry_id:'test-'+form,record_source:form,name:'TEST · Customer',berechneter_preis:"CHF 1’234.50",aktion:'Aktion 15%'});
      assert.equal((await createRecord(db,input)).created,true);
      assert.equal((await createRecord(db,input)).created,false);
      let r=await readRecord(db,input.id);assert.equal(r.document.status,'Novi upit');assert.equal(r.original.price,1234.5);assert.equal(r.history.length,1);
    }
    const id=fromSubmission({inquiry_id:'test-angebot',record_source:'angebot'}).id;
    await assert.rejects(changeRecord(db,id,{revision:1,patch:{status:'Prihvaćeno'}}),/cenu i datum/);
    await assert.rejects(changeRecord(db,id,{revision:1,patch:{original:{price:5}}}),/ne može menjati/);
    let r=await changeRecord(db,id,{revision:1,patch:{quotedPrice:1500,extraCosts:25,discount:'15%',offerSentAt:'2026-10-21',offerText:'Ponuda v2',status:'Ponuda poslata'}});
    assert.equal(r.revision,2);assert.equal(r.original.price,1234.5);assert.equal(r.history[1].snapshot.quotedPrice,1234.5);
    const results=await Promise.allSettled([changeRecord(db,id,{revision:2,patch:{notes:'Prvi prozor'}}),changeRecord(db,id,{revision:2,patch:{notes:'Drugi prozor'}})]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected')[0].reason.status,409);
    r=await readRecord(db,id);assert.equal(r.history.length,r.revision);
    r=await changeRecord(db,id,{revision:r.revision,patch:{status:'Prihvaćeno',decisionDate:'2026-10-21',agreedPrice:1450}});
    r=await changeRecord(db,id,{revision:r.revision,action:'payment',amount:500,date:'2026-10-21',note:'TEST uplata'});
    assert.equal(r.document.agreedPrice-r.document.payments.reduce((s,p)=>s+p.amount,0),950);
    r=await changeRecord(db,id,{revision:r.revision,action:'complaint',complaint:{description:'TEST oštećenje mrežice',date:'2026-10-21',status:'Otvorena',owner:'Servis',due:'2026-10-30'}});
    const c=r.document.complaints[0];
    await assert.rejects(changeRecord(db,id,{revision:r.revision,action:'complaint',complaint:{...c,status:'Rešena'}}),/način rešavanja/);
    r=await changeRecord(db,id,{revision:r.revision,action:'complaint',complaint:{...c,status:'Rešena',resolvedAt:'2026-10-22',resolution:'Zamenjena mrežica'}});
    assert.equal(r.document.complaints.length,1);assert.equal(r.history[1].snapshot.complaints[0].status,'Otvorena');
    await assert.rejects(changeRecord(db,id,{revision:r.revision,patch:{status:'Odbijeno',decisionReason:''}}),/datum i razlog/);
    const body=new FormData();body.append('file',new File(['TEST document'],'test.txt',{type:'text/html'}));
    await assert.rejects(recordsAPI(new Request('http://local',{method:'POST',body}),db,[id,'files']),/Dozvoljeni/);
    const pdf=new FormData();pdf.append('file',new File(['%PDF-TEST'],'TEST-potvrda.pdf',{type:'application/pdf'}));
    const uploaded=await recordsAPI(new Request('http://local',{method:'POST',body:pdf}),db,[id,'files']);assert.equal(uploaded.status,201);
    const fileId=(await uploaded.json()).id;
    const file=await recordsAPI(new Request('http://local'),db,[id,'files',fileId]);assert.equal(await file.text(),'%PDF-TEST');assert.match(file.headers.get('Content-Disposition'),/^attachment/);
    const otherId=fromSubmission({inquiry_id:'test-kontakt',record_source:'kontakt'}).id;
    await assert.rejects(recordsAPI(new Request('http://local'),db,[otherId,'files',fileId]),/nije pronađen/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_records')).rows[0].n,3);
  }finally{await db.close();}
});
