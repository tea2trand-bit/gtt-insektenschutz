import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createRecord,fromSubmission,readRecord,changeRecord,deleteArchivedTestRecord} from '../netlify/lib/records.mts';
import {completeWithInvoice,invoiceSnapshot,invoicePDF,invoiceForRecord,deliverInvoice,confirmInvoicePayment} from '../netlify/lib/invoices.mts';
import {invoiceQRData} from '../netlify/lib/invoice-pdf.mts';
const local={deploy:{context:'dev'}},prod={deploy:{context:'production'}};
async function setup(t,options={}){
 const db=await PGlite.create();t.after(()=>db.close());
 for(const f of (await readdir(new URL('../netlify/database/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL('../netlify/database/migrations/'+f,import.meta.url),'utf8'));
 const input=fromSubmission({record_source:'angebot',inquiry_id:randomUUID(),name:'Beispiel Kunde',email:'invoice-test@example.invalid',telefon:'000',adresse:'Musterstrasse 1',plz:'9000 St. Gallen'});await createRecord(db,input);
 const quote={totalCHF:205.39,areas:{fenster:1.6,tueren:0},rates:{fenster:128.36875,tueren:0},travelCosts:{amountCHF:0}},snapshot={quote,customer:{name:'Beispiel Kunde'}};
 const version=Number((await db.query("INSERT INTO gtt_quote_versions(record_id,source_fingerprint,snapshot) VALUES($1,'fixture',$2::jsonb) RETURNING version",[input.id,JSON.stringify(snapshot)])).rows[0].version);
 const doc={...input.document,status:'Montaža',decisionDate:'2026-10-22',agreedPrice:205.39,onsite:{totalCHF:205.39},measuredAt:'2026-10-22',intake:{version,quote},customerAcceptance:{quoteVersion:version,intent:'confirm_corrected_offer'},...options};
 await db.query('UPDATE gtt_records SET document=$2::jsonb WHERE id=$1',[input.id,JSON.stringify(doc)]);
 return {db,input,doc,snapshot,body:{revision:1,requestId:randomUUID(),method:'bank'}};
}
test('bank invoice completes montage atomically, uses approved gross price and deposits, keeps a single immutable PDF',async t=>{
 const {db,input,body}=await setup(t,{payments:[{id:'deposit',amount:50,date:'2026-10-21'}]});
 const before=await readRecord(db,input.id),result=await completeWithInvoice(db,input.id,body,local),s=result.invoice.snapshot;
 assert.equal(result.record.document.status,'Završeno');assert.match(s.number,/^GTT-R-\d{4}-\d{5}$/);assert.equal(s.netCHF,190);assert.equal(s.vatCHF,15.39);assert.equal(s.totalCHF,205.39);assert.equal(s.prepaidCHF,50);assert.equal(s.balanceCHF,155.39);assert.equal(s.paid,false);assert.equal(result.invoice.delivery_status,'preview_only');
 assert.deepEqual(invoiceQRData(s).amount,155.39);assert.equal(invoiceQRData(s).creditor.account,'CH7380808007449561057');assert.equal(invoiceQRData(s).reference,undefined);
 const pdf=await invoicePDF(db,result.invoice.id);assert.equal(pdf.subarray(0,4).toString(),'%PDF');assert.deepEqual(await invoicePDF(db,result.invoice.id),pdf);
 const again=await completeWithInvoice(db,input.id,body,local);assert.equal(again.record.revision,result.record.revision);assert.equal(again.invoice.id,result.invoice.id);assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_invoices')).rows[0].n,1);assert.equal(result.record.history.filter(h=>h.kind==='invoice_created').length,1);assert.deepEqual(result.record.original,before.original);
 await assert.rejects(completeWithInvoice(db,input.id,{...body,requestId:randomUUID(),method:'cash'},local),/bereits eine Rechnung/);
 await db.query("UPDATE gtt_records SET document=jsonb_set(document,'{name}','\"Geänderter Kontakt\"') WHERE id=$1",[input.id]);assert.deepEqual(await invoicePDF(db,result.invoice.id),pdf);assert.equal((await invoiceForRecord(db,input.id)).snapshot.customer.name,'Beispiel Kunde');
 await mkdir('test-results/pdf',{recursive:true});await writeFile('test-results/pdf/invoice-bank-preview.pdf',pdf);
});
test('cash and TWINT require explicit receipt, add only outstanding balance and produce paid receipts without duplicate payment',async t=>{
 for(const method of ['cash','twint']){
  const {db,input,body}=await setup(t,{payments:[{id:'deposit',amount:50,date:'2026-10-21'}]});
  await assert.rejects(completeWithInvoice(db,input.id,{...body,method},local),/ausdrücklich bestätigen/);assert.equal((await readRecord(db,input.id)).document.status,'Montaža');
  const payload={...body,method,paymentReceived:true},result=await completeWithInvoice(db,input.id,payload,local);assert.equal(result.invoice.snapshot.paid,true);assert.equal(result.record.document.payments.length,2);assert.equal(result.record.document.payments[1].amount,155.39);
  await completeWithInvoice(db,input.id,payload,local);assert.equal((await readRecord(db,input.id)).document.payments.length,2);
  await writeFile('test-results/pdf/invoice-'+method+'-preview.pdf',await invoicePDF(db,result.invoice.id));
 }
});
test('no invoice for unapproved correction, missing onsite measurement, invalid contact or overpayment; no partial completion',async t=>{
 for(const patch of [{correctionPending:true},{customerAcceptance:null},{agreedPrice:200},{onsite:null},{email:''},{postalCode:''},{payments:[{amount:300}]}]){
  const {db,input,body}=await setup(t,patch);await assert.rejects(completeWithInvoice(db,input.id,body,local));assert.equal((await readRecord(db,input.id)).revision,1);assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_invoices')).rows[0].n,0);
 }
});
test('invoice creation rollback leaves no bill or completion when audit fails',async t=>{
 const {db,input,body}=await setup(t);await db.exec("ALTER TABLE gtt_record_history ADD CONSTRAINT test_reject_invoice CHECK(kind<>'invoice_created')");
 await assert.rejects(completeWithInvoice(db,input.id,body,local));assert.equal((await readRecord(db,input.id)).document.status,'Montaža');assert.equal((await db.query('SELECT count(*)::int AS n FROM gtt_invoices')).rows[0].n,0);
});
test('concurrent production requests send one invoice attachment with stable idempotency and no second financial entry',async t=>{
 const {db,input,body}=await setup(t);const old=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='test-only-invoice-provider';t.after(()=>old===undefined?delete process.env.RESEND_API_KEY:process.env.RESEND_API_KEY=old);
 let calls=0;const provider=async(url,opts)=>{calls++;const m=JSON.parse(opts.body);assert.equal(url,'https://api.resend.com/emails');assert.deepEqual(m.to,['invoice-test@example.invalid']);assert.match(opts.headers['Idempotency-Key'],/^gtt-invoice-/);assert.equal(Buffer.from(m.attachments[0].content,'base64').subarray(0,4).toString(),'%PDF');return Response.json({id:'fake-invoice-id'});};
 const results=await Promise.allSettled([completeWithInvoice(db,input.id,body,prod,{fetch:provider,accountConfirmed:true}),completeWithInvoice(db,input.id,body,prod,{fetch:provider,accountConfirmed:true})]);assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(calls,1);assert.equal((await invoiceForRecord(db,input.id)).delivery_status,'accepted');assert.equal((await readRecord(db,input.id)).document.payments.length,0);
 await completeWithInvoice(db,input.id,body,prod,{fetch:provider,accountConfirmed:true});assert.equal(calls,1);
});
test('failed or uncertain provider outcome is truthful and retry uses identical attachment and key',async t=>{
 const {db,input,body}=await setup(t);process.env.RESEND_API_KEY='test-only-invoice-provider';t.after(()=>delete process.env.RESEND_API_KEY);let first;
 const result=await completeWithInvoice(db,input.id,body,prod,{accountConfirmed:true,fetch:async(_,options)=>{first=options;throw Error('simulated timeout');}});assert.equal(result.invoice.delivery_status,'unknown');
 await deliverInvoice(db,result.invoice.id,prod,{fetch:async(_,options)=>{assert.equal(options.body,first.body);assert.equal(options.headers['Idempotency-Key'],first.headers['Idempotency-Key']);return Response.json({id:'recovered-provider-id'});}});assert.equal((await invoiceForRecord(db,input.id)).delivery_status,'accepted');
});
test('test cards never send real invoices, and expired uncertain jobs never blindly resend',async t=>{
 const {db,input,body}=await setup(t,{isTest:true});process.env.RESEND_API_KEY='test-only-invoice-provider';t.after(()=>delete process.env.RESEND_API_KEY);
 let sent=0;const result=await completeWithInvoice(db,input.id,body,prod,{accountConfirmed:true,fetch:async()=>{sent++;throw Error('must not send');}});assert.equal(result.invoice.delivery_status,'preview_only');assert.equal(sent,0);
 await db.query("UPDATE gtt_invoice_outbox SET status='unknown',created_at=now()-interval '24 hours' WHERE invoice_id=$1",[result.invoice.id]);await deliverInvoice(db,result.invoice.id,prod,{fetch:async()=>{sent++;throw Error('must not send');}});assert.equal(sent,0);
});
test('bank receipt is explicit and repeat safe; issued financial records cannot be overwritten or deleted',async t=>{
 const {db,input,body}=await setup(t),result=await completeWithInvoice(db,input.id,body,local);
 await assert.rejects(confirmInvoicePayment(db,input.id,{revision:result.record.revision}),/tatsächlichen Zahlungseingang/);
 const paid=await confirmInvoicePayment(db,input.id,{revision:result.record.revision,paymentReceived:true});assert.equal(paid.record.document.payments[0].amount,205.39);
 const repeat=await confirmInvoicePayment(db,input.id,{revision:result.record.revision,paymentReceived:true});assert.equal(repeat.record.revision,paid.record.revision);assert.equal(repeat.record.document.payments.length,1);
 await assert.rejects(changeRecord(db,input.id,{revision:paid.record.revision,action:'update',patch:{invoiceAmount:1}}),/nicht überschrieben/);
 await assert.rejects(changeRecord(db,input.id,{revision:paid.record.revision,action:'payment',amount:1,date:'2026-10-22'}),/Rechnungsaktionen/);
 await assert.rejects(deleteArchivedTestRecord(db,input.id,paid.record.revision),/erhalten/);
});
