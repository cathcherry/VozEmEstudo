export function progressPatch(state) {
  const duration=Math.min(7200,Math.max(0,Number(state.duration)||0));
  return {position:Math.min(7200,Math.max(0,Number(state.position)||0)),
    playbackRate:[0.5,0.75,1,1.25,1.5,2,2.5,3].includes(state.playbackRate)?state.playbackRate:1,
    completed:state.completed===true,
    intervals:(state.intervals || []).filter((pair) => Array.isArray(pair)&&pair.length===2&&
      pair.every(Number.isFinite)&&pair[0]>=0&&pair[1]>pair[0]&&pair[1]<=Math.max(duration,0)).slice(0,300),
  };
}
export function remoteStudy(row) {
  return {position:Number(row.position_seconds),duration:Number(row.duration_seconds),
    playbackRate:Number(row.playback_rate),completed:row.completed,intervals:row.intervals || [],
    openedAt:new Date(row.updated_at).getTime(),cloudVersion:row.version};
}
export function buildStudySync({userId,api,storage,apply,uuid,readLocal=()=>null,onStatus=()=>{},now=()=>Date.now()}) {
  const key=`voz-study-outbox-v1:${userId}`;
  const remote=new Map(), pending=new Map();
  let working=false, stopped=false, nextAttempt=0, message='';
  try {
    const data=JSON.parse(storage.getItem(key)||'[]');
    if(Array.isArray(data)) for(const [id,item] of data.slice(0,1000))
      if(/^[a-f0-9-]{36}$/i.test(id)&&item?.wire?.requestId) pending.set(id,item);
  } catch { /* Corrupt saved queue does not expose another account or block reading. */ }
  function state(text=message) {
    message=text; const value={message,pending:pending.size,conflicts:[...pending.values()].filter((item)=>item.blocked).length};
    onStatus(value); return value;
  }
  function persist() {
    try { storage.setItem(key,JSON.stringify([...pending])); }
    catch { state('Não foi possível guardar os envios pendentes neste navegador. Mantenha esta página aberta para sincronizar.'); }
  }
  function enqueue(id,snapshot) {
    if(stopped)return;
    const patch=progressPatch(snapshot), entry=pending.get(id);
    if(entry) entry.latest=patch;
    else pending.set(id,{wire:{version:remote.get(id)?.version||0,requestId:uuid(),patch},latest:null});
    persist(); state('Andamento salvo neste navegador; sincronização pendente.');
  }
  async function load() {
    let offset=0,total;
    do {
      const page=await api.list(offset); total=page.total;
      for(const row of page.progress) {
        remote.set(row.material_id,row);
        if(!pending.has(row.material_id)) {
          const local=readLocal(row.material_id);
          if(local&&local.cloudVersion===undefined&&(local.position>0||local.completed||local.intervals?.length)) {
            pending.set(row.material_id,{wire:{version:row.version,requestId:uuid(),patch:progressPatch(local)},latest:null,blocked:true});persist();
          } else apply(row.material_id,remoteStudy(row));
        }
      }
      if(!page.progress.length && offset<total) throw new Error('A paginação do andamento não pôde ser concluída.');
      offset+=page.limit;
    } while(offset<total);
    state([...pending.values()].some((item)=>item.blocked)?'Há versões locais e da conta para comparar. Escolha qual manter.':pending.size?'Há andamento local aguardando sincronização.':'Andamento da conta carregado.');
  }
  async function flush(force=false) {
    if(stopped||working || (!force&&now()<nextAttempt)) return;
    working=true;
    try {
      for(const [id,entry] of pending) {
        if(stopped)break;
        if(entry.blocked) continue;
        try {
          const row=await api.save(id,entry.wire);
          remote.set(id,row); pending.delete(id);
          apply(id,{cloudVersion:row.version});
          if(entry.latest) pending.set(id,{wire:{version:row.version,requestId:uuid(),patch:entry.latest},latest:null});
          persist();
        } catch(error) {
          if(error.status===409) {
            entry.blocked=true; persist(); state('Há conflito entre aparelhos. Escolha abaixo qual andamento manter.');
          } else if(error.status===400||error.status===404) {
            pending.delete(id);persist();state('Um andamento não pôde ser enviado. O registro local foi mantido; confira se a aula ainda existe.');
          } else {
            nextAttempt=now()+30000; state('Sem confirmação da conta. O andamento continua neste navegador.'); break;
          }
        }
      }
      if(!pending.size) state('Andamento sincronizado com a conta.');
    } finally { working=false; }
  }
  async function resolve(useLocal) {
    if(working) return;
    await load();
    for(const [id,entry] of pending) if(entry.blocked) {
      const row=remote.get(id);
      if(useLocal) pending.set(id,{wire:{version:row?.version||0,requestId:uuid(),patch:entry.latest||entry.wire.patch},latest:null});
      else { if(row) apply(id,remoteStudy(row)); pending.delete(id); }
    }
    persist();state('Conflitos resolvidos.');await flush(true);
  }
  return {load,enqueue,flush,resolve,state,stop:()=>{stopped=true;},hasRemote:(id)=>remote.has(id)};
}
