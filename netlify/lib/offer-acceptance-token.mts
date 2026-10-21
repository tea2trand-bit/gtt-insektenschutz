import {createHmac,timingSafeEqual} from 'node:crypto';
const env=(key:string)=>(globalThis as any).Netlify?.env?.get(key)??process.env[key];
export class OfferLinkError extends Error{status:number;constructor(message:string,status=400){super(message);this.status=status;}}
export type OfferClaims={r:string;q:number;e:number;a:string};
export const publicBaseURL=()=>env('GTT_PUBLIC_BASE_URL')||'https://gtt-insektenschutz.ch';
export function createAcceptanceLink(snapshot:any,recordId:string,version:number,baseURL=publicBaseURL()){
 const secret=env('GTT_OFFER_ACCEPTANCE_SECRET');
 if(!secret||snapshot.status!=='priced'||!snapshot.quote||snapshot.manualReview)return null;
 const expires=Date.parse(snapshot.processedAt)+30*86400000;
 if(!Number.isFinite(expires))return null;
 const origin=new URL(baseURL).origin;
 const payload=Buffer.from(JSON.stringify({r:recordId,q:version,e:expires,a:origin})).toString('base64url');
 const signature=createHmac('sha256',secret).update(payload).digest('base64url');
 return origin+'/offerte-bestaetigen?token='+payload+'.'+signature;
}
export function verifyAcceptanceToken(token:string,origin:string,now=Date.now()):OfferClaims{
 const secret=env('GTT_OFFER_ACCEPTANCE_SECRET');
 if(!secret)throw new OfferLinkError('Die Bestätigung ist derzeit nicht verfügbar. Bitte antworten Sie auf Ihre Offerte.',503);
 if(token.length>1200)throw new OfferLinkError('Ungültiger Bestätigungslink.');
 const parts=token.split('.');if(parts.length!==2)throw new OfferLinkError('Ungültiger Bestätigungslink.');
 const expected=createHmac('sha256',secret).update(parts[0]).digest();
 let supplied:Buffer;try{supplied=Buffer.from(parts[1],'base64url');}catch{throw new OfferLinkError('Ungültiger Bestätigungslink.');}
 if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw new OfferLinkError('Ungültiger Bestätigungslink.');
 let claims:any;try{claims=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));}catch{throw new OfferLinkError('Ungültiger Bestätigungslink.');}
 if(!/^GTT-[a-f0-9]{24}$/.test(claims.r||'')||!Number.isSafeInteger(claims.q)||claims.q<1||!Number.isFinite(claims.e)||claims.a!==origin)throw new OfferLinkError('Ungültiger Bestätigungslink.');
 if(claims.e<now)throw new OfferLinkError('Dieser Bestätigungslink ist abgelaufen. Bitte antworten Sie auf Ihre Offerte.',410);
 return claims;
}
