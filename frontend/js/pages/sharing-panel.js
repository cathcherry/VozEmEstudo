import { createMaterialShare,listMaterialShares,revokeMaterialShare } from '../api/learning-tools.api.js';
import { pendingMutation } from '../utils/pending-mutation.js';
const make=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
// Revoking cannot be undone: whoever has the address loses access at once.
export const REVOKE_QUESTION='Revogar este link? Quem tiver o endereço não conseguirá mais abrir a cópia. Esta ação não pode ser desfeita.';
export function randomShareToken(){return [...crypto.getRandomValues(new Uint8Array(32))].map((b)=>b.toString(16).padStart(2,'0')).join('');}
export async function initSharingPanel({panel,materialId,context}){
  panel.hidden=false;panel.replaceChildren(make('h2','Compartilhar uma cópia para leitura'),make('p','Qualquer pessoa com o link poderá ler os textos escolhidos até a expiração ou revogação. Áudio, vídeo, anotações pessoais e progresso ficam fora da cópia. Uma revogação impede novos acessos, mas não remove cópias já baixadas.'));
  const form=make('form'),transcriptLabel=make('label'),transcript=make('input');transcript.type='checkbox';transcript.checked=true;transcriptLabel.append(transcript,' Incluir transcrição confirmada');
  const summaryLabel=make('label'),summary=make('input');summary.type='checkbox';summaryLabel.append(summary,' Incluir resumo da mesma revisão');
  const daysLabel=make('label','Validade'),days=make('select');for(const value of [1,7,30])days.append(new Option(`${value} ${value===1?'dia':'dias'}`,String(value)));daysLabel.append(days);
  const submit=make('button','Criar link de leitura');submit.type='submit';form.append(transcriptLabel,summaryLabel,daysLabel,submit);
  const status=make('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const result=make('div'),list=make('div'),more=make('button','Carregar mais links');more.type='button';
  panel.append(form,status,result,list,more);let offset=0,total=0,identity={id:crypto.randomUUID(),token:randomShareToken()};
  const create=pendingMutation((body)=>createMaterialShare(materialId,body),()=>crypto.randomUUID());
  form.addEventListener('submit',(event)=>{
    event.preventDefault();const source=context();if(source?.review?.state!=='ready_to_generate'){status.textContent='Confira e confirme a revisão atual antes de criar o link.';return;}
    submit.disabled=true;
    void create({...identity,sourceRevisionId:source.review.sourceRevisionId,includeTranscript:transcript.checked,includeSummary:summary.checked,days:Number(days.value)})
      .then((row)=>{
        const url=new URL('./compartilhado.html',location.href);url.hash=`token=${identity.token}`;
        const link=make('a','Abrir cópia compartilhada');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';
        const fieldLabel=make('label','Link criado (copie agora)'),field=make('input');field.readOnly=true;field.value=url.href;fieldLabel.append(field);
        result.replaceChildren(fieldLabel,link,make('p',`Expira em ${new Date(row.expiresAt).toLocaleString('pt-BR')}. O endereço não é guardado nesta lista; para outro link, revogue e crie uma nova cópia.`));
        identity={id:crypto.randomUUID(),token:randomShareToken()};status.textContent='Cópia criada. O texto não acompanha alterações futuras da aula.';return load(true);
      }).catch((error)=>{status.textContent=error.message;}).finally(()=>{submit.disabled=false;});
  });
  async function load(reset=false){
    more.disabled=true;try{const data=await listMaterialShares(materialId,reset?0:offset);if(reset){offset=0;list.replaceChildren();}total=data.total;
      for(const row of data.shares){const item=make('p',`${row.revoked_at?'Revogado':Date.parse(row.expires_at)<=Date.now()?'Expirado':'Disponível'} · expira em ${new Date(row.expires_at).toLocaleString('pt-BR')} `);
        if(!row.revoked_at&&Date.parse(row.expires_at)>Date.now()){const revoke=make('button','Revogar link');revoke.type='button';revoke.addEventListener('click',()=>{if(!confirm(REVOKE_QUESTION))return;revoke.disabled=true;void revokeMaterialShare(materialId,row.id).then(()=>load(true)).catch((e)=>{status.textContent=e.message;revoke.disabled=false;});});item.append(revoke);}list.append(item);}
      offset+=data.shares.length;more.hidden=offset>=total;
      if(!total)list.replaceChildren(make('p','Nenhum link criado para esta aula.'));
    }catch(error){status.textContent=error.message||'Não foi possível carregar os links.';more.hidden=true;}finally{more.disabled=false;}
  }
  more.addEventListener('click',()=>{void load();});await load(true);
}
