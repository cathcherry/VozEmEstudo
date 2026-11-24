// The lesson notebook as a writing area, in a real browser with a SIMULATED API (mock-app.cjs;
// no real backend or database): open the notebook → the caret is in the text → type at once →
// Enter makes paragraphs → markdown-like starts make a title, a list and a checklist → autosave →
// reload → the text reopens. A notebook saved in the old block format opens intact and, after an
// edit, is saved back with every other block unchanged (ids, lists, checklist state, quote and
// the cited highlight). Pasted HTML is reduced to text (nothing runs). Failed save → "Tentar de
// novo". Undo. axe at 1440 and 390 px, no horizontal scroll at 390 px.
// NOTEBOOK_SHOTS=<dir> also writes review captures there.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { state, errors, passed, record, axeCheck, noHorizontalScroll, openApp, settle, allFlags, startServer, launchBrowser } = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'notebook-editor');
fs.mkdirSync(output, { recursive: true });
const review = process.env.NOTEBOOK_SHOTS ? path.resolve(process.env.NOTEBOOK_SHOTS) : null;
async function capture(page, name) {
  await page.locator('.nb-cover-flap').first().waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  const target = page.locator('[data-notes-section]');
  await target.screenshot({ path: path.join(output, `${name}.png`) });
  if (review) await target.screenshot({ path: path.join(review, `${name}.png`) });
}
const flags = { ...allFlags, notebooks: true, journal: true };
const REF = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const OLD_BLOCKS = [
  { id: 'h1', type: 'heading', level: 2, text: 'Fase clara' },
  { id: 'p1', type: 'paragraph', text: 'A luz vira energia química.\nATP e NADPH.' },
  { id: 'l1', type: 'bullet_list', items: ['Clorofila', 'Tilacoide'] },
  { id: 'o1', type: 'ordered_list', items: ['Luz', 'Água', 'Oxigênio'] },
  { id: 'c1', type: 'checklist', items: [{ text: 'Revisar ciclo', checked: true }, { text: 'Fazer resumo', checked: false }] },
  { id: 'c2', type: 'checklist', items: [] },
  { id: 'h2', type: 'heading', level: 3, text: 'Citações' },
  { id: 'q1', type: 'quote', text: 'O carbono é fixado no ciclo de Calvin.' },
  { id: 'r1', type: 'annotation_ref', annotationId: 'n1', sourceRevisionId: REF, sourceRevision: 2 },
  { id: 'p2', type: 'paragraph', text: '' },
];
const saved = (notebook) => notebook.locator('.notebook-status[data-state="saved"]').waitFor({ timeout: 8000 });
const blocksOf = (data) => data.notebooks['l-foto'].doc.blocks;

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    // ---- A new notebook: open, type at once, paragraphs with Enter, shortcuts, autosave ------
    const data = state();
    const { context, page } = await openApp(browser, base, flags, data, { width: 1440, height: 1000 });
    await page.goto(`${base}/material.html?id=l-foto#anotacoes`);
    const notebook = page.locator('[data-lesson-notebook]');
    await notebook.getByRole('button', { name: 'Abrir o caderno' }).click();
    const editor = notebook.getByRole('textbox', { name: 'Texto do caderno' });
    await editor.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('nb-editor')), true, 'opening puts the caret in the text');
    assert.equal(await notebook.locator('.notebook-toolbar[role=toolbar]').count(), 1);
    assert.equal(await notebook.locator('.notebook-add, .notebook-block, textarea').count(), 0, 'no form fields to add blocks');
    await page.keyboard.type('Primeira ideia da aula.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Segunda ideia, sem botão nenhum.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('# Fase clara');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- clorofila');
    await page.keyboard.press('Enter');
    await page.keyboard.type('tilacoide');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('[ ] revisar o ciclo');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Linha um');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('linha dois do mesmo parágrafo.');
    await saved(notebook);
    assert.deepEqual(
      blocksOf(data).map(({ id: _id, ...rest }) => rest),
      [
        { type: 'paragraph', text: 'Primeira ideia da aula.' },
        { type: 'paragraph', text: 'Segunda ideia, sem botão nenhum.' },
        { type: 'heading', level: 2, text: 'Fase clara' },
        { type: 'bullet_list', items: ['clorofila', 'tilacoide'] },
        { type: 'checklist', items: [{ text: 'revisar o ciclo', checked: false }] },
        { type: 'paragraph', text: 'Linha um\nlinha dois do mesmo parágrafo.' },
      ],
    );
    assert.equal(new Set(blocksOf(data).map((b) => b.id)).size, 6, 'unique block ids');
    record('Caderno: abrir → digitar na hora; Enter cria parágrafos; "# ", "- " e "[ ] " viram título, lista e checklist; salvo sozinho');

    // Toolbar: the line with the caret becomes a quote; aria-pressed follows the caret.
    await notebook.locator('.notebook-tool-button[data-kind="quote"]').click();
    assert.equal(await notebook.locator('.notebook-tool-button[data-kind="quote"]').getAttribute('aria-pressed'), 'true');
    await saved(notebook);
    assert.equal(blocksOf(data).at(-1).type, 'quote');
    // Undo brings the paragraph back.
    await page.keyboard.press('Control+z');
    await saved(notebook);
    assert.equal(blocksOf(data).at(-1).type, 'paragraph');
    record('Caderno: barra compacta muda o tipo da linha (aria-pressed acompanha o cursor); Ctrl+Z desfaz');

    // Tick the checklist item with the mouse.
    await editor.locator('ul[data-type="checklist"] input[type=checkbox]').click();
    await saved(notebook);
    assert.equal(blocksOf(data)[4].items[0].checked, true);
    record('Caderno: marcar um item da checklist salva o estado');

    // Paste HTML: only text and the supported types; nothing runs.
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.setData(
        'text/html',
        '<h1 style="color:red">Colado</h1><p>Texto <b>forte</b> e <a href="javascript:alert(1)">link</a></p><script>window.__pwned=1</script><img src="x" onerror="window.__pwned=2"><ul><li>um</li><li>dois</li></ul>',
      );
      transfer.setData('text/plain', 'Colado');
      document.querySelector('.nb-editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    });
    await saved(notebook);
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'pasted code never runs');
    assert.equal(await editor.locator('script, img, a, b, [style], [onerror]').count(), 0, 'no pasted markup in the text');
    assert.deepEqual(
      blocksOf(data).slice(-3).map(({ id: _id, ...rest }) => rest),
      [
        { type: 'heading', level: 2, text: 'Colado' },
        { type: 'paragraph', text: 'Texto forte e link' },
        { type: 'bullet_list', items: ['um', 'dois'] },
      ],
    );
    record('Caderno: colar HTML guarda só texto e os tipos suportados (sem script, imagem, link ou estilo)');

    // A failed save says so and retries with the same request.
    data.notebookFailures = 1;
    await page.keyboard.type(' três');
    const status = notebook.locator('.notebook-status');
    await status.filter({ hasText: 'Não foi possível salvar.' }).waitFor({ timeout: 6000 });
    await settle(page);
    await axeCheck(page, '[data-notes-section]', 'caderno (não salvo)');
    await notebook.getByRole('button', { name: 'Tentar de novo' }).click();
    await saved(notebook);
    const [failed, retried] = data.notebookSaves.slice(-2);
    assert.equal(retried.requestId, failed.requestId, 'retry reuses the request id');
    record('Caderno: falha mostra "Não foi possível salvar." e "Tentar de novo" reenvia o mesmo pedido');

    // Reload: the text reopens as it was.
    const before = JSON.stringify(blocksOf(data));
    await page.reload();
    await editor.locator('h3', { hasText: 'Fase clara' }).waitFor();
    assert.equal(await editor.locator('ul:not([data-type]) > li').count(), 4, 'both lists are back');
    assert.match(await editor.innerText(), /Primeira ideia da aula\.\s+Segunda ideia, sem botão nenhum\./);
    assert.equal(await editor.locator('ul[data-type="checklist"] input').isChecked(), true);
    await page.waitForTimeout(1600);
    assert.equal(JSON.stringify(blocksOf(data)), before, 'opening does not rewrite the notebook');
    await settle(page);
    await axeCheck(page, '[data-notes-section]', 'caderno com texto');
    await capture(page, 'caderno-escrita-1440');
    record('Caderno: depois de recarregar, o texto reabre igual (e abrir não salva nada)');
    await context.close();

    // ---- A notebook in the old block format opens intact and keeps every block ------------------
    const old = state();
    old.notebooks = {
      'l-foto': { id: 'nb', material_id: 'l-foto', title: 'Fotossíntese', version: 4, last_request_id: 'x', visibility: 'private', doc: { type: 'doc', schemaVersion: 1, blocks: OLD_BLOCKS } },
    };
    const second = await openApp(browser, base, flags, old, { width: 1440, height: 1000 });
    await second.page.goto(`${base}/material.html?id=l-foto#anotacoes`);
    const oldBook = second.page.locator('[data-lesson-notebook]');
    await oldBook.getByRole('button', { name: 'Abrir o caderno' }).click();
    const oldEditor = oldBook.locator('.nb-editor');
    await oldEditor.locator('figure.nb-atom blockquote', { hasText: 'A energia luminosa' }).waitFor();
    assert.equal(await oldBook.locator('#lesson-notebook-name').inputValue(), 'Fotossíntese');
    assert.equal(await oldEditor.locator('h3').textContent(), 'Fase clara');
    assert.equal(await oldEditor.locator('h4').textContent(), 'Citações');
    assert.equal(await oldEditor.locator('ol > li').count(), 3);
    assert.deepEqual(await oldEditor.locator('ul[data-type="checklist"] input').evaluateAll((all) => all.map((i) => i.checked)), [true, false, false]);
    assert.equal(await oldEditor.locator('blockquote:not(.notebook-ref-quote)').textContent(), 'O carbono é fixado no ciclo de Calvin.');
    await settle(second.page);
    await axeCheck(second.page, '[data-notes-section]', 'caderno antigo');
    await capture(second.page, 'caderno-antigo-1440');
    // Edit one paragraph: everything else is saved back exactly as it was.
    // Click on the paragraph's last line (its middle sits between the two lines), then End.
    const twoLines = oldEditor.locator('p', { hasText: 'ATP e NADPH.' });
    const lineBox = await twoLines.boundingBox();
    await twoLines.click({ position: { x: 8, y: lineBox.height - 6 } });
    await second.page.keyboard.press('End');
    await second.page.keyboard.type(' (fase clara)');
    await saved(oldBook);
    const expected = OLD_BLOCKS.map((block) => (block.id === 'p1' ? { ...block, text: 'A luz vira energia química.\nATP e NADPH. (fase clara)' } : block));
    assert.deepEqual(blocksOf(old), expected, 'old blocks round-trip unchanged');
    assert.equal(old.notebookSaves.at(-1).version, 4, 'saved on top of the version it read');
    record('Caderno no formato antigo: abre intacto (títulos, listas, checklist marcada, citação, destaque citado) e só o parágrafo editado muda ao salvar');

    // Removing the cited highlight is explicit (keyboard Backspace never deletes it).
    await oldEditor.locator('p').last().click();
    await second.page.keyboard.press('Backspace');
    await second.page.keyboard.press('Backspace');
    await oldEditor.locator('figure.nb-atom').waitFor();
    await oldBook.getByRole('button', { name: 'Remover citação' }).click();
    await saved(oldBook);
    assert.equal(blocksOf(old).some((b) => b.type === 'annotation_ref'), false);
    record('Caderno: a citação só sai pelo botão "Remover citação" (Backspace não a apaga)');

    await second.context.close();

    // ---- "Citar no caderno" over a selection in the transcription ------------------------------
    const quoting = state();
    quoting.segmentsFor = {
      'l-foto': [
        { id: 'seg-1', position: 0, start_ms: 0, end_ms: 1500, current_text: 'A fotossíntese converte energia luminosa.' },
        { id: 'seg-2', position: 1, start_ms: 61000, end_ms: 63000, current_text: 'O oxigênio é liberado pelas folhas.' },
      ],
    };
    const third = await openApp(browser, base, flags, quoting, { width: 1440, height: 1000 });
    await third.page.goto(`${base}/material.html?id=l-foto`);
    await third.page.locator('.transcription-segment .segment-text').nth(1).waitFor();
    await third.page.evaluate(() => {
      const segment = document.querySelectorAll('.transcription-segment .segment-text')[1];
      const range = document.createRange();
      range.setStart(segment.firstChild, 0);
      range.setEnd(segment.firstChild, 'O oxigênio é liberado'.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      segment.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await third.page.locator('.selection-popover:not([hidden])').getByRole('button', { name: 'Citar no caderno' }).click();
    const quoteBook = third.page.locator('[data-lesson-notebook]');
    // The notebook sits in the hidden Anotações tab: wait for the save itself.
    for (let n = 0; n < 80 && !quoting.notebooks?.['l-foto']; n++) await third.page.waitForTimeout(100);
    const cited = blocksOf(quoting).find((b) => b.type === 'annotation_ref');
    const note = quoting.savedNotes.at(-1);
    assert.equal(cited.annotationId, note.id, 'the highlight is saved and cited');
    assert.equal(note.body.quote, 'O oxigênio é liberado');
    await third.page.locator('#tab-notes').click();
    await quoteBook.locator('figure.nb-atom', { hasText: 'O oxigênio é liberado' }).waitFor();
    assert.match(await quoteBook.locator('figure.nb-atom .notebook-ref-meta').first().textContent(), /revisão 1 · 01:01/);
    record('Transcrição: "Citar no caderno" sobre uma seleção cria o destaque e o cita no caderno com revisão e tempo (01:01)');
    await third.context.close();

    // Phone, night theme and the largest text.
    const phone = await openApp(browser, base, flags, old, { width: 390, height: 844 });
    await phone.context.addInitScript(() => {
      localStorage.setItem('audioestudo-theme', 'night');
      localStorage.setItem('audioestudo-ui-preferences', JSON.stringify({ textSize: 'maximum' }));
    });
    await phone.page.goto(`${base}/material.html?id=l-foto#anotacoes`);
    await phone.page.locator('[data-lesson-notebook]').getByRole('button', { name: 'Abrir o caderno' }).click();
    await phone.page.locator('.nb-editor h3').waitFor();
    await settle(phone.page);
    await noHorizontalScroll(phone.page, 'caderno 390');
    await axeCheck(phone.page, '[data-notes-section]', 'caderno 390 noite texto grande');
    await capture(phone.page, 'caderno-390-noite-grande');
    record('Caderno a 390 px, tema noite e texto máximo: sem rolagem horizontal, axe sem violações');
    await phone.context.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (errors.length) throw new Error(`Erros no navegador:\n${errors.join('\n')}`);
  console.log(JSON.stringify({ passed: passed.length }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
