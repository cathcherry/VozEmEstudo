# Idiomas da interface

O Voz em Estudo traduz **a interface** (menus, botões, rótulos, mensagens, diálogos) para inglês,
espanhol e chinês simplificado. Nunca traduz conteúdo de estudo: títulos de aulas, transcrições,
resumos, questões e alternativas, cartões, anotações, perfil e qualquer texto digitado ficam como
foram criados. O idioma da interface é independente do idioma da gravação (escolhido ao enviar cada
aula) e do idioma em que a IA gera textos.

## Como funciona

Duas camadas, ambas em `frontend/js/i18n/`:

1. **Mensagens com chave** (`i18n.js`, `locales/<idioma>.js`): `t('chave', { count, nome })`, com
   plural (`{ one, other }` via `Intl.PluralRules`; em pt-BR só 1 é singular, então continua
   "0 aulas", "1 aula", "2 aulas") e `data-i18n` / `data-i18n-attr` no HTML. Usadas no Início,
   Personalizar o Início, perfil em edição, modos de estudo e menus compartilhados.
2. **Catálogo de frases** (`phrases.js`, `phrases/<idioma>.js`), no estilo gettext: o texto em
   português é a chave. Em outro idioma, toda frase **inteira e conhecida** da interface é trocada —
   no HTML, no que os scripts acrescentam depois (observado com `MutationObserver`), em
   `aria-label`, `title`, `placeholder`, `alt`, no título da aba e nos diálogos nativos
   (`confirm`/`alert`). Mensagens compostas usam padrões com `{0}` ("Revisar {0} cartões").
   Assim, as páginas e scripts continuam escritos em português e não precisam de chaves.

Proteções do conteúdo:

- Só frases **inteiras** do catálogo mudam; um texto do usuário só seria afetado se fosse
  exatamente igual a um rótulo da interface.
- Contêineres de conteúdo são ignorados por inteiro (`USER_CONTENT` em `phrases.js`: título da
  aula, transcrição, resumo, enunciado e alternativas, cartões, citações de anotações, títulos de
  tarefas e eventos, perfil, cópia compartilhada, `textarea`, `[translate="no"]`).
- Padrões com pouco texto fixo ("{0} aula") só aceitam números ou palavras da própria interface
  como valor — nunca um título.
- Textos longos (mais de 600 caracteres) nunca são comparados.

Outros detalhes:

- Em português nada é reescrito e o catálogo nem é carregado.
- A preferência `language` fica com as preferências de interface (ver
  [FUNCIONALIDADES.md](FUNCIONALIDADES.md) §15 sobre conta e dispositivo). `theme-init.js` define
  `<html lang>` antes da página aparecer; em outro idioma, a página fica oculta por até 1,5 s até
  ser traduzida, para o português não piscar.
- Trocar de idioma recarrega a página.
- Datas e horas usam `Intl` no idioma da interface (`globalThis.VOZ_LOCALE`).
- Catálogos são gerados por `scripts/i18n/build-phrases.mjs` a partir de tabelas JSON
  (português → `{en, es, zh-CN}`); o arquivo gerado também pode ser editado à mão.

## Cobertura (21/11/2026)

Medida no navegador com API simulada: textos visíveis que continuam em português, fora de conteúdo
de usuário, depois de abrir as páginas e os principais diálogos.

| Área                                                                                                | pt-BR | en      | es      | zh-CN   |
| --------------------------------------------------------------------------------------------------- | ----- | ------- | ------- | ------- |
| Entrar, cadastro, recuperar senha, retorno do login                                                 | ✅    | ✅      | ✅      | ✅      |
| Menu, topo, conta, rodapé, modo foco, busca global                                                  | ✅    | ✅      | ✅      | ✅      |
| Início (cartões, estados vazios, datas, Personalizar o Início)                                      | ✅    | ✅      | ✅      | ✅      |
| Biblioteca (lista, filtros, pastas, ações, diálogos)                                                | ✅    | ✅      | ✅      | ✅      |
| Aula (player, etapas, transcrição, resumo, questões, exportar, compartilhar, cronômetro, anotações) | ✅    | ✅      | ✅      | ✅      |
| Responder questões, resultado e revisão de erros                                                    | ✅    | ✅      | ✅      | ✅      |
| Revisar (flashcards, conjuntos, tentativas, anotações)                                              | ✅    | ✅      | ✅      | ✅      |
| Planejar (objetivos, tarefas, calendário, tempo de estudo, Pomodoro)                                | ✅    | ✅      | ✅      | ✅      |
| Perfil (edição, blocos, marcos), Configurações, Aparência                                           | ✅    | ✅      | ✅      | ✅      |
| Nova transcrição, processamento, ajuda, privacidade, cópia pública                                  | ✅    | ✅      | ✅      | ✅      |
| Mensagens de erro vindas da API (servidor)                                                          | ✅    | ❌      | ❌      | ❌      |
| Algumas listas montadas por partes (ex.: tipos de dados pendentes)                                  | ✅    | parcial | parcial | parcial |

Limites conhecidos:

- **Erros do servidor** chegam em português (o backend não sabe o idioma da interface).
- Frases montadas por concatenação no código, ou palavras escolhidas por `?:`, só são traduzidas
  quando existe um padrão; algumas ficam em português.
- As traduções foram revisadas por consistência de termos, mas **não por falantes nativos**.

## Testes

- `frontend/tests/i18n.test.mjs`: chaves nos quatro idiomas, `{parâmetros}`, plural, reserva.
- `frontend/tests/i18n-phrases.test.mjs`: motor do catálogo (frases, padrões, espaços, conteúdo
  protegido, elementos acrescentados depois, desempenho com texto longo), paridade dos catálogos e
  **cobertura do texto fixo de todas as páginas** (falha se mais de 3% ficar sem tradução).
- `frontend/tests/i18n-check.cjs` (navegador): 10 páginas × 4 idiomas × 390 e 1280 px — `lang`,
  títulos e menu traduzidos, título da aula intacto, todo controle com nome acessível, sem rolagem
  lateral, axe.
- `frontend/tests/personalization-check.cjs` e `account-privacy-check.cjs`: troca de idioma, conta
  e cópia pública.

## Para ampliar

1. Texto novo em HTML ou JS: escreva em português e acrescente a tradução numa tabela JSON
   (`{"Texto": {"en": "...", "es": "...", "zh-CN": "..."}}`), depois
   `node scripts/i18n/build-phrases.mjs tabela.json`. O teste de cobertura avisa se faltar.
2. Mensagem com número ou nome: use um padrão (`"Revisar {0} cartões"`).
3. Datas: `(globalThis.VOZ_LOCALE || 'pt-BR')` em vez de `'pt-BR'` fixo.
