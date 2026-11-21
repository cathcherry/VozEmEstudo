// Animação progressiva, sem bibliotecas; não altera os handlers de negócio.
(() => {
  'use strict';
  const selector = '.study-section, .dashboard-start, .workflow-steps li, .library-card, .history-card, .quiz-answer-card, .output-list li, .theme-option, .personalization-group, .help-definitions article, .help-settings-grid article';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reducedMotion === 'true' || document.documentElement.dataset.lowStimulation === 'true';
  const setup = (element) => {
    // File-browser toolbars and context menus need a stationary parent surface.
    if (document.body.dataset.page === 'history' && element.matches('.study-section')) return;
    if (element.dataset.veMotionReady) return;
    element.dataset.veMotionReady = 'true';
    element.classList.add('ve-motion-card');
    if (reduced()) return;
    const onMove = (event) => {
      if (event.pointerType === 'touch' || reduced()) return;
      const box = element.getBoundingClientRect();
      const x = (event.clientX - box.left) / Math.max(box.width, 1) - .5;
      const y = (event.clientY - box.top) / Math.max(box.height, 1) - .5;
      element.style.setProperty('--ve-tilt-x', `${(-y * 1.2).toFixed(2)}deg`);
      element.style.setProperty('--ve-tilt-y', `${(x * 1.2).toFixed(2)}deg`);
    };
    const reset = () => {
      element.classList.remove('ve-hover');
      element.style.removeProperty('--ve-tilt-x');
      element.style.removeProperty('--ve-tilt-y');
    };
    element.addEventListener('pointerenter', () => { if (!reduced()) element.classList.add('ve-hover'); });
    element.addEventListener('pointermove', onMove, { passive:true });
    element.addEventListener('pointerleave', reset);
    element.addEventListener('focusout', (event) => { if (!element.contains(event.relatedTarget)) reset(); });
    if (observer && element.getBoundingClientRect().top > innerHeight) observer.observe(element);
  };
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) {
      observer.unobserve(entry.target);
      if (!reduced()) { entry.target.classList.add('ve-enter'); entry.target.addEventListener('animationend', () => entry.target.classList.remove('ve-enter'), { once:true }); }
    }
  }, { threshold: .12 }) : null;
  const scan = () => document.querySelectorAll(selector).forEach(setup);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, { once:true }); else scan();
  const mutationObserver = new MutationObserver((changes) => { if (changes.some(change => change.addedNodes.length)) scan(); });
  mutationObserver.observe(document.documentElement, { childList:true, subtree:true });
})();
