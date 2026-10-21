import type {QueryDB} from './records.mts';
import {renderComplaintMessage} from './complaints.mts';
const env=(key:string)=>(globalThis as any).Netlify?.env?.get(key)??process.env[key];
export const complaintDeliveryConfigured=()=>!!env('RESEND_API_KEY');
export const productionComplaintContext=(context:any)=>(context?.deploy?.context||env('CONTEXT'))==='production';

export async function dispatchComplaintNotification(db:QueryDB,id:string,context:any,options:{fetch?:typeof fetch}={}){
  if(!productionComplaintContext(context)||!complaintDeliveryConfigured())return null;
  const reserved=await db.query(`UPDATE gtt_complaint_outbox SET status='processing',attempts=attempts+1,lease_until=now()+interval '1 minute',updated_at=now()
    WHERE complaint_id=$1 AND attempts<3 AND created_at>now()-interval '23 hours'
    AND (status IN ('queued','unknown') OR (status='processing' AND lease_until<now())) RETURNING *`,[id]);
  const job=reserved.rows[0];if(!job)return null;
  const {rows}=await db.query('SELECT * FROM gtt_complaints WHERE id=$1',[id]);
  const complaint=rows[0];if(!complaint)return null;
  // These fields are immutable after receipt, keeping every retry byte-for-byte
  // identical within the provider's idempotency window.
  const message=renderComplaintMessage(complaint,new URL(job.message.adminURL).origin);
  let status='unknown',providerId:string|null=null,errorCode:string|null=null;
  try{
    const response=await(options.fetch||fetch)('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env('RESEND_API_KEY'),'Content-Type':'application/json','Idempotency-Key':'gtt-complaint-'+id},body:JSON.stringify({from:env('OFFER_FROM')||'GTT Insektenschutz <offerte@gtt-insektenschutz.ch>',...message}),signal:AbortSignal.timeout(15000)});
    const result=await response.json().catch(()=>null);
    if(response.ok&&typeof result?.id==='string'){status='accepted';providerId=result.id;}
    else{status=response.status===429||response.status>=500?'queued':'failed';errorCode='provider_http_'+response.status;}
  }catch{errorCode='provider_outcome_unknown';}
  await db.query('UPDATE gtt_complaint_outbox SET status=$3,provider_id=$4,error_code=$5,lease_until=NULL,updated_at=now() WHERE complaint_id=$1 AND attempts=$2',[id,job.attempts,status,providerId,errorCode]);
  return {status};
}

export async function dispatchPendingComplaints(db:QueryDB,context:any,options:{fetch?:typeof fetch}={}){
  if(!productionComplaintContext(context)||!complaintDeliveryConfigured())return;
  const {rows}=await db.query("SELECT complaint_id FROM gtt_complaint_outbox WHERE status IN ('queued','unknown','processing') AND attempts<3 AND created_at>now()-interval '23 hours' ORDER BY created_at LIMIT 20");
  for(const row of rows)await dispatchComplaintNotification(db,row.complaint_id,context,options);
}
