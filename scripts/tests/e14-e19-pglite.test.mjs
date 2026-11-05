import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAcademicDatabase,revisionIds } from '../../backend/tests/fixtures/academic-db.fixture.js';
import { identities,resourceIds } from '../../backend/tests/fixtures/ownership.fixture.js';
import { migrateLearningTools } from '../../backend/tests/fixtures/learning-db.fixture.js';
import { PERMISSION_DECLARATION } from '../../backend/src/config/permission-declaration.js';
const id=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('E03/E05/E14/E18/E19 execute together with revision anchors, calendar scope and revocable snapshots',async()=>{
  const database=await createAcademicDatabase(),{db}=database,a=identities.a.id,b=identities.b.id,mat=resourceIds.materialA;
  try{
    await database.permit(identities.a,mat);await database.confirm(identities.a,mat,revisionIds.a);
    await migrateLearningTools(db);
    const call=async(name,args)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).rows[0].r;
    const note={sourceRevisionId:revisionIds.a,segmentPosition:0,startOffset:0,endOffset:7,quote:'Energia',noteText:'Revisar a definição',color:'yellow'};
    const saveNote=(user,n,version,request,body)=>call('study_save_annotation_admin',[user,id(n),mat,version,id(request),JSON.stringify(body)]);
    const saved=await saveNote(a,1,0,2,note);assert.equal(saved.version,1);assert.equal(saved.source_revision,1);
    assert.equal((await saveNote(a,1,0,2,note)).version,1);
    await assert.rejects(saveNote(b,1,1,3,{noteText:'invasão'}),/LEARNING_NOT_FOUND/);
    await assert.rejects(saveNote(a,4,0,5,{...note,sourceRevisionId:revisionIds.b}),/LEARNING_NOT_FOUND/);
    await assert.rejects(saveNote(a,4,0,5,{...note,quote:'texto inexistente'}),/LEARNING_ANCHOR_CONFLICT/);
    await assert.rejects(saveNote(a,1,0,6,{noteText:'conflito'}),/LEARNING_VERSION_CONFLICT/);
    const notes=await call('study_list_annotations_admin',[a,null,'definição',0]);assert.equal(Number(notes.total),1);
    assert.equal(Number((await call('study_list_annotations_admin',[b,null,'',0])).total),0);
    assert.equal(Number((await call('study_list_annotations_admin',[a,null,"%' OR true --",0])).total),0);
    await saveNote(a,1,1,7,{deleted:true});assert.equal(Number((await call('study_list_annotations_admin',[a,null,'',0])).total),0);
    for(const [user,goal] of [[a,id(10)],[b,id(11)]])await db.query('insert into public.study_goals(id,user_id,title) values($1,$2,$3)',[goal,user,'Meta']);
    await db.query("insert into public.study_tasks(id,user_id,goal_id,title,due_date) values($1,$2,$3,'Tarefa da conta A','2026-11-05'),($4,$5,$6,'Tarefa da conta B','2026-11-05')",[id(12),a,id(10),id(13),b,id(11)]);
    const event={title:'Sessão de estudo',startsAt:'2026-11-05T13:00:00Z',endsAt:'2026-11-05T14:00:00Z',materialId:mat,taskId:id(12)};
    const saveEvent=(user,n,version,request,body)=>call('study_save_calendar_admin',[user,id(n),version,id(request),JSON.stringify(body)]);
    assert.equal((await saveEvent(a,20,0,21,event)).version,1);assert.equal((await saveEvent(a,20,0,21,event)).version,1);
    await assert.rejects(saveEvent(a,22,0,23,{...event,taskId:id(13)}),/LEARNING_NOT_FOUND/);
    await assert.rejects(saveEvent(b,20,1,24,{title:'invasão'}),/LEARNING_NOT_FOUND/);
    const feed=await call('study_calendar_feed_admin',[a,'2026-11-01T00:00Z','2026-12-01T00:00Z','2026-11-01','2026-12-01',0]);
    assert.equal(Number(feed.total),2);assert(feed.items.some((x)=>x.kind==='task'));assert(!feed.items.some((x)=>x.title==='Tarefa da conta B'));
    await db.query('select * from public.study_reorder_tasks($1,$2,$3::uuid[])',[a,id(10),[id(12)]]);
    const raw='ab'.repeat(32),hash=createHash('sha256').update(raw).digest('hex');
    const shareArgs=[a,id(30),mat,id(31),hash,revisionIds.a,true,false,7,PERMISSION_DECLARATION.version];
    const share=await call('study_create_share_admin',shareArgs);assert.equal(share.id,id(30));
    assert.equal((await call('study_create_share_admin',shareArgs)).expiresAt,share.expiresAt);
    const snapshot=await call('study_resolve_share_admin',[hash]);assert.deepEqual(Object.keys(snapshot).sort(),['revision','subject','title','transcript']);
    assert(snapshot.transcript.includes('Energia'));assert(!JSON.stringify(snapshot).includes(a));
    const originalTitle=snapshot.title;await db.query("update public.materials set title='Título alterado' where id=$1",[mat]);
    assert.equal((await call('study_resolve_share_admin',[hash])).title,originalTitle);
    await assert.rejects(call('study_create_share_admin',[...shareArgs.slice(0,8),1,PERMISSION_DECLARATION.version]),/LEARNING_REQUEST_CONFLICT/);
    await db.query('update public.material_shares set revoked_at=clock_timestamp() where id=$1',[id(30)]);assert.equal(await call('study_resolve_share_admin',[hash]),null);
    await db.query("update public.material_shares set revoked_at=null,expires_at=clock_timestamp()-interval '1 second' where id=$1",[id(30)]);assert.equal(await call('study_resolve_share_admin',[hash]),null);
    const rights=(await db.query(`select has_table_privilege('authenticated','public.study_annotations','SELECT') notes_read,
      has_table_privilege('anon','public.material_shares','SELECT') shares_read,
      has_function_privilege('anon','public.study_resolve_share_admin(text)','EXECUTE') public_rpc,
      has_function_privilege('service_role','public.study_resolve_share_admin(text)','EXECUTE') server_rpc`)).rows[0];
    assert.deepEqual(rights,{notes_read:false,shares_read:false,public_rpc:false,server_rpc:true});
  }finally{await db.close();}
});
