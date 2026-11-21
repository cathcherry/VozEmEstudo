# Créditos da interface

## Uiverse / Marque

Kit: https://uiverse.io/ui-kits/marque  
Autor: uiverse-astronaut. Código adaptado sob licença MIT, incluída em `frontend/css/MARQUE-LICENSE.txt`.

Componentes consultados:
- Botão: https://uiverse.io/uiverse-astronaut/neat-quail-90
- Cartão: https://uiverse.io/uiverse-astronaut/slimy-cougar-28
- Estilos de entrada, checkbox e tokens disponibilizados na prévia do kit.

A adaptação integra a cor persistente, tipografia local, foco, navegação e responsividade da aplicação. O CSS do kit fica separado em `frontend/css/marque.css`.

## Fontes

Plus Jakarta Sans e Inter, distribuídas sob SIL Open Font License. Arquivos WOFF2 locais em `frontend/assets/fonts/`. Licenças: `JAKARTA-OFL.txt` e `INTER-OFL.txt`.

No 3.5, a interface usa Fraunces (títulos, variável com eixo SOFT) e Instrument Sans (interface), ambas SIL Open Font License, copiadas de `@fontsource-variable/fraunces` e `@fontsource-variable/instrument-sans` 5.3.0 (subconjunto latino). Licenças: `FRAUNCES-OFL.txt` e `INSTRUMENT-SANS-OFL.txt`.

## Marca e referências

Logo, favicon e mascotes reaproveitados dos arquivos do projeto fornecido. As quatro imagens enviadas pela usuária foram usadas como referência de composição; não foram incorporadas como páginas prontas.

O cenário de árvores é SVG escrito para esta interface. Placeholders de equipe e contato continuam explícitos até que os dados reais sejam fornecidos.

## Software de mídia e autenticação

SDK Supabase JS 2.112.3, licença em `frontend/js/vendor/SUPABASE-LICENSE`. O bundle usa a mesma versão fixada no backend. O único ajuste na distribuição IIFE foi acrescentar `export { supabase };` ao final, para consumo como módulo ES pelo navegador. Para atualizá-lo, instale a versão escolhida, substitua `supabase.umd.js` pelo bundle da distribuição correspondente e acrescente novamente esse export. O wrapper `supabase.min.js` importa esse módulo local.

FFmpeg e FFprobe são instalados como dependências do servidor, ou usados via caminhos do sistema. Suas licenças e condições de redistribuição estão nas distribuições originais: https://ffmpeg.org/legal.html. Os binários e `node_modules` não estão incluídos no ZIP.

## Imagens fornecidas na revisão 0.3

Oito avatares e quatro versões do símbolo PNG do Voz em Estudo foram fornecidos pela usuária e copiados para `frontend/assets/brand/`. A revisão da biblioteca também usa as quatro novas referências enviadas (armazenamento, perfil, Bookavy e Hi George) como inspiração de organização; o CSS de composição é próprio.
