import type {Config,Context} from '@netlify/functions';
import {publicComplaintAPI} from '../lib/complaints.mts';
import {recordsDB} from '../lib/records-db.mts';
import {complaintDeliveryConfigured,productionComplaintContext} from '../lib/complaint-notification.mts';
import {publicBaseURL} from '../lib/offer-acceptance-token.mts';

export default async(req:Request,context:Context)=>{
  const production=productionComplaintContext(context);
  if(production&&!complaintDeliveryConfigured())return Response.json({error:'Bitte kontaktieren Sie uns direkt. Das Reklamationsformular ist vorübergehend nicht verfügbar.'},{status:503,headers:{'Cache-Control':'no-store'}});
  if(!production&&!['dev','local','deploy-preview','branch-deploy'].includes(context.deploy?.context||''))return Response.json({error:'Das Formular ist derzeit nicht verfügbar.'},{status:503});
  const db=recordsDB();
  if(req.method==='GET'){
    try{await db.query('SELECT complaint_id,status,attempts FROM gtt_complaint_outbox LIMIT 0');return Response.json({available:true},{headers:{'Cache-Control':'no-store'}});}
    catch{return Response.json({available:false},{status:503,headers:{'Cache-Control':'no-store'}});}
  }
  return publicComplaintAPI(req,db,{deliveryContext:production?context:undefined,baseURL:production?publicBaseURL():new URL(req.url).origin});
};
export const config:Config={path:'/api/reklamationen',rateLimit:{action:'rate_limit',aggregateBy:['ip','domain'],windowLimit:5,windowSize:300}};
