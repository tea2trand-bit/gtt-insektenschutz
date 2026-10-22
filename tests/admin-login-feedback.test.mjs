import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext,Script} from 'node:vm';

const html=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
const source=html.split('// -------------------------------------------------------------- auth ----')[1].split('// ------------------------------------------------- media preparation ----')[0];
function setup(api){
  const nodes=new Map(),timers=new Map(),stored=new Map(),events=[];
  const get=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:id==='#appView',value:id==='#pw'?'test-only-password':'',textContent:'',disabled:false,readOnly:false,attrs:{},handlers:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this.handlers[k]=v;},replaceChildren(...children){this.children=children;},focus(){this.focused=true;}});
    return nodes.get(id);
  };
  const context={$:get,api,token:null,AbortController,TypeError,Event,el:(tag,attrs,text)=>({tag,attrs,text}),loadItems(){},loadOffer(){},window:{dispatchEvent:event=>events.push(event.type)},sessionStorage:{setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},setTimeout:(fn,ms)=>{timers.set(ms,fn);return ms;},clearTimeout:id=>timers.delete(id)};
  runInNewContext(source,context);
  return {get,timers,stored,events,submit:()=>get('#loginForm').handlers.submit({preventDefault(){}})};
}

test('admin inline script parses',()=>{
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new Script(match[1]);
});
test('pending login shows feedback immediately and ignores repeated submission; failure allows retry',async()=>{
  let reject,calls=0;
  const ui=setup(()=>{calls++;return new Promise((_,fail)=>{reject=fail;});});
  const pending=ui.submit();
  assert.equal(ui.get('#loginBtn').disabled,true);
  assert.equal(ui.get('#loginBtn').attrs['aria-busy'],'true');
  assert.equal(ui.get('#loginBtn').textContent,'Anmeldung läuft…');
  await ui.submit();assert.equal(calls,1);
  ui.timers.get(8000)();assert.match(ui.get('#loginStatus').textContent,/länger/);
  reject(new Error('Falsches Passwort'));await pending;
  assert.equal(ui.get('#loginBtn').disabled,false);
  assert.equal(ui.get('#pw').readOnly,false);
  assert.equal(ui.get('#loginErr').hidden,false);
  assert.match(ui.get('#loginErr').textContent,/Falsches Passwort/);
  assert.equal(ui.timers.size,0);
});
test('successful login clears password and shows a loading message until inquiry data arrives',async()=>{
  const ui=setup(async()=>({token:'test-only-session'}));await ui.submit();
  assert.equal(ui.get('#pw').value,'');assert.equal(ui.get('#loginView').hidden,true);
  assert.equal(ui.get('#appView').hidden,false);
  assert.equal(ui.stored.get('gttAdminToken'),'test-only-session');
  assert.deepEqual(ui.events,['gtt:admin-login']);
  assert.match(ui.get('#recordsRoot').children[0].text,/Anfragen werden geladen/);
  assert.equal(ui.timers.size,0);
});
test('a stalled login times out and unlocks the form without accepting a late session',async()=>{
  const ui=setup((_,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('aborted')))));
  const pending=ui.submit();ui.timers.get(30000)();await pending;
  assert.match(ui.get('#loginErr').textContent,/dauert zu lange/);
  assert.equal(ui.get('#loginBtn').disabled,false);assert.equal(ui.get('#loginView').hidden,false);
  assert.equal(ui.stored.size,0);assert.equal(ui.timers.size,0);
});
