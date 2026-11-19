import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  buildStudyDocument,
  toMarkdown,
  toPlainText,
  renderPrintable,
  safeFilename,
  PRINT_STYLE,
} from '../js/utils/study-document.js';

const material = {
  id: 'm1',
  title: 'História do Brasil',
  subject: 'História',
  review: { state: 'ready_to_generate' },
  transcription: {
    current_revision: 3,
    current_text: 'ignorado quando há trechos',
    transcription_segments: [
      { position: 1, start_ms: 65000, end_ms: 70000, current_text: 'Segundo trecho.' },
      { position: 0, start_ms: 0, end_ms: 5000, current_text: 'Primeiro <b>trecho</b>.' },
    ],
  },
  summaries: [],
};
const summary = {
  version: 2,
  label: 'Para a prova',
  source_transcription_revision: 3,
  text: '## Independência\n\nTexto com **negrito** e *itálico*.\n\n- Item um\n- Item dois\n\n1. Primeiro\n2. Segundo',
};
const batch = {
  id: 'b1',
  source_transcription_revision: 3,
  questions: [
    {
      id: 'q1',
      statement: 'Quando ocorreu a Independência?',
      options: ['1500', '1822', '1889', '1930'],
    },
    { id: 'q2', statement: 'Quem proclamou?', options: ['A', 'B', 'C', 'D'] },
  ],
};
const key = {
  questions: [
    {
      id: 'q1',
      statement: batch.questions[0].statement,
      options: batch.questions[0].options,
      correctIndex: 1,
      explanation: 'A aula cita 1822.',
    },
    {
      id: 'q2',
      statement: batch.questions[1].statement,
      options: batch.questions[1].options,
      correctIndex: 0,
      explanation: 'Dito na aula.',
    },
  ],
};

test('Markdown keeps headings, lists, emphasis, timestamps and numbered questions', () => {
  const doc = buildStudyDocument(material, {
    transcript: true,
    summary,
    lists: [{ batch, name: 'História — Conceitos básicos' }],
  });
  const md = toMarkdown(doc);
  assert.match(md, /^# História do Brasil\n\n\*História\*/);
  assert.match(md, /## Transcrição\n\n\*Revisão 3 · confirmada\*/);
  // Segments are ordered by position and keep their time range.
  assert.match(
    md,
    /\*\*\[00:00–00:05\]\*\* Primeiro <b>trecho<\/b>\.\n\n\*\*\[01:05–01:10\]\*\* Segundo trecho\./,
  );
  assert.match(
    md,
    /## Resumo — Para a prova\n\n\*Versão 2 · fonte: revisão 3\*\n\n### Independência/,
  );
  assert.match(md, /- Item um\n- Item dois/);
  assert.match(md, /1\. Primeiro\n2\. Segundo/);
  assert.match(md, /\*\*negrito\*\* e \*itálico\*/);
  assert.match(
    md,
    /## História — Conceitos básicos\n\n\*2 questões · fonte: revisão 3 · folha do aluno, sem respostas\*/,
  );
  assert.match(md, /1\. Quando ocorreu a Independência\?\n {3}a\) 1500\n {3}b\) 1822/);
  assert.match(md, /2\. Quem proclamou\?/);
  const noTimes = toMarkdown(buildStudyDocument(material, { transcript: true, timestamps: false }));
  assert.doesNotMatch(noTimes, /\[00:00/);
});

test('student worksheets never contain answers; the teacher key is explicit', () => {
  // Even if a key is loaded, the student variant must not print it.
  const student = toMarkdown(
    buildStudyDocument(material, { lists: [{ batch, name: 'L', key }], variant: 'student' }),
  );
  assert.doesNotMatch(student, /Resposta correta|Explicação|1822\.\*\*|A aula cita/);
  const teacher = toMarkdown(
    buildStudyDocument(material, { lists: [{ batch, name: 'L', key }], variant: 'teacher' }),
  );
  assert.match(teacher, /gabarito do professor/);
  assert.match(
    teacher,
    /\*\*Resposta correta:\*\* b\) 1822\n {3}\*Explicação:\* A aula cita 1822\./,
  );
  // Teacher variant without a loaded key behaves like a worksheet.
  assert.doesNotMatch(
    toMarkdown(buildStudyDocument(material, { lists: [{ batch, name: 'L' }], variant: 'teacher' })),
    /Resposta correta/,
  );
});

test('attempt report shows the marked answers and the score', () => {
  const attempt = {
    answers: [
      {
        questionId: 'q1',
        selectedIndex: 2,
        correct: false,
        correctIndex: 1,
        explanation: 'A aula cita 1822.',
      },
    ],
  };
  const md = toMarkdown(
    buildStudyDocument(material, { lists: [{ batch, name: 'L', attempt }], variant: 'attempt' }),
  );
  assert.match(md, /\*\*Resultado:\*\* 0 de 2 corretas/);
  assert.match(md, /Resposta marcada:\* c\) — incorreta/);
  assert.match(md, /Resposta marcada:\* não respondida/);
});

