import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMeasurements,calculatorMeasurements,validateAIExtraction,redactMeasurementText} from '../netlify/lib/measurement-intake.mts';
import {priceExtraction} from '../netlify/lib/quote-pricing.mts';
import {DEFAULT_OFFER} from '../netlify/lib/projects-store.mts';
import {renderQuoteEmail} from '../netlify/lib/quote-email.mts';
import {refineMeasurements} from '../netlify/lib/measurement-ai.mts';

const offer={...DEFAULT_OFFER,active:true,percent:15};
for(const [message,areas]of [
  ['2 Fenster 120 x 140 cm, 1 Tür 90 x 210 cm',[3.36,1.89]],
  ['2 Fenster 1200 x 1400 mm; 1 Tür 900 x 2100 mm',[3.36,1.89]],
  ['2 Fenster 1,2 x 1,4 m, 1 Tür 0,9 x 2,1 m',[3.36,1.89]],
  ['2 Fenster 120 cm x 1,4 m, 1 Tür 90 cm x 2,1 m',[3.36,1.89]],
  ['Fenster 2 × 120 × 140 cm; Tür 90 × 210 cm',[3.36,1.89]],
  ['Fenster 3,36 m²; Türen 1,89 m²',[3.36,1.89]],
  ['3,36 m² Fenster; 1,89 m² Türen',[3.36,1.89]],
])test(`measurement units and quantities: ${message}`,()=>{
  const e=parseMeasurements(message,'9000');
  assert.deepEqual(e.issues,[]);
  assert.equal(e.measurements.filter(m=>m.type==='window').reduce((n,m)=>n+m.areaM2,0),areas[0]);
  assert.equal(e.measurements.filter(m=>m.type==='door').reduce((n,m)=>n+m.areaM2,0),areas[1]);
  const p=priceExtraction(e,'kontakt',offer);
  assert.equal(p.status,'priced');assert.equal(p.quote.totalCHF,1026);
  assert.deepEqual(p.quote.rates,{fenster:186,tueren:212});
});
for(const message of [
  '2 Fenster 120 x 140',
  '2 Fenster 120 x 140 cm oder 100 x 100 cm',
  '2 Fenster 120 x 140 cm, insgesamt 2 m²',
  '2 Fenster 3 m²',
  '2 Fenster 120 x 140 cm und 80 x 100 cm',
  '120 x 140 cm',
  '2 Fenster 0 x 140 cm',
  '2 Fenster 120 x 140 cm statt 100 x 100 cm',
  '2 Fenster 120 x 140 cm, 3 m² Fenster',
  '2 Fenster 120 x 140 cm, Anzahl 3',
  '2 Fenster 120 x 140 cm, aber nur eins',
  '2 Fenster -120 x 140 cm',
  '2 Fenster 1e3 x 140 cm',
])test(`ambiguous inputs do not become a fixed quote: ${message}`,()=>{
  const e=parseMeasurements(message,'9000');assert.ok(e.issues.length);
  assert.equal(priceExtraction(e,'kontakt',offer).quote,null);
});
test('direct totals corroborate dimensions and never double their area',()=>{
  const e=parseMeasurements('2 Fenster 120 x 140 cm, insgesamt 3,36 m²','9000');
  assert.deepEqual(e.issues,[]);assert.equal(e.measurements.length,1);assert.equal(e.measurements[0].areaM2,3.36);
});
test('test disclaimer is not a correction of the dimensions; actual corrections remain ambiguous',()=>{
  const message='Funktionstest, keine Bestellung, bitte nicht anrufen. PLZ 9000. 2 Fenster je 120 x 140 cm und 1 Tür 90 x 210 cm.';
  const e=parseMeasurements(message);assert.deepEqual(e.issues,[]);assert.equal(e.postalCode,'9000');assert.equal(priceExtraction(e,'kontakt',offer).quote.totalCHF,1026);
  assert.ok(parseMeasurements('2 Fenster nicht 120 x 140 cm, sondern 100 x 100 cm','9000').issues.some(i=>i.code==='negation_or_correction'));
});
test('pricing uses calculator rounding, discount once and no invented travel charge',()=>{
  const e=calculatorMeasurements({plz:'9000',fensterflaeche_m2:'1',tuerflaeche_m2:'0',berechneter_preis:'CHF 1.–',aktion:'Discount 15%'});
  assert.equal(priceExtraction(e,'angebot',offer).quote.totalCHF,186);
  assert.equal(priceExtraction(e,'angebot',{...offer,active:false}).quote.totalCHF,219);
  const outside=priceExtraction({...e,postalCode:'3000'},'angebot',offer);
  assert.equal(outside.quote,null);assert.equal(outside.estimate.totalCHF,186);assert.equal(outside.estimate.travelCosts.amountCHF,null);
  assert.equal(priceExtraction({...e,postalCode:null},'angebot',offer).quote,null);
  assert.equal(priceExtraction(e,'b2b-anfrage',offer).quote,null);
  assert.equal(priceExtraction(parseMeasurements('20 Fenster 120 x 140 cm','9000'),'kontakt',offer).quote,null);
});
test('conflicting postal codes, special projects, and invalid calculator areas require review',()=>{
  assert.ok(parseMeasurements('2 Fenster 120 x 140 cm, PLZ 8000','9000').issues.length);
  assert.equal(priceExtraction(parseMeasurements('2 runde Fenster 120 x 140 cm','9000'),'kontakt',offer).quote,null);
  assert.ok(calculatorMeasurements({plz:'9000',fensterflaeche_m2:'NaN',tuerflaeche_m2:'0'}).issues.length);
  assert.equal(parseMeasurements('2 Fenster 120 x 140 cm in 9000 St. Gallen').postalCode,'9000');
});
test('AI output is rejected when units/numbers/source/count are unsupported or coverage is incomplete',()=>{
  const text='2 Fenster, Breite 120 cm, Höhe 140 cm';
  const baseline=parseMeasurements(text,'9000');
  const item={type:'window',quantity:2,width:120,height:140,widthUnit:'cm',heightUnit:'cm',source:text};
  const valid=validateAIExtraction({measurements:[item]},text,baseline);assert.deepEqual(valid.issues,[]);assert.equal(valid.measurements[0].areaM2,3.36);
  for(const patch of [{width:130},{widthUnit:'m'},{quantity:3},{source:'invented evidence'}])assert.ok(validateAIExtraction({measurements:[{...item,...patch}]},text,baseline).issues.length);
  assert.ok(validateAIExtraction({measurements:[item,item]},text,baseline).issues.length);
  const longer=text+'; 1 Tür, Breite 90 cm, Höhe 210 cm';
  assert.ok(validateAIExtraction({measurements:[item]},longer,parseMeasurements(longer,'9000')).issues.some(i=>i.code==='ai_omitted_measurement'));
});
test('AI request uses structured schema and redacts supplied contact details; failed AI cannot invent a quote',async()=>{
  const contacts={name:'Private Name',email:'private@example.test',telefon:'+41 76 111 22 33'};
  const raw='Private Name private@example.test +41 76 111 22 33\n2 Fenster, Breite 120 cm, Höhe 140 cm';
  const safe=redactMeasurementText(raw,contacts);assert.doesNotMatch(safe,/Private Name|private@example|111 22/);
  const minimal=redactMeasurementText('Hallo, ich bin Max. Ich benötige 2 Fenster, Breite 120 cm, Höhe 140 cm. Grüsse Max Müller.');
  assert.equal(minimal,'2 Fenster, Breite 120 cm, Höhe 140 cm');
  let params;
  const client={responses:{create:async p=>{params=p;return {id:'local-mock-only',status:'completed',output_text:JSON.stringify({measurements:[{type:'window',quantity:2,width:120,height:140,widthUnit:'cm',heightUnit:'cm',source:'2 Fenster, Breite 120 cm, Höhe 140 cm'}]})};}}};
  const result=await refineMeasurements(raw,contacts,parseMeasurements(raw,'9000'),{client});
  assert.equal(result.ai.status,'used');assert.equal(params.text.format.strict,true);assert.equal(params.store,false);assert.doesNotMatch(JSON.stringify(params.input),/Private Name|private@example|111 22/);
  const failed=await refineMeasurements('2 Fenster 120 x 140',{},parseMeasurements('2 Fenster 120 x 140','9000'),{force:true,client:{responses:{create:async()=>{throw new Error('offline');}}}});
  assert.equal(failed.ai.status,'failed');assert.equal(priceExtraction(failed.extraction,'kontakt',offer).quote,null);
});
test('professional offer is stable, escaped, itemized, and does not duplicate discount or promise a PDF',()=>{
  const e=parseMeasurements('2 Fenster 120 x 140 cm, 1 Tür 90 x 210 cm','9000');const p=priceExtraction(e,'kontakt',offer);
  const s={...p,quote:p.quote,measurements:e.measurements,clarification:[],processedAt:'2026-10-21T01:00:00Z',postalCode:'9000',customer:{name:'TEST <script>alert(1)</script>',email:'test@example.invalid'}};
  const first=renderQuoteEmail(s,'GTT-12345678abcdef',4),again=renderQuoteEmail(s,'GTT-12345678abcdef',4);
  assert.equal(first.reference,'GTT-12345678-004');assert.deepEqual(first,again);assert.match(first.html,/Einzelpreis/);assert.match(first.html,/Gesamtbetrag/);assert.match(first.html,/bereits in den gerundeten Einheitspreisen berücksichtigt/);assert.match(first.html,/Rundung/);assert.doesNotMatch(first.html,/<script>|PDF|gültig bis|MwSt/);assert.match(first.html,/&lt;script&gt;/);assert.match(first.html,/@media\(max-width:480px\)/);
});
