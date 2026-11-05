const token=new URLSearchParams(location.hash.slice(1)).get('token');
const status=document.querySelector('[data-shared-status]'),content=document.querySelector('[data-shared-content]'),print=document.querySelector('[data-shared-print]'),retry=document.querySelector('[data-shared-retry]');
async function load(){
  retry.disabled=true;content.replaceChildren();print.hidden=true;
  try{
    if(!/^[0-9a-f]{64}$/.test(token||''))throw new Error('Link inválido. Solicite um novo endereço ao responsável.');
    const response=await fetch('/api/shared-material',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
    if(!response.ok)throw new Error(response.status===404?'Link indisponível, expirado ou revogado.':'Não foi possível abrir a cópia. Tente novamente.');
    const data=await response.json();document.querySelector('[data-shared-title]').textContent=data.title;
    status.textContent=`${data.subject||'Sem disciplina'} · revisão ${data.revision}${data.summaryVersion?' · resumo versão '+data.summaryVersion:''}`;
    for(const [key,title] of [['transcript','Transcrição'],['summary','Resumo']])if(typeof data[key]==='string'){
      const section=document.createElement('section'),heading=document.createElement('h2'),text=document.createElement('p');heading.textContent=title;text.textContent=data[key];section.append(heading,text);content.append(section);
    }print.hidden=false;
  }catch(error){status.textContent=error.message;}finally{retry.disabled=false;}
}
retry.addEventListener('click',()=>{void load();});print.addEventListener('click',()=>window.print());void load();
