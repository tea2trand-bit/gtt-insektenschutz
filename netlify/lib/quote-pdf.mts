import {PDFDocument,StandardFonts,rgb,PDFName,PDFString} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {offerNumber,money} from './quote-email.mts';
import {createAcceptanceLink} from './offer-acceptance-token.mts';

/** Render the immutable offer snapshot, never today's prices or mutable contact. */
export async function renderQuotePDF(snapshot:any,recordId:string,version:number,options:{baseURL?:string}={}){
 if(!snapshot.quote)throw Error('Für diese Anfrage liegt noch keine berechnete Offerte vor.');
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const font=await pdf.embedFont(await readFile(path.join(process.cwd(),'netlify/assets/fonts/DejaVuSans.ttf')),{subset:true});
 const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const green=rgb(.18,.37,.24),ink=rgb(.14,.19,.16),muted=rgb(.38,.43,.40),line=rgb(.84,.88,.85);
 const ref=offerNumber(recordId,version),q=snapshot.quote,c=snapshot.customer||{},W=595.28,H=841.89,M=42,R=W-M;
 const title=snapshot.correction?'Korrigierte Offerte':'Offerte';
 pdf.setTitle(title+' '+ref);pdf.setAuthor('GTT Insektenschutz');pdf.setSubject('Insektenschutz nach Mass');
 let page:any,y=0;
 const text=(value:any,x:number,yy:number,size=10,color=ink,strong=false)=>page.drawText(String(value),{x,y:yy,size,font:strong?bold:font,color});
 const right=(value:string,x:number,yy:number,size=10,strong=false)=>text(value,x-(strong?bold:font).widthOfTextAtSize(value,size),yy,size,ink,strong);
 function addPage(){page=pdf.addPage([W,H]);y=H-M;text('GTT Insektenschutz',M,y,17,green,true);right(ref,R,y,10,true);y-=20;text('GT-Trading GmbH · St. Gallen',M,y,9,muted);y-=18;page.drawLine({start:{x:M,y},end:{x:R,y},thickness:1.3,color:green});y-=24;}
 function space(h:number){if(y-h<82)addPage();}
 function wrap(value:string,width:number,size=10){const rows:string[]=[];let current='';for(const word of String(value).split(/\s+/)){if(font.widthOfTextAtSize(word,size)>width){if(current){rows.push(current);current='';}let chunk='';for(const char of word){if(font.widthOfTextAtSize(chunk+char,size)>width){rows.push(chunk);chunk='';}chunk+=char;}current=chunk;}else if(current&&font.widthOfTextAtSize(current+' '+word,size)>width){rows.push(current);current=word;}else current+=(current?' ':'')+word;}if(current)rows.push(current);return rows;}
 function paragraph(value:string,size=10,color=ink,width=R-M){for(const row of wrap(value,width,size)){space(size+6);text(row,M,y,size,color);y-=size+5;}y-=5;}
 function heading(value:string){space(34);text(value,M,y,11,green,true);y-=20;}
 addPage();text(title,M,y,23,ink,true);y-=24;
 const date=new Date(snapshot.processedAt).toLocaleDateString('de-CH',{timeZone:'Europe/Zurich'});
 paragraph(ref+' · '+date,9,muted);
 if(snapshot.email?.status==='draft')paragraph('ENTWURF - noch nicht versendet',10,muted);
 for(const value of [c.company,c.name,c.address,[snapshot.postalCode,c.city].filter(Boolean).join(' '),c.email,c.phone].filter(Boolean))paragraph(value,10,ink);
 y-=6;
 paragraph(snapshot.correction?'Auf Grundlage des Aufmasses vor Ort erhalten Sie die folgende korrigierte Offerte. Bitte bestätigen Sie diese neue Version.':'Vielen Dank für Ihre Anfrage. Ihre Richtpreis-Offerte für massgefertigten Insektenschutz:',10);
 if(snapshot.correction)paragraph('Bisher: '+money(snapshot.correction.previousTotalCHF)+'   |   Neu: '+money(q.totalCHF),10,green);
 function tableHead(){space(30);page.drawRectangle({x:M,y:y-8,width:R-M,height:23,color:rgb(.94,.96,.94)});text('Position / Ausführung',M+7,y,9,green,true);right('Fläche',341,y,9,true);right('CHF / m²',439,y,9,true);right('Betrag CHF',R-7,y,9,true);y-=29;}
 tableHead();
 for(const [type,key,label] of [['window','fenster','Fenster nach Mass'],['door','tueren','Türen / Plissee nach Mass']]){
  if(!q.areas[key])continue;
  space(54);text(label,M+7,y,10);right(Number(q.areas[key]).toLocaleString('de-CH',{maximumFractionDigits:4})+' m²',341,y,10);right(Number(q.rates[key]).toFixed(2),439,y,10);right((q.areas[key]*q.rates[key]).toFixed(2),R-7,y,10);y-=18;
  const details=(snapshot.measurements||[]).filter((m:any)=>m.type===type).map((m:any)=>m.mode==='dimensions'?`${m.quantity} × ${m.width} ${m.widthUnit} × ${m.height} ${m.heightUnit}`:`Gesamtfläche ${m.areaM2} m²`).join('; ');
  for(const row of wrap(details,240,8)){space(14);text(row,M+7,y,8,muted);y-=13;}y-=7;page.drawLine({start:{x:M,y},end:{x:R,y},thickness:.5,color:line});y-=20;
 }
 const travel=Number(q.travelCosts?.amountCHF)||0;
 if(travel){space(40);text('Anfahrtskosten, pauschal',M+7,y,10);right(travel.toFixed(2),R-7,y,10);y-=26;}
 if(q.discount)paragraph(q.discount.name+' -'+q.discount.percent+'%: bereits in den gerundeten Einheitspreisen berücksichtigt.',9,muted);
 const positions=q.areas.fenster*q.rates.fenster+q.areas.tueren*q.rates.tueren+travel;
 const rounding=Math.round((q.totalCHF-positions)*100)/100;
 if(rounding){space(25);text('Rundung des Gesamtbetrags',M,y,9,muted);right((rounding>0?'+':'')+rounding.toFixed(2),R,y,9);y-=23;}
 space(93);page.drawLine({start:{x:M,y},end:{x:R,y},thickness:1,color:green});y-=25;
 text('Gesamtbetrag inkl. MwSt.',M,y,12,green,true);right(money(q.totalCHF),R,y,17,true);y-=21;
 const vat=Math.round(q.totalCHF*8.1/108.1*100)/100;
 right('Enthaltene MwSt. (8.1 %): '+money(vat),R,y,9);y-=22;
 paragraph(snapshot.correction?'Preis auf Grundlage der vor Ort erfassten Masse. Die neue Offertversion benötigt Ihre Bestätigung.':'Unverbindlicher Richtpreis auf Grundlage Ihrer Angaben. Die Masse und die endgültige Vereinbarung werden vor Ort geprüft.',9,muted);
 if(q.travelCosts?.status==='requires_review')paragraph('Anfahrtskosten noch offen und im Richtpreis nicht enthalten.',9,muted);
 heading('Im Preis enthalten');paragraph('Ausmessen vor Ort · Lieferung und Montage · 2 Jahre Garantie',9);
 const accept=createAcceptanceLink(snapshot,recordId,version,options.baseURL);
 if(accept){heading('Ihre Entscheidung');space(44);const links=[['Offerte annehmen',accept],['Offerte ablehnen',accept+'&entscheidung=ablehnen']];let x=M;for(const [label,url] of links){const w=155;page.drawRectangle({x,y:y-10,width:w,height:29,borderColor:line,borderWidth:1,color:rgb(.94,.97,.94)});text(label,x+12,y,10,green);const annotation=pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[x,y-10,x+w,y+19],Border:[0,0,0],A:{Type:'Action',S:PDFName.of('URI'),URI:PDFString.of(url)}}));page.node.addAnnot(annotation);x+=w+12;}y-=34;paragraph('Der Link öffnet eine Bestätigungsseite. Erst Ihre ausdrückliche Bestätigung speichert die Entscheidung.',8,muted);}
 heading('Fragen oder Reklamation');paragraph('Reklamation melden auf gtt-insektenschutz.ch/reklamation: Offertnummer oder Name, E-Mail und Beschreibung angeben. Kontakt: info@gttgroup.ch.',8,muted);
 const pages=pdf.getPages();for(let i=0;i<pages.length;i++){page=pages[i];page.drawLine({start:{x:M,y:65},end:{x:R,y:65},thickness:.5,color:line});text('GTT Insektenschutz · GT-Trading GmbH · Quimbystrasse 7 · 9015 St. Gallen',M,50,8,muted);text('info@gttgroup.ch · +41 76 422 92 42',M,36,8,muted);right(`${i+1} / ${pages.length}`,R,36,8);}
 return pdf.save();
}

export async function quotePDFResponse(snapshot:any,id:string,version:number,baseURL:string){
 const bytes=await renderQuotePDF(snapshot,id,version,{baseURL});
 return new Response(bytes as BodyInit,{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="Offerte-${offerNumber(id,version)}.pdf"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
