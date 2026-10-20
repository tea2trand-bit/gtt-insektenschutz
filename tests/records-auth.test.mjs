import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/projects-admin.mts';
import {issueToken,verifyRequest} from '../netlify/lib/projects-store.mts';
test('records, imports and private attachments reject unauthenticated requests before database access',async()=>{
  process.env.ADMIN_PASSWORD='test-only-password';process.env.ADMIN_TOKEN_SECRET='test-only-secret';
  for(const route of ['records','records/import','records/GTT-123456789012345678901234/files/12345678-1234-1234-1234-123456789012']){
    const res=await handler(new Request('https://local/api/admin/'+route),{});
    assert.equal(res.status,401);assert.equal((await res.json()).error,'Nicht angemeldet');
  }
  const token=issueToken();
  assert.equal(verifyRequest(new Request('https://local',{headers:{Authorization:'Bearer '+token}})),true);
  assert.equal(verifyRequest(new Request('https://local',{headers:{Authorization:'Bearer '+token+'tampered'}})),false);
});
