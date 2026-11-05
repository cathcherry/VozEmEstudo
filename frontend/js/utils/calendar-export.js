export const localDay=(date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function monthRange(month){
  if(!/^\d{4}-\d{2}$/.test(month))throw new Error('Selecione um mês válido.');
  const [year,m]=month.split('-').map(Number);if(year<1970||year>2100||m<1||m>12)throw new Error('Selecione um mês entre 1970 e 2100.');
  const from=new Date(year,m-1,1),to=new Date(year,m,1);
  return {from:from.toISOString(),to:to.toISOString(),fromDay:localDay(from),toDay:localDay(to)};
}
export function itemOnDay(item,day){
  if(item.kind==='task')return item.date===day;
  const from=new Date(day+'T00:00:00'),to=new Date(from);to.setDate(to.getDate()+1);
  return Date.parse(item.startsAt)<to.getTime()&&Date.parse(item.endsAt)>from.getTime();
}
const escapeText=(value)=>String(value||'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
export function foldIcsLine(line){let result='',size=0;for(const char of line){const bytes=new TextEncoder().encode(char).length;if(size+bytes>75){result+='\r\n ';size=1;}result+=char;size+=bytes;}return result;}
const utcStamp=(value)=>{const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new Error('Data inválida para exportar.');return date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');};
export function calendarIcs(items,now=new Date()){
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Voz em Estudo//Calendario//PT-BR','CALSCALE:GREGORIAN'];
  for(const item of items){
    lines.push('BEGIN:VEVENT',`UID:${item.kind}-${item.id}@voz-em-estudo.local`,`DTSTAMP:${utcStamp(now)}`);
    if(item.kind==='task'){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(item.date))throw new Error('Prazo inválido.');
      const end=new Date(item.date+'T00:00:00Z');if(end.toISOString().slice(0,10)!==item.date)throw new Error('Prazo inválido.');end.setUTCDate(end.getUTCDate()+1);
      lines.push(`DTSTART;VALUE=DATE:${item.date.replace(/-/g,'')}`,`DTEND;VALUE=DATE:${end.toISOString().slice(0,10).replace(/-/g,'')}`);
    }else lines.push(`DTSTART:${utcStamp(item.startsAt)}`,`DTEND:${utcStamp(item.endsAt)}`);
    lines.push(`SUMMARY:${escapeText(item.title)}`,`DESCRIPTION:${escapeText(item.description||(item.kind==='task'?'Prazo de tarefa do Voz em Estudo':'Estudo agendado no Voz em Estudo'))}`,'END:VEVENT');
  }
  lines.push('END:VCALENDAR');return lines.map(foldIcsLine).join('\r\n')+'\r\n';
}
