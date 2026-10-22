import { randomUUID } from "node:crypto";
import { RecordError, amount, createRecord, fromSubmission, readRecord, changeRecord, deleteArchivedTestRecord, type QueryDB } from "./records.mts";
import {renderQuoteEmail,offerNumber,legacyOfferNumber} from './quote-email.mts';
import {calculateMeasuredOffer,refreshDraftContact} from './admin-measurements.mts';
import {readRequestMeasurements} from './request-measurements.mts';
import type {Offer} from './projects-store.mts';
import {quotePDFResponse} from './quote-pdf.mts';
import {completeWithInvoice,confirmInvoicePayment,invoiceForRecord,invoicePDF,deliverInvoice,directBillingAvailable} from './invoices.mts';
const reply = (data:unknown,status=200) => Response.json(data,{status,headers:{"Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"}});
export async function recordsAPI(req: Request, db: QueryDB, path: string[], options:{offer?:Offer;context?:any}={}) {
  const id = path[0];
  const method = req.method;
  if (!id && method === "POST") {
    const body:any=await req.json();
    const clean=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
    const name=clean(body.name,200),company=clean(body.company,200),phone=clean(body.phone,100),email=clean(body.email,250);
    if(!name&&!company)throw new RecordError("Unesi ime klijenta ili naziv firme.");
    if(!phone&&!email)throw new RecordError("Unesi telefon ili email za kontakt.");
    if(email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw new RecordError("Email nije ispravan.");
    if(!/^[a-f0-9-]{36}$/.test(body.requestId||''))throw new RecordError("Nedostaje ID ručnog unosa.");
    const price=amount(body.quotedPrice);
    const input=fromSubmission({inquiry_id:'manual-'+body.requestId,record_source:'manual',name,firma:company,telefon:phone,email,adresse:clean(body.address),plz:clean(body.postalCode,80),kanal:clean(body.channel,100),nachricht:clean(body.request,6000),berechneter_preis:price==null?'':String(price)})!;
    const created=await createRecord(db,input,"Admin: ručni unos (zajednička prijava)");
    return reply({record:await readRecord(db,input.id)},created.created?201:200);
  }
  if(id==='resolve'&&method==='GET'){
    const reference=new URL(req.url).searchParams.get('offerte')||'';
    if(!/^GTT-\d{3,15}$/.test(reference))throw new RecordError('Ungültige Offertnummer.',400);
    const {rows}=await db.query('SELECT record_id AS id FROM gtt_quote_versions WHERE version=$1',[reference.slice(4)]);
    if(!rows[0])throw new RecordError('Offerte nicht gefunden.',404);
    return reply(rows[0]);
  }
  if (id === "pending") {
    if (method === "GET") {
      const {rows} = await db.query("SELECT p.* FROM gtt_pending_inquiries p LEFT JOIN gtt_records r ON r.id=p.id WHERE r.id IS NULL ORDER BY p.received_at DESC");
      return reply({pending:rows});
    }
    if (method === "POST") {
      const body:any=await req.json();
      if (!Array.isArray(body.submissions) || body.submissions.length>200) throw new RecordError("Pripremi do 200 istorijskih upita odjednom.");
      const inputs=body.submissions.map((s:any)=>{
        if(!s.id||!s.created_at||!Number.isFinite(Date.parse(s.created_at)))throw new RecordError("Nedostaju izvorni Netlify ID i datum.");
        return fromSubmission(s.data||{},{id:String(s.id),form:s.form_name,at:s.created_at});
      }).filter(Boolean);
      let staged=0;
      for(const input of inputs){
        const {rows}=await db.query("INSERT INTO gtt_pending_inquiries(id,source,received_at,original) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id",[input.id,input.source,input.original.receivedAt,JSON.stringify(input.original)]);
        staged+=rows.length;
      }
      return reply({staged,duplicates:inputs.length-staged});
    }
    return reply({error:"Metod nije dozvoljen."},405);
  }
  if (!id && method === "GET") {
    const archived=new URL(req.url).searchParams.get('archived')==='1';
    const {rows} = await db.query("SELECT r.id,r.source,r.received_at,r.updated_at,r.revision,r.document,(COALESCE(r.original->>'submissionId','')<>'' AND COALESCE(r.original->>'inquiryId','')='') AS historical,(SELECT COALESCE(jsonb_agg(v.version::text ORDER BY v.version),'[]'::jsonb) FROM gtt_quote_versions v WHERE v.record_id=r.id) AS offer_versions FROM gtt_records r WHERE (COALESCE(r.document->>'archivedAt','')<>'')=$1 ORDER BY r.received_at DESC LIMIT 1000",[archived]);
    const summary=await db.query(`WITH offer_amounts AS (
      SELECT CASE WHEN jsonb_typeof(document->'agreedPrice')='number' THEN (document->>'agreedPrice')::numeric
        WHEN jsonb_typeof(document->'quotedPrice')='number' THEN (document->>'quotedPrice')::numeric END AS amount
      FROM gtt_records WHERE COALESCE(document->>'isTest','false')<>'true' AND COALESCE(document->>'archivedAt','')=''
    ) SELECT COALESCE(sum(amount),0)::text AS total,count(amount)::int AS count FROM offer_amounts WHERE amount>=0`);
    const offerSummary={total:Number(summary.rows[0].total),count:summary.rows[0].count};
    return reply({billingAvailable:directBillingAvailable(options.context),offerSummary,records:rows.map(({offer_versions,...record})=>({...record,offerReferences:offer_versions.flatMap((version:string)=>[offerNumber(record.id,Number(version)),legacyOfferNumber(record.id,Number(version))])}))});
  }
  if (id === "import" && method === "POST") {
    const body:any = await req.json();
    if (!Array.isArray(body.submissions) || body.submissions.length>200) throw new RecordError("Uvezi do 200 Netlify zapisa odjednom.");
    const inputs = body.submissions.map((s:any)=> {
      if (!s.id || !s.created_at || !Number.isFinite(Date.parse(s.created_at))) throw new RecordError("Za uvoz su potrebni Netlify ID i datum prijema.");
      return fromSubmission(s.data || {}, {id:String(s.id),form:s.form_name,at:s.created_at});
    }).filter(Boolean);
    let created=0;
    for (const input of inputs) { if ((await createRecord(db,input,"Admin: uvoz Netlify zapisa")).created) created++; }
    return reply({created,duplicates:inputs.length-created});
  }
  if (!/^GTT-[a-f0-9]{24}$/.test(id || "")) throw new RecordError("Neispravan ID kartona.");
  if(path[1]==='complete-invoice'&&path.length===2&&method==='POST')return reply(await completeWithInvoice(db,id,await req.json(),options.context));
  if(path[1]==='invoice'&&path.length===2){
    const invoice=await invoiceForRecord(db,id);
    if(!invoice)throw new RecordError('Rechnung nicht gefunden.',404);
    if(method==='GET'){
      if(new URL(req.url).searchParams.get('format')==='pdf')return new Response(new Uint8Array(await invoicePDF(db,invoice.id)),{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+invoice.number+'.pdf"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
      return reply({invoice});
    }
    if(method==='POST'){
      const body:any=await req.json();
      if(body.action==='confirm-payment')return reply(await confirmInvoicePayment(db,id,body));
      if(body.action==='retry'){
        await deliverInvoice(db,invoice.id,options.context);
        return reply({record:await readRecord(db,id),invoice:await invoiceForRecord(db,id)});
      }
    }
    return reply({error:'Methode nicht erlaubt.'},405);
  }
  if(path[1]==='measurement-proposal'&&path.length===2&&method==='GET'){
    const record=await readRecord(db,id);
    const d=record.document;
    return reply(await readRequestMeasurements(d.request||'',d.postalCode||'',{name:d.name,email:d.email,telefon:d.phone,adresse:d.address,firma:d.company},{useAI:options.context?.deploy?.context==='production'}));
  }
  if(path[1]==='measurements'&&path.length===2&&method==='POST')return reply(await calculateMeasuredOffer(db,id,await req.json(),options));
  if(path.length===1&&method==='DELETE'){
    const body:any=await req.json();
    if(body.confirmRecordId!==id)throw new RecordError("Potvrdi trajno uklanjanje izabranog TEST upita.");
    return reply(await deleteArchivedTestRecord(db,id,body.revision));
  }
  if(path[1]==='offer'&&path.length===2&&method==='GET'){
    const record=await readRecord(db,id);
    const version=record.document.intake?.version;
    if(!version)throw new RecordError("Automatska ponuda još nije pripremljena.",404);
    const {rows}=await db.query('SELECT version,snapshot FROM gtt_quote_versions WHERE record_id=$1 AND version=$2',[id,version]);
    if(!rows[0])throw new RecordError("Verzija ponude nije pronađena.",404);
    if(new URL(req.url).searchParams.get('format')==='pdf'){
      if(!rows[0].snapshot.quote)throw new RecordError('Automatska ponuda još nije pripremljena.',404);
      return quotePDFResponse(rows[0].snapshot,id,Number(rows[0].version),new URL(req.url).origin);
    }
    return reply({...renderQuoteEmail(rows[0].snapshot,id,Number(rows[0].version),{baseURL:new URL(req.url).origin}),pdfAvailable:!!rows[0].snapshot.quote});
  }
  if (path[1] === "files") {
    await readRecord(db,id);
    if (path[2] && method === "GET") {
      if (!/^[a-f0-9-]{36}$/.test(path[2])) throw new RecordError("Neispravan dokument.");
      const {rows} = await db.query("SELECT * FROM gtt_record_files WHERE id=$1 AND record_id=$2",[path[2],id]);
      const f=rows[0]; if (!f) throw new RecordError("Dokument nije pronađen.",404);
      return new Response(f.content,{headers:{"Content-Type":f.content_type,"Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
    }
    if (!path[2] && method === "POST") {
      const data=await req.formData(); const file=data.get("file");
      if (!(file instanceof File) || !file.size || file.size>2097152) throw new RecordError("Dokument mora biti manji od 2 MB.");
      if (!["application/pdf","image/jpeg","image/png","image/webp"].includes(file.type)) throw new RecordError("Dozvoljeni su PDF, JPG, PNG i WebP.");
      const fileId=randomUUID();
      await db.query("INSERT INTO gtt_record_files(id,record_id,name,content_type,content) VALUES($1,$2,$3,$4,$5)",[fileId,id,file.name.slice(0,200),file.type,Buffer.from(await file.arrayBuffer())]);
      return reply({id:fileId},201);
    }
  }
  if (path.length===1 && method === "GET") return reply({record:await readRecord(db,id)});
  if (path.length===1 && method === "PATCH") {
    const body:any=await req.json();
    const refreshed=await refreshDraftContact(db,id,body,options);
    if(refreshed)return reply(refreshed);
    return reply({record:await changeRecord(db,id,body)});
  }
  return reply({error:"Metod nije dozvoljen."},405);
}