test('plain text keeps structure without Markdown markers', () => {
  const txt = toPlainText(
    buildStudyDocument(material, { summary, lists: [{ batch, name: 'Lista A' }] }),
  );
  assert.match(txt, /^História do Brasil\n=+/);
  assert.match(txt, /RESUMO — PARA A PROVA\n-+/);
  assert.match(txt, /Texto com negrito e itálico\./);
  assert.match(txt, /- Item um/);
  assert.match(txt, /1\. Quando ocorreu/);
  assert.doesNotMatch(txt, /\*\*|^#/m);
});

test('printable A4 page renders structure with text nodes only', () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  globalThis.document = dom.window.document;
  try {
    const target = new JSDOM('<!doctype html><html><head></head><body></body></html>').window
      .document;
    const doc = buildStudyDocument(
      { ...material, title: 'Aula <img src=x onerror=alert(1)>' },
      {
        transcript: true,
        summary: { ...summary, text: '**Ok** <script>alert(1)</script>\n\n- a' },
        lists: [{ batch, name: 'L', key }],
        variant: 'teacher',
      },
    );
    renderPrintable(doc, target);
    assert.equal(target.querySelectorAll('script, img').length, 0);
    assert.equal(target.querySelector('h1').textContent, 'Aula <img src=x onerror=alert(1)>');
    assert.equal(target.querySelector('article strong').textContent, 'Ok');
    assert.equal(target.querySelectorAll('ol.questions > li').length, 2);
    assert.equal(
      target.querySelectorAll('ol.questions > li')[0].querySelectorAll('ol.options li').length,
      4,
    );
    assert.match(target.querySelector('.key').textContent, /Resposta correta: b\) 1822/);
    assert.equal(target.querySelectorAll('.time').length, 2);
    // Question lists start on a new page; questions avoid splitting across pages.
    assert(target.querySelector('.doc-section.page-start h2').textContent === 'L');
    assert.match(PRINT_STYLE, /@page\{size:A4;margin:18mm/);
    assert.match(PRINT_STYLE, /ol\.questions>li\{[^}]*break-inside:avoid/);
    assert.match(PRINT_STYLE, /h2\{[^}]*break-after:avoid/);
  } finally {
    delete globalThis.document;
  }
});

test('flashcard sets and filenames', () => {
  const md = toMarkdown(
    buildStudyDocument(material, {
      flashcardSets: [
        { name: 'Datas', cards: [{ front_text: 'Independência?', back_text: '1822' }] },
      ],
    }),
  );
  assert.match(md, /## Datas\n\n\*1 cartão\*\n\n1\. \*\*Independência\?\*\*\n {3}1822/);
  assert.equal(safeFilename('História do Brasil / 2º ano', 'md'), 'historia-do-brasil-2o-ano.md');
  assert.equal(safeFilename('', 'txt'), 'voz-em-estudo.txt');
});

test('flashcard CSV: documented header, RFC 4180 quoting, UTF-8 BOM and formula neutralisation', async () => {
  const { toFlashcardCsv, csvCell, FLASHCARD_CSV_COLUMNS } =
    await import('../js/utils/flashcard-csv.js');
  assert.deepEqual(FLASHCARD_CSV_COLUMNS, [
    'front',
    'back',
    'set',
    'lesson',
    'difficulty',
    'focus',
    'style',
    'source_revision_id',
    'evidence',
  ]);
  const csv = toFlashcardCsv(
    [
      {
        name: 'Conjunto "A"',
        source_revision_id: 'rev-1',
        cards: [
          {
            front_text: 'Mitose?',
            back_text: 'Duas células,\nidênticas.',
            difficulty: 'basic',
            focus: 'definitions',
            card_style: 'question_answer',
            evidence: 'A mitose…',
          },
          { front_text: '=HYPERLINK("x")', back_text: '+1', difficulty: null },
        ],
      },
    ],
    { lesson: 'Biologia' },
  );
  assert(
    csv.startsWith('﻿front,back,set,lesson,difficulty,focus,style,source_revision_id,evidence\r\n'),
  );
  const lines = csv.slice(1).split('\r\n');
  assert.equal(
    lines[1],
    '"Mitose?","Duas células,\nidênticas.","Conjunto ""A""","Biologia","basic","definitions","question_answer","rev-1","A mitose…"',
  );
  assert.equal(
    lines[2],
    `"'=HYPERLINK(""x"")","'+1","Conjunto ""A""","Biologia","","","","rev-1",""`,
  );
  assert.equal(csvCell('@SUM(A1)'), `"'@SUM(A1)"`);
  assert.equal(csvCell('-2'), `"'-2"`);
  assert(csv.endsWith('\r\n'));
});

test('an unconfirmed revision is never exported as the transcription', () => {
  const pending = { ...material, review: { state: 'awaiting_review' } };
  const md = toMarkdown(buildStudyDocument(pending, { transcript: true, summary }));
  assert.doesNotMatch(md, /## Transcrição|Primeiro <b>trecho/);
  assert.match(md, /## Resumo/);
});
