import { BASE_RATES, currentOffer } from "./projects-store.mts";
import type { Offer } from "./projects-store.mts";
import { addIssue } from "./measurement-intake.mts";
import type { Extraction, IntakeIssue } from "./measurement-intake.mts";

export const PRICING_VERSION="calculator-2026-10-v1";
export function priceExtraction(extraction: Extraction, form: string, offer: Offer, now=new Date()) {
  const issues: IntakeIssue[]=[...extraction.issues];
  if(!extraction.postalCode) addIssue(issues,"missing_postal_code","Wie lautet die vierstellige Schweizer PLZ des Montageorts? Davon hängen Servicegebiet und mögliche Anfahrtskosten ab.");
  const outside=!!extraction.postalCode && !(Number(extraction.postalCode)>=8000 && Number(extraction.postalCode)<=9999);
  if(outside) addIssue(issues,"travel_cost_review",`Für die PLZ ${extraction.postalCode} können zusätzliche Anfahrtskosten anfallen. Bitte nennen Sie die Montageadresse; unser Team bestätigt die Anfahrt und den Gesamtpreis.`);
  const count=extraction.measurements.reduce((n,m)=>n+(m.mode==="dimensions"?m.quantity:0),0);
  const manualReview=form==="b2b-anfrage" || count>=20 || extraction.special;
  if(manualReview) addIssue(issues,"special_project_review","Für Ihr Geschäfts- oder Sonderprojekt erstellt unser Team eine individuelle Offerte. Bitte ergänzen Sie die Projektadresse und besondere Anforderungen, soweit noch nicht angegeben.");
  // currentOffer is the exact rate/seasonal rule used by /api/offer and the UI.
  const active=currentOffer(offer);
  const rates=active?.rates || {...BASE_RATES};
  const areas={fenster:0,tueren:0};
  for(const m of extraction.measurements) areas[m.type==="window"?"fenster":"tueren"]+=m.areaM2;
  areas.fenster=Math.round(areas.fenster*1e8)/1e8;
  areas.tueren=Math.round(areas.tueren*1e8)/1e8;
  const totalCHF=Math.round(areas.fenster*rates.fenster+areas.tueren*rates.tueren);
  const baseTotalCHF=Math.round(areas.fenster*BASE_RATES.fenster+areas.tueren*BASE_RATES.tueren);
  const quote={version:0,totalCHF,currency:"CHF" as const,calculatedAt:now.toISOString(),pricingVersion:PRICING_VERSION,areas,rates:{...rates},baseRates:{...BASE_RATES},baseTotalCHF,discount:active && baseTotalCHF>totalCHF?{name:active.name,percent:active.percent,fenster:active.fenster,tueren:active.tueren}:null,postalCode:extraction.postalCode,serviceArea:outside?"outside_standard_area":"standard_area",travelCosts:outside?{status:"requires_review",amountCHF:null}:{status:"included",amountCHF:0},priceKind:outside||manualReview?"indicative":"standard"};
  return {status:issues.length?"needs_clarification" as const:"priced" as const,issues,quote:issues.length?null:quote,estimate:outside && !extraction.issues.length?{...quote,priceKind:"indicative"}:null,manualReview};
}
