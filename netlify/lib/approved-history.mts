import {createHash} from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {createRecord,fromSubmission,type QueryDB} from './records.mts';

export const HISTORY_IMPORT_KEY='approved-history-20261021-v2';
const env=(key:string)=>(globalThis as any).Netlify?.env?.get(key)??process.env[key];
const forms=new Set(['angebot','angebot-netlify-fallback','b2b-anfrage','kontakt']);
export function historyInputs(bundle:any){
  if(bundle?.version!==2||bundle.scope!=='all_inquiries'||!Array.isArray(bundle.submissions)||!Number.isInteger(bundle.expectedCount)||bundle.expectedCount<1||bundle.expectedCount>1000||bundle.submissions.length!==bundle.expectedCount)throw Error('Approved history manifest is invalid');
  const seen=new Set<string>();
  const convert=(row:any)=>{
    if(!/^[a-f0-9]{24}$/.test(row.id||'')||seen.has(row.id)||!forms.has(row.form_name)||!Number.isFinite(Date.parse(row.created_at)))throw Error('Approved history source identity is invalid');
    seen.add(row.id);
    return fromSubmission(row.data||{},{id:row.id,form:row.form_name,at:row.created_at})!;
  };
  return bundle.submissions.map(convert);
}

/** Immutable private import file, not a database or an alternate admin login.
 * Triggered only from the signed production platform event; all operational
 * writes/history/receipts live in Postgres and are idempotent by source ID.
 */
export async function importApprovedHistory(db:QueryDB,context:any,readSource?:()=>Promise<string|null>){
  const ctx=context?.deploy?.context||env('GTT_RUNTIME_CONTEXT')||env('CONTEXT');
  const pin=env('GTT_HISTORY_IMPORT_SHA256');
  if(ctx!=='production'||!pin)return null;
  const old=(await db.query('SELECT receipt FROM gtt_admin_import_jobs WHERE id=$1',[HISTORY_IMPORT_KEY])).rows[0];
  if(old)return old.receipt;
  const raw=readSource?await readSource():await getStore({name:'gtt-admin-imports',consistency:'strong'}).get(HISTORY_IMPORT_KEY);
  if(!raw||createHash('sha256').update(raw).digest('hex')!==pin)throw Error('Approved history source checksum does not match');
  const inputs=historyInputs(JSON.parse(raw));
  // Import directly as inquiries: never re-run extraction, send old offers,
  // accept a job, or overwrite an existing record's decisions and history.
  for(const input of inputs)await createRecord(db,input,'Odobren uvoz svih ranijih Netlify upita');
  const recordIds=inputs.map((x:any)=>x.id);
  const imported=(await db.query('SELECT count(*)::int AS n FROM gtt_records WHERE id=ANY($1::text[])',[recordIds])).rows[0].n;
  if(imported!==inputs.length)throw Error('Approved history import is incomplete');
  const dates=inputs.map((x:any)=>new Date(x.original.receivedAt).toISOString()).sort();
  const receipt={imported,tests:inputs.filter((x:any)=>x.document.isTest).length,pendingReview:0,recordIds,sourceSha256:pin,earliest:dates[0],latest:dates.at(-1),scope:'all_inquiries'};
  await db.query('INSERT INTO gtt_admin_import_jobs(id,source_sha256,receipt) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO NOTHING',[HISTORY_IMPORT_KEY,pin,JSON.stringify(receipt)]);
  return receipt;
}
