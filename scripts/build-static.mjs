import {mkdir,copyFile,cp,readdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'dist');
if(path.relative(root,out)!=='dist')throw Error('Publish directory must stay inside this project');
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
// Explicit allowlist: server code, local data, tools and tests never publish.
for(const item of await readdir(root,{withFileTypes:true})){
  if(item.isFile()&&(/\.(html|css|js)$/.test(item.name)||['_redirects','robots.txt','sitemap.xml'].includes(item.name)))await copyFile(path.join(root,item.name),path.join(out,item.name));
}
await cp(path.join(root,'assets'),path.join(out,'assets'),{recursive:true});
if(process.env.CONTEXT==='deploy-preview'){
  // A separate preview-only Netlify form avoids the production email handler
  // and existing notification rules when verifying signed platform events.
  await writeFile(path.join(out,'records-preview-probe.html'),`<!doctype html><html lang="sr-Latn"><meta name="robots" content="noindex"><title>TEST · Admin ulaz</title><body><h1>TEST · Provera ulaza u preview evidenciju</h1><p>Samo test podaci. Nije narudžbina i ne šalje ponudu.</p><form name="records-preview-probe" method="POST" data-netlify="true"><input type="hidden" name="form-name" value="records-preview-probe"><input type="hidden" name="record_source" value="kontakt"><input type="hidden" name="inquiry_id" value=""><label>Ime <input name="name" value="TEST · Preview ulaz"></label><label>Opis <textarea name="nachricht">TEST · Provera potpisanog događaja. Nije narudžbina.</textarea></label><button>Pošalji test u preview</button></form><script>document.querySelector('[name=inquiry_id]').value=crypto.randomUUID();</script></body></html>`);
}
console.log('Static site prepared in dist/');
