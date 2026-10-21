import { BASE_RATES, currentOffer } from "./projects-store.mts";
import type { Offer } from "./projects-store.mts";
import { addIssue } from "./measurement-intake.mts";
import type { Extraction, IntakeIssue } from "./measurement-intake.mts";

export const PRICING_VERSION="calculator-2026-10-v1";
export function priceExtraction(extraction: Extraction, form: string, offer: Offer, now=new Date(),options:{travelIncluded?:boolean;travelAmountCHF?:number}={}) {
  const issues: IntakeIssue[]=[...extraction.issues];
  const travelConfirmed=options.travelIncluded===true||options.travelAmountCHF!==undefined;
  const travelAmount=options.travelIncluded?0:options.travelAmountCHF||0;
  if(!extraction.postalCode&&!travelConfirmed) addIssue(issues,"missing_postal_code","Wie lautet die vierstellige Schweizer PLZ des Montageorts? Davon hängen Servicegebiet und mögliche Anfahrtskosten ab.");
  const outside=!travelConfirmed&&!!extraction.postalCode && !(Number(extraction.postalCode)>=8000 && Number(extraction.postalCode)<=9999);
  const travelReview=!travelConfirmed&&(!extraction.postalCode||outside);
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
  const totalCHF=Math.round((Math.round(areas.fenster*rates.fenster+areas.tueren*rates.tueren)+travelAmount)*100)/100;
  const baseTotalCHF=Math.round((Math.round(areas.fenster*BASE_RATES.fenster+areas.tueren*BASE_RATES.tueren)+travelAmount)*100)/100;
  const quote={version:0,totalCHF,currency:"CHF" as const,calculatedAt:now.toISOString(),pricingVersion:PRICING_VERSION,areas,rates:{...rates},baseRates:{...BASE_RATES},baseTotalCHF,discount:active && baseTotalCHF>totalCHF?{name:active.name,percent:active.percent,fenster:active.fenster,tueren:active.tueren}:null,postalCode:extraction.postalCode,serviceArea:travelConfirmed?(travelAmount?'confirmed_travel_costs':'confirmed_standard_area'):outside?"outside_standard_area":!extraction.postalCode?'unconfirmed':"standard_area",travelCosts:travelReview?{status:"requires_review",amountCHF:null}:{status:travelAmount?'priced':"included",amountCHF:travelAmount,...(travelConfirmed?{confirmedByAdmin:true}:{})},priceKind:travelReview||manualReview?"indicative":"standard"};
  return {status:issues.length?"needs_clarification" as const:"priced" as const,issues,quote:issues.length?null:quote,calculation:{...quote,priceKind:issues.length?'indicative':quote.priceKind},estimate:outside && !extraction.issues.length?{...quote,priceKind:"indicative"}:null,manualReview};
}
