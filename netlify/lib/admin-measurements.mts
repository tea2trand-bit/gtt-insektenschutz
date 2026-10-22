import {createHash,randomUUID} from 'node:crypto';
import {RecordError,readRecord,applyChange,type QueryDB} from './records.mts';
import {priceExtraction} from './quote-pricing.mts';
import {readOffer,projectsStore,type Offer} from './projects-store.mts';
import type {Measurement} from './measurement-intake.mts';
import {saveOnsiteCorrection,recoverOnsiteCorrection} from './onsite-correction.mts';

type CalculationOptions={offer?:Offer;context?:any;documentOverride?:any;quoteBasis?:any;contactRefresh?:boolean;fetch?:typeof fetch};
export async function calculateMeasuredOffer(db:QueryDB,id:string,body:any,options:CalculationOptions={}){
  const record=await readRecord(db,id),d=options.documentOverride||record.document;
  if(body.preview!==true&&/^[a-f0-9-]{36}$/i.test(body.requestId||'')){
    const recovered=await recoverOnsiteCorrection(db,record,body,options);if(recovered)return recovered;
  }
  if(!Number.isInteger(body.revision)||body.revision!==record.revision)throw new RecordError('Die Anfrage wurde geändert. Bitte neu öffnen.',409);
  const correction=!options.contactRefresh&&(['Ponuda poslata','Čeka odgovor','Prihvaćeno'].includes(d.status)||d.correctionPending===true);
  if(d.archivedAt||d.status!=='Novi upit'&&!correction)throw new RecordError('Masse können vor dem Versand oder zur Korrektur einer offenen Offerte erfasst werden.',409);
  if(correction&&!d.intake?.quote)throw new RecordError('Zu dieser Anfrage fehlt eine berechnete Offerte. Bitte zuerst die Offerte prüfen.',409);
  if(!Array.isArray(body.measurements)||!body.measurements.length||body.measurements.length>30)throw new RecordError('Bitte mindestens ein Fenster oder eine Tür erfassen.');
  const validateMeasurement=(m:any):Measurement=>{
    if(m.mode==='area'){
      if(!['window','door'].includes(m.type)||typeof m.areaM2!=='number'||!Number.isFinite(m.areaM2)||m.areaM2<=0||m.areaM2>10000)throw new RecordError('Bitte eine gültige Gesamtfläche in m² eingeben.');
      return {type:m.type,mode:'area',quantity:1,width:null,height:null,widthUnit:null,heightUnit:null,areaM2:Math.round(m.areaM2*1e8)/1e8,source:'Im Admin bestätigte Gesamtfläche'};
    }
    if(!['window','door'].includes(m.type)||!Number.isInteger(m.quantity)||m.quantity<1||m.quantity>100||typeof m.width!=='number'||typeof m.height!=='number'||!Number.isFinite(m.width)||!Number.isFinite(m.height)||m.width<=0||m.height<=0||m.width>2000||m.height>2000)throw new RecordError('Bitte Anzahl, Breite und Höhe in cm prüfen.');
    return {type:m.type,mode:'dimensions' as const,quantity:m.quantity,width:m.width,height:m.height,widthUnit:'cm' as const,heightUnit:'cm' as const,areaM2:Math.round(m.quantity*m.width*m.height/10000*1e8)/1e8,source:body.measurementSource==='admin_confirmed'?'Im Admin bestätigte Masse':'Ausmessen vor Ort'};
  };
  const measurements:Measurement[]=body.measurements.map(validateMeasurement);
  if(body.productionMeasurements!==undefined&&(!Array.isArray(body.productionMeasurements)||body.productionMeasurements.length>30||body.productionMeasurements.some((m:any)=>m.mode==='area')))throw new RecordError('Bitte die Einzelmasse für die Fertigung prüfen.');
  const productionMeasurements=body.productionMeasurements?.map(validateMeasurement)||d.intake?.productionMeasurements||[];
  const postalCode=(d.postalCode||'').match(/\b\d{4}\b/)?.[0]||'';
  const extraction={method:'deterministic' as const,measurements,postalCode,issues:[],special:false};
  const offer=options.offer||await readOffer(projectsStore(options.context));
  if(body.travelAmountCHF!==undefined&&(typeof body.travelAmountCHF!=='number'||!Number.isFinite(body.travelAmountCHF)||body.travelAmountCHF<0||body.travelAmountCHF>100000||body.travelIncluded===true&&body.travelAmountCHF!==0))throw new RecordError('Bitte die Anfahrtskosten als gültigen CHF-Betrag prüfen.');
  const travelAmountCHF=body.travelAmountCHF===undefined?undefined:Math.round(body.travelAmountCHF*100)/100;
  const previousTravel=correction&&d.intake.quote.postalCode===postalCode&&d.intake.quote.travelCosts?.confirmedByAdmin?d.intake.quote.travelCosts:null;
  const preserveTravel=previousTravel&&body.travelIncluded!==true&&travelAmountCHF===undefined;
  const pricing=priceExtraction(extraction,'angebot',offer,new Date(),preserveTravel?{travelIncluded:previousTravel.amountCHF===0,travelAmountCHF:previousTravel.amountCHF}:{travelIncluded:body.travelIncluded===true,travelAmountCHF});
  const draftQuote={...(pricing.quote||pricing.calculation),priceKind:'indicative'};
  if(correction){
    const old=d.intake.quote,areas=draftQuote.areas,travel=Number(draftQuote.travelCosts.amountCHF)||0;
    Object.assign(draftQuote,{rates:old.rates,baseRates:old.baseRates,discount:old.discount,pricingVersion:old.pricingVersion,totalCHF:Math.round((Math.round(areas.fenster*old.rates.fenster+areas.tueren*old.rates.tueren)+travel)*100)/100,baseTotalCHF:Math.round((Math.round(areas.fenster*old.baseRates.fenster+areas.tueren*old.baseRates.tueren)+travel)*100)/100});
  }
  if(options.quoteBasis){
    const previous=options.quoteBasis,oldTravel=Number(previous.travelCosts?.amountCHF)||0,newTravel=Number(draftQuote.travelCosts.amountCHF)||0;
    Object.assign(draftQuote,{areas:previous.areas,rates:previous.rates,baseRates:previous.baseRates,discount:previous.discount,pricingVersion:previous.pricingVersion,totalCHF:Math.round((previous.totalCHF-oldTravel+newTravel)*100)/100,baseTotalCHF:Math.round((previous.baseTotalCHF-oldTravel+newTravel)*100)/100});
  }
  if(body.preview===true)return {quote:draftQuote,issues:pricing.issues,...(correction?{correction:{previousTotalCHF:d.intake.quote.totalCHF,priceChanged:draftQuote.totalCHF!==d.intake.quote.totalCHF}}:{})};
  if(!/^[a-f0-9-]{36}$/i.test(body.requestId||''))throw new RecordError('Bitte die Berechnung neu öffnen.');
  if(correction)return saveOnsiteCorrection(db,record,body,draftQuote,measurements,productionMeasurements,pricing.issues,options);
  const fingerprint=createHash('sha256').update('onsite:'+id+':'+body.requestId).digest('hex');
  const snapshot={schemaVersion:'measurement-intake-v1',status:'priced',sourceFingerprint:fingerprint,processedAt:new Date().toISOString(),method:'deterministic',ai:{status:'not_needed',model:null},measurements,productionMeasurements,postalCode,clarification:pricing.issues,manualReview:pricing.manualReview,quote:draftQuote,estimate:null,customer:{name:d.name,company:d.company,email:d.email,phone:d.phone,address:d.address},email:{status:'draft'},contractAccepted:false};
  if(options.contactRefresh&&d.intake?.correction)Object.assign(snapshot,{correction:d.intake.correction,quote:{...draftQuote,priceKind:'onsite'}});
  const products=measurements.map(m=>(m.type==='window'?'Fenster':'Türen / Plissee')+': '+(m.mode==='area'?m.areaM2+' m²':m.quantity+' × '+m.width+' × '+m.height+' cm')).join('\n');
  const dateKey=body.measurementSource==='admin_confirmed'?'dimensionsConfirmedAt':'measuredAt';
  const {rows}=await db.query(`WITH target AS MATERIALIZED (
    SELECT id FROM gtt_records WHERE id=$1 AND revision=$2 AND document->>'status'='Novi upit' AND COALESCE(document->>'archivedAt','')=''
      AND NOT EXISTS(SELECT 1 FROM gtt_quote_outbox WHERE record_id=$1 AND status IN ('queued','processing')) FOR UPDATE
  ), added AS (
    INSERT INTO gtt_quote_versions(record_id,source_fingerprint,snapshot) SELECT id,$3,$4::jsonb FROM target
    ON CONFLICT(record_id,source_fingerprint) DO NOTHING RETURNING version,record_id
  ), changed AS (
    UPDATE gtt_records r SET document=$9::jsonb||jsonb_build_object('quotedPrice',$5::numeric,'products',$6::text,$8::text,$7::text,'intake',$4::jsonb||jsonb_build_object('version',a.version,'quote',$4::jsonb->'quote'||jsonb_build_object('version',a.version))),revision=revision+1,updated_at=now()
    FROM added a WHERE r.id=a.record_id AND r.revision=$2 RETURNING r.*
  ), audit AS (
    INSERT INTO gtt_record_history(record_id,revision,actor,kind,snapshot) SELECT id,revision,$10,$11,document FROM changed RETURNING record_id
  ) SELECT id FROM changed`,[id,body.revision,fingerprint,JSON.stringify(snapshot),draftQuote.totalCHF,products,options.contactRefresh?d[dateKey]||'':new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Zurich'}),dateKey,JSON.stringify(d),options.contactRefresh?'Admin: Kontakt und Offertentwurf aktualisiert':'Admin: Masse bestätigt',options.contactRefresh?'update':'measurement']);
  if(!rows.length)throw new RecordError('Die Anfrage wurde geändert oder der Versand läuft. Bitte neu öffnen.',409);
  return {record:await readRecord(db,id)};
}

export async function refreshDraftContact(db:QueryDB,id:string,body:any,options:{offer?:Offer;context?:any}={}){
  const contactKeys=['name','company','email','phone','address','postalCode'];
  if(body.action!=='update'||!body.patch||typeof body.patch!=='object'||!Object.keys(body.patch).length||!Object.keys(body.patch).every(key=>contactKeys.includes(key)))return null;
  const current=await readRecord(db,id),d=current.document,intake=d.intake;
  if(d.archivedAt||d.status!=='Novi upit'||intake?.email?.status!=='draft'||!intake.quote||!intake.measurements?.length)return null;
  if(!Number.isInteger(body.revision)||body.revision!==current.revision)throw new RecordError('Die Anfrage wurde geändert. Bitte neu öffnen.',409);
  const changed=applyChange(d,body).document;
  if(!contactKeys.some(key=>changed[key]!==d[key]))return null;
  const previous=intake.quote,travelAmount=Number(previous.travelCosts?.amountCHF)||0;
  const travel=previous.travelCosts?.confirmedByAdmin?(travelAmount?{travelAmountCHF:travelAmount}:changed.postalCode===d.postalCode?{travelIncluded:true}:{}):{};
  const dimensions=intake.measurements.map((m:any)=>m.mode==='area'?{type:m.type,mode:'area',areaM2:m.areaM2}:{type:m.type,quantity:m.quantity,width:m.width*(m.widthUnit==='m'?100:m.widthUnit==='mm'?.1:1),height:m.height*(m.heightUnit==='m'?100:m.heightUnit==='mm'?.1:1)});
  return calculateMeasuredOffer(db,id,{revision:body.revision,requestId:randomUUID(),measurementSource:'admin_confirmed',measurements:dimensions,...travel},{...options,documentOverride:changed,quoteBasis:previous,contactRefresh:true});
}
