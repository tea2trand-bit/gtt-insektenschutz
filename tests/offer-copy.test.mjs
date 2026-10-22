import test from 'node:test';
import assert from 'node:assert/strict';
import '../offer-copy.js';
import {currentOffer,DEFAULT_OFFER} from '../netlify/lib/projects-store.mts';
const copy=globalThis.gttOfferCopy;
const offer={...DEFAULT_OFFER,active:true,percent:20,text:'Jetzt im Herbst bestellen – 15% Rabatt, Montage vor dem nächsten Frühling'};
test('changing a saved promotion from 15 to 20 shows the configured percentage only once and calculates matching rates',()=>{
  const active=currentOffer(offer),view=copy(active);
  assert.equal(view.label,'Herbst-/Winteraktion −20%');
  assert.equal(view.detail,'Jetzt im Herbst bestellen – Montage vor dem nächsten Frühling');
  assert.equal((view.label+' '+view.detail).match(/%/g).length,1);
  assert.deepEqual(active.rates,{fenster:175,tueren:199});
  assert.equal(offer.text,'Jetzt im Herbst bestellen – 15% Rabatt, Montage vor dem nächsten Frühling');
  assert.equal(copy({...offer,percent:25}).label,'Herbst-/Winteraktion −25%');
});
test('free text without discounts is preserved and percent-only descriptions fall back to scope and validity',()=>{
  assert.equal(copy({...offer,text:'Montage vor dem Frühling'}).detail,'Montage vor dem Frühling');
  assert.equal(copy({...offer,tueren:false,text:'Jetzt 15 Prozent sparen!',validUntil:'2027-02-28'}).detail,'Rabatt auf Fenster – gültig bis 28.02.2027');
  assert.equal(copy({...offer,text:'15,5 % Rabatt'}).detail,'Rabatt auf Fenster und Türen');
});
test('legacy percentage in the promotion name cannot produce two advertised discounts',()=>{
  assert.equal(copy({...offer,name:'Winteraktion −15%'}).label,'Winteraktion −20%');
});
