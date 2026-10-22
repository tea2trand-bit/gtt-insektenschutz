import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {PDFDocument,PDFName} from 'pdf-lib';
import {prepareQuoteIntake,processQuoteIntake} from '../netlify/lib/quote-intake.mts';
import {renderQuotePDF} from '../netlify/lib/quote-pdf.mts';
import {renderQuoteEmail} from '../netlify/lib/quote-email.mts';
import {handleOfferAcceptance} from '../netlify/functions/offer-acceptance.mts';
import {fromSubmission,createRecord,readRecord} from '../netlify/lib/records.mts';
import {prepareSmallinvoiceDraft} from '../netlify/lib/smallinvoice-preparation.mts';
const offer={active:true,name:'TEST Aktion',percent:15,fenster:true,tueren:true,validFrom:'',validUntil:'',text:''};
const data={record_source:'kontakt',inquiry_id:'pdf-security-demo',name:'TEST Đorđe Čirić',email:'test@example.invalid',plz:'9000',nachricht:'2 Fenster je 120 x 140 cm und 1 Tür 90 x 210 cm.'};
test('short offer is A4 with two decision links; long measured details paginate on A4',async()=>{
 process.env.GTT_OFFER_ACCEPTANCE_SECRET='test-only-pdf';
 try{
 const s=await prepareQuoteIntake(data,{deploy:{context:'dev'}},{mode:'preview',offer,useAI:false});
 const pdf=await PDFDocument.load(await renderQuotePDF(s,'GTT-123456789012345678901234',1,{baseURL:'https://example.invalid'}));
 assert.equal(pdf.getPageCount(),1);const page=pdf.getPages()[0];assert.ok(Math.abs(page.getWidth()-595.28)<.01);assert.ok(Math.abs(page.getHeight()-841.89)<.01);assert.equal(page.node.lookup(PDFName.of('Annots')).size(),2);
 const long={...s,measurements:Array.from({length:30},(_,i)=>({...s.measurements[0],source:'TEST',width:100+i,quantity:1}))};
 const larger=await PDFDocument.load(await renderQuotePDF(long,'GTT-123456789012345678901234',1));assert.ok(larger.getPageCount()>1);assert.ok(larger.getPages().every(p=>p.getHeight()===841.89));
 }finally{delete process.env.GTT_OFFER_ACCEPTANCE_SECRET;}
});
test('customer PDF requires a valid current signed link and downloading never records a decision',async t=>{
 const db=await PGlite.create();t.after(()=>db.close());
 for(const n of (await readdir(new URL('../netlify/database/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL('../netlify/database/migrations/'+n,import.meta.url),'utf8'));
 process.env.GTT_OFFER_ACCEPTANCE_SECRET='test-only-pdf';t.after(()=>delete process.env.GTT_OFFER_ACCEPTANCE_SECRET);
 const input=fromSubmission(data);await createRecord(db,input);const context={deploy:{context:'dev'}};
 const s=await processQuoteIntake(db,input.id,data,context,{mode:'preview',offer,useAI:false});const email=renderQuoteEmail(s,input.id,s.version,{baseURL:'https://example.invalid'}),before=await readRecord(db,input.id);
 const response=await handleOfferAcceptance(new Request(email.pdfURL),context,db);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.match(response.headers.get('content-disposition'),/attachment/);assert.equal((await PDFDocument.load(await response.arrayBuffer())).getPageCount(),1);assert.deepEqual(await readRecord(db,input.id),before);
 assert.equal((await handleOfferAcceptance(new Request(email.pdfURL.replace('token=','token=x')),context,db)).status,400);
 await processQuoteIntake(db,input.id,{...data,nachricht:'1 Fenster 100 x 100 cm'},context,{mode:'preview',offer,useAI:false});assert.equal((await handleOfferAcceptance(new Request(email.pdfURL),context,db)).status,409);
});
test('invoice preparation binds the final measured and approved offer and never uses an unapproved correction',()=>{
 const document={status:'Završeno',agreedPrice:223,measuredAt:'2026-10-22',intake:{version:2,quote:{totalCHF:223}},customerAcceptance:{quoteVersion:2,intent:'confirm_corrected_offer'}};
 const result=prepareSmallinvoiceDraft({id:'test',document});assert.equal(result.totalCHF,223);assert.equal(result.quoteVersion,2);assert.equal(result.sendAutomatically,false);
 for(const patch of [{correctionPending:true},{agreedPrice:200},{customerAcceptance:{quoteVersion:1}},{measuredAt:''}])assert.throws(()=>prepareSmallinvoiceDraft({id:'test',document:{...document,...patch}}));
});
