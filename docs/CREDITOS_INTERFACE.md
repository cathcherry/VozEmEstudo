# Créditos da interface

## Uiverse / Marque

Kit: https://uiverse.io/ui-kits/marque  
Autor: uiverse-astronaut. Código adaptado sob licença MIT, incluída em `frontend/css/MARQUE-LICENSE.txt`.

Componentes consultados:
- Botão: https://uiverse.io/uiverse-astronaut/neat-quail-90
- Cartão: https://uiverse.io/uiverse-astronaut/slimy-cougar-28
- Estilos de entrada, checkbox e tokens disponibilizados na prévia do kit.

A adaptação integra a cor persistente, tipografia local, foco, navegação e responsividade da aplicação. O CSS do kit fica separado em `frontend/css/marque.css`.

## Ícones de interface (3.6)

Phosphor Icons 2.1.1 (`@phosphor-icons/core`, peso duotone), licença MIT, © 2023 Phosphor Icons
(Tobias Fried e Helena Zhang). Fonte: https://phosphoricons.com e
https://github.com/phosphor-icons/core. A licença acompanha o sprite em
`frontend/assets/icons/PHOSPHOR-LICENSE.txt`. Os SVGs são copiados do pacote npm para
`frontend/assets/icons/sprite.svg` por `npm run icons:build`; a única alteração é a camada clara do
duotone, que passa a usar a cor da variável CSS `--icon-tint`. A MIT permite uso, cópia,
modificação e distribuição, inclusive comercial, desde que o aviso de copyright e a licença
acompanhem o material. A lista de ícones usados está em `frontend/js/utils/icons.js`.

## Fontes

Plus Jakarta Sans e Inter, distribuídas sob SIL Open Font License. Arquivos WOFF2 locais em `frontend/assets/fonts/`. Licenças: `JAKARTA-OFL.txt` e `INTER-OFL.txt`.

No 3.5, a interface usa Fraunces (títulos, variável com eixo SOFT) e Instrument Sans (interface), ambas SIL Open Font License, copiadas de `@fontsource-variable/fraunces` e `@fontsource-variable/instrument-sans` 5.3.0 (subconjunto latino). Licenças: `FRAUNCES-OFL.txt` e `INSTRUMENT-SANS-OFL.txt`.

No 3.6, os títulos do caderno da aula e do Diário de estudo usam Caveat (letra manuscrita, só em títulos; o texto continua em Instrument Sans), SIL Open Font License 1.1, © 2014 The Caveat Project Authors, copiada de `@fontsource-variable/caveat` 5.3.0 (subconjunto latino, variável 400–700): `caveat-latin-wght.woff2`. Licença: `CAVEAT-OFL.txt`.

## Marca e referências

Logo, favicon e mascotes reaproveitados dos arquivos do projeto fornecido. As quatro imagens enviadas pela usuária foram usadas como referência de composição; não foram incorporadas como páginas prontas.

O cenário de árvores é SVG escrito para esta interface. Placeholders de equipe e contato continuam explícitos até que os dados reais sejam fornecidos.

## Software de mídia e autenticação

SDK Supabase JS 2.112.3, licença em `frontend/js/vendor/SUPABASE-LICENSE`. O bundle usa a mesma versão fixada no backend. O único ajuste na distribuição IIFE foi acrescentar `export { supabase };` ao final, para consumo como módulo ES pelo navegador. Para atualizá-lo, instale a versão escolhida, substitua `supabase.umd.js` pelo bundle da distribuição correspondente e acrescente novamente esse export. O wrapper `supabase.min.js` importa esse módulo local.

FFmpeg e FFprobe são instalados como dependências do servidor, ou usados via caminhos do sistema. Suas licenças e condições de redistribuição estão nas distribuições originais: https://ffmpeg.org/legal.html. Os binários e `node_modules` não estão incluídos no ZIP.

## Imagens fornecidas na revisão 0.3

Oito avatares e quatro versões do símbolo PNG do Voz em Estudo foram fornecidos pela usuária e copiados para `frontend/assets/brand/`. A revisão da biblioteca também usa as quatro novas referências enviadas (armazenamento, perfil, Bookavy e Hi George) como inspiração de organização; o CSS de composição é próprio.
