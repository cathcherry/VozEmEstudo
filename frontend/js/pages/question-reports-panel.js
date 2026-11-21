// Revisar › Questões › "Questões marcadas": the questions this account flagged, newest first,
// with the lesson, the reason and a way back to the lesson's questions. Hidden when empty.
import { activeReports, clearReport, onReportsChange, questionReportsReady, reasonLabel } from '../utils/question-reports.js';

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};

export async function initQuestionReportsPanel({ section, materials = [] }) {
  if (!section) return;
  const list = section.querySelector('[data-question-reports-list]');
  const titles = new Map(materials.map((m) => [m.id, m.title]));
  const live = make('p', '', 'sr-only');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  section.append(live);
  const render = () => {
    const reports = activeReports().sort((a, b) => b.at - a.at);
    section.hidden = !reports.length;
    list.replaceChildren(
      ...reports.map((report) => {
        const item = make('li', null, 'question-report-row');
        const statement = make('p', report.statement || 'Questão sem enunciado salvo', 'question-report-statement');
        const meta = make('p', null, 'question-report-meta');
        meta.append(make('span', `⚑ ${reasonLabel(report.reason)}`));
        if (report.note) meta.append(make('span', `“${report.note}”`));
        const actions = make('div', null, 'question-report-actions');
        if (report.materialId) {
          const link = make('a', `Abrir ${titles.get(report.materialId) || 'aula'}`);
          link.href = `./material.html?id=${encodeURIComponent(report.materialId)}#questoes`;
          actions.append(link);
        }
        const undo = make('button', 'Desfazer', 'text-action');
        undo.type = 'button';
        undo.setAttribute('aria-label', `Desfazer a marcação: ${report.statement || 'questão'}`);
        undo.addEventListener('click', async () => {
          await clearReport(report.id).catch(() => {});
          live.textContent = 'Marcação removida.';
          render();
          (list.querySelector('button') || section.querySelector('h2'))?.focus?.();
        });
        actions.append(undo);
        item.append(statement, meta, actions);
        return item;
      }),
    );
  };
  await questionReportsReady();
  render();
  onReportsChange(render);
}
