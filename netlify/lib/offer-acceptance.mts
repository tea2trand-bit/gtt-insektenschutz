import type {QueryDB} from './records.mts';
import {OfferLinkError,type OfferClaims} from './offer-acceptance-token.mts';
export const ACCEPTANCE_TEXT_VERSION='ausmessen-2026-10-v1';
export async function readAcceptanceOffer(db:QueryDB,claims:OfferClaims){
 const {rows}=await db.query("SELECT r.id,r.document,r.original,r.revision,q.snapshot,q.version FROM gtt_records r JOIN gtt_quote_versions q ON q.record_id=r.id WHERE r.id=$1 AND q.version=$2",[claims.r,claims.q]);
 const row=rows[0];
 if(!row||row.snapshot.status!=='priced'||!row.snapshot.quote)throw new OfferLinkError('Diese Offerte ist nicht verfügbar.',404);
 if(row.document.archivedAt)throw new OfferLinkError('Diese Anfrage ist nicht mehr aktiv. Bitte kontaktieren Sie unser Team.',410);
 if(Number(row.document.intake?.version)!==claims.q)throw new OfferLinkError('Zu dieser Anfrage gibt es eine neuere Offerte. Bitte verwenden Sie die aktuelle E-Mail.',409);
 return row;
}
export async function acceptOffer(db:QueryDB,claims:OfferClaims){
 const row=await readAcceptanceOffer(db,claims),d=row.document;
 if(d.customerAcceptance?.quoteVersion===claims.q)return {recordId:row.id,alreadyConfirmed:true};
 if(!['Novi upit','Ponuda poslata','Čeka odgovor'].includes(d.status))throw new OfferLinkError('Diese Anfrage wird bereits bearbeitet. Bitte kontaktieren Sie unser Team.',409);
 const confirmation={quoteVersion:claims.q,confirmedAt:new Date().toISOString(),intent:'request_measurement',pricePreliminary:true,textVersion:ACCEPTANCE_TEXT_VERSION};
 const patch={status:'Prihvaćeno',agreedPrice:row.snapshot.quote.totalCHF,decisionDate:new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Zurich'}),decisionEvidence:'Kundenbestätigung per Offertlink: Ausmessen und weitere Abstimmung angefragt. Masse und endgültige Vereinbarung werden geprüft.',customerAcceptance:confirmation};
 const {rows}=await db.query("WITH changed AS (UPDATE gtt_records SET document=document || $3::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING id,revision,document), audit AS (INSERT INTO gtt_record_history(record_id,revision,actor,kind,snapshot) SELECT id,revision,'Kunde: Bestätigung per Offertlink','customer_acceptance',document FROM changed RETURNING record_id) SELECT id FROM changed",[row.id,row.revision,JSON.stringify(patch)]);
 if(!rows.length){
  const fresh=await readAcceptanceOffer(db,claims);
  if(fresh.document.customerAcceptance?.quoteVersion===claims.q)return {recordId:row.id,alreadyConfirmed:true};
  throw new OfferLinkError('Die Anfrage wurde gerade aktualisiert. Bitte laden Sie die Seite neu.',409);
 }
 return {recordId:row.id,alreadyConfirmed:false};
}
