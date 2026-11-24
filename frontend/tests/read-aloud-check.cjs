// Leitura em voz alta, verified by what is actually handed to speechSynthesis: the Web Speech API
// is replaced by a recorder (headless Chromium has no voices), every utterance's text, voice and
// order is captured, and onstart/onboundary/onend are driven by hand.
//   BROWSER_EXECUTABLE=… node frontend/tests/read-aloud-check.cjs
const assert = require('node:assert/strict');
const m = require('./support/mock-app.cjs');

const LONG_P =
  'A fotossíntese é o processo pelo qual plantas, algas e algumas bactérias convertem a energia luminosa em energia química. ' +
  'Ela ocorre principalmente nas folhas, dentro dos cloroplastos, organelas que contêm clorofila, o pigmento verde que absorve a luz azul e vermelha. ' +
  'O processo consome gás carbônico e água e libera oxigênio para a atmosfera, sustentando a maior parte da vida no planeta, inclusive a nossa.';
const SECOND_P =
  'Na fase clara, a energia da luz quebra moléculas de água, liberando oxigênio e produzindo ATP e NADPH, que serão usados na etapa seguinte do ciclo.';
const SUMMARY = [
  '## Visão geral',
  LONG_P,
  '',
  '## Etapas',
  SECOND_P,
  '',
  '- Fase clara: ocorre nos tilacoides.',
  '- Fase escura: ocorre no estroma, com o **ciclo de Calvin**.',
  '',
  '1. Absorção da luz',
  '2. Fixação do carbono',
].join('\n');

