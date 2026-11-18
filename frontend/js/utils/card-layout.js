export function normalizeCardLayout(layout = {}) {
  return {
    columns: Math.max(3, Math.min(12, Math.round(Number(layout.columns) || 4))),
    height: Math.max(220, Math.min(900, Math.round((Number(layout.height) || 400) / 20) * 20)),
  };
}
export function resizedCardLayout(start, dx, dy, gridWidth, gap = 16) {
  const step = (gridWidth + gap) / 12;
  return normalizeCardLayout({ columns:start.columns + Math.round(dx / step), height:start.height + dy });
}

export function enhanceCard(card, block, { saveLayout, saveOrder }) {
  let layout = normalizeCardLayout(block.layout);
  const apply = () => {
    card.style.setProperty('--card-columns', layout.columns);
    card.style.setProperty('--card-height', `${layout.height}px`);
  };
  apply();
  const resize = document.createElement('button');
  resize.type='button'; resize.className='card-resize-handle'; resize.textContent='⌟';
  resize.setAttribute('aria-label',`Redimensionar ${block.title}. Use as setas para ajustar.`);
  resize.title='Arraste para redimensionar · clique duplo para restaurar';
  card.append(resize);
  resize.addEventListener('dblclick',()=>{layout=normalizeCardLayout();apply();saveLayout(layout);});
  resize.addEventListener('keydown',event=>{
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    layout=normalizeCardLayout({columns:layout.columns+({'ArrowLeft':-1,'ArrowRight':1}[event.key] || 0),height:layout.height+({'ArrowUp':-20,'ArrowDown':20}[event.key] || 0)});
    apply(); saveLayout(layout);
  });
  resize.addEventListener('pointerdown',event=>{
    if(event.button!==0) return;
    event.preventDefault();resize.setPointerCapture(event.pointerId);
    const gridWidth=card.parentElement.clientWidth;
    const start={...layout}, x=event.clientX,y=event.clientY;
    card.classList.add('is-resizing');document.body.classList.add('card-manipulating');
    const move=e=>{layout=resizedCardLayout(start,gridWidth<520?0:e.clientX-x,e.clientY-y,gridWidth);apply();};
    const finish=e=>{
      if(e.type==='pointercancel' || e.key==='Escape') layout=start;
      if(resize.hasPointerCapture(event.pointerId)) resize.releasePointerCapture(event.pointerId);
      apply();card.classList.remove('is-resizing');document.body.classList.remove('card-manipulating');
      resize.removeEventListener('pointermove',move);resize.removeEventListener('pointerup',finish);resize.removeEventListener('pointercancel',finish);document.removeEventListener('keydown',escape);
      saveLayout(layout);
    };
    const escape=e=>{if(e.key==='Escape')finish(e);};
    resize.addEventListener('pointermove',move);resize.addEventListener('pointerup',finish);resize.addEventListener('pointercancel',finish);document.addEventListener('keydown',escape);
  });
  const body=card.querySelector('.profile-card-body');
  const fit=()=>{
    if(!card.isConnected) return;
    const frame=body.querySelector('.profile-widget-frame');
    if(frame) {
      const scale=Math.max(.2,Math.min(body.clientWidth/320,body.clientHeight/380));
      frame.style.setProperty('--widget-scale',scale);
    }
    const text=body.querySelector(':scope > p, :scope > .profile-checklist');
    if(text){
      const base=parseFloat(getComputedStyle(document.documentElement).fontSize)||16;
      let low=base*.875,high=text.matches('p')?base*2.375:base*1.5;
      for(let i=0;i<7;i++){
        const size=(low+high)/2;text.style.fontSize=`${size}px`;
        if(body.scrollHeight>body.clientHeight+1 || body.scrollWidth>body.clientWidth+1) high=size;else low=size;
      }
      text.style.fontSize=`${Math.floor(low)}px`;
    }
  };
  const observer=new ResizeObserver(fit);observer.observe(body);
  attachDrag(card,saveOrder);
  requestAnimationFrame(fit);
  return ()=>observer.disconnect();
}

function attachDrag(card,saveOrder) {
  const handle=card.querySelector('.block-drag-handle');
  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0) return;
    event.preventDefault();handle.setPointerCapture(event.pointerId);
    const grid=card.parentElement, original=[...grid.children];
    const x=event.clientX,y=event.clientY;
    let ghost=null, point=event, raf, dropTarget=null, dropAfter=false, active=true;
    const tick=()=>{
      const speed=point.clientY<90?-12:point.clientY>innerHeight-90?12:0;
      if(speed) window.scrollBy(0,speed);
      raf=requestAnimationFrame(tick);
    };
    const move=e=>{
      if(e.buttons===0) { finish(e); return; }
      point=e;
      if(!ghost && Math.hypot(e.clientX-x,e.clientY-y)<7) return;
      if(!ghost){
        ghost=document.createElement('div');ghost.className='card-drag-preview';ghost.textContent=card.querySelector('h3').textContent;
        document.body.append(ghost);card.classList.add('is-dragging');document.body.classList.add('card-manipulating');tick();
      }
      ghost.style.left=`${e.clientX+16}px`;ghost.style.top=`${e.clientY+12}px`;
      let target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-custom-block]');
      if(!target || target===card || target.parentElement!==grid) return;
      const rect=target.getBoundingClientRect();
      const after = Math.abs(e.clientY-(rect.top+rect.height/2))<rect.height*.35 ? e.clientX>rect.left+rect.width/2 : e.clientY>rect.top+rect.height/2;
      dropTarget?.classList.remove('card-drop-before','card-drop-after');
      dropTarget=target;dropAfter=after;
      target.classList.add(after?'card-drop-after':'card-drop-before');
    };
    const finish=e=>{
      if(!active)return;active=false;
      cancelAnimationFrame(raf);
      const changed=Boolean(ghost);ghost?.remove();
      if(handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      card.classList.remove('is-dragging');document.body.classList.remove('card-manipulating');
      dropTarget?.classList.remove('card-drop-before','card-drop-after');
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);document.removeEventListener('keydown',escape);
      window.removeEventListener('mouseup',finish);handle.removeEventListener('lostpointercapture',finish);
      if(e.type==='pointercancel'||e.key==='Escape') { for(const el of original)grid.append(el); }
      else if(changed && dropTarget) {
        grid.insertBefore(card,dropAfter?dropTarget.nextSibling:dropTarget);
        saveOrder([...grid.querySelectorAll('[data-custom-block]')].map(el=>el.dataset.customBlock));
      }
      handle.focus({preventScroll:true});
    };
    const escape=e=>{if(e.key==='Escape')finish(e);};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);document.addEventListener('keydown',escape);
    window.addEventListener('mouseup',finish);handle.addEventListener('lostpointercapture',finish);
  });
}
