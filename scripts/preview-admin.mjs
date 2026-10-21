import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat, chmod } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { recordsAPI } from '../netlify/lib/records-api.mts';
import { createRecord, fromSubmission, RecordError } from '../netlify/lib/records.mts';
import { checkPassword, issueToken, verifyRequest } from '../netlify/lib/projects-store.mts';
import { recordSubmission } from '../netlify/functions/records-event.mts';
import {handleOfferAcceptance} from '../netlify/functions/offer-acceptance.mts';
import {recordMessageDE} from '../netlify/lib/record-messages-de.mts';
import { validateSubmission } from '../netlify/edge-functions/validate-form-submission.js';
import {exportAdminSnapshot,importAdminSnapshot} from './admin-snapshot.mjs';
import {publicComplaintAPI,complaintsAdminAPI} from '../netlify/lib/complaints.mts';

const root=path.resolve(import.meta.dirname,'..');
const port=Number(process.env.GTT_PREVIEW_PORT||4400);
const seedExamples=process.env.GTT_PREVIEW_SEED==='1';
await mkdir(path.join(root,'.local-records'),{recursive:true});
const dbPath=path.resolve(root,process.env.GTT_PREVIEW_DB_DIR||'.local-records/db');
// Windows can restore the ReadOnly attribute on synced folders. Node can still
// write them, but the WASM filesystem interprets that attribute as POSIX mode 444.
// Correct only directories belonging to this local DB; never alter data files.
async function writableWindowsDirectories(directory){
  let info;try{info=await stat(directory);}catch(err){if(err.code==='ENOENT')return;throw err;}
  if(!info.isDirectory())return;
  if(!(info.mode&0o200))await chmod(directory,0o700);
  for(const entry of await readdir(directory,{withFileTypes:true}))if(entry.isDirectory()&&!entry.isSymbolicLink())await writableWindowsDirectories(path.join(directory,entry.name));
}
if(process.platform==='win32')await writableWindowsDirectories(dbPath);
const db=await PGlite.create({dataDir:dbPath});
await db.exec('CREATE TABLE IF NOT EXISTS gtt_local_migrations(name text PRIMARY KEY)');
const migrationDir=path.join(root,'netlify/database/migrations');
for(const name of (await readdir(migrationDir)).filter(n=>n.endsWith('.sql')).sort()){
  if((await db.query('SELECT name FROM gtt_local_migrations WHERE name=$1',[name])).rows.length)continue;
  const baseline={'20261021010000_admin_records.sql':'gtt_records','20261021014500_pending_history.sql':'gtt_pending_inquiries'}[name];
  if(baseline&&(await db.query('SELECT to_regclass($1) AS name',['public.'+baseline])).rows[0].name){await db.query('INSERT INTO gtt_local_migrations(name) VALUES($1)',[name]);continue;}
  await db.transaction(async tx=>{await tx.exec(await readFile(path.join(migrationDir,name),'utf8'));await tx.query('INSERT INTO gtt_local_migrations(name) VALUES($1)',[name]);});
}
if(seedExamples)for(const [key,form,name,company,price]of [['private','angebot','TEST · Demo kupac','','CHF 186.–'],['business','b2b-anfrage','TEST · Demo firma','TEST Firma AG',''],['contact','kontakt','TEST · Demo kontakt','','']]){
  await createRecord(db,fromSubmission({inquiry_id:'preview-'+key,record_source:form,name,firma:company,email:'test@example.invalid',telefon:'+41 00 000 00 00',plz:'9000',fensterflaeche_m2:'1',tuerflaeche_m2:'0',berechneter_preis:price,aktion:price?'Herbst-/Winteraktion −15% (regulär CHF 219.–)':'',nachricht:'TEST · Lokalni primer za pregled. Nije narudžbina.'}));
}
// Credentials apply only to loopback. Never read or copy production secrets.
process.env.ADMIN_PASSWORD='gtt-demo-local';
process.env.ADMIN_TOKEN_SECRET='local-preview-only';
process.env.GTT_OFFER_ACCEPTANCE_SECRET='local-preview-only-offer-confirmation-secret';
let offer={active:true,name:'Herbst-/Winteraktion',percent:15,fenster:true,tueren:true,validFrom:'2026-09-30',validUntil:'2027-02-28',text:''};
let gallery=[],copying=false;
const copyNonce=crypto.randomUUID();
const snapshotFile=path.join(root,'.local-records/current-admin-snapshot-private.json');
try{
  const snapshot=JSON.parse(await readFile(snapshotFile,'utf8'));
  await db.exec('CREATE TABLE IF NOT EXISTS gtt_local_snapshot_receipt(id boolean PRIMARY KEY DEFAULT true CHECK(id),source_exported_at text NOT NULL)');
  const copied=(await db.query('SELECT id FROM gtt_local_snapshot_receipt')).rows.length;
  if(!copied){
    if(!(await db.query('SELECT count(*)::int AS n FROM gtt_records')).rows[0].n)await importAdminSnapshot(db,snapshot);
    else await db.query('INSERT INTO gtt_local_snapshot_receipt(source_exported_at) VALUES($1)',[snapshot.exportedAt]);
  }
  gallery=snapshot.items||[];offer=snapshot.offer||offer;
}catch(err){if(err.code!=='ENOENT')throw err;}
if(seedExamples)await recordSubmission({record_source:'kontakt',inquiry_id:'preview-automatic-customer-confirmation',name:'TEST · Automatische Anfrage',email:'test@example.invalid',telefon:'+41 00 000 00 00',nachricht:'TEST. Keine Bestellung. PLZ 9000. 2 Fenster je 120 x 140 cm und 1 Tür 90 x 210 cm.'},db,{deploy:{context:'dev'}},{mode:'preview',offer,useAI:false});
const json=(d,s=200)=>Response.json(d,{status:s,headers:{'Cache-Control':'no-store'}});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
async function handle(req){
  const url=new URL(req.url);
  if(url.pathname==='/lokale-kopie'&&req.method==='GET'){
    const admin=await readFile(path.join(root,'admin.html'),'utf8'),style=admin.match(/<style>([\s\S]*?)<\/style>/)[1];
    return new Response('<!doctype html><html lang="de-CH"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lokale Datenkopie | GTT Admin</title><style>'+style+'</style><main class="wrap"><section class="card login"><h1>Produktionsdaten lokal kopieren</h1><p>Die bestehenden Anfragen und ihr aktueller Status werden gelesen und in dieser privaten lokalen Kopie gespeichert. Änderungen im lokalen Admin bleiben lokal.</p><form id="copy"><label>Aktuelles Produktionspasswort<input id="password" type="password" autocomplete="off" required></label><div class="err" id="message" role="status"></div><button class="btn" type="submit">Daten lokal kopieren</button></form><p><a href="/admin">Zurück zum lokalen Admin</a></p><small>Nur Anmeldung und Lesezugriff auf die Produktion. Kein Versand und keine Änderungen an Produktionsdaten. Passwort und Sitzung werden nicht gespeichert.</small></section></main><script>document.getElementById("copy").onsubmit=async e=>{e.preventDefault();const field=document.getElementById("password"),button=e.target.querySelector("button"),message=document.getElementById("message");button.disabled=true;message.textContent="Daten werden gelesen …";try{const pending=fetch("/api/local-copy",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:field.value,nonce:'+JSON.stringify(copyNonce)+'})});field.value="";const response=await pending,data=await response.json();if(!response.ok)throw Error(data.error);location.href="/admin";}catch(err){message.textContent=err.message;button.disabled=false;}};</script></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"connect-src 'self'; form-action 'self'"}});
  }
  if(url.pathname==='/api/local-copy'&&req.method==='POST'){
    const body=await req.json();
    if(req.headers.get('origin')!==url.origin||body.nonce!==copyNonce)return json({error:'Ungültige lokale Anfrage.'},403);
    if(copying)return json({error:'Eine Kopie wird bereits vorbereitet.'},409);
    if((await db.query('SELECT count(*)::int AS n FROM gtt_records')).rows[0].n)return json({error:'Die lokale Kopie enthält bereits Daten. Lokale Änderungen werden nicht überschrieben.'},409);
    copying=true;
    try{const snapshot=await exportAdminSnapshot(body.password);body.password='';const result=await importAdminSnapshot(db,snapshot);await writeFile(snapshotFile,JSON.stringify(snapshot,null,2));gallery=snapshot.items;offer=snapshot.offer||offer;return json(result);}
    catch(err){return json({error:err.message||'Die Daten konnten nicht kopiert werden.'},400);}finally{body.password='';copying=false;}
  }
  if(url.pathname==='/offerte-bestaetigen')return handleOfferAcceptance(req,{deploy:{context:'dev'}},db);
  if(url.pathname==='/api/reklamationen')return publicComplaintAPI(req,db,{useAI:false});
  if(url.pathname==='/'&&req.method==='POST'){
    const values=Object.fromEntries(new URLSearchParams(await req.text()));
    const validation=validateSubmission({...values,formName:values['form-name']});
    if(!validation.protectedForm||Object.keys(validation.errors).length)return json({error:'Neispravni test podaci.'},422);
    if(values['bot-field'])return new Response(null,{status:204});
    await recordSubmission(values,db,{deploy:{context:'dev'}},{mode:'preview',offer,useAI:false});
    return json({ok:true,localTest:true});
  }
  if(url.pathname.startsWith('/api/admin/')){
    const route=url.pathname.slice('/api/admin/'.length);
    if(route==='login'&&req.method==='POST'){const d=await req.json();return checkPassword(d.password)?json({token:issueToken()}):json({error:'Pogrešna lozinka.'},401);}
    if(!verifyRequest(req))return json({error:'Prijavi se.'},401);
    if(route==='complaints'||route.startsWith('complaints/'))return complaintsAdminAPI(req,db,route.split('/').slice(1));
    if(route==='records'||route.startsWith('records/'))return recordsAPI(req,db,route.split('/').slice(1),{offer});
    // Existing gallery/offer are represented by isolated preview fixtures.
    if(route==='items')return json({items:gallery});
    if(route==='offer'){if(req.method==='PUT')offer=await req.json();return json({offer,today:new Date().toISOString().slice(0,10),current:offer.active});}
    return json({error:'Galerija se u ovom lokalnom pregledu ne objavljuje.'},400);
  }
  if(req.method!=='GET')return new Response('Method not allowed',{status:405});
  const filePath=url.pathname==='/admin'||url.pathname==='/admin/'?'/admin.html':url.pathname==='/reklamation'?'/reklamation.html':url.pathname==='/'?'/index.html':url.pathname;
  const file=path.resolve(root,'.'+decodeURIComponent(filePath));
  if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.jpg','.webp','.jpeg','.ico'].includes(path.extname(file))||['node_modules','netlify','.local-records','test-results','.git'].some(folder=>file.includes(path.sep+folder+path.sep)))return new Response('Not found',{status:404});
  try{
    let content=await readFile(file);
    if(filePath==='/admin.html'&&process.env.GTT_PREVIEW_AUTO_LOGIN==='1')content=Buffer.from(content.toString().replace('</head>','<script>sessionStorage.setItem("gttAdminToken",'+JSON.stringify(issueToken())+');</script></head>'));
    return new Response(content,{headers:{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Security-Policy':"connect-src 'self'; form-action 'self'"}});
  }catch{return new Response('Not found',{status:404});}
}
const server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const request=new Request('http://localhost:'+port+req.url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});const response=await handle(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(err){res.writeHead(err instanceof RecordError?err.status:500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:err instanceof RecordError?recordMessageDE(err.message):"Die Anfrage konnte nicht verarbeitet werden."}));}});
server.listen(port,'127.0.0.1',()=>console.log('Lokalni admin: http://localhost:'+port+'/admin · samo lokalna baza · primeri: '+(seedExamples?'da':'ne')));
async function stop(){server.close();await db.close();process.exit(0);}process.on('SIGINT',stop);process.on('SIGTERM',stop);
