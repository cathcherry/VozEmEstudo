export function exportDocument(material,{transcript=true,summary=true,notes=[]}={}){
  const sections=[];
  if(transcript&&material.transcription)sections.push({heading:`Transcrição · revisão ${material.transcription.current_revision}`,text:material.transcription.current_text||''});
  const current=material.summaries?.find((s)=>s.is_current)||material.summaries?.[0];
  if(summary&&current)sections.push({heading:`Resumo · versão ${current.version} · fonte: revisão ${current.source_transcription_revision}`,text:current.text});
  if(notes.length)sections.push({heading:'Anotações pessoais',text:notes.map((n)=>`Revisão ${n.source_revision}${n.quote?'\nDestaque: '+n.quote:''}${n.note_text?'\nNota: '+n.note_text:''}`).join('\n\n')});
  return {title:material.title,subject:material.subject||'Sem disciplina',sections};
}
export function exportText(document,markdown=false){
  return `${markdown?'# ':''}${document.title}\n${document.subject}\n\n`+document.sections.map((s)=>`${markdown?'## ':''}${s.heading}\n\n${s.text}`).join('\n\n');
}
export function downloadText(text,filename,type='text/plain;charset=utf-8'){
  const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
export function printStudyDocument(data,popup=window.open('','_blank')){
  if(!popup)throw new Error('Permita abrir a janela de impressão para salvar o PDF.');popup.opener=null;
  const doc=popup.document;doc.title=data.title;
  const style=doc.createElement('style');style.textContent='@page{size:A4;margin:20mm}body{font:12pt/1.55 Georgia,serif;color:#111;max-width:180mm;margin:auto}h1{font-size:22pt}h2{font-size:15pt;break-after:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere}section{margin-top:1.4em}@media print{button{display:none}}';doc.head.append(style);
  doc.body.replaceChildren();const heading=doc.createElement('h1');heading.textContent=data.title;doc.body.append(heading);
  const subject=doc.createElement('p');subject.textContent=data.subject;doc.body.append(subject);
  for(const item of data.sections){const section=doc.createElement('section'),title=doc.createElement('h2'),text=doc.createElement('p');title.textContent=item.heading;text.textContent=item.text;section.append(title,text);doc.body.append(section);}
  const button=doc.createElement('button');button.textContent='Imprimir / salvar PDF';button.addEventListener('click',()=>popup.print());doc.body.prepend(button);
  void (doc.fonts?.ready||Promise.resolve()).then(()=>popup.print());
}
