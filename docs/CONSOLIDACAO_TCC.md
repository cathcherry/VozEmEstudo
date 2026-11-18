# Consolidação do TCC — 18/11/2026

## Versão escolhida

`consolidacao/tcc` combina a base funcional `feat/acessibilidade-teste-integrado`
(`ecff683`) com o fluxo visual de `codex/simplificar-fluxo-de-estudo` (`1930edb`).
A base já contém o histórico de `feat/etapa-2-biblioteca-2-0`.
O layout simplificado de envio, espera, abas, diálogos e Markdown foi preservado.
E07 mantém áudio e vídeo separados, offset, retomada, timestamps e acessibilidade.
Flashcards permanecem nas telas existentes; não foi criada integração no material.

O backend preserva o contrato A de resumo: opções aninhadas, formatos
`paragraphs/topics` e extensões `short/standard/detailed`. O frontend converte os
nomes do diálogo antes de calcular a chave de idempotência e chamar a API.

## Branches

- Manter `main` como destino oficial e `consolidacao/tcc` até revisão e integração.
- Após integração com histórico preservado e validação em main, as branches
  de acessibilidade, simplificação e biblioteca podem ser removidas.
- Manter `chore/etapa-1-estabilizacao`: oito commits exclusivos de CI, documentação
  e inicializador Windows precisam de revisão própria. Não substituir o package.json
  atual pelo dessa branch, pois isso retiraria scripts dos módulos posteriores.
- Não houve push, exclusão de branches ou integração em main nesta consolidação.

## Próxima etapa: Gemini

A integração futura com Gemini é um requisito registrado; ainda não implementada.
O provedor textual atual é Groq, chamado diretamente pelos serviços em
`backend/src/integrations/llm/groq.client.js`. Whisper/Hugging Face continua
responsável pelo reconhecimento de fala.

Antes de implementar Gemini, confirmar quais tarefas ele atenderá: resumo,
questões, avisos e/ou sugestões de flashcards. Introduzir uma interface comum
para geração textual e JSON, com seleção do provedor no backend e configuração
privada. Preservar Groq como opção e os contratos HTTP, revisão confirmada,
idempotência, proveniência, validação de saída e tratamento de erros/retries.

Guardar chaves somente no backend. Verificar documentação oficial, modelos,
custos e limites vigentes na implementação; não fixar essas decisões neste merge.
Adicionar testes com transporte simulado para ambos os provedores e registrar o
modelo efetivamente usado nos artefatos gerados. Atualizar a informação ao usuário
sobre provedores e a declaração de permissão versionada quando o fluxo mudar.

## Validação e limites

Baseline backend local: 171 pass / 4 fail, com duas causas preexistentes
(featureFlags e duração AAC, contando também os testes pais).
Testes de player: 7/7; painéis/player/flashcards: 22/22; DOM e tema: 21/21.
Esses testes não certificam credenciais reais, banco remoto ou qualidade dos modelos.

Final browser validation: Chrome + real FFmpeg + simulated APIs; 38/38 checks passed, including E07, normalized summary options, automated accessibility and 200% text reflow.
