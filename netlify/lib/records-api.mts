import { randomUUID } from "node:crypto";
import { RecordError, amount, createRecord, fromSubmission, readRecord, changeRecord, type QueryDB } from "./records.mts";
import {renderQuoteEmail} from './quote-email.mts';
const reply = (data:unknown,status=200) => Response.json(data,{status,headers:{"Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"}});
export async function recordsAPI(req: Request, db: QueryDB, path: string[]) {
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
    const {rows} = await db.query("SELECT id,source,received_at,updated_at,revision,document FROM gtt_records ORDER BY received_at DESC LIMIT 1000");
    return reply({records:rows});
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
  if(path[1]==='offer'&&path.length===2&&method==='GET'){
    const record=await readRecord(db,id);
    const version=record.document.intake?.version;
    if(!version)throw new RecordError("Automatska ponuda još nije pripremljena.",404);
    const {rows}=await db.query('SELECT version,snapshot FROM gtt_quote_versions WHERE record_id=$1 AND version=$2',[id,version]);
    if(!rows[0])throw new RecordError("Verzija ponude nije pronađena.",404);
    return reply(renderQuoteEmail(rows[0].snapshot,id,Number(rows[0].version)));
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
    return reply({record:await changeRecord(db,id,body)});
  }
  return reply({error:"Metod nije dozvoljen."},405);
}
