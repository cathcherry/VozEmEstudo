// Structured study documents. One model feeds Markdown, plain text and the printable (A4) page, so
// headings, lists and numbered questions survive every format. Only saved server data enters a
// document; text typed in edit fields is never read here.
import { formatTimestamp } from './format.js';
import { renderMarkdown } from './markdown.js';

const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

/**
 * @param material the material DTO (saved data only)
 * @param options.lists [{ name, batch, key?, attempt? }]; `key` holds correct answers, used only for
 *   the teacher variant; `attempt` holds a completed attempt for the attempt report.
 */
export function buildStudyDocument(material, options = {}) {
  const {
    transcript = false,
    timestamps = true,
    summary = null,
    notes = [],
    lists = [],
    variant = 'student',
    flashcardSets = [],
  } = options;
  const sections = [];
  const transcription = material.transcription;
  if (transcript && transcription) {
    const confirmed = material.review?.state === 'ready_to_generate';
    const segments = [...(transcription.transcription_segments || [])].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );
    sections.push({
      heading: 'Transcrição',
      meta: `Revisão ${transcription.current_revision}${confirmed ? ' · confirmada' : ' · aguardando conferência'}`,
      blocks: [
        {
          type: 'transcript',
          items: segments.length
            ? segments.map((s) => ({
                time: timestamps ? `${formatTimestamp(s.start_ms)}–${formatTimestamp(s.end_ms)}` : null,
                text: s.current_text,
              }))
            : [{ time: null, text: transcription.current_text || '' }],
        },
      ],
    });
  }
  if (summary)
    sections.push({
      heading: summary.label ? `Resumo — ${summary.label}` : 'Resumo',
      meta: `Versão ${summary.version} · fonte: revisão ${summary.source_transcription_revision}`,
      blocks: [{ type: 'markdown', text: summary.text || '' }],
    });
  if (notes.length)
    sections.push({
      heading: 'Anotações pessoais',
      blocks: [
        {
          type: 'notes',
          items: notes.map((n) => ({ revision: n.source_revision, quote: n.quote || '', note: n.note_text || '' })),
        },
      ],
    });
  for (const list of lists) {
    const questions = list.key?.questions || list.batch.questions || [];
    const withKey = variant === 'teacher' && Boolean(list.key);
    const attempt = variant === 'attempt' ? list.attempt : null;
    const answers = new Map((attempt?.answers || []).map((a) => [a.questionId, a]));
    sections.push({
      heading: list.name,
      meta: [
        `${questions.length} ${questions.length === 1 ? 'questão' : 'questões'}`,
        `fonte: revisão ${list.batch.source_transcription_revision}`,
        withKey ? 'gabarito do professor' : attempt ? 'relatório da tentativa' : 'folha do aluno, sem respostas',
      ].join(' · '),
      blocks: [
        {
          type: 'questions',
          items: questions.map((q) => {
            const answer = answers.get(q.id);
            return {
              statement: q.statement,
              options: q.options || [],
              ...(withKey ? { correctIndex: q.correctIndex, explanation: q.explanation || '' } : {}),
              ...(attempt
                ? {
                    selectedIndex: answer?.selectedIndex ?? null,
                    correct: answer?.correct ?? null,
                    correctIndex: answer?.correctIndex,
                    explanation: answer?.explanation || '',
                  }
                : {}),
            };
          }),
          ...(attempt
            ? {
                summary: `${(attempt.answers || []).filter((a) => a.correct).length} de ${questions.length} corretas`,
              }
            : {}),
        },
      ],
    });
  }
  for (const set of flashcardSets)
    sections.push({
      heading: set.name,
      meta: `${set.cards.length} ${set.cards.length === 1 ? 'cartão' : 'cartões'}`,
      blocks: [{ type: 'cards', items: set.cards.map((c) => ({ front: c.front_text, back: c.back_text })) }],
    });
  return {
    title: material.title,
    subtitle: material.subject || 'Sem disciplina',
    sections,
  };
}

