// Keep one shared recording above the content tabs.
const tabs=document.querySelector('.material-tabs');
const recording=document.querySelector('[data-audio-section]');
if(tabs && recording){
  recording.classList.add('material-recording');
  const heading=document.createElement('h2');heading.className='recording-title';heading.textContent='Gravação da aula';
  recording.prepend(heading);tabs.before(recording);
}
