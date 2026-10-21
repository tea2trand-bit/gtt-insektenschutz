import {createHash} from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {createRecord,fromSubmission,type QueryDB} from './records.mts';

export const HISTORY_IMPORT_KEY='approved-history-20261021-v1';
const env=(key:string)=>(globalThis as any).Netlify?.env?.get(key)??process.env[key];
const forms=new Set(['angebot','angebot-netlify-fallback','b2b-anfrage','kontakt']);
export function historyInputs(bundle:any){
  if(bundle?.version!==1||!Array.isArray(bundle.tests)||!Array.isArray(bundle.pending)||bundle.tests.length!==3||bundle.pending.length!==11)throw Error('Approved history manifest is invalid');
  const seen=new Set<string>();
  const convert=(row:any)=>{
    if(!/^[a-f0-9]{24}$/.test(row.id||'')||seen.has(row.id)||!forms.has(row.form_name)||!Number.isFinite(Date.parse(row.created_at)))throw Error('Approved history source identity is invalid');
    seen.add(row.id);
    return fromSubmission(row.data||{},{id:row.id,form:row.form_name,at:row.created_at})!;
  };
  const tests=bundle.tests.map(convert),pending=bundle.pending.map(convert);
  if(!tests.every((r:any)=>r.document.isTest&&r.document.status==='Novi upit'))throw Error('Only explicitly marked tests may create historical operational records');
  return {tests,pending};
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
  const {tests,pending}=historyInputs(JSON.parse(raw));
  for(const input of tests)await createRecord(db,input,'Odobren uvoz ranijih TEST upita');
  for(const input of pending)await db.query('INSERT INTO gtt_pending_inquiries(id,source,received_at,original) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO NOTHING',[input.id,input.source,input.original.receivedAt,JSON.stringify(input.original)]);
  const testIds=tests.map((x:any)=>x.id),pendingIds=pending.map((x:any)=>x.id);
  const a=(await db.query('SELECT count(*)::int AS n FROM gtt_records WHERE id=ANY($1::text[])',[testIds])).rows[0].n;
  const b=(await db.query('SELECT count(*)::int AS n FROM gtt_pending_inquiries WHERE id=ANY($1::text[])',[pendingIds])).rows[0].n;
  if(a!==3||b!==11)throw Error('Approved history import is incomplete');
  const receipt={tests:a,pendingReview:b,recordIds:testIds,pendingIds,sourceSha256:pin};
  await db.query('INSERT INTO gtt_admin_import_jobs(id,source_sha256,receipt) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO NOTHING',[HISTORY_IMPORT_KEY,pin,JSON.stringify(receipt)]);
  return receipt;
}
