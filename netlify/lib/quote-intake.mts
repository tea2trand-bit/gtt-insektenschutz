import { createHash } from "node:crypto";
import { calculatorMeasurements, parseMeasurements } from "./measurement-intake.mts";
import { refineMeasurements } from "./measurement-ai.mts";
import { priceExtraction } from "./quote-pricing.mts";
import { renderQuoteEmail } from "./quote-email.mts";
import { readOffer, projectsStore } from "./projects-store.mts";
import type { Offer } from "./projects-store.mts";
import type { QueryDB } from "./records.mts";

export const INTAKE_VERSION="measurement-intake-v1";
const env=(key:string)=>(globalThis as any).Netlify?.env?.get(key) ?? process.env[key];
export const deploymentContext=(context:any)=>context?.deploy?.context || (globalThis as any).Netlify?.context?.deploy?.context || env("GTT_RUNTIME_CONTEXT") || env("CONTEXT") || "unknown";
const production=(context:any)=>deploymentContext(context)==="production";
export const quoteAutomationEnabled=(context:any)=>production(context)?env("GTT_QUOTE_AUTOMATION")==="enabled":["deploy-preview","branch-deploy","dev","local"].includes(deploymentContext(context));
const emailValid=(value:string)=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
export interface IntakeOptions {
  offer?: Offer;
  mode?: "live" | "preview" | "manual" | "historical";
  now?: Date;
  useAI?: boolean;
  forceAI?: boolean;
  aiClient?: any;
  fetch?: typeof fetch;
}
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
export function sourceFingerprint(data:Record<string,string>) {
  const keys=["record_source","form-name","nachricht","plz","fensterflaeche_m2","tuerflaeche_m2","name","email","telefon","firma","adresse"];
  return sha(JSON.stringify([INTAKE_VERSION,...keys.map(k=>[k,(data[k]||"").trim()])]));
}
export async function prepareQuoteIntake(data:Record<string,string>,context:any={},options:IntakeOptions={}) {
  const form=data.record_source || data["form-name"] || "";
  const message=(data.nachricht||"").slice(0,6000);
  let extraction=form.startsWith("angebot")?calculatorMeasurements(data):parseMeasurements(message,data.plz||"");
  let ai:any={status:"not_needed",model:null};
  if(!form.startsWith("angebot") && options.useAI!==false){
    const refined=await refineMeasurements(message,data,extraction,{force:options.forceAI,client:options.aiClient});
    extraction=refined.extraction;ai=refined.ai;
  }
  const offer=options.offer || await readOffer(projectsStore(context));
  const result=priceExtraction(extraction,form,offer,options.now);
  const measurementRequired=!result.quote&&!result.manualReview&&!extraction.measurements.length&&extraction.issues.some(i=>i.code==='missing_dimensions');
  const recipient=(data.email||"").trim();
  const preview=options.mode==="preview" || !production(context);
  return {schemaVersion:INTAKE_VERSION,status:result.status,measurementRequired,sourceFingerprint:sourceFingerprint(data),processedAt:(options.now||new Date()).toISOString(),method:extraction.method,ai,measurements:extraction.measurements,postalCode:extraction.postalCode,clarification:result.issues,manualReview:result.manualReview,quote:result.quote,estimate:result.estimate,customer:{name:(data.name||"").trim(),company:(data.firma||"").trim(),email:recipient,phone:(data.telefon||"").trim(),address:(data.adresse||"").trim()},email:{status:!emailValid(recipient)?"not_available":preview?"preview_only":"queued"},contractAccepted:false};
}

export async function processQuoteIntake(db:QueryDB,recordId:string,originalData:Record<string,string>,context:any={},options:IntakeOptions={}) {
  const form=originalData.record_source || originalData["form-name"];
  if(!["angebot","angebot-netlify-fallback","kontakt","b2b-anfrage"].includes(form) || ["manual","historical"].includes(options.mode||"")) return null;
  if(!quoteAutomationEnabled(context)) return null;
  const fp=sourceFingerprint(originalData);
  const existing=await db.query("SELECT version,snapshot FROM gtt_quote_versions WHERE record_id=$1 AND source_fingerprint=$2",[recordId,fp]);
  if(existing.rows[0]) return finishExisting(db,recordId,existing.rows[0],context,options);
  const snapshot=await prepareQuoteIntake(originalData,context,options);
  const recipient=snapshot.customer.email;
  const outboxId="gtt-quote-"+sha(recordId+":"+fp+":"+recipient.toLowerCase()).slice(0,40);
  const {rows}=await db.query(`WITH added AS (
    INSERT INTO gtt_quote_versions(record_id,source_fingerprint,snapshot)
    VALUES ($1,$2,$3::jsonb) ON CONFLICT(record_id,source_fingerprint) DO NOTHING RETURNING version,record_id
  ), prepared AS (
    SELECT version,record_id, $3::jsonb || jsonb_build_object('version',version,'quote',CASE WHEN $3::jsonb->'quote'='null'::jsonb THEN 'null'::jsonb ELSE $3::jsonb->'quote' || jsonb_build_object('version',version) END) AS snapshot FROM added
  ), outbox AS (
    INSERT INTO gtt_quote_outbox(id,record_id,quote_version,recipient,kind,idempotency_key,status)
    SELECT $4,record_id,version,$5,$6,$4,$7 FROM prepared RETURNING id
  ), changed AS (
    UPDATE gtt_records r SET document=r.document || jsonb_build_object('intake',p.snapshot)
      || CASE WHEN p.snapshot->>'status'='priced' THEN jsonb_build_object('quotedPrice',(p.snapshot->'quote'->>'totalCHF')::numeric) ELSE '{}'::jsonb END,
      revision=revision+1,updated_at=now()
    FROM prepared p WHERE r.id=p.record_id RETURNING r.id,r.revision,r.document
  ), audit AS (
    INSERT INTO gtt_record_history(record_id,revision,actor,kind,snapshot)
    SELECT id,revision,'Automatska obrada upita','quote_intake',document FROM changed RETURNING record_id
  ) SELECT p.version,p.snapshot FROM prepared p JOIN changed c ON c.id=p.record_id`,[recordId,fp,JSON.stringify(snapshot),outboxId,recipient,snapshot.status==="priced"?"offer":"clarification",snapshot.email.status]);
  let saved=rows[0];
  // Concurrent duplicate INSERT waits for the winner; a fresh statement sees
  // the winner's committed immutable version rather than making another one.
  if(!saved) saved=(await db.query("SELECT version,snapshot FROM gtt_quote_versions WHERE record_id=$1 AND source_fingerprint=$2",[recordId,fp])).rows[0];
  if(!saved) throw new Error("Quote reservation failed; no customer email was sent.");
  return finishExisting(db,recordId,saved,context,options);
}