// Recorder for the Web Speech API. Voices: a remote pt-BR voice listed first, then a local one.
const STUB = () => {
  const log = [];
  const queue = [];
  const voices = [
    { name: 'English', lang: 'en-US', localService: true },
    { name: 'Rede pt-BR', lang: 'pt-BR', localService: false },
    { name: 'Local pt-BR', lang: 'pt_BR', localService: true },
  ];
  const synth = {
    paused: false,
    get speaking() {
      return queue.length > 0;
    },
    get pending() {
      return queue.length > 1;
    },
    getVoices: () => (window.__noVoices ? [] : voices),
    speak(u) {
      log.push({ text: u.text, voice: u.voice?.name || null, lang: u.lang, rate: u.rate });
      queue.push(u);
      if (queue.length === 1) setTimeout(() => queue[0] === u && u.onstart?.({}), 0);
    },
    cancel() {
      log.push({ cancel: true });
      const dropped = queue.splice(0);
      dropped.forEach((u) => u.onerror?.({ error: 'canceled' }));
    },
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  window.__tts = {
    log,
    current: () => queue[0]?.text ?? null,
    end() {
      const u = queue.shift();
      u?.onend?.({});
      if (queue[0]) queue[0].onstart?.({});
      return Boolean(u);
    },
    boundary(charIndex) {
      queue[0]?.onboundary?.({ name: 'word', charIndex });
    },
    fail(error) {
      const u = queue.shift();
      u?.onerror?.({ error });
      if (queue[0]) queue[0].onstart?.({});
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) {
    this.text = text;
  };
  try {
    localStorage.setItem('audioestudo-ui-preferences', JSON.stringify({ readAloud: 'everywhere' }));
  } catch {
    /* storage blocked: the check would fail visibly */
  }
};

const spoken = (page) =>
  page.evaluate(() => window.__tts.log.filter((e) => e.text).map((e) => e.text));
const clearLog = (page) => page.evaluate(() => window.__tts.log.splice(0));
// Lets the voice "finish" every passage and returns the texts in order.
async function drain(page) {
  for (let i = 0; i < 200; i += 1) {
    await page.waitForTimeout(5);
    if (!(await page.evaluate(() => window.__tts.end()))) break;
  }
  return spoken(page);
}
const norm = (s) => s.replace(/\s+/g, ' ').trim();

(async () => {
  const { server, base } = await m.startServer();
  const browser = await m.launchBrowser();
  const data = m.state();
  data.lessonStage = { 'l-foto': 'questions' };
  data.summaryText = { 'l-foto': SUMMARY };
  data.segmentsFor = {
    'l-foto': [
      {
        id: 'seg-1',
        position: 0,
        start_ms: 0,
        end_ms: 4000,
        current_text: 'Primeiro trecho da aula sobre a luz.',
      },
      {
        id: 'seg-2',
        position: 1,
        start_ms: 4000,
        end_ms: 8000,
        current_text: 'Segundo trecho, sobre a clorofila.',
      },
      {
        id: 'seg-3',
        position: 2,
        start_ms: 8000,
        end_ms: 12000,
        current_text: 'Terceiro trecho: o ciclo de Calvin.',
      },
    ],
  };
  const { context, page } = await m.openApp(browser, base, m.allFlags, data);
  await context.addInitScript(STUB);
  try {
    // 1. Whole page on the Resumo tab: every heading, paragraph and list item, in order.
    await page.goto(`${base}/material.html?id=l-foto#resumo`);
    await m.settle(page);
    await page.locator('[data-summary-text] p').first().waitFor();
    await clearLog(page);
    const pageReader = page.locator('.page-reader .speak-button');
    await pageReader.click();
    await page.waitForTimeout(20);
    // The passage being read is highlighted, one block at a time.
    assert.equal(await page.locator('.is-speaking').count(), 1);
    assert.equal(
      await page.getAttribute('.page-reader .speak-button', 'aria-label'),
      'Pausar leitura',
    );
    const texts = await drain(page);
    if (process.env.DEBUG_TTS) console.log(texts);
    const all = texts.join(' ');
    for (const t of texts)
      assert(t.length <= 180, `passage too long for Chrome (${t.length}): ${t}`);
    for (const expected of [
      'Visão geral',
      LONG_P,
      'Etapas',
      SECOND_P,
      'Fase clara: ocorre nos tilacoides.',
      'Fase escura: ocorre no estroma, com o ciclo de Calvin.',
      'Absorção da luz',
      'Fixação do carbono',
    ])
      assert(all.includes(norm(expected)), `not read: ${expected.slice(0, 60)}`);
    const at = (s) => all.indexOf(s);
    assert(at('Fotossíntese e respiração celular') < at('Visão geral'));
    assert(at('Visão geral') < at('A fotossíntese é o processo'));
    assert(at('A fotossíntese é o processo') < at('Etapas'));
    assert(at('Etapas') < at('Na fase clara'));
    assert(at('Na fase clara') < at('Fase clara: ocorre'));
    assert(at('Fase escura') < at('Absorção da luz'));
    // Each sentence once; no control names, hidden tab or screen-reader-only heading.
    assert.equal(all.split('A fotossíntese é o processo').length - 1, 1, 'read twice');
    for (const never of [
      'Gerar resumo',
      'Versões',
      'Ouvir',
      'Editar informações',
      'Primeiro trecho',
      'Conjunto 1',
      'Criar flashcards',
    ])
      assert(!all.includes(never), `should not read “${never}”`);
    assert(!texts.includes('Resumo'), 'sr-only tab heading is not read');
    assert.equal(await page.locator('.is-speaking').count(), 0, 'highlight cleared at the end');
    assert.equal(
      await page.getAttribute('.page-reader .speak-button', 'aria-label'),
      'Ouvir esta página',
    );
    // Long paragraph: several passages, cut at sentence ends.
    const longParts = texts.filter((t) => t.length > 40 && LONG_P.includes(t));
    assert(longParts.length >= 3, `long paragraph chunked (${longParts.length})`);
    assert.equal(longParts.join(' '), LONG_P);
    m.record?.('whole page reads headings, paragraphs and lists in order, chunked');

    // 2. Voice: the local pt-BR voice wins over a network one listed first; lesson language set.
    const voices = await page.evaluate(() =>
      window.__tts.log.filter((e) => e.text).map((e) => `${e.voice}|${e.lang}`),
    );
    assert(
      voices.every((v) => v === 'Local pt-BR|pt-BR'),
      voices[0],
    );

    // 3. The summary's own speaker reads only the summary, with highlight on the block.
    await clearLog(page);
    await page.locator('[data-summary-speech] .speak-button').click();
    await page.waitForTimeout(20);
    assert.equal(
      await page
        .locator('[data-summary-text] h3.is-speaking, [data-summary-text] .is-speaking')
        .count(),
      1,
    );
    // Pause in the middle of the long paragraph: resumes from the last word reached.
    await page.evaluate(() => window.__tts.end()); // "Visão geral"
    await page.waitForTimeout(10);
    const before = await page.evaluate(() => window.__tts.current());
    assert(before.startsWith('A fotossíntese é o processo'));
    assert(
      await page
        .locator('[data-summary-text] p')
        .first()
        .evaluate((p) => p.classList.contains('is-speaking')),
    );
    const offset = before.indexOf('converte');
    await page.evaluate((i) => window.__tts.boundary(i), offset);
    await page.locator('[data-summary-speech] .speak-button').click();
    assert.equal(
      await page.getAttribute('[data-summary-speech] .speak-button', 'aria-label'),
      'Continuar leitura',
    );
    assert.equal(await page.evaluate(() => window.__tts.current()), null, 'paused by cancelling');
    assert(
      await page
        .locator('[data-summary-text] p')
        .first()
        .evaluate((p) => p.classList.contains('is-speaking')),
      'highlight kept while paused',
    );
    await page.waitForTimeout(50);
    await page.locator('[data-summary-speech] .speak-button').click();
    await page.waitForTimeout(10);
    assert.equal(await page.evaluate(() => window.__tts.current()), before.slice(offset));
    const summaryTexts = await drain(page);
    assert(
      !summaryTexts.join(' ').includes('Fotossíntese e respiração celular'),
      'only the summary',
    );
    assert(summaryTexts.join(' ').includes('Fixação do carbono'));
    m.record?.('summary speaker, highlight, pause and resume from the last word');

    // 4. Stop clears everything; a failing voice is retried once with the default voice.
    await clearLog(page);
    await page.locator('[data-summary-speech] .speak-button').click();
    await page.waitForTimeout(10);
    await page.evaluate(() => window.__tts.fail('synthesis-failed'));
    const retry = await page.evaluate(() => window.__tts.log.filter((e) => e.text).slice(-2));
    assert.equal(retry[0].text, retry[1].text);
    assert.equal(retry[1].voice, null, 'second try without a chosen voice');
    await page.locator('[data-summary-speech] .speak-stop').click();
    assert.equal(await page.locator('.is-speaking').count(), 0);
    assert(await page.locator('[data-summary-speech] .speak-stop').isHidden());
    assert.equal(await page.evaluate(() => window.__tts.current()), null);

    // 5. A selection is read alone.
    await clearLog(page);
    await page.evaluate(() => {
      const p = document.querySelectorAll('[data-summary-text] p')[1];
      const range = document.createRange();
      range.selectNodeContents(p);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await pageReader.click();
    assert.deepEqual(await drain(page), [SECOND_P]);
    await page.evaluate(() => getSelection().removeAllRanges());

    // 6. Transcript tab: the segments, in order, once each.
    await page.locator('#tab-transcription').click();
    await page.waitForTimeout(150);
    await clearLog(page);
    await pageReader.click();
    const transcript = (await drain(page)).join(' ');
    const segs = [
      'Primeiro trecho da aula sobre a luz.',
      'Segundo trecho, sobre a clorofila.',
      'Terceiro trecho: o ciclo de Calvin.',
    ];
    for (const s of segs)
      assert.equal(transcript.split(s).length - 1, 1, `segment read once: ${s}`);
    assert(
      transcript.indexOf(segs[0]) < transcript.indexOf(segs[1]) &&
        transcript.indexOf(segs[1]) < transcript.indexOf(segs[2]),
    );
    assert(!transcript.includes('Visão geral'), 'hidden summary tab is not read');
    assert(
      !transcript.includes('Confirmar e continuar') && !transcript.includes('Editar transcrição'),
    );

    // 7. Questions: the list's speaker, and the whole page once the list is open.
    await page.locator('#tab-questions').click();
    await page.waitForTimeout(150);
    await page.locator('.list-questions > summary').first().click();
    await clearLog(page);
    await page.locator('.list-questions .speak-button').first().click();
    assert.deepEqual(await drain(page), ['Questão 1. Onde ocorre a fotossíntese?']);
    await clearLog(page);
    await pageReader.click();
    const questions = await drain(page);
    assert(
      questions.includes('Onde ocorre a fotossíntese? – Não respondida'),
      questions.join(' | '),
    );
    assert(!questions.join(' ').includes('Reportar problema'), 'control names are not read');
    assert(
      !questions.join(' ').includes('Ver questões'),
      'details summary (a control) is not read',
    );
    m.record?.('transcript and questions read in order without controls');

    // 8. Without any voice installed the browser still gets lang=pt-BR (it picks its default).
    await page.evaluate(() => {
      window.__noVoices = true;
    });
    await clearLog(page);
    await page.locator('.list-questions .speak-button').first().click();
    const noVoice = await page.evaluate(() => window.__tts.log.find((e) => e.text));
    assert.equal(noVoice.voice, null);
    assert.equal(noVoice.lang, 'pt-BR');
    await page.locator('.list-questions .speak-stop').first().click();

    assert.deepEqual(m.errors, []);
    console.log('read-aloud-check: ok');
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
