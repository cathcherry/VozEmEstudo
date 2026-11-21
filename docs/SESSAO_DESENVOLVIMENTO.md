# Sessão de desenvolvimento — Personalização 2.0, UX e validação

Documento de passagem: o que foi feito, o que falta e como retomar. Atualizado a cada etapa.

## Objetivo

Estabilizar a nova navegação, validar os recursos ativados em 20/11/2026, implementar a
Personalização 2.0 (perfil e Início), predefinições de estudo, base de internacionalização e
revisão de acessibilidade — sem tocar em produção.

## Base

| Item             | Valor                                                                    |
| ---------------- | ------------------------------------------------------------------------ |
| Branch de origem | `feat/ux-navigation` @ `6a54c4e` (CI verde)                              |
| `main`           | `47b64bf`                                                                |
| Branch de work   | `feat/personalization-2-0`                                               |
| Produção         | Nenhuma migration, SQL ou deploy feito nesta sessão                      |
| Banco            | Novas chaves de `profile_state` (`dashboard-layout`) seguem o formato já exigido pela migration `profile_state_hardening`; nenhuma mudança de schema |

## Como rodar os testes aqui

```bash
npm ci && (cd frontend && npm ci) && (cd backend && npm ci) && pip install -r requirements-dev.txt
npm run lint
npm run test:backend          # 1 falha conhecida: recorte AAC depende da versão do FFmpeg
npm run test:planning-ui      # e as demais suítes test:* (ver package.json)
BROWSER_EXECUTABLE=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome npm run test:browser
```

No contêiner da sessão, o Playwright fixado (1.62.1) não encontra o Chromium dele; use
`BROWSER_EXECUTABLE` apontando para o Chromium instalado.

## Etapas

| #   | Etapa                               | Situação  | Commits   |
| --- | ----------------------------------- | --------- | --------- |
| 1   | Estabilizar UX e navegação          | Concluída | `8f87e6e` |
| 5   | Personalizar o Início               | Concluída | `4b47a39` |
| 3   | Validar recursos ativados           | Em curso  |           |
| 4   | Perfil: modo de visualização/edição | Pendente  |           |
| 6   | Aparência e predefinições de estudo | Pendente  |           |
| 7   | Internacionalização                 | Pendente  |           |
| 8   | Acessibilidade e confiabilidade     | Pendente  |           |
| 9   | Validação final e documentação      | Pendente  |           |

## Decisões

- **Simulação compartilhada para testes de navegador**: `frontend/tests/support/mock-app.cjs`
  (API, SDK do Supabase e uma tabela `profile_state` em memória servida pelo servidor de teste,
  para testar sincronização, troca de conta e falha de rede).
- **Layout do Início** em `profile_state` (`dashboard-layout`) pela mesma `profile-cloud.js`; o
  padrão nunca é gravado (conta nova sem linha). Blocos são movidos no DOM, não só com CSS, para a
  ordem de leitura acompanhar a tela.
- **Densidade** (`density`: confortável/compacta) é uma preferência de interface comum
  (`audioestudo-ui-preferences`), fora dos temas salvos — como a leitura em voz alta.

## Bugs corrigidos

- Botão da conta invisível no celular e com texto máximo (a regra que escondia "Minha conta"
  escondia também o avatar, deixando um controle focável invisível).
- Busca do topo em Revisar/Planejar filtrava só a Biblioteca; agora abre a busca global.
- Títulos de aulas recentes quebravam no meio da palavra quando cabiam três colunas.

## Pendências que dependem de você

- Nenhuma autorização pedida até aqui.

## Limitações conhecidas

- Preferências de aparência continuam compartilhadas pelo navegador entre contas (já registrado
  em ROADMAP §5.2); a densidade segue a mesma regra.
