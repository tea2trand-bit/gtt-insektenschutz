import {parseMeasurements} from './measurement-intake.mts';
import {refineMeasurements} from './measurement-ai.mts';

const typeOf=(text:string)=>/tür|tuer|door|plissee/iu.test(text)?'door':/fenster|window/iu.test(text)?'window':'';
const cm=(value:string,unit:string)=>Number(value.replace(',','.'))*(unit==='mm'?.1:unit==='m'?100:1);

// A proposal for the admin, never an instruction to send a customer offer.
// Keep frame alternatives separate and leave an unstated element type empty.
export function proposeRequestMeasurements(text:string,postalCode=''){
  const rows:any[]=[],warnings:string[]=[];
  const blocks=text.slice(0,6000).split(/(?:^|\n)\s*(\d+)[.)]\s+([^\n]+)\n/u);
  for(let i=1;i<blocks.length;i+=3){
    const label=blocks[i+1].trim(),body=blocks[i+2];
    const claims=[...body.matchAll(/(?:^|\n)\s*[*•-]?\s*(Breite|Höhe|Hoehe)\s*(ohne\s+Rahmen|mit\s+Rahmen)?\s*:\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/giu)];
    if(!claims.length)continue;
    const variants=[];
    for(const basis of ['without_frame','with_frame','unspecified']){
      const found=claims.filter(m=>(m[2]?.toLowerCase().startsWith('ohne')?'without_frame':m[2]?'with_frame':'unspecified')===basis);
      const widths=found.filter(m=>/^breite$/iu.test(m[1])),heights=found.filter(m=>!/^breite$/iu.test(m[1]));
      if(widths.length===1&&heights.length===1){
        const width=cm(widths[0][3],widths[0][4].toLowerCase()),height=cm(heights[0][3],heights[0][4].toLowerCase());
        if(width>0&&height>0&&width<=2000&&height<=2000)variants.push({basis,width,height});
      }
    }
    rows.push({label,type:typeOf(label),quantity:1,variants});
  }
  if(!rows.length){
    const normalized=text.replace(/\b(?:Doppelfenster|Fensterfront)\b/giu,'Fenster');
    const parsed=parseMeasurements(normalized,postalCode);
    const dimensions=parsed.measurements.filter(m=>m.mode==='dimensions');
    const typeSet=new Set(dimensions.map(m=>m.type));
    // "Die beiden Türen ..." followed by two dimension lines means one each,
    // not two doors of each size. Check both the group count and line count.
    const group=text.match(/\b(?:die\s+)?(beiden|zwei|drei|vier|\d+)\s+(?:Fenster|Türen|Tueren|Schiebetüren)\s+(?:haben|mit|jeweils)/iu);
    const groupCount=group?({beiden:2,zwei:2,drei:3,vier:4}[group[1].toLowerCase()]||Number(group[1])):0;
    const grouped=typeSet.size===1&&groupCount===dimensions.length&&dimensions.every(m=>m.quantity===1);
    const singular=/\b(?:ein|eine|einem|einen|1)\s+(?:Doppel)?(?:fenster|tür|tuer)\b/iu.test(text)&&dimensions.length===1;
    const blocking=parsed.issues.filter(i=>i.code!=='uncertain_dimensions'&&!(i.code==='missing_quantity'&&(grouped||singular)));
    const partial=/gesamt/iu.test(text)&&/lediglich|nur|eine\s+Doppelfenster-Seite|Teilfläche/iu.test(text);
    const proposalOnly=blocking.every(i=>['missing_quantity','negation_or_correction'].includes(i.code));
    if(proposalOnly)for(const m of dimensions)rows.push({label:partial?'Gesamte Fensterfront · gewünschte Teilfläche offen':m.type==='window'?'Fenster':'Tür / Plissee',type:m.type,quantity:blocking.some(i=>i.code==='missing_quantity')?null:m.quantity,confirmationRequired:partial||blocking.length>0,variants:[{basis:'unspecified',width:cm(String(m.width),m.widthUnit!),height:cm(String(m.height),m.heightUnit!)}]});
    if(blocking.length||partial)warnings.push(partial?'Die genannten Masse beschreiben die gesamte Fensterfront. Der Kunde möchte nur eine Seite schützen. Die gewünschte Teilfläche muss vor dem Gesamtpreis bestätigt werden.':'Die Zuordnung oder Stückzahl ist nicht eindeutig. Erkannte Masse sind vorbereitet; bitte die markierte Zuordnung bestätigen.');
    if(!rows.length)warnings.push('Die Masse konnten nicht vollständig zugeordnet werden. Bitte die Angaben in der Anfrage prüfen.');
  }
  if(/±|ungefähr|\bca\.?\s|circa|ohne Gewähr/iu.test(text))warnings.push('Der Kunde nennt ungefähre Masse. Kontrollmessung vor der Fertigung erforderlich.');
  if(/variante|öffnungsfähig|oeffnungsfaehig/iu.test(text))warnings.push('Der Kunde wünscht Systemvarianten. Der Rechner verwendet den Standardtarif für Fenster bzw. Tür / Plissee; ein besonderer Systempreis ist damit nicht bestätigt.');
  if(rows.some(r=>!r.type))warnings.push('Fenster oder Tür ist nicht bei jedem Element angegeben. Bitte die markierte Elementart auswählen.');
  if(rows.some(r=>!r.variants.length))warnings.push('Nicht für alle Elemente ist ein eindeutiges Paar aus Breite und Höhe vorhanden.');
  return {rows,warnings};
}

export async function readRequestMeasurements(text:string,postalCode='',contacts:Record<string,string>={},options:{useAI?:boolean;client?:any}={}){
  const proposal=proposeRequestMeasurements(text,postalCode);
  if(proposal.rows.length||!/(?:\d\s*(?:cm|mm|m\b)|breite|höhe|hoehe)/iu.test(text))return {...proposal,ai:{status:'not_needed'}};
  if(options.useAI===false)return {...proposal,ai:{status:'disabled_local'}};
  const baseline=parseMeasurements(text,postalCode);
  const refined=await refineMeasurements(text,contacts,baseline,{client:options.client});
  if(refined.ai.status!=='used')return {...proposal,ai:refined.ai};
  const dimensions=refined.extraction.measurements.filter(m=>m.mode==='dimensions');
  return {rows:dimensions.map(m=>({label:m.type==='window'?'Fenster':'Tür / Plissee',type:m.type,quantity:m.quantity,confirmationRequired:refined.extraction.issues.length>0,variants:[{basis:'unspecified',width:cm(String(m.width),m.widthUnit!),height:cm(String(m.height),m.heightUnit!)}]})),warnings:refined.extraction.issues.map(i=>i.question),ai:refined.ai};
}
