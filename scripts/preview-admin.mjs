import { createServer } from 'node:http';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { recordsAPI } from '../netlify/lib/records-api.mts';
import { createRecord, fromSubmission, RecordError } from '../netlify/lib/records.mts';
import { checkPassword, issueToken, verifyRequest } from '../netlify/lib/projects-store.mts';
import { recordSubmission } from '../netlify/functions/records-event.mts';
import { validateSubmission } from '../netlify/edge-functions/validate-form-submission.js';

const root=path.resolve(import.meta.dirname,'..');
await mkdir(path.join(root,'.local-records'),{recursive:true});
const db=await PGlite.create({dataDir:path.join(root,'.local-records/db')});
await db.exec('CREATE TABLE IF NOT EXISTS gtt_local_migrations(name text PRIMARY KEY)');
const migrationDir=path.join(root,'netlify/database/migrations');
for(const name of (await readdir(migrationDir)).filter(n=>n.endsWith('.sql')).sort()){
  if((await db.query('SELECT name FROM gtt_local_migrations WHERE name=$1',[name])).rows.length)continue;
  const baseline={'20261021010000_admin_records.sql':'gtt_records','20261021014500_pending_history.sql':'gtt_pending_inquiries'}[name];
  if(baseline&&(await db.query('SELECT to_regclass($1) AS name',['public.'+baseline])).rows[0].name){await db.query('INSERT INTO gtt_local_migrations(name) VALUES($1)',[name]);continue;}
  await db.transaction(async tx=>{await tx.exec(await readFile(path.join(migrationDir,name),'utf8'));await tx.query('INSERT INTO gtt_local_migrations(name) VALUES($1)',[name]);});
}
for(const [key,form,name,company,price]of [['private','angebot','TEST · Demo kupac','','CHF 186.–'],['business','b2b-anfrage','TEST · Demo firma','TEST Firma AG',''],['contact','kontakt','TEST · Demo kontakt','','']]){
  await createRecord(db,fromSubmission({inquiry_id:'preview-'+key,record_source:form,name,firma:company,email:'test@example.invalid',telefon:'+41 00 000 00 00',plz:'9000',fensterflaeche_m2:'1',tuerflaeche_m2:'0',berechneter_preis:price,aktion:price?'Herbst-/Winteraktion −15% (regulär CHF 219.–)':'',nachricht:'TEST · Lokalni primer za pregled. Nije narudžbina.'}));
}
// Credentials apply only to loopback. Never read or copy production secrets.
process.env.ADMIN_PASSWORD='gtt-demo-local';
process.env.ADMIN_TOKEN_SECRET='local-preview-only';
let offer={active:true,name:'Herbst-/Winteraktion',percent:15,fenster:true,tueren:true,validFrom:'2026-09-30',validUntil:'2027-02-28',text:''};
const json=(d,s=200)=>Response.json(d,{status:s,headers:{'Cache-Control':'no-store'}});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
async function handle(req){
  const url=new URL(req.url);
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
    if(route==='records'||route.startsWith('records/'))return recordsAPI(req,db,route.split('/').slice(1));
    // Existing gallery/offer are represented by isolated preview fixtures.
    if(route==='items')return json({items:[]});
    if(route==='offer'){if(req.method==='PUT')offer=await req.json();return json({offer,today:new Date().toISOString().slice(0,10),current:offer.active});}
    return json({error:'Galerija se u ovom lokalnom pregledu ne objavljuje.'},400);
  }
  if(req.method!=='GET')return new Response('Method not allowed',{status:405});
  const filePath=url.pathname==='/admin'||url.pathname==='/admin/'?'/admin.html':url.pathname==='/'?'/index.html':url.pathname;
  const file=path.resolve(root,'.'+decodeURIComponent(filePath));
  if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.jpg','.webp','.jpeg','.ico'].includes(path.extname(file))||file.includes(path.sep+'node_modules'+path.sep)||file.includes(path.sep+'netlify'+path.sep))return new Response('Not found',{status:404});
  try{return new Response(await readFile(file),{headers:{'Content-Type':types[path.extname(file)]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}
}
const server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const request=new Request('http://127.0.0.1:4400'+req.url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});const response=await handle(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(err){res.writeHead(err instanceof RecordError?err.status:500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:err.message}));}});
server.listen(4400,'127.0.0.1',()=>console.log('Lokalni admin: http://127.0.0.1:4400/admin · lozinka: gtt-demo-local · PGlite čuva test podatke na disku.'));
async function stop(){server.close();await db.close();process.exit(0);}process.on('SIGINT',stop);process.on('SIGTERM',stop);
