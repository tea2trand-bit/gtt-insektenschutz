import {createHash} from 'node:crypto';
import {RecordError,readRecord,type QueryDB} from './records.mts';
import {deploymentContext,quoteAutomationEnabled,deliverPreparedQuote} from './quote-intake.mts';

export const correctionRequestHash=(body:any)=>createHash('sha256').update(JSON.stringify([body.revision,body.measurements,body.productionMeasurements??null,body.travelAmountCHF??null,body.travelIncluded===true])).digest('hex');
export async function recoverOnsiteCorrection(db:QueryDB,record:any,body:any,options:{context?:any;fetch?:typeof fetch}){
 const intake=record.document.intake;
 if(intake?.correction?.requestId!==body.requestId)return null;
 if(intake.correction.requestHash!==correctionRequestHash(body))throw new RecordError('Die Anfrage wurde geändert. Bitte neu öffnen.',409);
 if(intake.email?.status!=='draft')await deliverPreparedQuote(db,record.id,intake.version,options.context,{fetch:options.fetch});
 return {record:await readRecord(db,record.id),correction:{priceChanged:true}};
}

export async function saveOnsiteCorrection(db:QueryDB,record:any,body:any,quote:any,measurements:any[],productionMeasurements:any[],issues:any[],options:{context?:any;fetch?:typeof fetch}={}){
 const d=record.document,previous=d.intake,at=new Date().toISOString(),day=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Zurich'});
 const onsite={measurements,productionMeasurements,areas:quote.areas,totalCHF:quote.totalCHF,measuredAt:at};
 const guard="id=$1 AND revision=$2 AND document->>'status' IN ('Novi upit','Ponuda poslata','Čeka odgovor','Prihvaćeno') AND COALESCE(document->>'archivedAt','')='' AND NOT EXISTS(SELECT 1 FROM gtt_quote_outbox WHERE record_id=$1 AND status IN ('queued','processing'))";
 if(quote.totalCHF===previous.quote.totalCHF&&(previous.email?.status!=='draft'||issues.length>0)){
  const patch={onsite,measuredAt:day};
  const {rows}=await db.query(`WITH changed AS (UPDATE gtt_records SET document=document||$3::jsonb,revision=revision+1,updated_at=now() WHERE ${guard} RETURNING id,revision,document),audit AS (INSERT INTO gtt_record_history(record_id,revision,actor,kind,snapshot) SELECT id,revision,'Admin: Aufmass vor Ort','onsite_measurement',document FROM changed RETURNING record_id) SELECT id FROM changed`,[record.id,body.revision,JSON.stringify(patch)]);
  if(!rows.length)throw new RecordError('Die Anfrage wurde geändert oder der Versand läuft. Bitte neu öffnen.',409);
  return {record:await readRecord(db,record.id),correction:{priceChanged:false}};
 }
 const allIssues=[...issues];
 if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email||''))allIssues.push({code:'missing_email',question:'E-Mail-Adresse des Kunden fehlt. Die korrigierte Offerte bleibt als Entwurf gespeichert.'});
 const live=deploymentContext(options.context)==='production'&&quoteAutomationEnabled(options.context);
 const emailStatus=allIssues.length||deploymentContext(options.context)==='production'&&!live?'draft':live?'queued':'preview_only';
 const fingerprint=createHash('sha256').update('onsite-correction:'+record.id+':'+body.requestId).digest('hex');
 const correction={previousVersion:previous.version,previousTotalCHF:previous.quote.totalCHF,previousAcceptance:d.customerAcceptance||previous.correction?.previousAcceptance||null,createdAt:at,requestId:body.requestId,requestHash:correctionRequestHash(body)};
 const snapshot={schemaVersion:'measurement-intake-v1',status:'priced',sourceFingerprint:fingerprint,processedAt:at,method:'deterministic',ai:{status:'not_needed',model:null},measurements,productionMeasurements,postalCode:quote.postalCode,clarification:allIssues,manualReview:allIssues.length>0,quote:{...quote,priceKind:'onsite'},estimate:null,customer:{name:d.name,company:d.company,email:d.email,phone:d.phone,address:d.address},email:{status:emailStatus},correction,contractAccepted:false};
 const next={...d,onsite,measuredAt:day,status:'Novi upit',quotedPrice:quote.totalCHF,agreedPrice:null,decisionDate:'',decisionReason:'',decisionEvidence:'',customerAcceptance:null,customerDecline:null,correctionPending:true};
 const outboxId='gtt-correction-'+fingerprint.slice(0,40);
 const {rows}=await db.query(`WITH target AS MATERIALIZED (SELECT id FROM gtt_records WHERE ${guard} FOR UPDATE),added AS (
  INSERT INTO gtt_quote_versions(record_id,source_fingerprint,snapshot) SELECT id,$3,$4::jsonb FROM target ON CONFLICT(record_id,source_fingerprint) DO NOTHING RETURNING version,record_id
 ),outbox AS (
  INSERT INTO gtt_quote_outbox(id,record_id,quote_version,recipient,kind,idempotency_key,status) SELECT $5,record_id,version,$6,'offer',$5,$7 FROM added WHERE $7<>'draft' RETURNING id
 ),changed AS (
  UPDATE gtt_records r SET document=$8::jsonb||jsonb_build_object('intake',$4::jsonb||jsonb_build_object('version',a.version,'quote',$4::jsonb->'quote'||jsonb_build_object('version',a.version))),revision=revision+1,updated_at=now() FROM added a WHERE r.id=a.record_id AND r.revision=$2 RETURNING r.id,r.revision,r.document
 ),audit AS (INSERT INTO gtt_record_history(record_id,revision,actor,kind,snapshot) SELECT id,revision,'Admin: Korrigierte Offerte nach Aufmass','onsite_quote',document FROM changed RETURNING record_id) SELECT (document->'intake'->>'version')::int AS version FROM changed`,[record.id,body.revision,fingerprint,JSON.stringify(snapshot),outboxId,d.email,emailStatus,JSON.stringify(next)]);
 if(!rows.length)throw new RecordError('Die Anfrage wurde geändert oder der Versand läuft. Bitte neu öffnen.',409);
 if(emailStatus!=='draft')await deliverPreparedQuote(db,record.id,rows[0].version,options.context,{fetch:options.fetch});
 return {record:await readRecord(db,record.id),correction:{priceChanged:true}};
}
