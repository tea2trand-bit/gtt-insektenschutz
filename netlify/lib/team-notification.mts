import {createHash} from 'node:crypto';
import type {QueryDB} from './records.mts';
import {offerNumber,money} from './quote-email.mts';
import {publicBaseURL} from './offer-acceptance-token.mts';
const env=(key:string)=>(globalThis as any).Netlify?.env?.get(key)??process.env[key];
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function renderTeamNotification(record:any,kind='new_inquiry',baseURL=publicBaseURL()){
 const d=record.document,intake=d.intake,quote=intake?.quote;
 const source=({'Kontakt':'Kontaktformular','Kalkulator':'Preisrechner','B2B':'B2B-Anfrage','Ručni unos':'Manuelle Erfassung'} as any)[record.source]||record.source;
 const customer=d.name||d.company||'Kunde ohne Namen';
 const title=kind==='customer_acceptance'?'Kunde möchte fortfahren':'Neue Anfrage';
 const email=intake?.email?.status;
 const sent=email==='accepted'?(intake.status==='priced'?'Offerte an den Kunden versendet':'Rückfrage an den Kunden versendet'):email==='failed'?'E-Mail-Versand fehlgeschlagen – bitte prüfen':email==='unknown'?'Versandausgang unklar – bitte prüfen':email==='not_available'?'Keine Kunden-E-Mail vorhanden':'Versand wird bearbeitet';
 const state=kind==='customer_acceptance'?'Bestätigung erhalten – Ausmessen abstimmen':sent;
 const at=new Date(kind==='customer_acceptance'?d.customerAcceptance?.confirmedAt:record.received_at).toLocaleString('de-CH',{timeZone:'Europe/Zurich'});
 const measurements=(intake?.measurements||[]).map((m:any)=>(m.type==='window'?'Fenster':'Türen / Plissee')+': '+(m.mode==='dimensions'?m.quantity+' × '+m.width+' '+m.widthUnit+' × '+m.height+' '+m.heightUnit+' · ':'')+Number(m.areaM2).toLocaleString('de-CH',{maximumFractionDigits:4})+' m²');
 const details=[['Herkunft',source],['Eingang / Bestätigung',at],['Status',state],['Kunde',customer],['E-Mail',d.email||'Nicht angegeben'],['Telefon',d.phone||'Nicht angegeben'],['Adresse / PLZ',[d.address,d.postalCode].filter(Boolean).join(' · ')||'Nicht angegeben'],...(quote?[['Offertbetrag',money(quote.totalCHF)],['Offerte Nr.',offerNumber(record.id,Number(intake.version))]]:[])];
 const href=new URL('/admin?anfrage='+encodeURIComponent(record.id),baseURL).toString();
 const note=kind==='customer_acceptance'?'Der Kunde möchte auf Grundlage der Offerte fortfahren und das Ausmessen abstimmen. Masse und endgültige Vereinbarung werden noch geprüft.':intake?.manualReview?'Fachliche Prüfung erforderlich.':'';
 const questions=(intake?.clarification||[]).map((q:any)=>typeof q==='string'?q:q.question);
 const html='<!doctype html><html lang="de-CH"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#f5f7f3;font:15px/1.6 Arial,sans-serif;color:#24392b"><main style="max-width:650px;margin:24px auto;padding:28px;background:white;border:1px solid #e1e8dc"><small>GTT Insektenschutz · Interne Mitteilung</small><h1 style="font-size:25px">'+escape(title)+': '+escape(customer)+'</h1><p style="font-size:17px;color:#306e2c"><strong>'+escape(state)+'</strong></p>'+details.map(([label,value])=>'<p style="margin:10px 0"><small style="color:#667264">'+escape(label)+'</small><br><strong>'+escape(value)+'</strong></p>').join('')+(measurements.length?'<h2 style="font-size:17px">Masse</h2><p>'+measurements.map(escape).join('<br>')+'</p>':'')+(questions.length?'<h2 style="font-size:17px">Noch erforderlich</h2><ul>'+questions.map((q:string)=>'<li>'+escape(q)+'</li>').join('')+'</ul>':'')+(note?'<p>'+escape(note)+'</p>':'')+(d.request?'<h2 style="font-size:17px">Originalnachricht</h2><p style="white-space:pre-wrap">'+escape(d.request)+'</p>':'')+'<p style="margin-top:25px"><a href="'+escape(href)+'" style="display:inline-block;background:#3d862b;color:white;padding:12px 18px;text-decoration:none;border-radius:7px">Anfrage im Admin öffnen</a></p></main></body></html>';
 const text=[title+': '+customer,'',...details.map(([label,value])=>label+': '+value),'',...measurements,...questions,note,d.request||'','Anfrage im Admin öffnen: '+href].filter(Boolean).join('\n');
 return {subject:(kind==='customer_acceptance'?'Kundenbestätigung: ':'Neue Anfrage: ')+customer+' · '+source,html,text};
}
export async function notifyTeam(db:QueryDB,recordId:string,kind:'new_inquiry'|'customer_acceptance',context:any={},options:{fetch?:typeof fetch}={}){
 const runtime=context?.deploy?.context||env('GTT_RUNTIME_CONTEXT')||env('CONTEXT');
 if(runtime!=='production'||env('GTT_TEAM_NOTIFICATIONS')!=='enabled'||!env('RESEND_API_KEY'))return null;
 const {rows}=await db.query('SELECT id,source,received_at,document FROM gtt_records WHERE id=$1',[recordId]);const record=rows[0];if(!record)return null;
 const to=(env('GTT_ADMIN_NOTIFICATION_TO')||env('GTT_NOTIFY_TO')||'info@gttgroup.ch').split(',').map((s:string)=>s.trim()).filter(Boolean);
 if(!to.length||to.some((s:string)=>!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)))throw Error('Invalid internal notification recipients');
 const version=Number(record.document.intake?.version||0);
 const id='gtt-team-'+createHash('sha256').update(recordId+':'+version+':'+kind).digest('hex').slice(0,40);
 const replyTo=/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(record.document.email||'')?record.document.email:'info@gttgroup.ch';
 const message={...renderTeamNotification(record,kind),to,reply_to:replyTo};
 await db.query("INSERT INTO gtt_team_outbox(id,record_id,quote_version,kind,message,status) VALUES($1,$2,$3,$4,$5::jsonb,'queued') ON CONFLICT(id) DO NOTHING",[id,recordId,version,kind,JSON.stringify(message)]);
 const reserved=await db.query("UPDATE gtt_team_outbox SET status='processing',attempts=attempts+1,lease_until=now()+interval '1 minute',updated_at=now() WHERE id=$1 AND attempts<3 AND created_at>now()-interval '23 hours' AND (status='queued' OR (status='processing' AND lease_until<now())) RETURNING *",[id]);
 const job=reserved.rows[0];if(!job)return {id,sent:false};
 let state='unknown',provider:string|null=null,code:string|null=null;
 try{
  const result=await(options.fetch||fetch)('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env('RESEND_API_KEY'),'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from:env('OFFER_FROM')||'GTT Insektenschutz <offerte@gtt-insektenschutz.ch>',...job.message}),signal:AbortSignal.timeout(15000)});
  const response=await result.json().catch(()=>null);
  if(result.ok&&typeof response?.id==='string'){state='accepted';provider=response.id;}else{state='failed';code='provider_http_'+result.status;}
 }catch{code='provider_outcome_unknown';}
 await db.query('UPDATE gtt_team_outbox SET status=$3,provider_id=$4,error_code=$5,lease_until=NULL,updated_at=now() WHERE id=$1 AND attempts=$2',[id,job.attempts,state,provider,code]);
 return {id,sent:state==='accepted',status:state};
}
