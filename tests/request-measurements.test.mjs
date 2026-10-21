import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeRequestMeasurements,readRequestMeasurements} from '../netlify/lib/request-measurements.mts';

const inquiry=`Drei Fliegengitter, Masse ca. ±1 cm ohne Gewähr.
1. Schlafzimmer
* Breite ohne Rahmen: 42,5 cm
* Breite mit Rahmen: 56,5 cm
* Höhe ohne Rahmen: 209 cm
* Höhe mit Rahmen: 223 cm
2. Fenster
* Breite ohne Rahmen: 45 cm
* Breite mit Rahmen: 59 cm
* Höhe ohne Rahmen: 115,5 cm
* Höhe mit Rahmen: 129,5 cm
3. Balkontür
* Breite ohne Rahmen: 67 cm
* Breite mit Rahmen: 81 cm
* Höhe ohne Rahmen: 209 cm
* Höhe mit Rahmen: 223 cm
Bitte zwei Varianten mit und ohne öffnungsfähiges System.`;

test('numbered labelled measurements preserve frame alternatives and never guess a room element type',()=>{
  const result=proposeRequestMeasurements(inquiry);
  assert.equal(result.rows.length,3);
  assert.deepEqual(result.rows.map(r=>r.type),['','window','door']);
  assert.deepEqual(result.rows[0].variants,[{basis:'without_frame',width:42.5,height:209},{basis:'with_frame',width:56.5,height:223}]);
  assert.deepEqual(result.rows[1].variants[0],{basis:'without_frame',width:45,height:115.5});
  assert.deepEqual(result.rows[2].variants[1],{basis:'with_frame',width:81,height:223});
  assert.ok(result.warnings.some(w=>w.includes('ungefähre')));
  assert.ok(result.warnings.some(w=>w.includes('Systemvarianten')));
  assert.ok(result.warnings.some(w=>w.includes('Elementart')));
});

test('ordinary compact measurements use existing validated parser; missing units and counts are not invented',()=>{
  const result=proposeRequestMeasurements('2 Fenster 1200 x 1400 mm, 1 Tür 0,9 x 2,1 m','9000');
  assert.equal(result.rows.length,2);
  assert.deepEqual(result.rows[0].variants,[{basis:'unspecified',width:120,height:140}]);
  assert.deepEqual(result.rows[1].variants,[{basis:'unspecified',width:90,height:210}]);
  assert.equal(proposeRequestMeasurements('Fenster 120 x 140').rows.length,0);
  assert.equal(proposeRequestMeasurements('Fenster 120 x 140 cm').rows[0].quantity,null);
});

test('conflicting or incomplete labelled dimensions do not become a priceable pair',()=>{
  for(const text of ['1. Fenster\nBreite: 100 cm\nBreite: 110 cm\nHöhe: 120 cm','1. Fenster\nBreite ohne Rahmen: 100 cm\nHöhe mit Rahmen: 120 cm']){
    const result=proposeRequestMeasurements(text);
    assert.equal(result.rows.length,1);assert.deepEqual(result.rows[0].variants,[]);
  }
});

test('two different door sizes in a prose inquiry become one door per dimension line',()=>{
  const result=proposeRequestMeasurements('Die beiden Türen haben folgende Masse\n115cm x 205cm\n105cm x 205 cm\nInklusive Montage?');
  assert.equal(result.rows.length,2);assert.deepEqual(result.rows.map(r=>[r.type,r.quantity,r.variants[0].width,r.variants[0].height]),[['door',1,115,205],['door',1,105,205]]);
  assert.ok(result.rows.every(r=>!r.confirmationRequired));
});

test('a whole double window measurement is preserved but never silently halved for a one-side request',()=>{
  const result=proposeRequestMeasurements('Für ein Doppelfenster. Die Fensterfront hat eine Gesamtgrösse von ca. 216 × 199 cm. Lediglich die eine Doppelfenster-Seite schützen, nicht eine Tür.');
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].type,'window');assert.equal(result.rows[0].confirmationRequired,true);assert.deepEqual(result.rows[0].variants,[{basis:'unspecified',width:216,height:199}]);assert.ok(result.warnings.some(w=>w.includes('Teilfläche')));
});

test('free prose uses evidence-checked AI fallback; local mode makes no provider call and contact data is removed',async()=>{
  let calls=0,request;
  const source='2 Fenster, Breite 120 cm, Höhe 140 cm';
  const raw='Private Person private@example.invalid\n'+source;
  const client={responses:{create:async p=>{calls++;request=p;return {status:'completed',id:'mock',output_text:JSON.stringify({measurements:[{type:'window',quantity:2,width:120,height:140,widthUnit:'cm',heightUnit:'cm',source}]})};}}};
  const local=await readRequestMeasurements(raw,'9000',{}, {useAI:false,client});assert.equal(calls,0);assert.equal(local.ai.status,'disabled_local');
  const result=await readRequestMeasurements(raw,'9000',{name:'Private Person',email:'private@example.invalid'},{useAI:true,client});assert.equal(calls,1);assert.equal(result.ai.status,'used');assert.equal(result.rows[0].quantity,2);assert.deepEqual(result.rows[0].variants,[{basis:'unspecified',width:120,height:140}]);assert.doesNotMatch(JSON.stringify(request.input),/Private Person|private@example/);
});
