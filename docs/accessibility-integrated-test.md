# Teste integrado — etapas 1–9 e acessibilidade experimental

Esta branch parte de `feat/etapa-2-biblioteca-2-0`, incluindo o trabalho acumulado do PR #2. A `main` não foi alterada.

## Instalação local no Windows

1. Abra [a branch de teste](https://github.com/cathcherry/VozEmEstudo/tree/feat/acessibilidade-teste-integrado), escolha **Code > Download ZIP** e extraia em uma pasta nova. Alternativamente, use GitHub Desktop e selecione a branch.
2. Copie seu `backend/.env` funcional para `backend/.env` desta pasta, sem compartilhar nem versionar segredos.
3. Instale Node.js 22.19+ (preferência 24). Dê dois cliques em `INICIAR.cmd` e abra `http://localhost:3000/painel.html`.
4. Comece com todas as flags opcionais em `false`. Verifique login, aulas existentes, upload de áudio, transcrição, revisão e geração de conteúdo.
5. No painel, abra **Opções de acessibilidade (teste)**. Experimente cada apresentação e os três controles independentes. Recarregue a página para confirmar persistência. Clique em **Restaurar opções** para desfazer.
6. Teste com Tab/Shift+Tab, Enter e Espaço, com zoom de 200% e 400%, largura equivalente a 320 CSS px, e com leitor de tela (NVDA no Windows). Observe especialmente upload, status do processamento, revisão e player.
7. Registre resultado, navegador, largura/zoom, etapa, comportamento esperado e observado, sem incluir tokens ou dados pessoais.

**Limite desta versão:** o painel recebeu controles experimentais de apresentação. Não há comprovação de contraste de todos os componentes, reflow em todas as páginas, cobertura de leitor de tela, nem conformidade WCAG 2.2. Outras páginas ainda podem usar apenas as preferências preexistentes. Não faça merge sem avaliação.

## Banco de dados — não executar automaticamente

As opções de acessibilidade desta branch são locais e **não precisam de migration**. As etapas 2–9, sim. Siga integralmente `docs/first-integrated-test.md` da mesma branch, incluindo inventário, preflight, ordem das migrations, postflight e ativação gradual das flags.

Antes de qualquer SQL: confirme o projeto Supabase apontado pelo `.env`, faça um backup **atual** e valide como restaurá-lo. Prefira um Supabase separado para testes. No SQL Editor, comece apenas com `database/checks/first-test-inventory.sql`, que é de leitura. Não reaplique `001_initial.sql` ou E02 sem verificar o schema. As migrations novas são candidatas; não foram executadas por esta alteração. A ordem e nomes completos estão no roteiro integrado.

## Registro de aceite

- [ ] Fluxo principal sem regressões, com todas as flags OFF
- [ ] Temas claro/escuro/suave legíveis e opções persistentes
- [ ] Foco de teclado visível e percurso principal sem mouse
- [ ] Zoom/reflow sem perda de função
- [ ] Mensagens de processamento e erros compreensíveis com leitor de tela
- [ ] Backup/restauração conferidos e inventário revisado
- [ ] Migrations aplicadas individualmente em ambiente autorizado, com checks
- [ ] 12 casos do roteiro integrado concluídos com duas contas

**Não homologado:** este arquivo descreve procedimentos, não resultados de testes reais.
