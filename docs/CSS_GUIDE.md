# Mapa de CSS — Voz em Estudo

## Objetivo

Prevenir conflitos de aparência entre telas sem reescrever o design atual. O histórico já contém regras compartilhadas e modificadores de página; esta etapa define responsabilidade antes de mudanças graduais. **Não houve unificação integral de todas as folhas de estilo.**

## Arquivo responsável

| Arquivo | Responsabilidade | Alterações permitidas |
| --- | --- | --- |
| `frontend/css/style.css` | Variáveis, temas, reset/base e componentes legados | Manutenção global estritamente necessária; evitar novas regras exclusivas de uma página |
| `frontend/css/marque.css` | Marca, logo e identidade compartilhada | Regras de marca reutilizadas em várias páginas |
| `frontend/css/product.css` | Componentes visuais compartilhados do produto | Componentes reutilizáveis com classe específica, evitando seletores de elemento genéricos |
| `frontend/css/library.css` | Componentes da biblioteca e organização de materiais | Elementos da biblioteca; escopo de página ao alterar aparência local |
| `frontend/css/academic.css` | Upload, material e conferência acadêmica | Estilos acadêmicos sem interferir em autenticação |
| `frontend/css/voz-redesign.css` | Ajustes visuais compartilhados da aplicação | Somente regras compartilhadas, preferindo `body.app-page` |
| `frontend/css/auth-pages.css` | Login, cadastro, recuperação, senha e notificações de autenticação | **Fonte de verdade de ajustes das três páginas**, com `body.auth-page`; carregada por último |

## Regras de alteração

1. **Preservar o design existente:** não mudar tipografia, cores, tamanhos ou layout global apenas para corrigir uma tela.
2. **Escopar seletores locais:** usar `body.auth-page`, `body.app-page`, `body[data-page="..."]` ou classes próprias de componente. Evitar `h1`, `button`, `input`, `section` globais em novos ajustes.
3. **Um proprietário por regra nova:** alterações de login/cadastro/recuperação pertencem a `auth-pages.css`; não criar outro `auth-layout.css`, `auth-toast.css` ou `password-controls.css`.
4. **Respeitar o carregamento:** mudanças locais de páginas devem vir depois das regras gerais. Não usar `!important` para vencer um conflito sem inspecionar a cascata; o arquivo de autenticação já contém exceções pontuais históricas.
5. **Regressão barata:** `npm test` na raiz inclui `node frontend/tests/auth-style-check.mjs`. O teste confere estrutura e ordem de CSS das três páginas; não é screenshot nem avaliação visual completa.
6. **Aprimorar incrementalmente:** ao alterar cada módulo E03–E21, mover ou isolar somente as regras tocadas e registrar o motivo. Sem refatoração massiva em uma entrega de correção de CI.

## Aceite desta etapa

Os seletores de autenticação seguem isolados em `auth-pages.css`, o fluxo de teste passa a verificá-los automaticamente e alterações futuras têm responsável definido. A organização integral das demais páginas fica para os módulos em que forem editadas; não há alegação de que conflitos de CSS foram totalmente eliminados.
