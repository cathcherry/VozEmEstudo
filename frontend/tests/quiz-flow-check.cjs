// Question lists (quiz_v2) in a real browser with the simulated app (support/mock-quiz.cjs):
//   1. Start: two option cards and one "Começar" button.
//   2. Correction at the end: no permanent "registered" message and no answer key before
//      concluding; a saved answer moves on to the next question (focus on its heading, polite
//      announcement); a failed save keeps the question, the choice and a visible error.
//   3. Last answer offers "Concluir tentativa"; results show letter AND text, icon AND word,
//      the lesson excerpt, and one short line instead of a disclaimer.
//   4. Correction after each question: the person reads it and presses "Próxima questão".
//   5. Older data without option text says so instead of inventing it.
//   6. The lesson's Questões tab lists the attempts of each list (continue / see result).
// 1440 and 390 px, axe. Nothing here calls a real backend, AI provider or Supabase project.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {
  state, errors, passed, record, axeCheck, noHorizontalScroll, openApp, shotter, settle,
  allFlags, startServer, launchBrowser,
} = require('./support/mock-app.cjs');
const { QUIZ_BATCH } = require('./support/mock-quiz.cjs');

const output = path.join(__dirname, 'artifacts', 'quiz-flow');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);
const URL_ = '/responder.html?material=l-foto&batch=bq';

function quizData() {
  const data = state();
  data.extraBatches = { 'l-foto': [QUIZ_BATCH] };
  data.lessonStage = { 'l-foto': 'questions' };
  return data;
}

async function start(page, base, mode) {
  await page.goto(base + URL_);
  await page.getByRole('heading', { name: 'Como você quer responder?' }).waitFor();
  await page.getByRole('radio', { name: mode === 'immediate' ? 'Correção a cada questão' : 'Correção no final' }).check();
  await page.getByRole('button', { name: 'Começar', exact: true }).click();
  await page.locator('[data-quiz-primary]').waitFor();
}
const heading = (page) => page.locator('h1#quiz-statement');

async function deferred(browser, base) {
  for (const width of [1440, 390]) {
    const data = quizData();
    const { context, page } = await openApp(browser, base, allFlags, data, { width, height: 900 });
    await page.goto(base + URL_);
    await page.getByRole('heading', { name: 'Como você quer responder?' }).waitFor();
    assert.equal(await page.locator('.quiz-mode-card').count(), 2, 'two option cards');
    await settle(page);
    await noHorizontalScroll(page, `início ${width}`);
    await axeCheck(page, 'main', `início ${width}`);
    await shot(page, `start-${width}.png`);
    await start(page, base, 'deferred');

    // A failed save: the question, the choice and a persistent error stay.
    data.quiz.failAnswers = 1;
    await page.getByRole('radio', { name: /Mitocôndria/ }).check();
    await page.getByRole('button', { name: 'Salvar e avançar' }).click();
    await page.getByRole('alert').filter({ hasText: 'A resposta não foi salva.' }).waitFor();
    await page.waitForTimeout(400);
    assert.equal(await heading(page).textContent(), QUIZ_BATCH.questions[0].statement, 'no advance after a failed save');
    assert(await page.getByRole('radio', { name: /Mitocôndria/ }).isChecked(), 'choice kept');
    await axeCheck(page, 'main', `erro ao salvar ${width}`);
    await shot(page, `save-failed-${width}.png`);

    // Retry works and moves on, focus on the next heading, polite announcement.
    await page.getByRole('button', { name: 'Salvar e avançar' }).click();
    await page.waitForFunction((text) => document.activeElement?.textContent === text, QUIZ_BATCH.questions[1].statement);
    await page.waitForFunction(() => /Resposta da questão 1 salva\. Questão 2 de 4/.test(document.querySelector('[data-quiz-live]').textContent));
    const body = await page.locator('main').textContent();
    assert.doesNotMatch(body, /gabarito será apresentado|Resposta registrada/);
    // Back to the saved question: marked as "Sua resposta", never correct/incorrect.
    await page.getByRole('button', { name: 'Anterior' }).click();
    await page.locator('.quiz-answer-card.is-saved', { hasText: 'Mitocôndria' }).waitFor();
    assert.equal(await page.locator('.is-correct, .is-wrong, .quiz-feedback').count(), 0, 'no key before concluding');
    assert(await page.getByRole('radio', { name: /Mitocôndria/ }).isDisabled(), 'a saved answer is final');
    await page.getByRole('button', { name: 'Próxima questão' }).click();
    for (const option of ['Oxigênio', '15']) {
      await page.getByRole('radio', { name: new RegExp(option) }).check();
      await page.getByRole('button', { name: 'Salvar e avançar' }).click();
      await page.waitForFunction((text) => document.activeElement?.textContent === text, option === '15' ? QUIZ_BATCH.questions[3].statement : QUIZ_BATCH.questions[2].statement);
    }
    await page.getByRole('radio', { name: /Luz/ }).check();
    await page.getByRole('button', { name: 'Salvar resposta' }).click();
    await page.getByRole('button', { name: 'Concluir tentativa' }).waitFor();
    assert.equal(await heading(page).textContent(), QUIZ_BATCH.questions[3].statement, 'the last answer stays to conclude');
    assert.equal(await page.locator('.is-correct, .is-wrong, .quiz-feedback').count(), 0);
    await shot(page, `last-${width}.png`);
    await page.getByRole('button', { name: 'Concluir tentativa' }).click();

    // Results: letter and text, icon and word, excerpt, one short line.
    await page.getByRole('heading', { name: 'Resultado da tentativa' }).waitFor();
    const results = page.locator('.quiz-v2-diagnostic');
    await results.getByText('Sua resposta: D — 15').waitFor();
    await results.getByText('Resposta correta: A — 2').waitFor();
    await results.getByText('Sua resposta: A — Mitocôndria').waitFor();
    assert.equal(await results.locator('.quiz-review-mark', { hasText: 'Errou' }).count(), 2);
    assert.equal(await results.locator('.quiz-review-mark svg').count(), 2, 'icon + word');
    await results.getByText('Trecho da aula').first().waitFor();
    assert.doesNotMatch(await page.locator('main').textContent(), /clínica|diagnóstica|domínio do assunto/);
    await page.locator('.quiz-review-all summary').click();
    assert.equal(await page.locator('.quiz-review-list [data-result="success"]').count(), 2);
    await settle(page);
    await noHorizontalScroll(page, `resultado ${width}`);
    await axeCheck(page, 'main', `resultado ${width}`);
    await shot(page, `results-${width}.png`);
    await context.close();
  }
  record('Correção no final: sem mensagem fixa nem gabarito antes de concluir; salvar avança (foco no enunciado, aviso educado); falha ao salvar não avança e mostra erro persistente; "Concluir tentativa" ao final; resultado com letra e texto, ícone e palavra, trecho da aula; 1440 e 390; axe');
}

