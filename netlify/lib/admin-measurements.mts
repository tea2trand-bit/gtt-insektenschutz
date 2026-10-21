import {createHash} from 'node:crypto';
import {RecordError,readRecord,type QueryDB} from './records.mts';
import {priceExtraction} from './quote-pricing.mts';
import {readOffer,projectsStore,type Offer} from './projects-store.mts';

export async function calculateMeasuredOffer(db:QueryDB,id:string,body:any,options:{offer?:Offer;context?:any}={}){
  const record=await readRecord(db,id),d=record.document;
  if(!Number.isInteger(body.revision)||body.revision!==record.revision)throw new RecordError('Die Anfrage wurde geändert. Bitte neu öffnen.',409);
  if(d.archivedAt||d.status!=='Novi upit')throw new RecordError('Masse können hier vor dem Versand der Offerte erfasst werden.',409);
  if(!Array.isArray(body.measurements)||!body.measurements.length||body.measurements.length>30)throw new RecordError('Bitte mindestens ein Fenster oder eine Tür erfassen.');
  const measurements=body.measurements.map((m:any)=>{
    if(!['window','door'].includes(m.type)||!Number.isInteger(m.quantity)||m.quantity<1||m.quantity>100||typeof m.width!=='number'||typeof m.height!=='number'||!Number.isFinite(m.width)||!Number.isFinite(m.height)||m.width<=0||m.height<=0||m.width>2000||m.height>2000)throw new RecordError('Bitte Anzahl, Breite und Höhe in cm prüfen.');
    return {type:m.type,mode:'dimensions' as const,quantity:m.quantity,width:m.width,height:m.height,widthUnit:'cm' as const,heightUnit:'cm' as const,areaM2:Math.round(m.quantity*m.width*m.height/10000*1e8)/1e8,source:'Ausmessen vor Ort'};
  });
  const postalCode=(d.postalCode||'').match(/\b\d{4}\b/)?.[0]||'';
  const extraction={method:'deterministic' as const,measurements,postalCode,issues:[],special:false};
  const offer=options.offer||await readOffer(projectsStore(options.context));
  const pricing=priceExtraction(extraction,'angebot',offer);
  if(!pricing.quote)throw new RecordError(pricing.issues.map(i=>i.question).join(' '));
  if(body.preview===true)return {quote:pricing.quote};
  if(!/^[a-f0-9-]{36}$/i.test(body.requestId||''))throw new RecordError('Bitte die Berechnung neu öffnen.');
  const fingerprint=createHash('sha256').update('onsite:'+id+':'+body.requestId).digest('hex');
  const snapshot={schemaVersion:'measurement-intake-v1',status:'priced',sourceFingerprint:fingerprint,processedAt:new Date().toISOString(),method:'deterministic',ai:{status:'not_needed',model:null},measurements,postalCode,clarification:[],manualReview:false,quote:pricing.quote,estimate:null,customer:{name:d.name,company:d.company,email:d.email,phone:d.phone,address:d.address},email:{status:'draft'},contractAccepted:false};
  const products=measurements.map(m=>(m.type==='window'?'Fenster':'Türen / Plissee')+': '+m.quantity+' × '+m.width+' × '+m.height+' cm').join('\n');
  const {rows}=await db.query(`WITH target AS MATERIALIZED (
    SELECT id FROM gtt_records WHERE id=$1 AND revision=$2 AND document->>'status'='Novi upit' AND COALESCE(document->>'archivedAt','')=''
      AND NOT EXISTS(SELECT 1 FROM gtt_quote_outbox WHERE record_id=$1 AND status IN ('queued','processing')) FOR UPDATE
  ), added AS (
    INSERT INTO gtt_quote_versions(record_id,source_fingerprint,snapshot) SELECT id,$3,$4::jsonb FROM target
    ON CONFLICT(record_id,source_fingerprint) DO NOTHING RETURNING version,record_id
  ), changed AS (
    UPDATE gtt_records r SET document=r.document||jsonb_build_object('quotedPrice',$5::numeric,'products',$6::text,'measuredAt',$7::text,'intake',$4::jsonb||jsonb_build_object('version',a.version,'quote',$4::jsonb->'quote'||jsonb_build_object('version',a.version))),revision=revision+1,updated_at=now()
    FROM added a WHERE r.id=a.record_id AND r.revision=$2 RETURNING r.*
  ), audit AS (
    INSERT INTO gtt_record_history(record_id,revision,actor,kind,snapshot) SELECT id,revision,'Admin: Ausmessen','measurement',document FROM changed RETURNING record_id
  ) SELECT id FROM changed`,[id,body.revision,fingerprint,JSON.stringify(snapshot),pricing.quote.totalCHF,products,new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Zurich'})]);
  if(!rows.length)throw new RecordError('Die Anfrage wurde geändert oder der Versand läuft. Bitte neu öffnen.',409);
  return {record:await readRecord(db,id)};
}
