# Idiomas da interface

O Voz em Estudo traduz **a interface** (menus, botões, mensagens). Nunca traduz o conteúdo de
estudo: transcrições, resumos, questões, títulos de aulas, anotações, perfil e qualquer texto que a
pessoa escreveu continuam como foram criados. O idioma da interface é independente do idioma da
gravação, escolhido ao enviar cada aula.

## Como funciona

- `frontend/js/i18n/i18n.js`: `t(chave, parâmetros)` com plural (`{ one, other }`, via
  `Intl.PluralRules`; em pt-BR, só 1 é singular) e `{nome}` nos textos; `translateDocument()`
  aplica `data-i18n` (texto) e `data-i18n-attr="aria-label:chave;placeholder:chave"`; elementos
  repetidos em todas as páginas (menu, rodapé, topo) são traduzidos centralmente pelo texto em
  português (`SHARED`).
- Dicionários em `frontend/js/i18n/locales/`: `pt-BR.js` é a fonte e o idioma de reserva.
  Mensagem ausente em outro idioma aparece em português; chave inexistente aparece como a própria
  chave (fácil de achar).
- Em português nada na página é reescrito: o HTML já está em português, então não há risco de
  regressão.
- Preferência `language` em `audioestudo-ui-preferences` (junto com as outras preferências de
  interface, sincronizada com a conta). `theme-init.js` define `<html lang>` antes da página
  aparecer. Ao trocar o idioma (em Aparência › Idioma, ou quando a conta traz outro), a página
  recarrega para que textos fixos e dinâmicos mudem juntos.
- Datas e horários do Início usam `Intl` no idioma escolhido.

## Cobertura atual

| Área                                                            | pt-BR | en / es / zh-CN |
| --------------------------------------------------------------- | ----- | --------------- |
| Menu lateral, topo, rodapé, menu da conta, modo foco            | ✅    | ✅              |
| Busca do topo                                                   | ✅    | ✅              |
| Início (cartões, mensagens, datas, Personalizar o Início)       | ✅    | ✅              |
| Revisar e Planejar: título, introdução e abas                   | ✅    | ✅              |
| Revisar e Planejar: conteúdo das ferramentas (flashcards, etc.) | ✅    | ❌ português    |
| Perfil: título, ações, barra de edição, títulos das seções      | ✅    | ✅              |
| Perfil: menus dos blocos, conquistas, diálogo de informações    | ✅    | ❌ português    |
| Aparência: título, modos de estudo, idioma                      | ✅    | ✅              |
| Aparência: temas, leitura e foco                                | ✅    | ❌ português    |
| Biblioteca, aula, nova transcrição, login, cadastro, ajuda      | ✅    | ❌ português    |
| Mensagens de erro vindas da API                                 | ✅    | ❌ português    |

Por isso **nenhum outro idioma está completo**; a página Aparência avisa isso a quem escolhe
inglês, espanhol ou chinês.

## Testes

- `frontend/tests/i18n.test.mjs` (em `npm run test:personalization`): todas as chaves existem nos
  quatro idiomas, sem chaves sobrando, com os mesmos `{parâmetros}`; todas as chaves usadas nas
  páginas e scripts existem; reserva, plural e interpolação.
- `frontend/tests/personalization-check.cjs`: troca de idioma no navegador, `lang`, menus e
  mensagens dinâmicas, conteúdo das aulas intacto, salvo na conta, volta ao português, axe.

## Para ampliar

1. Acrescente a chave em `pt-BR.js` e nos outros três dicionários (o teste falha se faltar).
2. No HTML, `data-i18n="chave"`; em JS, `t('chave', { count, nome })`.
3. Para datas e ordenação, `intlLocale()` em vez de `'pt-BR'` fixo.
