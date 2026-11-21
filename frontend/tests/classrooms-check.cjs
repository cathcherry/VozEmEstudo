// Turmas (private classrooms) in a real browser with a SIMULATED API (support/mock-classrooms.cjs):
// a teacher creates a class, invites, publishes a lesson; a student joins by link, submits a
// recording and shares a flashcard set; the teacher moves the submission through each separate
// step. Dialogs: keyboard, Escape, focus return. axe at 1280 and 390 px, no horizontal scroll.
// Nothing here calls a real backend, database or AI provider; the permission rules themselves are
// tested against Postgres in backend/tests/classrooms-*.test.js.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {
  state,
  errors,
  passed,
  record,
  axeCheck,
  noHorizontalScroll,
  openApp,
  shotter,
  settle,
  allFlags,
  startServer,
  launchBrowser,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'classrooms');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);
const flags = { ...allFlags, classrooms: true };
const student = {
  id: 'user-student',
  email: 'aluno@example.test',
  email_confirmed_at: new Date().toISOString(),
  user_metadata: { display_name: 'Caio Lima' },
};
const activeText = (page) => page.evaluate(() => document.activeElement?.textContent?.trim());

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    const data = state();
    data.lessonStage = { 'l-foto': 'questions' };
    data.sets = [{ id: 'set-1', name: 'Fotossíntese — revisão', status: 'active', card_count: 2 }];

    // ---------- Feature off: no navigation item, an explanation instead of the page ---------
    {
      const { context, page } = await openApp(browser, base, allFlags, state());
      await page.goto(base + '/turmas.html');
      await page
        .locator('[data-tool-unavailable]:not([hidden])', {
          hasText: 'Turmas ainda não estão ativas',
        })
        .waitFor();
      assert.equal(
        await page.locator('.primary-navigation a[href="./turmas.html"]').isVisible(),
        false,
      );
      await context.close();
      record(
        'Sem a flag: Turmas fica fora do menu e a página explica que o recurso não está ativo',
      );
    }

    // ---------- Teacher: create, invite, publish ---------------------------------------------
    const teacher = await openApp(browser, base, flags, data, { width: 1280, height: 900 });
    const page = teacher.page;
    await page.goto(base + '/turmas.html');
    await page.locator('[data-classrooms-home]:not([hidden])').waitFor();
    assert(
      await page.locator('.primary-navigation a[href="./turmas.html"]').isVisible(),
      'nav item',
    );
    await page.locator('text=Nenhuma turma ainda').waitFor();
    await settle(page);
    await axeCheck(page, 'main', 'Turmas vazia');
    const create = page.locator('[data-classroom-open="create"]');
    await create.click();
    const dialog = page.locator('dialog[open]');
    assert.equal(
      await page.evaluate(() => document.activeElement.labels?.[0]?.textContent.trim()),
      'Nome da turma',
    );
    assert.equal(
      await dialog.locator('input[name="displayName"]').inputValue(),
      'Marina Souza',
      'profile name is the default',
    );
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await activeText(page), 'Nova turma', 'Escape closes and focus returns');
    await create.click();
    await dialog.locator('input[name="name"]').fill('Biologia 2º ano');
    await dialog.locator('textarea[name="description"]').fill('Turma da manhã');
    await dialog.locator('button[type="submit"]').click();
    await page.waitForURL(/turmas\.html\?turma=/);
    await page.locator('[data-classroom-name]', { hasText: 'Biologia 2º ano' }).waitFor();
    const classUrl = page.url().split('#')[0];
    record(
      'Professor cria a turma pelo diálogo (nome do perfil sugerido; Esc fecha e devolve o foco)',
    );

    // Invite from the Members tab: a link with the code in the fragment, shown once.
    await page.locator('[role="tab"]', { hasText: 'Membros' }).click();
    const inviteButton = page.locator('[data-classroom-open="invite"]');
    await inviteButton.click();
    await dialog.locator('select[name="days"]').selectOption('7');
    await dialog.locator('input[name="maxUses"]').fill('25');
    await dialog.locator('button[type="submit"]').click();
    const linkInput = page.locator('dialog[open] #classroom-invite-link');
    await linkInput.waitFor();
    const link = await linkInput.inputValue();
    assert.match(
      link,
      /\/turmas\.html#convite=[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/,
    );
    await page.locator('dialog[open] button', { hasText: 'Copiar link' }).click();
    await page
      .locator('dialog[open] [role="status"]', { hasText: /Link copiado|Selecione o link/ })
      .waitFor();
    await axeCheck(page, 'dialog[open]', 'Convite criado');
    await page.locator('dialog[open] button[type="submit"]', { hasText: 'Concluir' }).click();
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    await page.waitForTimeout(50);
    assert.equal(await activeText(page), 'Convidar alunos', 'focus returns to the opener');
    await page.locator('[data-invites-list] .status-chip', { hasText: 'Ativo' }).waitFor();
    await page.locator('[data-invites-list]', { hasText: '0 de 25 usos' }).waitFor();
    record(
      'Convite: link com código no fragmento (#convite=), copiar, exibido uma vez; lista mostra usos',
    );

    // Publish one of the teacher's own lessons with its summary and a question list.
    await page.locator('[role="tab"]', { hasText: 'Aulas publicadas' }).click();
    await page.locator('[data-classroom-open="publish"]').click();
    await dialog.locator('select[name="materialId"]').selectOption('l-foto');
    await dialog.locator('select[name="summaryId"]').waitFor();
    await dialog.locator('text=revisão 1, mesmo que você a edite depois').waitFor();
    await dialog.locator('select[name="summaryId"]').selectOption('s1');
    await dialog.locator('input[name="questionBatchIds"]').check();
    await axeCheck(page, 'dialog[open]', 'Publicar aula');
    await dialog.locator('button[type="submit"]').click();
    await page
      .locator('[data-lessons-list] li', { hasText: 'Fotossíntese e respiração celular' })
      .waitFor();
    assert.deepEqual(data.publishedBodies.at(-1), {
      id: data.publishedBodies.at(-1).id,
      materialId: 'l-foto',
      revisionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      summaryId: 's1',
      questionBatchIds: ['b1'],
    });
    record(
      'Publicar aula: só aulas próprias com transcrição confirmada, fixa a revisão, resumo e lista escolhidos',
    );

    // ---------- Student: join by link, read, submit, share ---------------------------------
    const pupil = await openApp(
      browser,
      base,
      flags,
      data,
      { width: 390, height: 844 },
      { user: student },
    );
    const spage = pupil.page;
    await spage.goto(link);
    await spage.locator('dialog[open] input[name="code"]').waitFor();
    assert.match(
      await spage.locator('dialog[open] input[name="code"]').inputValue(),
      /^[A-Z2-9-]{14}$/,
    );
    assert.equal(new URL(spage.url()).hash, '', 'the code leaves the address bar');
    await spage.locator('dialog[open] button[type="submit"]').click();
    await spage.waitForURL(/turmas\.html\?turma=/);
    await spage.locator('[data-classroom-meta] .status-chip', { hasText: 'Aluno(a)' }).waitFor();
    assert.equal(
      await spage.locator('[data-classroom-open="publish"]').isVisible(),
      false,
      'students do not publish',
    );
    await spage.locator('[data-lessons-list] button', { hasText: 'Abrir aula' }).click();
    const reader = spage.locator('[data-lesson-reader]:not([hidden])');
    await reader.locator('text=A fotossíntese converte energia luminosa').waitFor();
    await reader.locator('text=Onde ocorre a fotossíntese?').waitFor();
    assert.equal(
      await spage.evaluate(() => document.activeElement.matches('[data-lesson-reader]')),
      true,
    );
    await settle(spage);
    await axeCheck(spage, 'main', 'Aula publicada (aluno, 390 px)');
    await noHorizontalScroll(spage, 'Aula publicada 390');
    await reader.locator('button', { hasText: 'Fechar aula' }).click();
    assert.equal(await activeText(spage), 'Abrir aula');
    await shot(spage, 'aluno-aula-390');
    record(
      'Aluno entra pelo link (código sai da barra), lê a aula publicada; 390 px sem rolagem lateral, axe',
    );

    await spage.locator('[role="tab"]', { hasText: 'Envios' }).click();
    await spage.locator('[data-classroom-open="submit"]').click();
    await spage.locator('dialog[open] select[name="materialId"]').selectOption('l-rev');
    await spage.locator('dialog[open] textarea[name="note"]').fill('Aula de reforço');
    await spage.locator('dialog[open] button[type="submit"]').click();
    await spage.locator('[data-submissions-list] .status-chip', { hasText: 'Enviado' }).waitFor();
    await spage.locator('[role="tab"]', { hasText: 'Flashcards compartilhados' }).click();
    await spage.locator('[data-classroom-open="share"]').click();
    await spage.locator('dialog[open] select[name="setId"]').selectOption('set-1');
    await spage.locator('dialog[open] button[type="submit"]').click();
    await spage.locator('[data-shared-list] li', { hasText: 'Fotossíntese — revisão' }).waitFor();
    await noHorizontalScroll(spage, 'Flashcards 390');
    record('Aluno envia gravação (estado Enviado) e compartilha um conjunto de flashcards');

    // ---------- Teacher: each step is separate --------------------------------------------
    // Same document, new hash: reload to fetch the current state.
    await page.goto(classUrl + '#envios');
    await page.reload();
    const row = page.locator('[data-submissions-list] li', { hasText: 'Revolução Industrial' });
    await row.locator('.status-chip', { hasText: 'Enviado' }).waitFor();
    assert.equal(
      await row.locator('button', { hasText: 'Publicar na turma' }).count(),
      0,
      'cannot publish before the steps',
    );
    await row.locator('button', { hasText: 'Aprovar para processar' }).click();
    await row.locator('.status-chip', { hasText: 'Aprovado para processar' }).waitFor();
    // The student starts processing (teacher has no such button).
    assert.equal(await row.locator('button').count(), 1, 'only "Recusar" for the teacher');
    await spage.goto(classUrl + '#envios');
    await spage.reload();
    await spage
      .locator('[data-submissions-list] button', { hasText: 'Já processei a gravação' })
      .click();
    await spage
      .locator('[data-submissions-list] .status-chip', { hasText: 'Em processamento' })
      .waitFor();
    await page.reload();
    await row.locator('button', { hasText: 'Conferir e confirmar transcrição' }).click();
    await page
      .locator('dialog[open] [role="region"]', { hasText: 'a luz é absorvida pela clorofila' })
      .waitFor();
    await axeCheck(page, 'dialog[open]', 'Conferir transcrição');
    await page.locator('dialog[open] button[type="submit"]').click();
    await row.locator('.status-chip', { hasText: 'Transcrição confirmada' }).waitFor();
    await row.locator('button', { hasText: 'Publicar na turma' }).click();
    await row.locator('.status-chip', { hasText: 'Publicado na turma' }).waitFor();
    assert.deepEqual(
      data.transitions.map((t) => t.to),
      ['approved_for_processing', 'processing', 'transcription_confirmed', 'published'],
    );
    await page.locator('[role="tab"]', { hasText: 'Aulas publicadas' }).click();
    await page.locator('[data-lessons-list] li', { hasText: 'enviada por aluno' }).waitFor();
    await page.locator('[role="tab"]', { hasText: 'Flashcards compartilhados' }).click();
    const shared = page.locator('[data-shared-list] li', { hasText: 'Fotossíntese — revisão' });
    await shared.locator('text=Caio Lima').waitFor();
    await shared.locator('button', { hasText: 'Ver cartões' }).click();
    await shared.locator('text=Onde ocorre o ciclo de Calvin?').waitFor();
    assert.equal(await shared.locator('button[aria-expanded="true"]').count(), 1);
    await page.locator('[role="tab"]', { hasText: 'Membros' }).click();
    await page.locator('[data-members-list] li', { hasText: 'Caio Lima' }).waitFor();
    await settle(page);
    await axeCheck(page, 'main', 'Turma do professor');
    await noHorizontalScroll(page, 'Turma 1280');
    await shot(page, 'professor-membros-1280');
    record(
      'Professor: aprovar, (aluno processa), conferir transcrição e publicar são etapas distintas; conjunto do aluno com autoria',
    );

    // Keyboard: arrow keys move between tabs.
    await page.locator('[role="tab"][aria-selected="true"]').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await activeText(page), 'Flashcards compartilhados');
    record('Abas da turma com setas do teclado');

    // ---------- Another interface language: interface translated, user content untouched -------
    {
      const english = await openApp(browser, base, flags, data, { width: 390, height: 844 });
      await english.page.addInitScript(() =>
        localStorage.setItem('audioestudo-ui-preferences', JSON.stringify({ language: 'en' })),
      );
      await english.page.goto(classUrl);
      await english.page.waitForFunction(
        () => !document.documentElement.hasAttribute('data-i18n-pending'),
      );
      await english.page.locator('[role="tab"]', { hasText: 'Published lessons' }).waitFor();
      assert.equal((await english.page.locator('h1').textContent()).trim(), 'Classes');
      assert.equal(
        (await english.page.locator('[data-classroom-name]').textContent()).trim(),
        'Biologia 2º ano',
      );
      await english.page
        .locator('[data-lessons-list] strong', { hasText: 'Fotossíntese e respiração celular' })
        .waitFor();
      await noHorizontalScroll(english.page, 'Turma em inglês 390');
      await english.context.close();
      record('Em inglês: interface traduzida; nome da turma e títulos das aulas intactos; 390 px');
    }

    // ---------- The student leaves: the class disappears for them -----------------------------
    await spage.goto(classUrl);
    await spage.locator('[data-classroom-actions] button', { hasText: 'Sair da turma' }).click();
    await spage.locator('dialog[open] button[type="submit"]', { hasText: 'Sair' }).click();
    await spage.waitForURL(/turmas\.html$/);
    await spage.locator('text=Nenhuma turma ainda').waitFor();
    await spage.goto(classUrl);
    await spage
      .locator('[data-tool-unavailable]:not([hidden])', { hasText: 'Turma indisponível' })
      .waitFor();
    await page.reload();
    await page.locator('[role="tab"]', { hasText: 'Flashcards compartilhados' }).click();
    await page
      .locator('[data-shared-list]', { hasText: 'Ninguém compartilhou conjuntos ainda.' })
      .waitFor();
    record('Ao sair, a turma some para o aluno e o conjunto dele deixa de aparecer para a turma');

    await pupil.context.close();
    await teacher.context.close();
  } finally {
    await browser.close();
    server.close();
  }
  assert.deepEqual(
    errors.filter((e) => !/Sem simulação|404/.test(e)),
    [],
    'browser errors',
  );
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(passed, null, 2));
  console.log(`${passed.length} classroom checks passed (simulated API)`);
}
main().catch((error) => {
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors.slice(0, 5));
  process.exit(1);
});
