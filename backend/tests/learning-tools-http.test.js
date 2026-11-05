import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { migrateLearningTools } from './fixtures/learning-db.fixture.js';
import { identities,resourceIds } from './fixtures/ownership.fixture.js';
import { revisionIds } from './fixtures/academic-db.fixture.js';
test('annotations/calendar require accounts while shared copies expose only an expiring revocable snapshot',async()=>{
  const fixture=createSupabaseHttpFixture(),nativeFetch=globalThis.fetch;
  Object.assign(process.env,{SUPABASE_URL:fixture.origin,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_e19_fixture',SUPABASE_SECRET_KEY:'e19-fixture-server-key',
    FEATURE_ANNOTATIONS:'true',FEATURE_CALENDAR:'true',FEATURE_SHARING:'true',MOCK_EXTERNAL_SERVICES:'true'});
  const {db}=await fixture.getDatabase();await migrateLearningTools(db);
  for(const name of ['study_annotations','material_shares','study_calendar_events'])fixture.state.tables[name]=[];
  globalThis.fetch=fixture.fetch;const {app}=await import('../src/app.js');const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  async function request(path,method='GET',body,user='a'){
    const res=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${identities[user].token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:res.status,body:await res.json(),headers:res.headers};
  }
  try{
    assert.equal((await request('/api/annotations','GET',null,null)).status,401);
    assert.equal((await request('/api/calendar','GET',null,null)).status,401);
    const note={id:randomUUID(),requestId:randomUUID(),materialId:resourceIds.materialA,version:0,body:{sourceRevisionId:revisionIds.a,noteText:'Nota privada'}};
    assert.equal((await request('/api/annotations','PUT',note)).status,200);
    assert.equal((await request('/api/annotations','GET',null,'b')).body.notes.length,0);
    assert.equal((await request('/api/annotations','PUT',{...note,id:randomUUID(),requestId:randomUUID()},'b')).status,404);
    const event={id:randomUUID(),requestId:randomUUID(),version:0,body:{title:'Estudo privado',startsAt:'2026-11-05T10:00:00Z',endsAt:'2026-11-05T11:00:00Z',materialId:resourceIds.materialA}};
    assert.equal((await request('/api/calendar','PUT',event)).status,200);
    assert.equal((await request('/api/calendar','PUT',{...event,id:randomUUID(),requestId:randomUUID()},'b')).status,404);
    const token='cd'.repeat(32),share={id:randomUUID(),requestId:randomUUID(),token,sourceRevisionId:revisionIds.a,includeTranscript:true,includeSummary:false,days:1};
    assert.equal((await request('/api/sharing/'+resourceIds.materialA,'POST',share,'b')).status,404);
    const created=await request('/api/sharing/'+resourceIds.materialA,'POST',share);assert.equal(created.status,200);
    const publicCopy=await request('/api/shared-material','POST',{token},null);assert.equal(publicCopy.status,200);
    assert.deepEqual(Object.keys(publicCopy.body).sort(),['revision','subject','title','transcript']);assert(!JSON.stringify(publicCopy.body).includes('Nota privada'));
    assert.equal(publicCopy.headers.get('cache-control'),'no-store');assert.equal(publicCopy.headers.get('referrer-policy'),'no-referrer');
    assert.equal((await request(`/api/sharing/${resourceIds.materialA}/${created.body.id}`,'DELETE',null,'b')).status,404);
    assert.equal((await request(`/api/sharing/${resourceIds.materialA}/${created.body.id}`,'DELETE')).status,200);
    assert.equal((await request('/api/shared-material','POST',{token},null)).status,404);
  }finally{await new Promise((resolve)=>server.close(resolve));await fixture.close();globalThis.fetch=nativeFetch;}
});
