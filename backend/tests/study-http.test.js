import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { identities,resourceIds } from './fixtures/ownership.fixture.js';
test('E08/E09 HTTP and real SQL preserve account isolation, optimistic progress and exclusive sessions',async()=>{
  const fixture=createSupabaseHttpFixture(),nativeFetch=globalThis.fetch;
  process.env.SUPABASE_URL=fixture.origin;process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_e08_fixture';
  process.env.SUPABASE_SECRET_KEY='e08-fixture-server-key';process.env.FEATURE_STUDY_TRACKING='true';process.env.MOCK_EXTERNAL_SERVICES='true';
  const {db}=await fixture.getDatabase();
  await db.exec('alter table public.materials add constraint e08_owner_unique unique(id,user_id)');
  await db.exec(readFileSync(new URL('../../database/migrations/20261105011000_study_tracking.sql',import.meta.url),'utf8'));
  fixture.state.tables.study_progress=[];
  globalThis.fetch=fixture.fetch;
  const {app}=await import('../src/app.js');const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api/study`;
  async function request(path,method='GET',body,user='a'){
    const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${identities[user].token}`}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};
  }
  try {
    assert.equal((await request('/overview','GET',null,null)).status,401);
    const body={version:0,requestId:randomUUID(),patch:{position:2,playbackRate:2,completed:true,intervals:[[0,2]]}};
    assert.equal((await request(`/progress/${resourceIds.materialB}`,'PUT',body)).status,404);
    assert.equal((await request(`/progress/${resourceIds.materialA}`,'PUT',body)).status,200);
    assert.equal((await request(`/progress/${resourceIds.materialA}`,'PUT',body)).body.version,1);
    assert.equal((await request(`/progress/${resourceIds.materialA}`,'PUT',{...body,requestId:randomUUID()})).status,409);
    assert.equal((await request('/progress')).body.progress.length,1);
    assert.equal((await request('/progress','GET',null,'b')).body.progress.length,0);
    const sessionId=randomUUID(),session={sessionId,kind:'pomodoro',materialId:resourceIds.materialA};
    assert.equal((await request('/sessions','POST',session)).status,200);
    assert.equal((await request('/sessions','POST',{...session,sessionId:randomUUID()})).status,409);
    assert.equal((await request(`/sessions/${sessionId}/tick`,'POST',{sequence:1,active:true,close:false},'b')).status,404);
    assert.equal((await request(`/sessions/${sessionId}/tick`,'POST',{sequence:1,active:true,close:false,seconds:9000})).status,400);
    assert.equal((await request(`/sessions/${sessionId}/tick`,'POST',{sequence:1,active:false,close:true})).status,200);
    assert.equal((await request('/settings','PUT',{goalMinutes:180,timezone:'America/Sao_Paulo'})).status,200);
    const overview=await request('/overview');assert.equal(overview.body.goalMinutes,180);assert.equal(overview.body.completedMaterials,1);
    assert.equal(Number((await request('/overview','GET',null,'b')).body.weekSeconds),0);
  } finally {await new Promise((resolve)=>server.close(resolve));await fixture.close();globalThis.fetch=nativeFetch;}
});
