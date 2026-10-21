import {readFile} from 'node:fs/promises';
const origin='http://127.0.0.1:4400';
const login=await fetch(origin+'/api/admin/login',{method:'POST',body:JSON.stringify({password:'gtt-demo-local'})});
const {token}=await login.json();if(!token)throw Error('Lokalna prijava nije uspela.');
async function post(route,submissions){const r=await fetch(origin+'/api/admin/records/'+route,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({submissions})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}
const tests=JSON.parse(await readFile(new URL('../.local-records/historical-tests-private.json',import.meta.url),'utf8'));
const others=JSON.parse(await readFile(new URL('../.local-records/historical-review-private.json',import.meta.url),'utf8'));
if(tests.length!==3||!tests.every(x=>/^TEST(?: [23])? [–-] I Trajkovic$/.test(x.data.name)))throw Error('Lista testova nije potvrđena.');
console.log(JSON.stringify({tests:await post('import',tests),privateReview:await post('pending',others)}));