async function immediate(browser, base) {
  const data = quizData();
  const { context, page } = await openApp(browser, base, allFlags, data, { width: 1440, height: 900 });
  await start(page, base, 'immediate');
  await page.getByRole('radio', { name: /Mitocôndria/ }).check();
  await page.getByRole('button', { name: 'Confirmar resposta' }).click();
  const feedback = page.locator('.quiz-feedback');
  await feedback.waitFor();
  assert.equal(await heading(page).textContent(), QUIZ_BATCH.questions[0].statement, 'stays to read the correction');
  await page.waitForFunction(() => document.activeElement?.classList.contains('quiz-feedback'));
  assert.match(await feedback.textContent(), /Resposta incorreta/);
  assert.match(await feedback.textContent(), /Sua resposta: A — Mitocôndria/);
  assert.match(await feedback.textContent(), /Resposta correta: B — Cloroplasto/);
  assert.match(await feedback.textContent(), /Trecho da aula/);
  await page.locator('.quiz-answer-card.is-correct', { hasText: 'Correta' }).waitFor();
  await page.locator('.quiz-answer-card.is-wrong', { hasText: 'Sua resposta · incorreta' }).waitFor();
  await axeCheck(page, 'main', 'correção imediata');
  await page.getByRole('button', { name: 'Próxima questão' }).click();
  await page.waitForFunction((text) => document.activeElement?.textContent === text, QUIZ_BATCH.questions[1].statement);
  // The personal mark sits in the question header and says nobody else receives it.
  await page.getByRole('button', { name: 'Sinalizar esta questão para revisar (marca pessoal)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sinalizar questão para revisar' });
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /ninguém mais recebe/);
  await dialog.locator('[data-dialog-close]').click();
  await dialog.waitFor({ state: 'detached' });
  await context.close();
  record('Correção a cada questão: a correção fica até "Próxima questão" (foco na correção); marcação pessoal no cabeçalho, sem prometer que alguém recebe');
}

async function olderData(browser, base) {
  const data = quizData();
  data.quiz = { noOptionText: true };
  const { context, page } = await openApp(browser, base, allFlags, data, { width: 390, height: 900 });
  await start(page, base, 'deferred');
  for (const option of ['Mitocôndria', 'Oxigênio', '2', 'Luz']) {
    await page.getByRole('radio', { name: new RegExp(`^[A-D] ${option}$`) }).check();
    await page.locator('[data-quiz-primary="save"]').click();
    await page.waitForTimeout(250);
  }
  await page.getByRole('button', { name: 'Concluir tentativa' }).click();
  await page.locator('.quiz-v2-diagnostic').getByText('Sua resposta: A (texto da alternativa não disponível)').waitFor();
  await page.locator('.quiz-v2-diagnostic').getByText('Resposta correta: B (texto da alternativa não disponível)').waitFor();
  await context.close();
  record('Dados antigos sem texto da alternativa: mostra só a letra e diz que o texto não está disponível');
}

async function lessonTab(browser, base) {
  const data = quizData();
  data.quizSessions.push(
    { id: 'qs-bq-open', material_id: 'l-foto', batch_id: 'bq', status: 'active', kind: 'full', created_at: new Date().toISOString() },
    { id: 'qs-bq-done', material_id: 'l-foto', batch_id: 'bq', status: 'completed', kind: 'full', created_at: new Date(Date.now() - 2 * 86400000).toISOString() },
  );
  const { context, page } = await openApp(browser, base, allFlags, data, { width: 1440, height: 900 });
  await page.goto(base + '/material.html?id=l-foto#questoes');
  const row = page.locator('.question-batch-card[data-batch-id="bq"]');
  const resume = row.getByRole('link', { name: /^Continuar tentativa/ });
  await resume.waitFor();
  assert.match(await resume.getAttribute('href'), /responder\.html\?material=l-foto&batch=bq&session=qs-bq-open$/);
  await row.locator('.list-attempts summary').click();
  assert.match(await row.getByRole('link', { name: /^Ver resultado/ }).getAttribute('href'), /session=qs-bq-done$/);
  await settle(page);
  await axeCheck(page, '#questoes', 'tentativas na aba Questões');
  await context.close();
  record('Aba Questões da aula: "Continuar tentativa" e "Tentativas (n)" com continuar / ver resultado em cada lista');
}

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
  try {
    for (const [name, run] of Object.entries({ deferred, immediate, olderData, lessonTab }))
      if (!only || only.test(name)) await run(browser, base);
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${passed.length} quiz-flow checks passed.`);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
