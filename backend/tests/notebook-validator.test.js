import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateNotebookSave, BLOCK_TYPES } from '../src/validators/notebook.validator.js';
import { validateAnnotationRange } from '../src/validators/learning-tools.validator.js';
import { buildLearningToolsService } from '../src/services/learning-tools.service.js';

const doc = (blocks) => ({ type: 'doc', schemaVersion: 1, blocks });
const body = (blocks, extra = {}) => ({ version: 0, requestId: randomUUID(), doc: doc(blocks), ...extra });
const rejects = (input, code) => assert.throws(() => validateNotebookSave(input), (error) => error.code === code);

test('notebook schema: every block type accepted, plain text only, strict fields and limits', () => {
  const ref = randomUUID().toUpperCase();
  const all = validateNotebookSave(body([
    { id: 'h', type: 'heading', level: 2, text: 'Título' },
    { id: 'p', type: 'paragraph', text: 'Se a < b e b > c, então a < c.' },
    { id: 'u', type: 'bullet_list', items: ['um', 'dois'] },
    { id: 'o', type: 'ordered_list', items: ['primeiro'] },
    { id: 'c', type: 'checklist', items: [{ text: 'Rever', checked: true }] },
    { id: 'q', type: 'quote', text: 'Citação' },
    { id: 'r', type: 'annotation_ref', annotationId: ref, sourceRevisionId: ref, sourceRevision: 2 },
  ]));
  assert.deepEqual(all.doc.blocks.map((block) => block.type), BLOCK_TYPES);
  assert.equal(all.doc.blocks[6].annotationId, ref.toLowerCase(), 'ids are normalized for the database');
  assert.equal(all.title, '');
  for (const blocks of [
    [{ id: 'x', type: 'paragraph', text: '<script>alert(1)</script>' }],
    [{ id: 'x', type: 'bullet_list', items: ['<img src=x onerror=alert(1)>'] }],
    [{ id: 'x', type: 'quote', text: 'fim</p>' }],
    [{ id: 'x', type: 'paragraph', text: '<!-- comentário -->' }],
  ])
    assert.throws(() => validateNotebookSave(body(blocks)), /marcações HTML/);
  rejects(body([], { title: '<b>x</b>' }), 'NOTEBOOK_INVALID');
  rejects(body([{ id: 'x', type: 'iframe', src: 'https://example.test' }]), 'NOTEBOOK_INVALID');
  rejects(body([{ id: 'x', type: 'paragraph', text: 'oi', html: '<b>' }]), 'NOTEBOOK_INVALID');
  rejects(body([{ id: 'x', type: 'heading', level: 1, text: 'h1 é o título da página' }]), 'NOTEBOOK_INVALID');
  rejects(body([{ id: 'bad id!', type: 'paragraph', text: '' }]), 'NOTEBOOK_INVALID');
  rejects(body([{ id: 'r', type: 'annotation_ref', annotationId: 'x', sourceRevisionId: randomUUID() }]), 'NOTEBOOK_INVALID');
  rejects({ ...body([]), doc: { type: 'doc', schemaVersion: 2, blocks: [] } }, 'NOTEBOOK_INVALID');
  rejects({ ...body([]), extra: true }, 'NOTEBOOK_INVALID');
  rejects(body(Array.from({ length: 301 }, (_, i) => ({ id: `b${i}`, type: 'paragraph', text: '' }))), 'NOTEBOOK_INVALID');
  rejects(body([{ id: 'x', type: 'bullet_list', items: Array(101).fill('i') }]), 'NOTEBOOK_INVALID');
  rejects(body([{ id: 'x', type: 'paragraph', text: 'a'.repeat(5001) }]), 'NOTEBOOK_INVALID');
  const big = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, type: 'paragraph', text: 'é'.repeat(2100) }));
  assert.throws(() => validateNotebookSave(body(big)), (error) => error.code === 'NOTEBOOK_TOO_LARGE' && error.status === 413, 'bytes, not characters');
});

test('range anchors: start before end, quote required, at most 50 segments', () => {
  const base = { id: randomUUID(), materialId: randomUUID(), version: 0, requestId: randomUUID() };
  const anchor = { sourceRevisionId: randomUUID(), segmentPosition: 2, startOffset: 10, endSegmentPosition: 4, endOffset: 3, quote: 'a\nb\nc' };
  assert.equal(validateAnnotationRange({ ...base, body: anchor }).body.endSegmentPosition, 4);
  for (const bad of [
    { ...anchor, endSegmentPosition: 1 },
    { ...anchor, endSegmentPosition: 53 },
    { ...anchor, quote: undefined, noteText: 'só nota' },
    { ...anchor, endSegmentPosition: 2, endOffset: 10 },
    { ...anchor, html: true },
  ])
    assert.throws(() => validateAnnotationRange({ ...base, body: bad }));
  assert.throws(() => validateAnnotationRange({ ...base, version: 1, body: { endSegmentPosition: 3 } }), 'anchor is immutable');
  assert.equal(validateAnnotationRange({ ...base, version: 1, body: { noteText: 'nova' } }).body.noteText, 'nova');
});

test('the annotations service picks the range function only with FEATURE_NOTEBOOKS', async () => {
  const calls = [];
  const store = { saveNote: async () => calls.push('e14'), saveNoteRange: async () => calls.push('range') };
  const note = { id: randomUUID(), materialId: randomUUID(), version: 0, requestId: randomUUID(), body: { sourceRevisionId: randomUUID(), noteText: 'x' } };
  await buildLearningToolsService(store, null, { ranges: false }).saveNote('u', note);
  await buildLearningToolsService(store, null, { ranges: true }).saveNote('u', note);
  assert.deepEqual(calls, ['e14', 'range']);
  assert.throws(() =>
    buildLearningToolsService(store, null, { ranges: false }).saveNote('u', { ...note, body: { ...note.body, quote: 'a\nb', segmentPosition: 0, startOffset: 0, endOffset: 1, endSegmentPosition: 1 } }),
  );
});
