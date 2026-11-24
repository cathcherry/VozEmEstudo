// Configurações as a direct list, in a real browser with the simulated API (no backend, no
// Supabase): every row leads straight to its page, dialog or action; "Trocar senha" shows its
// working, error and done states; "Dados neste navegador" is a sub-view with a way back; the
// interface language changes in place; axe; no sideways scroll at 390 px (also largest text).
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {
  state,
  errors,
  passed,
  record,
  axeCheck,
  openApp,
  shotter,
  settle,
  allFlags,
  noHorizontalScroll,
  startServer,
  launchBrowser,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'settings');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);

// Row label → where it must lead (a path with its anchor).
const LINKS = {
  'Tema e cores': '/aparencia.html#aparencia',
  'Espaço de estudo': '/aparencia.html#estudio',
  'Leitura e acessibilidade': '/aparencia.html#reading-settings',
  'Leitura em voz alta': '/aparencia.html#read-aloud-settings',
  'Privacidade e uso de dados': '/privacidade.html',
  'Central de ajuda': '/ajuda.html',
};

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    const data = state();
    const { context, page } = await openApp(browser, base, allFlags, data);
    await page.goto(base + '/configuracoes.html');
    await settle(page);
    const groups = await page.locator('.settings-group-title').allTextContents();
    assert.deepEqual(groups, [
      'Conta',
      'Aparência e leitura',
      'Idioma',
      'Sons',
      'Segurança',
      'Privacidade e dados',
      'Ajuda',
    ]);
    assert.equal(
      await page.locator('[data-settings-email]').textContent(),
      'estudante@example.test',
    );
    assert.equal(await page.locator('[data-settings-providers]').textContent(), 'E-mail e senha');
    assert.equal(
      await page.locator('.settings-category-nav, .settings-details-card').count(),
      0,
      'no jump bar or disclosures',
    );
    for (const [label, href] of Object.entries(LINKS)) {
      const row = page.locator('a.settings-row', { hasText: label });
      assert.equal(await row.getAttribute('href'), `.${href}`, label);
    }
    // Every anchor the rows point to exists on its page.
    for (const href of Object.values(LINKS).filter((h) => h.includes('#'))) {
      const [file, id] = href.split('#');
      await page.goto(base + file);
      assert.equal(await page.locator(`#${id}`).count(), 1, `${href} exists`);
    }
    await page.goto(base + '/configuracoes.html');
    await settle(page);
    await axeCheck(page, 'main', 'Configurações');
    await shot(page, 'configuracoes-1440');
    record(
      'Configurações: lista agrupada (Conta, Aparência e leitura, Idioma, Sons, Segurança, Privacidade e dados, Ajuda, Sair) e cada linha leva direto à página e seção certas',
    );

    // ---------- Sons ambientes: the row opens the mixer -------------------------------------
    await page.locator('[data-open-soundscape]').click();
    await page.locator('#soundscape-popover').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('#soundscape-popover').waitFor({ state: 'hidden' });
    // ---------- Atalhos de teclado ------------------------------------------------------------
    await page.locator('[data-open-shortcuts]').click();
    await page.locator('.shortcuts-dialog[open]').waitFor();
    await page.keyboard.press('Escape');
    record('Sons ambientes e Atalhos de teclado abrem direto da lista');

    // ---------- Trocar senha: link by e-mail (sending → sent; error) ------------------------
    const dialog = page.locator('[data-password-dialog]');
    await page.locator('[data-open-password]').click();
    await dialog.waitFor();
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      'settings-current-password',
      'focus on the first field',
    );
    await settle(page);
    await axeCheck(page, '[data-password-dialog]', 'Trocar senha');
    await shot(page, 'senha-dialogo-1440', false);
    await page.evaluate(() => localStorage.setItem('mock-reset-error', '1'));
    await dialog.locator('[data-password-send-link]').click();
    assert.equal(await dialog.getAttribute('aria-busy'), 'true', 'busy while sending');
    assert.equal(await dialog.locator('[data-password-send-link]').textContent(), 'Enviando…');
    await dialog.locator('[data-password-link-status][data-state="error"]').waitFor();
    assert.match(
      await dialog.locator('[data-password-link-status]').textContent(),
      /Aguarde um minuto/,
    );
    assert.equal(await dialog.locator('[data-password-send-link]').isEnabled(), true);
    await page.evaluate(() => localStorage.removeItem('mock-reset-error'));
    await dialog.locator('[data-password-send-link]').click();
    await dialog.locator('[data-password-step="done"]').waitFor();
    assert.equal(await dialog.locator('[data-password-done-title]').textContent(), 'Link enviado');
    assert.match(
      await dialog.locator('[data-password-done-text]').textContent(),
      /estudante@example\.test/,
    );
    await shot(page, 'senha-link-enviado-1440', false);
    await dialog.getByRole('button', { name: 'Fechar' }).last().click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(
      await page.evaluate(() => document.activeElement.hasAttribute('data-open-password')),
      true,
      'focus returns to the row',
    );
    record(
      'Trocar senha por link: "Enviando…" com o diálogo ocupado, erro legível (limite de pedidos), confirmação com o e-mail, foco volta à linha',
    );

    // ---------- Trocar senha: new password now (errors → saved) ------------------------------
    await page.locator('[data-open-password]').click();
    assert(await dialog.locator('[data-password-step="choose"]').isVisible(), 'opens clean');
    const status = dialog.locator('[data-password-update-status]');
    await dialog.locator('[type=submit]').click();
    assert.equal(await status.textContent(), 'Digite a senha atual.');
    await dialog.locator('#settings-current-password').fill('senha-errada');
    await dialog.locator('#settings-new-password').fill('Nova#Senha2026x');
    await dialog.locator('#settings-confirm-password').fill('Outra#Senha2026x');
    await dialog.locator('[type=submit]').click();
    assert.equal(await status.textContent(), 'As duas senhas novas não são iguais.');
    assert.equal(
      await dialog.locator('#settings-confirm-password').getAttribute('aria-invalid'),
      'true',
    );
    await dialog.locator('#settings-confirm-password').fill('Nova#Senha2026x');
    // The leaked-password lookup is a third-party request: answer "not found".
    await context.route('https://api.pwnedpasswords.com/**', (route) =>
      route.fulfill({ body: '' }),
    );
    await dialog.locator('[type=submit]').click();
    await status.filter({ hasText: 'A senha atual não confere.' }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-current-password');
    await dialog.locator('#settings-current-password').fill('Senha#Atual2025');
    await dialog.locator('[type=submit]').click();
    await dialog.locator('[data-password-step="done"]').waitFor();
    assert.equal(
      await dialog.locator('[data-password-done-title]').textContent(),
      'Senha alterada',
    );
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    record(
      'Trocar senha agora: campos obrigatórios, senhas diferentes e senha atual errada com mensagem e foco no campo; sucesso confirmado',
    );

    // ---------- Dados neste navegador: sub-view and back ------------------------------------
    const summary = page.locator('[data-device-summary]');
    assert((await summary.textContent()).length > 0, 'sync state in the row');
    await page.locator('[data-open-device-data]').click();
    await page.locator('[data-settings-subview]').waitFor();
    assert.equal(
      await page.locator('.settings-list').isHidden(),
      true,
      'list hidden in the sub-view',
    );
    assert.equal(await page.evaluate(() => document.activeElement.id), 'device-data-title');
    assert(await page.locator('[data-sync-panel]').isVisible());
    assert.match(
      await page.locator('.device-data-facts').textContent(),
      /Sair da conta não apaga essa cópia/,
    );
    await settle(page);
    await axeCheck(page, 'main', 'Dados neste navegador');
    await shot(page, 'dados-neste-navegador-1440');
    await page.locator('[data-settings-back]').click();
    await page.locator('.settings-list').waitFor();
    assert.equal(
      await page.evaluate(() => document.activeElement.hasAttribute('data-open-device-data')),
      true,
      'focus back on the row',
    );
    await page.goBack();
    await page.locator('[data-settings-subview]').waitFor();
    record(
      'Dados neste navegador: subpágina com título focado, painel de sincronização e explicações; "Configurações" e o botão Voltar do navegador retornam à lista',
    );

    // ---------- Language in place --------------------------------------------------------------
    await page.goto(base + '/configuracoes.html');
    await settle(page);
    await Promise.all([
      page.waitForEvent('load'),
      page.locator('#settings-language').selectOption('en'),
    ]);
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-i18n-pending'));
    await page.waitForTimeout(300);
    assert.equal(await page.locator('h1').first().textContent(), 'Settings');
    assert.equal(await page.locator('.settings-group-title').first().textContent(), 'Account');
    await shot(page, 'configuracoes-en-1440', false);
    await page.locator('#settings-language').selectOption('pt-BR');
    await page.waitForTimeout(800);
    record('Idioma da interface muda direto na lista');

    // ---------- Sair da conta ------------------------------------------------------------------
    await page.goto(base + '/configuracoes.html');
    await settle(page);
    await Promise.all([
      page.waitForURL('**/login.html'),
      page.locator('[data-settings-logout]').click(),
    ]);
    record('Sair da conta direto da lista');
    await context.close();

    // ---------- Phone and largest text ---------------------------------------------------------
    for (const big of [false, true]) {
      const phone = await openApp(browser, base, allFlags, state(), { width: 390, height: 844 });
      if (big)
        await phone.context.addInitScript(() =>
          localStorage.setItem(
            'audioestudo-ui-preferences',
            JSON.stringify({ textSize: 'maximum' }),
          ),
        );
      const label = `390${big ? ' texto máximo' : ''}`;
      for (const url of [
        '/configuracoes.html',
        '/configuracoes.html#dados-neste-navegador',
        '/privacidade.html',
      ]) {
        await phone.page.goto(base + url);
        await settle(phone.page);
        await noHorizontalScroll(phone.page, `${url} ${label}`);
      }
      await phone.page.goto(base + '/configuracoes.html');
      await settle(phone.page);
      await phone.page.locator('[data-open-password]').click();
      await phone.page.locator('[data-password-dialog]').waitFor();
      const box = await phone.page.locator('[data-password-dialog]').boundingBox();
      assert(box.x >= 0 && box.x + box.width <= 390, `dialog inside the screen (${label})`);
      await shot(phone.page, `senha-dialogo-${label.replace(/\s+/g, '-')}`, false);
      await phone.context.close();
    }
    record(
      '390 px e texto máximo: lista, subpágina, privacidade e diálogo de senha sem rolagem lateral',
    );
  } finally {
    await browser.close();
    server.close();
  }
  const unexpected = errors.filter((e) => !/Sem simulação|404/.test(e));
  assert.deepEqual(unexpected, [], 'browser errors');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(passed, null, 2));
  console.log(`${passed.length} settings checks passed`);
}
main().catch((error) => {
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors.slice(0, 5));
  process.exit(1);
});
