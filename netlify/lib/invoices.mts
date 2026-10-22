import {randomUUID} from 'node:crypto';
import {RecordError,readRecord,type QueryDB} from './records.mts';
import {offerNumber,money} from './quote-email.mts';
import {INVOICE_ISSUER,INVOICE_ACCOUNT_CONFIRMED} from './invoice-settings.mts';
import {renderInvoicePDF} from './invoice-pdf.mts';
const env=(key:string)=>(globalThis as any).Netlify?.env?.get(key)??process.env[key];
const cents=(n:number)=>Math.round(n*100);
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function invoiceSnapshot(record:any,approved:any,method:string,now=new Date()){
 const d=record.document,q=approved.quote;
 if(!['bank','cash','twint'].includes(method))throw new RecordError('Bitte Rechnung, Bar oder TWINT auswählen.');
 if(d.status!=='Montaža'||d.archivedAt)throw new RecordError('Die Rechnung wird beim Abschluss der Montage erstellt.',409);
 if(d.correctionPending||!q||d.customerAcceptance?.quoteVersion!==d.intake?.version||d.customerDecline||d.agreedPrice!==q.totalCHF)throw new RecordError('Die aktuelle Offerte muss vor der Rechnung bestätigt werden.',409);
 if(!d.onsite||d.onsite.totalCHF!==q.totalCHF||!d.measuredAt)throw new RecordError('Bitte zuerst das Aufmass vor Ort speichern.',409);
 if(!Number.isFinite(q.totalCHF)||q.totalCHF<=0||q.totalCHF>10000000)throw new RecordError('Der bestätigte Rechnungsbetrag ist ungültig.');
 for(const [key,label]of [['name','Name'],['email','E-Mail'],['address','Adresse'],['postalCode','PLZ / Ort']])if(typeof d[key]!=='string'||!d[key].trim())throw new RecordError(label+' des Kunden fehlt. Bitte unter Kontakt korrigieren ergänzen.');
 if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email))throw new RecordError('Die E-Mail-Adresse des Kunden ist ungültig.');
 const prepaidCents=(d.payments||[]).reduce((sum:number,p:any)=>{if(!Number.isFinite(p.amount)||p.amount<=0)throw new RecordError('Bitte die vorhandenen Zahlungen prüfen.');return sum+cents(p.amount);},0),totalCents=cents(q.totalCHF);
 if(prepaidCents>totalCents)throw new RecordError('Die erfassten Zahlungen übersteigen den Rechnungsbetrag. Bitte prüfen.',409);
 const day=now.toLocaleDateString('sv-SE',{timeZone:'Europe/Zurich'}),due=new Date(day+'T12:00:00Z');due.setUTCDate(due.getUTCDate()+INVOICE_ISSUER.paymentDays);
 const totalCHF=totalCents/100,netCHF=Math.round(totalCHF/(1+INVOICE_ISSUER.vatRate/100)*100)/100;
 return {schemaVersion:'gtt-invoice-v1',createdAt:now.toISOString(),date:day,dueDate:due.toISOString().slice(0,10),serviceDate:day,issuer:INVOICE_ISSUER,customer:{name:d.name,company:d.company,email:d.email,phone:d.phone,address:d.address,postalCode:d.postalCode},offerReference:offerNumber(record.id,d.intake.version),quoteVersion:d.intake.version,quote:q,customerAcceptance:d.customerAcceptance,method,totalCHF,netCHF,vatCHF:(totalCents-cents(netCHF))/100,prepaidCHF:prepaidCents/100,balanceCHF:(totalCents-prepaidCents)/100,paid:method!=='bank'||prepaidCents===totalCents};
}
export async function invoiceForRecord(db:QueryDB,id:string){
 const {rows}=await db.query('SELECT i.id,i.number,i.method,i.snapshot,o.status AS delivery_status,o.error_code FROM gtt_invoices i JOIN gtt_invoice_outbox o ON o.invoice_id=i.id WHERE i.record_id=$1',[id]);
 return rows[0]||null;
}
export function renderInvoiceEmail(s:any){
 const title=s.paid?'Ihre bezahlte Rechnung':'Ihre Rechnung',next=s.paid?'Die Zahlung ist bestätigt. Es ist kein Betrag mehr offen.':'Bitte überweisen Sie '+money(s.balanceCHF)+' bis '+s.dueDate.split('-').reverse().join('.')+'. Den QR-Zahlteil finden Sie im angehängten PDF.';
 const text=[title+' '+s.number,'','Guten Tag '+s.customer.name+',','vielen Dank für Ihren Auftrag. Die Montage ist abgeschlossen.',next,'','Bestätigte Offerte: '+s.offerReference,'Gesamtbetrag: '+money(s.totalCHF),'','Ihre Rechnung ist als PDF angehängt.','Bei Fragen antworten Sie auf diese E-Mail.',s.issuer.name].join('\n');
 const html='<!doctype html><html lang="de-CH"><body style="font:16px/1.6 Arial,sans-serif;color:#24392b"><main style="max-width:560px;margin:20px auto;padding:24px"><p>GTT Insektenschutz</p><h1 style="font-size:24px">'+escape(title)+' '+escape(s.number)+'</h1><p>Guten Tag '+escape(s.customer.name)+',</p><p>Vielen Dank für Ihren Auftrag. Die Montage ist abgeschlossen.</p><p><strong>'+escape(next)+'</strong></p><p>Bestätigte Offerte: '+escape(s.offerReference)+'<br>Gesamtbetrag: '+escape(money(s.totalCHF))+'</p><p>Ihre Rechnung ist als PDF angehängt.<br>Bei Fragen antworten Sie auf diese E-Mail.</p><p>'+escape(s.issuer.name)+'</p></main></body></html>';
 return {subject:title+' '+s.number+' · GTT Insektenschutz',html,text};
}
export async function invoicePDF(db:QueryDB,id:string){
 const row=(await db.query('SELECT * FROM gtt_invoices WHERE id=$1',[id])).rows[0];
 if(!row)throw new RecordError('Rechnung nicht gefunden.',404);
 if(row.pdf)return Buffer.from(row.pdf);
 const bytes=await renderInvoicePDF(row.snapshot);
 const saved=await db.query('UPDATE gtt_invoices SET pdf=$2 WHERE id=$1 AND pdf IS NULL RETURNING pdf',[id,bytes]);
 return saved.rows[0]?Buffer.from(saved.rows[0].pdf):Buffer.from((await db.query('SELECT pdf FROM gtt_invoices WHERE id=$1',[id])).rows[0].pdf);
}
export async function deliverInvoice(db:QueryDB,id:string,context:any={},options:{fetch?:typeof fetch}={}){
 if(context?.deploy?.context!=='production'||!env('RESEND_API_KEY'))return;
 const pdf=await invoicePDF(db,id);
 const reserved=await db.query(`UPDATE gtt_invoice_outbox SET status='processing',attempts=attempts+1,lease_until=now()+interval '1 minute',updated_at=now() WHERE invoice_id=$1 AND attempts<3 AND created_at>now()-interval '23 hours' AND (status IN ('queued','failed','unknown') OR (status='processing' AND lease_until<now())) RETURNING *`,[id]);
 const job=reserved.rows[0];if(!job)return;
 const invoice=(await db.query('SELECT snapshot FROM gtt_invoices WHERE id=$1',[id])).rows[0],s=invoice.snapshot;
 let status='unknown',provider=null,code='provider_outcome_unknown';
 try{
  const response=await(options.fetch||fetch)('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env('RESEND_API_KEY'),'Content-Type':'application/json','Idempotency-Key':'gtt-invoice-'+id},body:JSON.stringify({from:env('OFFER_FROM')||'GTT Insektenschutz <offerte@gtt-insektenschutz.ch>',to:[s.customer.email],reply_to:s.issuer.email,...renderInvoiceEmail(s),attachments:[{filename:s.number+'.pdf',content:pdf.toString('base64')}] }),signal:AbortSignal.timeout(15000)});
  const body=await response.json().catch(()=>null);
  if(response.ok&&typeof body?.id==='string'){status='accepted';provider=body.id;code=null;}else{status='failed';code='provider_http_'+response.status;}
 }catch{}
 await db.query('UPDATE gtt_invoice_outbox SET status=$3,provider_id=$4,error_code=$5,lease_until=NULL,updated_at=now() WHERE invoice_id=$1 AND attempts=$2',[id,job.attempts,status,provider,code]);
}
export async function completeWithInvoice(db:QueryDB,recordId:string,body:any,context:any={},options:{fetch?:typeof fetch;accountConfirmed?:boolean}={}){
 if(!/^[a-f0-9-]{36}$/i.test(body.requestId||''))throw new RecordError('Bitte den Montageabschluss erneut öffnen.');
 const existing=(await db.query('SELECT id,request_id,method FROM gtt_invoices WHERE record_id=$1',[recordId])).rows[0];
 if(existing){
  if(existing.request_id!==body.requestId||existing.method!==body.method)throw new RecordError('Für diesen Auftrag existiert bereits eine Rechnung.',409);
  await invoicePDF(db,existing.id);await deliverInvoice(db,existing.id,context,options);
  return {record:await readRecord(db,recordId),invoice:await invoiceForRecord(db,recordId)};
 }
 const record=await readRecord(db,recordId),d=record.document;
 if(!Number.isInteger(body.revision)||record.revision!==body.revision)throw new RecordError('Die Anfrage wurde geändert. Bitte neu öffnen.',409);
 if(body.method!=='bank'&&body.paymentReceived!==true)throw new RecordError('Bitte den erhaltenen Bar- oder TWINT-Betrag ausdrücklich bestätigen.');
 if(context?.deploy?.context==='production'&&!(options.accountConfirmed??INVOICE_ACCOUNT_CONFIRMED))throw new RecordError('Das Empfängerkonto für Rechnungen muss zuerst bestätigt werden.',409);
 const approved=(await db.query('SELECT snapshot FROM gtt_quote_versions WHERE record_id=$1 AND version=$2',[recordId,d.intake?.version||0])).rows[0]?.snapshot;
 const snapshot={...invoiceSnapshot(record,approved||{},body.method),preview:context?.deploy?.context!=='production'||d.isTest===true},invoiceId=randomUUID();
 const payment=body.method!=='bank'&&snapshot.balanceCHF>0?[{id:invoiceId,amount:snapshot.balanceCHF,date:snapshot.date,note:body.method==='cash'?'Barzahlung bei Montageabschluss bestätigt':'TWINT-Zahlung bei Montageabschluss bestätigt'}]:[];
 const next={...d,status:'Završeno',installedAt:snapshot.date,payments:[...(d.payments||[]),...payment]};
 const delivery=context?.deploy?.context==='production'&&!d.isTest?'queued':'preview_only';
 const {rows}=await db.query(`WITH target AS MATERIALIZED (
  SELECT id FROM gtt_records WHERE id=$1 AND revision=$2 AND document->>'status'='Montaža' AND COALESCE(document->>'archivedAt','')='' FOR UPDATE
 ), numbered AS (
  SELECT id,'GTT-R-'||$3||'-'||CASE WHEN length(seq)>5 THEN seq ELSE lpad(seq,5,'0') END AS number FROM (SELECT id,nextval('gtt_invoice_numbers')::text AS seq FROM target) n
 ), added AS (
  INSERT INTO gtt_invoices(id,record_id,quote_version,request_id,number,method,snapshot)
  SELECT $4,n.id,$5,$6,n.number,$7,$8::jsonb||jsonb_build_object('number',n.number) FROM numbered n RETURNING *
 ), outbox AS (
  INSERT INTO gtt_invoice_outbox(invoice_id,status) SELECT id,$9 FROM added RETURNING invoice_id
 ), changed AS (
  UPDATE gtt_records r SET document=$10::jsonb||jsonb_build_object('invoiceNumber',a.number,'invoiceAmount',($8::jsonb->'totalCHF'),'invoiceDate',($8::jsonb->>'date'),'invoiceDue',($8::jsonb->>'dueDate'),'billing',jsonb_build_object('id',a.id,'number',a.number,'method',a.method)),revision=revision+1,updated_at=now() FROM added a WHERE r.id=a.record_id RETURNING r.*
 ), audit AS (
  INSERT INTO gtt_record_history(record_id,revision,actor,kind,snapshot) SELECT id,revision,'Admin: Montageabschluss und Rechnung','invoice_created',document FROM changed RETURNING record_id
 ) SELECT id FROM added`,[recordId,body.revision,snapshot.date.slice(0,4),invoiceId,d.intake.version,body.requestId,body.method,JSON.stringify(snapshot),delivery,JSON.stringify(next)]);
 if(!rows.length)throw new RecordError('Die Anfrage wurde geändert. Bitte neu öffnen.',409);
 await invoicePDF(db,invoiceId);await deliverInvoice(db,invoiceId,context,options);
 return {record:await readRecord(db,recordId),invoice:await invoiceForRecord(db,recordId)};
}
/** Only mark a bank payment when the operator has actually verified receipt. */
export async function confirmInvoicePayment(db:QueryDB,recordId:string,body:any){
 const record=await readRecord(db,recordId),invoice=await invoiceForRecord(db,recordId),d=record.document;
 if(!invoice||body.paymentReceived!==true)throw new RecordError('Bitte den tatsächlichen Zahlungseingang bestätigen.');
 if(d.archivedAt)throw new RecordError('Bitte die Anfrage zuerst aus dem Archiv wiederherstellen.',409);
 const paid=(d.payments||[]).reduce((n:number,p:any)=>n+cents(p.amount),0),remaining=cents(invoice.snapshot.totalCHF)-paid;
 if(remaining<=0)return {record,invoice};
 if(!Number.isInteger(body.revision)||record.revision!==body.revision)throw new RecordError('Die Anfrage wurde geändert. Bitte neu öffnen.',409);
 const next={...d,payments:[...d.payments,{id:randomUUID(),amount:remaining/100,date:new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Zurich'}),note:'Bankeingang zur Rechnung '+invoice.number+' bestätigt'}]};
 const {rows}=await db.query(`WITH changed AS (UPDATE gtt_records SET document=$3::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *),audit AS (INSERT INTO gtt_record_history(record_id,revision,actor,kind,snapshot) SELECT id,revision,'Admin: Zahlungseingang bestätigt','invoice_paid',document FROM changed RETURNING record_id) SELECT id FROM changed`,[recordId,body.revision,JSON.stringify(next)]);
 if(!rows.length)throw new RecordError('Die Anfrage wurde geändert. Bitte neu öffnen.',409);
 return {record:await readRecord(db,recordId),invoice};
}
export async function dispatchPendingInvoices(db:QueryDB,context:any={},options:{fetch?:typeof fetch}={}){
 if(context?.deploy?.context!=='production'||!env('RESEND_API_KEY'))return;
 const {rows}=await db.query("SELECT invoice_id FROM gtt_invoice_outbox WHERE status IN ('queued','failed','unknown','processing') AND attempts<3 AND created_at>now()-interval '23 hours' AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at LIMIT 5");
 for(const job of rows){try{await deliverInvoice(db,job.invoice_id,context,options);}catch{console.error('Invoice delivery preparation failed');}}
}
