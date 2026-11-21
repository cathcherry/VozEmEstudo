// Personalization 2.0 in a real browser with a simulated API and an in-memory `profile_state`:
// Início customization (show/hide, order, density, restore), persistence per account, recovery
// from a failed synchronization, and profile view/edit mode. Nothing here calls a real backend,
// AI provider or Supabase project.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {
  state,
  errors,
  passed,
  record,
  axeCheck,
  ready,
  noHorizontalScroll,
  openApp,
  shotter,
  settle,
  allFlags,
  startServer,
  launchBrowser,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'personalization');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);

const OTHER = {
  id: 'user-other',
  email: 'outra@example.test',
  email_confirmed_at: new Date().toISOString(),
  user_metadata: { display_name: 'Rafa Lima' },
};
const units = (page, column) =>
  page.evaluate(
    (selector) =>
      [...document.querySelectorAll(`${selector} > [data-widget-unit]`)].map(
        (node) => node.dataset.widgetUnit,
      ),
    column === 'main' ? '.dash-main' : '.dash-rail',
  );
const row = (data, owner, key) =>
  data.profileState.find((item) => item.user_id === owner && item.key === key);
/** Waits until the simulated account copy satisfies `check` (saves are asynchronous). */
async function until(check, label) {
  for (let i = 0; i < 50; i++) {
    try {
      if (check()) return;
    } catch {
      /* not there yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out: ${label}`);
}
async function openSheet(page) {
  await page.locator('[data-dashboard-customize]:visible').click();
  await page.locator('[data-dashboard-customize-dialog][open]').waitFor();
  await page.waitForTimeout(300); // opening animation
}

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    // ---------- Default stays excellent; customization is opt-in ---------------------------
    const data = state();
    data.profileState = [];
    const { context, page } = await openApp(browser, base, allFlags, data);
    await page.goto(base + '/painel.html');
    await ready(page);
    assert.deepEqual(await units(page, 'main'), ['plan', 'recent']);
    assert.deepEqual(await units(page, 'rail'), ['week', 'agenda', 'subjects', 'notes']);
    assert.equal(row(data, 'user-dashboard', 'dashboard-layout'), undefined, 'no layout written');

    // ---------- Keyboard: open, hide, move, density, close ---------------------------------
    await page.locator('[data-dashboard-customize]').focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-dashboard-customize-dialog][open]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'customize-title');
    assert(await page.locator('[data-customize-reset]').isDisabled(), 'nothing to restore yet');
    await settle(page);
    await axeCheck(page, '[data-dashboard-customize-dialog]', 'Personalizar o Início');
    await shot(page, 'inicio-personalizar-1440', false);
    await page.locator('[data-widget-toggle="cards"]').focus();
    await page.keyboard.press('Space');
    assert(await page.locator('[data-widget="cards"]').isHidden(), 'cards hidden at once');
    assert(await page.locator('[data-widget="tasks"]').isVisible(), 'tasks stay');
    await page.locator('[data-move="notes:-1"]').click();
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.move),
      'notes:-1',
      'focus follows the moved block',
    );
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.move),
      'notes:1',
      'at the top, focus moves to the button that still works',
    );
    assert.deepEqual(await units(page, 'rail'), ['notes', 'week', 'agenda', 'subjects']);
    await page.locator('#dashboard-density').selectOption('compact');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.density), 'compact');
    await page.locator('[data-customize-status]', { hasText: 'Salvo na sua conta' }).waitFor();
    await page.keyboard.press('Escape');
    assert(await page.locator('[data-dashboard-customize-dialog]').evaluate((d) => !d.open));
    assert.equal(
      await page.evaluate(() => document.activeElement.hasAttribute('data-dashboard-customize')),
      true,
      'focus returns to Personalizar',
    );
    // Reading order follows the screen: the rail starts with Anotações.
    assert.equal(
      await page.locator('.dash-rail > .dash-card:not([hidden]) h2').first().textContent(),
      'Anotações',
    );
    await noHorizontalScroll(page, 'Início personalizado');
    await settle(page);
    await axeCheck(page, 'body', 'Início personalizado');
    await shot(page, 'inicio-personalizado-1440');
    const saved = row(data, 'user-dashboard', 'dashboard-layout');
    assert.deepEqual(saved.data.hidden, ['cards']);
    assert.deepEqual(saved.data.order.rail, ['notes', 'week', 'agenda', 'subjects']);
    record(
      'Personalizar o Início por teclado: ocultar cartão, mover bloco (foco acompanha), densidade compacta, Escape devolve o foco, axe sem violações',
    );

    // ---------- Persistence, other account, restore ----------------------------------------
    await page.reload();
    await ready(page);
    assert.deepEqual(await units(page, 'rail'), ['notes', 'week', 'agenda', 'subjects']);
    assert(await page.locator('[data-widget="cards"]').isHidden());
    // Another account signs in on the same browser: it never inherits this layout.
    data.user = OTHER;
    await page.reload();
    await ready(page);
    assert.deepEqual(await units(page, 'rail'), ['week', 'agenda', 'subjects', 'notes']);
    assert(await page.locator('[data-widget="cards"]').isVisible());
    assert.equal(row(data, OTHER.id, 'dashboard-layout'), undefined);
    // Back to the first account: its layout is still there.
    data.user = null;
    await page.reload();
    await ready(page);
    assert.deepEqual(await units(page, 'rail'), ['notes', 'week', 'agenda', 'subjects']);
    await openSheet(page);
    await page.locator('[data-customize-reset]').click();
    assert.equal(
      await page.evaluate(() => document.activeElement.hasAttribute('data-customize-done')),
      true,
    );
    assert.deepEqual(await units(page, 'rail'), ['week', 'agenda', 'subjects', 'notes']);
    assert(await page.locator('[data-widget="cards"]').isVisible());
    await page.locator('[data-customize-status]', { hasText: 'Salvo na sua conta' }).waitFor();
    assert.deepEqual(row(data, 'user-dashboard', 'dashboard-layout').data.hidden, []);
    await page.locator('.dash-customize-foot [data-customize-done]').click();
    record(
      'Layout salvo por conta: sobrevive ao recarregar, outra conta no mesmo navegador vê o padrão, Restaurar padrão volta tudo',
    );

    // ---------- Failed synchronization and a newer copy from another device ----------------
    data.dbDown = true;
    await openSheet(page);
    await page.locator('[data-widget-toggle="recent"]').uncheck();
    await page.locator('[data-customize-status]', { hasText: 'Salvo neste dispositivo' }).waitFor();
    assert(await page.locator('[data-widget="recent"]').isHidden(), 'still applied offline');
    data.dbDown = false;
    await page.reload();
    await ready(page);
    assert(await page.locator('[data-widget="recent"]').isHidden(), 'pending edit kept');
    assert.deepEqual(
      row(data, 'user-dashboard', 'dashboard-layout').data.hidden,
      ['recent'],
      'the pending edit reaches the account on the next load',
    );
    // Another device saves a newer layout: this browser shows it instead of its own copy.
    Object.assign(row(data, 'user-dashboard', 'dashboard-layout'), {
      data: { version: 1, hidden: ['subjects'], order: { main: ['recent', 'plan'], rail: [] } },
      updated_at: new Date(Date.now() + 60000).toISOString(),
    });
    await page.reload();
    await ready(page);
    await page.waitForFunction(() =>
      document.querySelector('[data-widget="subjects"]')?.hasAttribute('data-user-hidden'),
    );
    assert(await page.locator('[data-widget="recent"]').isVisible());
    assert.deepEqual(await units(page, 'main'), ['recent', 'plan']);
    record(
      'Falha de sincronização: a mudança vale na hora, fica pendente e chega à conta depois; cópia mais nova de outro aparelho prevalece',
    );
    await context.close();

    // ---------- Profile: viewing mode, editing mode and keyboard arrangement ---------------
    {
      const profileData = state();
      profileData.profileState = [
        {
          user_id: 'user-dashboard',
          key: 'profile-blocks',
          updated_at: new Date(Date.now() - 60000).toISOString(),
          data: [
            {
              id: 'b1',
              title: 'O que estou estudando',
              type: 'text',
              content: 'Biologia celular.',
            },
            { id: 'b2', title: 'Rascunho', type: 'text', content: 'Ainda não.', hidden: true },
            // An older block with fields this version does not know keeps working.
            {
              id: 'b3',
              title: 'Passos',
              type: 'text',
              content: 'Um passo.',
              layout: { columns: 4 },
              extra: 1,
            },
          ],
        },
      ];
      const owner = (key) => row(profileData, 'user-dashboard', key)?.data;
      const profile = await openApp(browser, base, allFlags, profileData);
      const p = profile.page;
      await p.goto(base + '/conta.html');
      await p.locator('[data-custom-block="b1"]').waitFor();
      assert.equal(
        await p.locator('[data-custom-block="b2"]').count(),
        0,
        'hidden block not shown',
      );
      assert.equal(
        await p
          .locator(
            '.block-drag-handle:visible, .card-resize-handle:visible, .profile-block-actions:visible',
          )
          .count(),
        0,
        'no editing tools while viewing',
      );
      await settle(p);
      await axeCheck(p, 'main', 'Perfil (visualização)');
      await shot(p, 'perfil-visualizacao-1440');
      await p.locator('[data-profile-edit-toggle]').click();
      assert.equal(
        await p.locator('[data-profile-edit-toggle]').getAttribute('aria-pressed'),
        'true',
      );
      await p.locator('[data-custom-block="b2"].is-hidden-block').waitFor();
      // Keyboard: open the block menu, duplicate, move, resize, show.
      await p.locator('[data-custom-block="b1"] summary').focus();
      await p.keyboard.press('Enter');
      await p.getByRole('button', { name: 'Duplicar', exact: true }).click();
      await until(
        () =>
          owner('profile-blocks')
            .map((b) => b.title)
            .join('|') === 'O que estou estudando|O que estou estudando (cópia)|Rascunho|Passos',
        'duplicate saved',
      );
      const copyId = owner('profile-blocks')[1].id;
      assert.equal(
        await p.evaluate(
          () => document.activeElement.closest('[data-custom-block]')?.dataset.customBlock,
        ),
        copyId,
        'focus on the copy',
      );
      await p.keyboard.press('Enter');
      await p
        .locator(`[data-custom-block="${copyId}"]`)
        .getByRole('button', { name: 'Mover para baixo' })
        .click();
      await until(() => owner('profile-blocks')[2].id === copyId, 'move saved');
      await p.locator(`[data-custom-block="${copyId}"] summary`).click();
      await p
        .locator(`[data-custom-block="${copyId}"]`)
        .getByRole('button', { name: 'Linha inteira' })
        .click();
      await until(() => owner('profile-blocks')[2].layout.columns === 12, 'width saved');
      await p.locator('[data-custom-block="b2"] summary').click();
      await p
        .locator('[data-custom-block="b2"]')
        .getByRole('button', { name: 'Mostrar no perfil' })
        .click();
      await until(
        () => owner('profile-blocks').find((b) => b.id === 'b2').hidden === false,
        'shown',
      );
      // Removing asks first.
      p.once('dialog', (d) => void d.dismiss());
      await p.locator(`[data-custom-block="${copyId}"] summary`).click();
      await p
        .locator(`[data-custom-block="${copyId}"]`)
        .getByRole('button', { name: 'Remover' })
        .click();
      assert.equal(owner('profile-blocks').length, 4, 'cancel keeps the block');
      p.once('dialog', (d) => void d.accept());
      await p.locator(`[data-custom-block="${copyId}"] summary`).click();
      await p
        .locator(`[data-custom-block="${copyId}"]`)
        .getByRole('button', { name: 'Remover' })
        .click();
      await until(() => owner('profile-blocks').length === 3, 'removed');
      assert.equal(
        owner('profile-blocks').find((b) => b.id === 'b3').extra,
        1,
        'unknown fields kept',
      );
      // A block with real data, then hide a fixed section.
      await p.locator('[data-block-open-bar]').click();
      await p.locator('[data-block-mode="data"]').click();
      await p.locator('[data-data-source="recent"]').click();
      const recent = p.locator('.profile-block-data').last();
      await recent.getByRole('link', { name: 'Fotossíntese e respiração celular' }).waitFor();
      await p.locator('[data-section-toggle="achievements"]').click();
      await until(
        () => owner('profile-layout').hiddenSections.join() === 'achievements',
        'section hidden',
      );
      await settle(p);
      await axeCheck(p, 'main', 'Perfil (edição)');
      await shot(p, 'perfil-edicao-1440');
      await p.keyboard.press('Escape');
      assert.equal(
        await p.locator('[data-profile-edit-toggle]').getAttribute('aria-pressed'),
        'false',
      );
      assert(
        await p.locator('.achievements-section').isHidden(),
        'hidden section gone while viewing',
      );
      await p.reload();
      await p.locator('[data-custom-block="b2"]').waitFor();
      assert(await p.locator('.achievements-section').isHidden(), 'layout kept after reload');
      assert.equal(await p.locator('.profile-block-data').count(), 1);
      // Another account in the same browser sees none of it.
      profileData.user = OTHER;
      await p.reload();
      await p.locator('[data-profile-name]', { hasText: 'Rafa Lima' }).waitFor();
      assert.equal(await p.locator('[data-custom-block]').count(), 0);
      assert(await p.locator('.achievements-section').isVisible());
      await profile.context.close();
      record(
        'Perfil: visualização limpa sem ferramentas; edição com menu por teclado (duplicar, mover, largura, mostrar, remover com confirmação), bloco com dados reais, seção oculta, salvo por conta',
      );
    }

    // ---------- Phone: the sheet fits and the essential card stays -------------------------
    const phone = await openApp(browser, base, allFlags, state(), { width: 390, height: 844 });
    await phone.page.goto(base + '/painel.html');
    await ready(phone.page);
    await openSheet(phone.page);
    await noHorizontalScroll(phone.page, 'Personalizar no celular');
    const box = await phone.page.locator('[data-dashboard-customize-dialog]').boundingBox();
    assert(box.width <= 390 && box.x >= 0, 'sheet inside the screen');
    await shot(phone.page, 'inicio-personalizar-390', false);
    await phone.page.keyboard.press('Escape');
    assert(await phone.page.locator('.dash-continue').isVisible());
    record(
      'Celular (390 px): a folha de personalização cabe na tela e "Continuar estudando" permanece',
    );
    await phone.context.close();
  } finally {
    await browser.close();
    server.close();
  }
  assert.deepEqual(errors, [], 'browser errors');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(passed, null, 2));
  console.log(`${passed.length} personalization checks passed`);
}
main().catch((error) => {
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors);
  process.exit(1);
});
