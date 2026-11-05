# Teste integrado — etapas 1–9 e preferências de acessibilidade

Esta branch parte de `feat/etapa-2-biblioteca-2-0`, incluindo as etapas 1–9. A `main` não foi alterada.

## O que mudou na interface

Não existe mais um painel separado de "Opções de acessibilidade (teste)" na tela inicial. As escolhas agora usam os controles existentes:

- **Aparência** (`/aparencia.html`): temas Alto contraste claro, Alto contraste escuro e Fundo suave, junto dos temas anteriores e das cores personalizadas.
- **Leitura e foco** (`/leitura.html`): tamanho do texto, espaçamento de leitura, movimento reduzido, contraste reforçado, tipografia de leitura e opções de foco. Não há duplicatas.
- Preferências locais e perfis salvos continuam usando `VozAppearance`. Escolhas do antigo painel experimental são transferidas uma vez para o sistema de preferências integrado.
- Não há alteração no banco de dados para esses ajustes.

## Teste local (Windows)

1. Baixe o ZIP da branch `feat/acessibilidade-teste-integrado` ou selecione-a no GitHub Desktop.
2. Preserve o arquivo `backend/.env` funcional em sua máquina, sem compartilhar chaves.
3. No PowerShell dentro de `backend`, instale dependências com `npm install` (se necessário); inicie `node src/server.js`. Em um segundo terminal, inicie `node src/worker.js`.
4. Abra `http://localhost:3000/painel.html`. Confirme que o painel antigo de acessibilidade **não aparece**.
5. Em **Aparência**, teste cada um dos três temas novos; navegue até Biblioteca e outras telas e recarregue. Confirme que as cores continuam.
6. Em **Leitura e foco**, altere tamanho, espaçamento, movimento reduzido e contraste reforçado. Recarregue e navegue entre páginas. Confirme que **Restaurar preferências** funciona.
7. Para testar a conversão de preferências antigas, use um navegador em que o painel experimental tenha sido utilizado. Confirme que as escolhas permanecem disponíveis nas novas seções.
8. Teste Tab/Shift+Tab, Enter/Espaço, zoom de 200% e 400%, janela estreita (~320px CSS) e, se possível, NVDA.
9. Anote tela, configuração, comportamento esperado e observado, sem incluir segredos.

**Limitação:** isso não é uma auditoria completa de WCAG 2.2. Contraste por componente, leitor de tela, teclado e reflow ainda precisam de testes. Os módulos das etapas 2–9 também precisam de homologação.

## Banco de dados

Os ajustes de interface não precisam de migrations. Para as etapas 2–9, siga `docs/first-integrated-test.md` e comece pelo inventário somente leitura. Antes de executar SQL, confirme o Supabase alvo, faça backup manual do PostgreSQL e valide como seria restaurado; prefira um projeto separado para testes. Não aplique migrations automaticamente.

## Aceite

- [ ] Painel principal sem seção duplicada
- [ ] Três temas novos disponíveis em Aparência e aplicados em todas as telas
- [ ] Ajustes de leitura sem duplicação e persistentes
- [ ] Testes de teclado, zoom e leitor de tela registrados
- [ ] Fluxo de login, upload, transcrição e estudo sem regressões
- [ ] Etapas 2–9 avaliadas segundo o roteiro integrado

**Status:** implementado em branch de teste; sem validação completa em ambiente real.
