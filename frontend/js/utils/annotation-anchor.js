export function selectionAnchor(field,position){
  const start=field.selectionStart,end=field.selectionEnd;
  if(end<=start)return null;
  return {segmentPosition:position,startOffset:[...field.value.slice(0,start)].length,endOffset:[...field.value.slice(0,end)].length,quote:field.value.slice(start,end)};
}
export function focusAnnotation(note,container,revision){
  if(note.source_revision!==revision)return false;
  const element=[...container.querySelectorAll('.transcription-segment')].find((item)=>Number(item.dataset.segmentPosition)===note.segment_position);
  const field=element?.querySelector('textarea');if(!field)return false;
  const chars=[...field.value];if(chars.slice(note.start_offset,note.end_offset).join('')!==note.quote)return false;
  element.scrollIntoView?.({block:'center'});field.focus({preventScroll:true});field.setSelectionRange(chars.slice(0,note.start_offset).join('').length,chars.slice(0,note.end_offset).join('').length);return true;
}
