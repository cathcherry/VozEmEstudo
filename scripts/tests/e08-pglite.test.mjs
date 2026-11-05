import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', foreign='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const material='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const id=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('E08/E09 SQL preserves progress, deduplicates time, excludes stale gaps and isolates accounts',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create schema auth;create role anon nologin;create role authenticated nologin;create role service_role nologin;
      create table auth.users(id uuid primary key);
      create table public.materials(id uuid primary key,user_id uuid not null references auth.users(id),unique(id,user_id));
      create table public.audio_files(material_id uuid primary key references public.materials(id) on delete cascade,duration_ms bigint);`);
    for(const user of [owner,foreign])await db.query('insert into auth.users values($1)',[user]);
    await db.query('insert into public.materials values($1,$2)',[material,owner]);
    await db.query('insert into public.audio_files values($1,100000)',[material]);
    await db.exec(readFileSync(new URL('../../database/migrations/20261105011000_study_tracking.sql',import.meta.url),'utf8'));
    const progress=(user,version,request,patch)=>db.query('select public.study_save_progress_admin($1,$2,$3,$4,$5::jsonb) r',[user,material,version,request,JSON.stringify(patch)]).then((result)=>result.rows[0].r);
    const patch={position:12,playbackRate:2,intervals:[[0,10],[8,20],[30,40]]};
    const p=await progress(owner,0,id(1),patch);
    assert.equal(p.version,1);assert.equal(p.completed,false);assert.equal(Number(p.duration_seconds),100);
    assert.deepEqual(p.intervals,[[0,20],[30,40]]);
    assert.equal((await progress(owner,0,id(1),patch)).version,1);
    await assert.rejects(progress(owner,1,id(1),{completed:true}),/STUDY_REQUEST_CONFLICT/);
    await assert.rejects(progress(owner,0,id(2),{completed:true}),/STUDY_PROGRESS_CONFLICT/);
    await assert.rejects(progress(foreign,0,id(3),patch),/STUDY_NOT_FOUND/);
    const p2=await progress(owner,1,id(4),{position:500,completed:true,intervals:[[90,150]]});
    assert.equal(Number(p2.position_seconds),100);assert.equal(p2.completed,true);
    assert.deepEqual(p2.intervals,[[0,20],[30,40],[90,100]]);
    await assert.rejects(progress(owner,2,id(5),{intervals:[[4,2]]}),/STUDY_INVALID_INPUT/);
    await db.query("select public.study_save_settings_admin($1,90,'America/Sao_Paulo')",[owner]);
    await assert.rejects(db.query("select public.study_save_settings_admin($1,90,'Invalid/Zone')",[owner]));
    const start=(user,session,mat=material)=>db.query("select public.study_start_session_admin($1,$2,$3,'reading') r",[user,session,mat]).then((r)=>r.rows[0].r);
    const tick=(user,session,sequence,active,close)=>db.query('select public.study_tick_session_admin($1,$2,$3,$4,$5) r',[user,session,sequence,active,close]).then((r)=>r.rows[0].r);
    const s=await start(owner,id(10));assert.equal(s.total_seconds,0);
    assert.equal((await start(owner,id(10))).started_at,s.started_at);
    await assert.rejects(start(owner,id(11)),/STUDY_SESSION_ACTIVE/);
    await assert.rejects(start(foreign,id(12)),/STUDY_NOT_FOUND/);
    await assert.rejects(tick(foreign,id(10),1,true,false),/STUDY_NOT_FOUND/);
    await db.query("update public.study_sessions set last_tick_at=clock_timestamp()-interval '20 seconds' where id=$1",[id(10)]);
    const first=await tick(owner,id(10),1,true,false);
    assert(first.total_seconds>=20&&first.total_seconds<=30);
    const repeated=await tick(owner,id(10),1,true,false);assert.equal(repeated.total_seconds,first.total_seconds);
    await assert.rejects(tick(owner,id(10),1,false,true),/STUDY_REQUEST_CONFLICT/);
    await db.query("update public.study_sessions set last_tick_at=clock_timestamp()-interval '120 seconds' where id=$1",[id(10)]);
    const expired=await tick(owner,id(10),2,true,false);
    assert(expired.ended_at);assert.equal(expired.total_seconds,first.total_seconds);
    await start(owner,id(11));const closed=await tick(owner,id(11),1,false,true);
    assert.equal(closed.total_seconds,0);assert(closed.ended_at);
    const count=(await db.query('select count(*)::int n from public.study_time_credits')).rows[0].n;assert.equal(count,1);
    const overview=(user)=>db.query('select public.study_overview_admin($1) r',[user]).then((r)=>r.rows[0].r);
    const summary=await overview(owner);assert.equal(summary.days.length,7);assert.equal(summary.timezone,'America/Sao_Paulo');
    assert.equal(summary.goalMinutes,90);assert.equal(summary.completedMaterials,1);
    assert.equal(Number(summary.weekSeconds),first.total_seconds);
    assert.equal(Number((await overview(foreign)).weekSeconds),0);
    const rights=(await db.query(`select has_table_privilege('authenticated','public.study_progress','SELECT') browser_read,
      has_function_privilege('anon','public.study_tick_session_admin(uuid,uuid,integer,boolean,boolean)','EXECUTE') anon_tick,
      has_function_privilege('service_role','public.study_save_progress_admin(uuid,uuid,integer,uuid,jsonb)','EXECUTE') server_write`)).rows[0];
    assert.deepEqual(rights,{browser_read:false,anon_tick:false,server_write:true});
    await db.query('delete from public.materials where id=$1',[material]);
    assert.equal((await db.query('select count(*)::int n from public.study_progress')).rows[0].n,0);
    assert.equal((await db.query('select material_id from public.study_sessions where id=$1',[id(10)])).rows[0].material_id,null);
    assert.equal(Number((await overview(owner)).weekSeconds),first.total_seconds);
  } finally {await db.close();}
});
