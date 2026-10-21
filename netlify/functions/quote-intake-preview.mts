import type { Config, Context } from "@netlify/functions";
import { verifyRequest, DEFAULT_OFFER, json } from "../lib/projects-store.mts";
import { recordsDB } from "../lib/records-db.mts";
import { createRecord, fromSubmission } from "../lib/records.mts";
import { prepareQuoteIntake, processQuoteIntake } from "../lib/quote-intake.mts";
import { renderQuoteEmail } from "../lib/quote-email.mts";
import { MEASUREMENT_MODEL } from "../lib/measurement-ai.mts";

export default async (req:Request,context:Context)=>{
  if(!verifyRequest(req))return json({error:"Prijavi se."},401);
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const raw=await req.text();if(raw.length>15000)return json({error:"Upit je predugačak."},413);
  let body:any;try{body=JSON.parse(raw);}catch{return json({error:"Neispravan JSON."},400);}
  if(body?.operation==="gateway_status"){
    if(!process.env.OPENAI_API_KEY)return json({configured:false,model:process.env.GTT_MEASUREMENTS_MODEL||MEASUREMENT_MODEL});
    try{
      const client=new (await import("openai")).default();
      const models=await client.models.list({timeout:10000,maxRetries:0});
      const model=process.env.GTT_MEASUREMENTS_MODEL||MEASUREMENT_MODEL;
      return json({configured:true,model,modelListed:models.data.some(m=>m.id===model)});
    }catch{return json({configured:true,model:process.env.GTT_MEASUREMENTS_MODEL||MEASUREMENT_MODEL,modelListAvailable:false});}
  }
  const data:Record<string,string>={};
  for(const key of ["record_source","form-name","nachricht","plz","fensterflaeche_m2","tuerflaeche_m2","name","email","telefon","firma","adresse"]) if(typeof body?.data?.[key]==="string")data[key]=body.data[key].slice(0,6000);
  if(!["angebot","kontakt","b2b-anfrage"].includes(data.record_source||data["form-name"]))return json({error:"Izaberi izvor upita."},400);
  if(body.operation==="fixture"){
    if(context.deploy?.context==="production")return json({error:"Sintetički upis je dostupan samo u previewju."},404);
    const key=typeof body.fixtureKey==="string" && /^[a-z0-9-]{1,60}$/.test(body.fixtureKey)?body.fixtureKey:null;
    if(!key)return json({error:"Potreban je stabilan fixtureKey."},400);
    Object.assign(data,{inquiry_id:"quote-fixture-"+key,name:"TEST – Demo upit",email:"test@example.invalid",telefon:"+41 00 000 00 00"});
    const input=fromSubmission(data)!;
    const db=recordsDB();await createRecord(db,input,"TEST – Sintetički preview");
    const intake=await processQuoteIntake(db,input.id,data,context,{mode:"preview",offer:{...DEFAULT_OFFER,active:true,percent:15},useAI:body.useAI===true});
    return json({recordId:input.id,intake,liveEmailSent:false});
  }
  const intake=await prepareQuoteIntake(data,context,{mode:"preview",useAI:body.useAI===true,forceAI:body.forceAI===true});
  const email=renderQuoteEmail(intake,"GTT-preview000000000000000000",1);
  return json({intake,email,liveEmailSent:false});
};
export const config:Config={path:"/api/quote-intake-preview",method:"POST",rateLimit:{action:"rate_limit",aggregateBy:["ip"],windowSize:60,windowLimit:10}};
