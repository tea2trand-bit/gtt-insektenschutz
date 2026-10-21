import type {Config} from '@netlify/functions';
import {recordsDB} from '../lib/records-db.mts';
import {verifyAcceptanceToken,OfferLinkError} from '../lib/offer-acceptance-token.mts';
import {readAcceptanceOffer,acceptOffer} from '../lib/offer-acceptance.mts';
import {notifyTeam} from '../lib/team-notification.mts';
import type {QueryDB} from '../lib/records.mts';
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function page(title:string,body:string,status=200){
 return new Response('<!doctype html><html lang="de-CH"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+escape(title)+' | GTT Insektenschutz</title><style>body{margin:0;background:#f5f7f3;color:#24342a;font:16px/1.6 Arial,sans-serif}main{max-width:620px;margin:40px auto;padding:30px;background:white;border:1px solid #e0e7dc;border-radius:12px}h1{font-size:26px}button{background:#398429;color:white;border:0;border-radius:8px;font:inherit;padding:13px 20px;cursor:pointer}label{display:flex;gap:10px;margin:22px 0}input[type=checkbox]{min-width:20px}small{color:#59655b}a{color:#2c6b28}.amount{font-size:26px;font-weight:bold}footer{margin-top:25px;border-top:1px solid #e2e8df;padding-top:15px;font-size:13px}@media(max-width:680px){main{margin:15px;padding:22px}}</style><main><strong>GTT Insektenschutz</strong><h1>'+escape(title)+'</h1>'+body+'<footer>GTT Insektenschutz · GT-Trading GmbH<br><a href="mailto:info@gttgroup.ch">info@gttgroup.ch</a> · +41 76 422 92 42</footer></main></html>',{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});
}
export async function handleOfferAcceptance(req:Request,context:any,db:QueryDB){
 if(!['GET','POST'].includes(req.method))return page('Methode nicht erlaubt','<p>Bitte öffnen Sie den Link aus Ihrer Offerte.</p>',405);
 try{
  const url=new URL(req.url),token=url.searchParams.get('token')||'';
  const claims=verifyAcceptanceToken(token,url.origin);
  if(req.method==='POST'){
   if(req.headers.get('origin')!==url.origin)throw new OfferLinkError('Bitte bestätigen Sie direkt auf dieser Seite.',403);
   const form=await req.formData();if(form.get('confirm')!=='yes')throw new OfferLinkError('Bitte bestätigen Sie zuerst, dass Sie das Ausmessen abstimmen möchten.');
   const result=await acceptOffer(db,claims);
   if(!result.alreadyConfirmed)await notifyTeam(db,result.recordId,'customer_acceptance',context).catch(()=>{});
   return new Response(null,{status:303,headers:{Location:url.pathname+'?token='+encodeURIComponent(token),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  }
  const row=await readAcceptanceOffer(db,claims);
  if(row.document.customerAcceptance?.quoteVersion===claims.q)return page('Vielen Dank für Ihre Bestätigung','<p>Wir haben Ihren Wunsch zur weiteren Abstimmung und zum Ausmessen gespeichert. Unser Team meldet sich bei Ihnen.</p><p>Die Masse und die endgültige Vereinbarung werden beim Ausmessen geprüft.</p>');
  const amount=new Intl.NumberFormat('de-CH',{style:'currency',currency:'CHF'}).format(row.snapshot.quote.totalCHF);
  return page('Offerte annehmen','<p>Guten Tag '+escape(row.snapshot.customer?.name||'')+'</p><p>Ihre Offerte für Insektenschutz nach Mass:</p><p class="amount">'+escape(amount)+'</p><p>Mit Ihrer Bestätigung möchten Sie auf dieser Grundlage fortfahren und das Ausmessen mit unserem Team abstimmen. Die Masse und die endgültige Vereinbarung werden vor Ort geprüft.</p><form method="post"><label><input type="checkbox" name="confirm" value="yes" required><span>Ich möchte auf Grundlage dieser Offerte fortfahren und das Ausmessen abstimmen.</span></label><button type="submit">Bestätigen und Ausmessen anfragen</button></form><p><small>Ihre Bestätigung wird dieser Offertversion zugeordnet. Es wird noch kein Montagetermin gebucht.</small></p>');
 }catch(error){if(error instanceof OfferLinkError)return page('Bestätigung der Offerte','<p>'+escape(error.message)+'</p>',error.status);console.error('Offer confirmation failed');return page('Bitte später erneut versuchen','<p>Ihre Bestätigung konnte derzeit nicht gespeichert werden. Bitte antworten Sie auf Ihre Offerte oder rufen Sie uns an.</p>',503);}
}
export default(req:Request,context:any)=>handleOfferAcceptance(req,context,recordsDB());
export const config:Config={path:'/offerte-bestaetigen',method:['GET','POST'],rateLimit:{action:'rate_limit',aggregateBy:['ip'],windowSize:60,windowLimit:30}};
