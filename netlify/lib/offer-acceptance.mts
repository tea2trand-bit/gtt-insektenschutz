import type {QueryDB} from './records.mts';
import {OfferLinkError,type OfferClaims} from './offer-acceptance-token.mts';
export const ACCEPTANCE_TEXT_VERSION='ausmessen-2026-10-v1';
export const DECLINE_TEXT_VERSION='offerte-ablehnen-2026-10-v1';
export async function readAcceptanceOffer(db:QueryDB,claims:OfferClaims){
 const {rows}=await db.query("SELECT r.id,r.document,r.original,r.revision,q.snapshot,q.version FROM gtt_records r JOIN gtt_quote_versions q ON q.record_id=r.id WHERE r.id=$1 AND q.version=$2",[claims.r,claims.q]);
 const row=rows[0];
 if(!row||row.snapshot.status!=='priced'||!row.snapshot.quote)throw new OfferLinkError('Diese Offerte ist nicht verfügbar.',404);
 if(row.document.archivedAt)throw new OfferLinkError('Diese Anfrage ist nicht mehr aktiv. Bitte kontaktieren Sie unser Team.',410);
 if(Number(row.document.intake?.version)!==claims.q)throw new OfferLinkError('Zu dieser Anfrage gibt es eine neuere Offerte. Bitte verwenden Sie die aktuelle E-Mail.',409);
 return row;
}
export async function acceptOffer(db:QueryDB,claims:OfferClaims){
 const result=await recordDecision(db,claims,'accept');
 return {recordId:result.recordId,alreadyConfirmed:result.alreadyRecorded};
}
export async function declineOffer(db:QueryDB,claims:OfferClaims){
 const result=await recordDecision(db,claims,'decline');
 return {recordId:result.recordId,alreadyDeclined:result.alreadyRecorded};
}
async function recordDecision(db:QueryDB,claims:OfferClaims,decision:'accept'|'decline'){
 const row=await readAcceptanceOffer(db,claims),d=row.document;
 const key=decision==='accept'?'customerAcceptance':'customerDecline';
 const opposite=decision==='accept'?'customerDecline':'customerAcceptance';
 if(d[key]?.quoteVersion===claims.q)return {recordId:row.id,alreadyRecorded:true};
 if(d[opposite]?.quoteVersion===claims.q)throw new OfferLinkError('Für diese Offerte wurde bereits eine andere Entscheidung gespeichert. Bitte kontaktieren Sie unser Team.',409);
 if(!['Novi upit','Ponuda poslata','Čeka odgovor'].includes(d.status))throw new OfferLinkError('Diese Anfrage wird bereits bearbeitet. Bitte kontaktieren Sie unser Team.',409);
 const correction=!!row.snapshot.correction;
 const confirmation={quoteVersion:claims.q,confirmedAt:new Date().toISOString(),intent:correction?'confirm_corrected_offer':'request_measurement',pricePreliminary:!correction,textVersion:correction?'onsite-correction-2026-10-v1':ACCEPTANCE_TEXT_VERSION};
 const patch={decisionDate:new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Zurich'}),correctionPending:false,...(decision==='accept'?{status:'Prihvaćeno',agreedPrice:row.snapshot.quote.totalCHF,decisionEvidence:'Kundenbestätigung per Offertlink: Ausmessen und weitere Abstimmung angefragt. Masse und endgültige Vereinbarung werden geprüft.',customerAcceptance:confirmation}:{status:'Odbijeno',decisionEvidence:'Kunde hat diese Offertversion über den persönlichen Offertlink ausdrücklich abgelehnt.',decisionReason:'Offerte online abgelehnt',customerDecline:{quoteVersion:claims.q,declinedAt:new Date().toISOString(),intent:'decline_offer',textVersion:DECLINE_TEXT_VERSION}})};
 const kind=decision==='accept'?'customer_acceptance':'customer_decline',actor=decision==='accept'?'Kunde: Bestätigung per Offertlink':'Kunde: Ablehnung per Offertlink';
 if(correction&&decision==='accept')patch.decisionEvidence='Kunde hat die korrigierte Offerte nach dem Aufmass ausdrücklich bestätigt.';
 if(decision==='decline'&&d.appointmentAt&&d.appointmentStatus!=='cancelled')Object.assign(patch,{appointmentStatus:'cancelled',appointmentCancelledAt:new Date().toISOString(),appointmentCancelReason:'Offerte vom Kunden abgelehnt'});
 const {rows}=await db.query("WITH changed AS (UPDATE gtt_records SET document=document || $3::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING id,revision,document), audit AS (INSERT INTO gtt_record_history(record_id,revision,actor,kind,snapshot) SELECT id,revision,$4,$5,document FROM changed RETURNING record_id) SELECT id FROM changed",[row.id,row.revision,JSON.stringify(patch),actor,kind]);
 if(!rows.length){
  const fresh=await readAcceptanceOffer(db,claims);
  if(fresh.document[key]?.quoteVersion===claims.q)return {recordId:row.id,alreadyRecorded:true};
  if(fresh.document[opposite]?.quoteVersion===claims.q)throw new OfferLinkError('Für diese Offerte wurde bereits eine andere Entscheidung gespeichert. Bitte kontaktieren Sie unser Team.',409);
  throw new OfferLinkError('Die Anfrage wurde gerade aktualisiert. Bitte laden Sie die Seite neu.',409);
 }
 return {recordId:row.id,alreadyRecorded:false};
}
