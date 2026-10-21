import { recordsDB } from "../lib/records-db.mts";
import { createRecord, fromSubmission } from "../lib/records.mts";
import type { FormSubmittedEvent } from "@netlify/functions";
import type { QueryDB } from "../lib/records.mts";
import { getContext } from "@netlify/functions";
import { deploymentContext, processQuoteIntake, type IntakeOptions } from "../lib/quote-intake.mts";
import { importApprovedHistory } from "../lib/approved-history.mts";
import { notifyTeam } from "../lib/team-notification.mts";

export async function recordSubmission(data: Record<string,string>, db: QueryDB, context:any={}, options:IntakeOptions={}) {
  const input = fromSubmission(data);
  if(!input)return null;
  const record=await createRecord(db,input);
  // A duplicate delivery must resume a pending outbox job, without replacing
  // the original inquiry or creating another version/email.
  const intake=await processQuoteIntake(db,input.id,data,context,options);
  if(options.mode!=='preview')await notifyTeam(db,input.id,'new_inquiry',context,{fetch:options.fetch}).catch(()=>console.error('Internal notification needs review'));
  return {...record,intake};
}

// Netlify verifies the platform event signature before invoking this handler.
// Independent of customer email: a provider failure cannot prevent the record.
export default {
  async deploySucceeded() {
    let context:any;
    try{context=getContext();}catch{context=(globalThis as any).Netlify?.context||{};}
    context={...context,deploy:{...context.deploy,context:deploymentContext(context)}};
    if(context.deploy.context==='production')await importApprovedHistory(recordsDB(),context);
  },
  async formSubmitted(event: FormSubmittedEvent) {
    let context:any;
    try{context=getContext();}catch{context=(globalThis as any).Netlify?.context||{};}
    context={...context,deploy:{...context.deploy,context:deploymentContext(context)}};
    const db=recordsDB();
    await recordSubmission(event.data,db,context);
    await importApprovedHistory(db,context);
  },
};