/** Lowers summary headings so they nest under the section heading (## → ###). */
const nestHeadings = (text, levels = 1) =>
  String(text).replace(/^(#{1,5})(\s)/gm, (_, hashes, space) => '#'.repeat(Math.min(6, hashes.length + levels)) + space);

const optionLabel = (index) => `${LETTERS[index] || index + 1})`;

function questionMarkdown(item, number) {
  const lines = [`${number}. ${item.statement}`];
  item.options.forEach((option, i) => lines.push(`   ${optionLabel(i)} ${option}`));
  if (item.selectedIndex !== undefined) {
    lines.push(
      '',
      `   *Resposta marcada:* ${item.selectedIndex === null ? 'não respondida' : optionLabel(item.selectedIndex)}` +
        (item.correct === null ? '' : item.correct ? ' — correta' : ' — incorreta'),
    );
  }
  if (Number.isInteger(item.correctIndex)) {
    lines.push('', `   **Resposta correta:** ${optionLabel(item.correctIndex)} ${item.options[item.correctIndex] ?? ''}`);
    if (item.explanation) lines.push(`   *Explicação:* ${item.explanation}`);
  }
  return lines.join('\n');
}

export function toMarkdown(doc) {
  const out = [`# ${doc.title}`, '', `*${doc.subtitle}*`];
  for (const section of doc.sections) {
    out.push('', `## ${section.heading}`);
    if (section.meta) out.push('', `*${section.meta}*`);
    for (const block of section.blocks) {
      out.push('');
      if (block.type === 'markdown') out.push(nestHeadings(block.text).trim());
      if (block.type === 'transcript')
        out.push(block.items.map((i) => (i.time ? `**[${i.time}]** ${i.text}` : i.text)).join('\n\n'));
      if (block.type === 'notes')
        out.push(
          block.items
            .map((n) => [`- Revisão ${n.revision}`, n.quote && `  - Destaque: ${n.quote}`, n.note && `  - Nota: ${n.note}`].filter(Boolean).join('\n'))
            .join('\n'),
        );
      if (block.type === 'questions') {
        if (block.summary) out.push(`**Resultado:** ${block.summary}`, '');
        out.push(block.items.map((item, i) => questionMarkdown(item, i + 1)).join('\n\n'));
      }
      if (block.type === 'cards')
        out.push(block.items.map((c, i) => `${i + 1}. **${c.front}**\n   ${c.back.replace(/\n/g, '\n   ')}`).join('\n\n'));
    }
  }
  return out.join('\n') + '\n';
}

/** Plain text keeps structure (titles, numbering, bullets) without Markdown syntax. */
export function toPlainText(doc) {
  const strip = (line) => line.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/`([^`]+)`/g, '$1');
  return (
    toMarkdown(doc)
      .split('\n')
      .map((line) => {
        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (!heading) return strip(line);
        const text = strip(heading[2]);
        if (heading[1].length === 1) return `${text}\n${'='.repeat(Math.min(72, text.length))}`;
        if (heading[1].length === 2) return `\n${text.toLocaleUpperCase('pt-BR')}\n${'-'.repeat(Math.min(72, text.length))}`;
        return text;
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
  );
}

export const PRINT_STYLE = `@page{size:A4;margin:18mm 18mm 20mm}
*{box-sizing:border-box}
body{margin:0 auto;max-width:174mm;color:#14213d;font:11.5pt/1.55 Georgia,'Times New Roman',serif}
h1{margin:0 0 2mm;font-size:22pt;line-height:1.2}
h2{margin:9mm 0 1mm;font-size:15pt;break-after:avoid;page-break-after:avoid}
h3,h4,h5,h6{margin:5mm 0 1mm;font-size:12.5pt;break-after:avoid;page-break-after:avoid}
p,li{orphans:3;widows:3}
.doc-subtitle,.section-meta{margin:0 0 3mm;color:#4a5568;font-style:italic}
.doc-section+.doc-section.page-start{break-before:page;page-break-before:always}
.transcript p{margin:0 0 2.5mm}
.time{margin-right:2mm;color:#4a5568;font:600 9.5pt/1 ui-monospace,'Courier New',monospace;font-variant-numeric:tabular-nums}
ol.questions{padding-left:7mm}
ol.questions>li{margin:0 0 5mm;break-inside:avoid;page-break-inside:avoid}
ol.options{margin:1.5mm 0 0;padding-left:7mm;list-style:lower-alpha}
.key,.result{margin:1.5mm 0 0;padding:1.5mm 3mm;border-left:2.5pt solid #1d3fa6;background:#f1f4fb}
.blank-line{margin-top:3mm;border-bottom:.6pt solid #9aa5b8;height:6mm}
.cards li{margin-bottom:3mm;break-inside:avoid}
.print-toolbar{position:sticky;top:0;padding:8px 0;background:#fff}
@media print{.print-toolbar{display:none}}`;

/** Renders the document into a (popup) document with text nodes and the safe Markdown renderer. */
export function renderPrintable(doc, target) {
  const make = (tag, text, className) => {
    const node = target.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  target.title = doc.title;
  const style = make('style');
  style.textContent = PRINT_STYLE;
  target.head.append(style);
  const body = target.body;
  body.replaceChildren(make('h1', doc.title), make('p', doc.subtitle, 'doc-subtitle'));
  doc.sections.forEach((section, index) => {
    const wrap = make('section', null, `doc-section${index > 0 && section.blocks[0]?.type === 'questions' ? ' page-start' : ''}`);
    wrap.append(make('h2', section.heading));
    if (section.meta) wrap.append(make('p', section.meta, 'section-meta'));
    for (const block of section.blocks) {
      if (block.type === 'markdown') {
        const article = make('article');
        renderMarkdown(article, nestHeadings(block.text));
        wrap.append(target.importNode(article, true));
      }
      if (block.type === 'transcript') {
        const container = make('div', null, 'transcript');
        for (const item of block.items) {
          const p = make('p');
          if (item.time) p.append(make('span', item.time, 'time'));
          p.append(target.createTextNode(item.text));
          container.append(p);
        }
        wrap.append(container);
      }
      if (block.type === 'notes') {
        const list = make('ul');
        for (const n of block.items) {
          const li = make('li', `Revisão ${n.revision}`);
          if (n.quote) li.append(make('div', `Destaque: ${n.quote}`));
          if (n.note) li.append(make('div', `Nota: ${n.note}`));
          list.append(li);
        }
        wrap.append(list);
      }
      if (block.type === 'questions') {
        if (block.summary) wrap.append(make('p', `Resultado: ${block.summary}`, 'result'));
        const list = make('ol', null, 'questions');
        for (const item of block.items) {
          const li = make('li');
          li.append(make('p', item.statement));
          const options = make('ol', null, 'options');
          for (const option of item.options) options.append(make('li', option));
          li.append(options);
          if (item.selectedIndex !== undefined)
            li.append(
              make(
                'p',
                `Resposta marcada: ${item.selectedIndex === null ? 'não respondida' : optionLabel(item.selectedIndex)}` +
                  (item.correct === null ? '' : item.correct ? ' — correta' : ' — incorreta'),
                'result',
              ),
            );
          if (Number.isInteger(item.correctIndex)) {
            const key = make('div', null, 'key');
            const strong = make('strong', 'Resposta correta: ');
            key.append(strong, target.createTextNode(`${optionLabel(item.correctIndex)} ${item.options[item.correctIndex] ?? ''}`));
            if (item.explanation) key.append(make('p', `Explicação: ${item.explanation}`));
            li.append(key);
          } else if (item.selectedIndex === undefined) li.append(make('div', null, 'blank-line'));
          list.append(li);
        }
        wrap.append(list);
      }
      if (block.type === 'cards') {
        const list = make('ol', null, 'cards');
        for (const card of block.items) {
          const li = make('li');
          li.append(make('strong', card.front), make('div', card.back));
          list.append(li);
        }
        wrap.append(list);
      }
    }
    body.append(wrap);
  });
}

/** Browser print dialog: the user saves as PDF there. Labelled as such in the interface. */
export function printDocument(doc, popup) {
  if (!popup) throw new Error('Permita abrir a janela de impressão para salvar o PDF.');
  popup.opener = null;
  renderPrintable(doc, popup.document);
  const toolbar = popup.document.createElement('div');
  toolbar.className = 'print-toolbar';
  const button = popup.document.createElement('button');
  button.textContent = 'Imprimir / salvar como PDF';
  button.addEventListener('click', () => popup.print());
  toolbar.append(button);
  popup.document.body.prepend(toolbar);
  void (popup.document.fonts?.ready || Promise.resolve()).then(() => popup.print());
}

export function safeFilename(title, extension) {
  const base = String(title || 'voz-em-estudo')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .toLowerCase();
  return `${base || 'voz-em-estudo'}.${extension}`;
}
