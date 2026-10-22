import {createHash} from 'node:crypto';
import type {QueryDB} from './records.mts';
import {offerNumber,money} from './quote-email.mts';
import {publicBaseURL} from './offer-acceptance-token.mts';
const env=(key:string)=>(globalThis as any).Netlify?.env?.get(key)??process.env[key];
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Both MIME alternatives carry the same short, actionable information. */
export function renderTeamNotification(record:any,kind='new_inquiry',baseURL=publicBaseURL()){
 const d=record.document,intake=d.intake,quote=intake?.quote;
 const source=({'Kontakt':'Kontaktformular auf der Website','Kalkulator':'Kalkulator auf der Website','B2B':'B2B-Formular auf der Website','Ručni unos':'Manuelle Erfassung'} as any)[record.source]||record.source;
 const customer=d.name||d.company||'Kunde ohne Namen',declined=kind==='customer_decline',accepted=kind==='customer_acceptance',corrected=d.customerAcceptance?.intent==='confirm_corrected_offer';
 const title=declined?'Offerte abgelehnt':accepted?(corrected?'Korrigierte Offerte bestätigt':'Offerte bestätigt'):'Neue Anfrage';
 const status=intake?.email?.status;
 const next=declined?'Kein Termin erforderlich. Es wird kein Termin gebucht.':accepted?(corrected?'Montagetermin mit dem Kunden vereinbaren.':'Termin zum Ausmessen mit dem Kunden vereinbaren.'):status==='failed'||status==='unknown'?'E-Mail-Versand in der Karte prüfen.':intake?.manualReview?'Anfrage in der Karte prüfen.':intake?.measurementRequired?'Termin zum Ausmessen mit dem Kunden vereinbaren.':status==='accepted'?(quote?'Auf die Entscheidung des Kunden warten.':'Auf die ergänzenden Angaben des Kunden warten.'):'Anfrage und Versandstatus in der Karte prüfen.';
 const reference=Number(intake?.version)>0?offerNumber(record.id,Number(intake.version)):null;
 const href=new URL(reference?'/admin?offerte='+encodeURIComponent(reference):'/admin?anfrage='+encodeURIComponent(record.id),baseURL).toString();
 const rows=[['Quelle',source],['Kunde',customer],...(quote?[['Offerte',reference+' · '+money(quote.totalCHF)]]:[]),...(d.phone?[['Telefon',d.phone]]:[]),...(d.email?[['E-Mail',d.email]]:[]),...([d.address,d.postalCode].some(Boolean)?[['Montageort',[d.address,d.postalCode].filter(Boolean).join(', ')]]:[])];
 const notice=!accepted&&!declined&&status==='accepted'?(quote?'Die Offerte wurde an den Kunden versendet.':'Die Rückfrage wurde an den Kunden versendet.'):'';
 const text=[title,'','Nächster Schritt: '+next,'',...rows.map(([k,v])=>k+': '+v),...(notice?['',notice]:[]),'','Karte öffnen (Anmeldung erforderlich):',href].join('\n');
 const html='<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f6f3;color:#24392b;font:16px/1.5 Arial,sans-serif"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:20px 12px"><table role="presentation" style="width:100%;max-width:560px;margin:auto;background:#fff;border:1px solid #dce4da;border-radius:12px"><tr><td style="padding:24px"><p style="margin:0 0 12px;color:#657164;font-size:13px">GTT Insektenschutz · Für das Team</p><h1 style="font-size:24px;line-height:1.25;margin:0 0 20px">'+escape(title)+'</h1><div style="padding:14px 16px;background:#edf5e9;border-radius:8px"><strong>Nächster Schritt</strong><br>'+escape(next)+'</div><table role="presentation" style="width:100%;margin:18px 0;border-collapse:collapse">'+rows.map(([k,v])=>'<tr><td style="padding:6px 12px 6px 0;color:#657164;vertical-align:top;font-size:14px">'+escape(k)+'</td><td style="padding:6px 0;overflow-wrap:anywhere">'+escape(v)+'</td></tr>').join('')+'</table>'+(notice?'<p style="font-size:14px;color:#657164">'+escape(notice)+'</p>':'')+'<a href="'+escape(href)+'" style="display:inline-block;background:#508343;color:#fff;border-radius:7px;padding:12px 20px;text-decoration:none;font-weight:bold">Karte öffnen</a><p style="font-size:12px;color:#657164;margin:10px 0 0">Anmeldung erforderlich · Alle Details stehen in der Karte.</p></td></tr></table></td></tr></table></body></html>';
 return {subject:title+' · '+customer+(reference?' · '+reference:''),html,text};
}
export async function notifyTeam(db:QueryDB,recordId:string,kind:'new_inquiry'|'customer_acceptance'|'customer_decline',context:any={},options:{fetch?:typeof fetch}={}){
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
