import PDFDocument from 'pdfkit';
import {SwissQRBill} from 'swissqrbill/pdf';
import path from 'node:path';
const money=(n:number)=>new Intl.NumberFormat('de-CH',{style:'currency',currency:'CHF'}).format(n);
const date=(s:string)=>s.split('-').reverse().join('.');
export function invoiceQRData(s:any){
 const i=s.issuer;
 const postal=s.customer.postalCode.match(/^(\d{4})\s+(.+)$/),street=s.customer.address.match(/^(.+?)\s+(\d+[a-zA-Z]?)$/);
 const debtor=postal&&street?{name:[s.customer.company,s.customer.name].filter(Boolean).join(', ').slice(0,70),address:street[1].slice(0,70),buildingNumber:street[2],zip:postal[1],city:postal[2].slice(0,35),country:'CH'}:undefined;
 return {currency:'CHF' as const,amount:s.balanceCHF,creditor:{name:i.name,address:i.address,buildingNumber:i.buildingNumber,zip:i.zip,city:i.city,country:i.country,account:i.account},...(debtor?{debtor}:{}),message:'Rechnung '+s.number};
}
/** Frozen invoice only; no live prices, external services, or AI-generated amounts. */
export async function renderInvoicePDF(s:any):Promise<Buffer>{
 const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true,info:{Title:'Rechnung '+s.number,Author:s.issuer.name,CreationDate:new Date(s.createdAt),ModDate:new Date(s.createdAt)}});
 const chunks:Buffer[]=[];const result=new Promise<Buffer>((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 doc.registerFont('GTT',path.join(process.cwd(),'netlify/assets/fonts/DejaVuSans.ttf'));doc.font('GTT');
 const ink='#24392b',green='#3f7136',muted='#607064';
 const text=(value:string,x:number,y:number,width=510,size=10,color=ink)=>doc.fillColor(color).fontSize(size).text(value,x,y,{width,lineGap:2});
 text('GTT Insektenschutz',42,38,330,20,green);text(s.issuer.name,42,68,300,10);
 text(s.issuer.address+' '+s.issuer.buildingNumber+' · '+s.issuer.zip+' '+s.issuer.city,42,84,510,9,muted);
 text(s.issuer.email+' · '+s.issuer.phone,42,99,510,9,muted);
 doc.moveTo(42,124).lineTo(553,124).strokeColor('#ceddca').stroke();
 const c=s.customer;
 const customerLines=[c.company,c.name,c.address,c.postalCode].filter(Boolean).join('\n');
 text(customerLines,42,140,290,10);
 const metaY=140+doc.fontSize(13).heightOfString('Rechnung '+s.number,{width:203,lineGap:2})+9;
 const bodyY=Math.max(234,140+doc.fontSize(10).heightOfString(customerLines,{width:290,lineGap:2})+28,metaY+65);
 text('Rechnung '+s.number,350,140,203,13,green);text('Datum: '+date(s.date)+'\nLeistung: '+date(s.serviceDate)+'\nOfferte: '+s.offerReference,350,metaY,203,9);
 text('Insektenschutz nach Mass',42,bodyY,510,13);
 text('Gemäss bestätigter Offerte, inklusive Ausmessen, Lieferung und Montage.',42,bodyY+23,510,9,muted);
 const a=s.quote.areas;
 text([a.fenster?'Fenster: '+a.fenster+' m²':'',a.tueren?'Türen / Plissee: '+a.tueren+' m²':''].filter(Boolean).join(' · '),42,bodyY+43,510,10);
 doc.rect(42,bodyY+73,511,30).fill('#edf4e9');text('Gesamtbetrag inkl. '+s.issuer.vatRate+' % MwSt.',53,bodyY+81,330,11);text(money(s.totalCHF),394,bodyY+81,148,11);
 text('Nettobetrag: '+money(s.netCHF)+' · Enthaltene MwSt.: '+money(s.vatCHF),42,bodyY+114,510,9,muted);
 if(s.prepaidCHF)text('Bereits bezahlt: '+money(s.prepaidCHF),42,bodyY+137,510,10);
 if(s.paid){
  text('BEZAHLT · '+(s.method==='cash'?'Bar':s.method==='twint'?'TWINT':'Bereits vollständig bezahlt'),42,bodyY+166,510,14,green);
  text('Zahlungseingang bestätigt am '+date(s.date)+'. Kein offener Betrag.',42,bodyY+195,510,10);
 }else{
  text('Noch zu bezahlen: '+money(s.balanceCHF),42,bodyY+166,510,13,green);
  text('Zahlbar bis '+date(s.dueDate)+' mit dem QR-Zahlteil unten.',42,bodyY+191,510,10);
  text(s.issuer.bank+' · BIC '+s.issuer.bic,42,bodyY+213,510,9,muted);
 }
 if(s.preview)text('MUSTER - Keine Zahlungsaufforderung. Nicht an Kunden versendet.',42,bodyY+231,510,9,green);
 text('MwSt.-Nr. '+s.issuer.vatId+' · Bitte bei Rückfragen die Rechnungsnummer angeben.',42,bodyY+249,510,8,muted);
 if(!s.paid){
  if(doc.y+SwissQRBill.height>doc.page.height){doc.addPage({size:'A4'});text('QR-Zahlteil zur Rechnung '+s.number,42,42,510,14,green);}
  doc.fillColor('#000000');new SwissQRBill(invoiceQRData(s),{language:'DE',scissors:true}).attachTo(doc);
 }
 doc.end();return result;
}

/** Separate negative document; the original invoice and its PDF stay unchanged. */
export async function renderInvoiceCancellationPDF(s:any):Promise<Buffer>{
 const doc=new PDFDocument({size:'A4',margin:42,info:{Title:'Stornobeleg '+s.number,Author:s.issuer.name,CreationDate:new Date(s.createdAt),ModDate:new Date(s.createdAt)}});
 const chunks:Buffer[]=[];const result=new Promise<Buffer>((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 doc.registerFont('GTT',path.join(process.cwd(),'netlify/assets/fonts/DejaVuSans.ttf'));doc.font('GTT').fillColor('#24392b');
 const line=(value:string,size=10)=>{doc.fontSize(size).text(value,{lineGap:3});doc.moveDown(.65);};
 line('GTT Insektenschutz',20);line(s.issuer.name+'\n'+s.issuer.address+' '+s.issuer.buildingNumber+' · '+s.issuer.zip+' '+s.issuer.city+'\n'+s.issuer.email+' · '+s.issuer.phone);
 doc.moveDown();line('Stornobeleg '+s.number,17);line('Zur Rechnung '+s.originalNumber+'\nStorniert am '+date(s.date));
 line([s.customer.company,s.customer.name,s.customer.address,s.customer.postalCode].filter(Boolean).join('\n'));
 doc.moveDown();line('Die Rechnung '+s.originalNumber+' wird vollständig storniert.',12);
 line('Stornobetrag inkl. '+s.issuer.vatRate+' % MwSt.: '+money(s.totalCHF),14);
 line('Nettobetrag: '+money(s.netCHF)+' · MwSt.: '+money(s.vatCHF));
 line('Offener Rechnungsbetrag nach Stornierung: CHF 0.00',12);
 if(s.refundDueCHF>0)line('Bereits bezahlt: '+money(s.refundDueCHF)+'\nZurückzuerstatten: '+money(s.refundDueCHF)+'\nDieser Beleg bestätigt keine Rückzahlung.');
 if(s.reason)line('Grund: '+s.reason);
 line('Keine Zahlungsaufforderung. Bitte nicht nochmals bezahlen.');
 if(s.preview)line('MUSTER - Nicht an Kunden versendet.');
 line('MwSt.-Nr. '+s.issuer.vatId+' · '+s.issuer.name,8);
 doc.end();return result;
}