async function finishExisting(db:QueryDB,recordId:string,saved:any,context:any,options:IntakeOptions){
  // The immutable snapshot stores version in its column; callers always see the
  // same reference, date and content on a retry, even if rates later change.
  const snapshot={...saved.snapshot,version:Number(saved.version),quote:saved.snapshot.quote?{...saved.snapshot.quote,version:Number(saved.version)}:null};
  const message=renderQuoteEmail(snapshot,recordId,Number(saved.version));
  if(production(context) && options.mode!=="preview") await dispatchQuoteEmail(db,recordId,Number(saved.version),snapshot,message,options);
  const outbox=(await db.query("SELECT status,provider_id,error_code,attempts FROM gtt_quote_outbox WHERE record_id=$1 AND quote_version=$2",[recordId,saved.version])).rows[0];
  return {...snapshot,email:{status:outbox.status,...(outbox.provider_id?{providerId:outbox.provider_id}:{}),...(outbox.error_code?{errorCode:outbox.error_code}:{}),attempts:outbox.attempts},reference:message.reference,emailPreview:message};
}

async function dispatchQuoteEmail(db:QueryDB,recordId:string,version:number,snapshot:any,message:ReturnType<typeof renderQuoteEmail>,options:IntakeOptions){
  const apiKey=env("RESEND_API_KEY");
  if(!apiKey) return;
  // Only one worker acquires a lease. Automatic recovery is restricted to the
  // provider's 24h idempotency window (23h locally for clock/transport margin).
  const {rows}=await db.query(`UPDATE gtt_quote_outbox SET status='processing',attempts=attempts+1,lease_until=now()+interval '1 minute',updated_at=now()
    WHERE record_id=$1 AND quote_version=$2 AND attempts<3 AND created_at>now()-interval '23 hours'
      AND (status='queued' OR (status='processing' AND lease_until<now())) RETURNING *`,[recordId,version]);
  const job=rows[0];if(!job)return;
  let state="unknown",providerId:string|null=null,errorCode:string|null=null;
  try{
    const response=await (options.fetch||fetch)("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json","Idempotency-Key":job.idempotency_key},body:JSON.stringify({from:env("OFFER_FROM")||"GTT Insektenschutz <offerte@gtt-insektenschutz.ch>",to:[job.recipient],reply_to:env("GTT_NOTIFY_TO")||"info@gttgroup.ch",subject:message.subject,html:message.html,text:message.text}),signal:AbortSignal.timeout(15000)});
    const body=await response.json().catch(()=>null);
    if(response.ok && typeof body?.id==="string"){state="accepted";providerId=body.id;}
    else {state="failed";errorCode=`provider_http_${response.status}`;}
  }catch{errorCode="provider_outcome_unknown";}
  await db.query(`WITH job AS (
    UPDATE gtt_quote_outbox SET status=$3,provider_id=$4,error_code=$5,lease_until=NULL,updated_at=now() WHERE id=$1 AND attempts=$2 RETURNING record_id,quote_version
  ), changed AS (
    UPDATE gtt_records r SET document=jsonb_set(r.document,'{intake,email}',$6::jsonb)
      || CASE WHEN $3='accepted' AND $7='priced' AND r.document->>'status'='Novi upit' THEN jsonb_build_object('status','Ponuda poslata','offerSentAt',$8::text,'offerText',$9::text) ELSE '{}'::jsonb END,
      revision=revision+1,updated_at=now() FROM job j WHERE r.id=j.record_id AND r.document->'intake'->>'version'=j.quote_version::text RETURNING r.id,r.revision,r.document
  ) INSERT INTO gtt_record_history(record_id,revision,actor,kind,snapshot) SELECT id,revision,'Automatska obrada upita','quote_email',document FROM changed`,[job.id,job.attempts,state,providerId,errorCode,JSON.stringify({status:state,...(providerId?{providerId}:{}),...(errorCode?{errorCode}:{}),attempts:job.attempts}),snapshot.status,new Date().toLocaleDateString("sv-SE",{timeZone:"Europe/Zurich"}),message.text]);
}
