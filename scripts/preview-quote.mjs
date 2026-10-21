import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createRecord,fromSubmission,readRecord} from '../netlify/lib/records.mts';
import {processQuoteIntake} from '../netlify/lib/quote-intake.mts';
import {DEFAULT_OFFER} from '../netlify/lib/projects-store.mts';

const db=await PGlite.create();
for(const file of ['20261021010000_admin_records.sql','20261021014500_pending_history.sql','20261021021000_quote_intake.sql'])await db.exec(await readFile(new URL('../netlify/database/migrations/'+file,import.meta.url),'utf8'));
const offer={...DEFAULT_OFFER,active:true,percent:15};
const cases={
  standard:{record_source:'kontakt',plz:'9000',nachricht:'Funktionstest, keine Bestellung, bitte nicht anrufen. PLZ 9000. 2 Fenster je 120 x 140 cm und 1 Tür 90 x 210 cm.'},
  missing:{record_source:'kontakt',plz:'9000',nachricht:'2 Fenster 120 x 140, 1 Tür 90 x 210 cm'},
  outside:{record_source:'kontakt',plz:'3000',nachricht:'2 Fenster 120 x 140 cm, 1 Tür 90 x 210 cm'},
  b2b:{record_source:'b2b-anfrage',plz:'9000',nachricht:'25 Fenster 120 x 140 cm'},
};
const results={};
for(const [key,fields]of Object.entries(cases)){
  const data={...fields,inquiry_id:'local-quote-demo-'+key,name:'TEST – Demo Familie mit einem langen Namen für die mobile Ansicht',email:'test@example.invalid',telefon:'+41 00 000 00 00'};
  const input=fromSubmission(data);await createRecord(db,input);
  const intake=await processQuoteIntake(db,input.id,data,{deploy:{context:'deploy-preview'}},{mode:'preview',offer,useAI:false});
  const again=await processQuoteIntake(db,input.id,data,{deploy:{context:'deploy-preview'}},{mode:'preview',offer,useAI:false});
  const record=await readRecord(db,input.id);
  results[key]={recordId:input.id,intake,repeatVersion:again.version,historyLength:record.history.length,contractStatus:record.document.status,agreedPrice:record.document.agreedPrice};
}
await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
await writeFile(new URL('../test-results/quote-intake-preview.json',import.meta.url),JSON.stringify(results,null,2));
await writeFile(new URL('../test-results/offer-preview.html',import.meta.url),results.standard.intake.emailPreview.html);
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:4401');
  if(url.pathname==='/cases'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(results));return;}
  const key=url.searchParams.get('case')||'standard';
  if(!results[key]){res.writeHead(404);res.end();return;}
  const banner='<div style="background:#fff1cd;padding:10px 14px;font:13px Arial;color:#5c4915">TEST · Lokalni pregled · imejl nije poslat · <a href="?case=standard">Ponuda</a> · <a href="?case=missing">Dopuna</a> · <a href="?case=outside">Van regiona</a> · <a href="?case=b2b">B2B</a></div>';
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(results[key].intake.emailPreview.html.replace('<body>','<body>'+banner));
});
server.listen(4401,'127.0.0.1',()=>console.log('TEST ponuda: http://127.0.0.1:4401/offer · /cases za rezultat kartona, obračuna i deduplikacije. Bez stvarnog slanja.'));
async function stop(){server.close();await db.close();process.exit(0);}process.on('SIGINT',stop);process.on('SIGTERM',stop);
