# ADR-002 — revisão humana e fonte imutável para geração

Status: implementado e verificado localmente na E02; aceite G1 e aplicação em staging pendentes. Data: 09/10/2026. Base: pacote vigente E01, versão 12. Contrato: Manual REVISADO §9.1 e §26.3; Roteiro E02.

## Contexto

O checkout vigente gera resumo e questões dentro do job inicial, antes de qualquer confirmação. As gerações posteriores consultam `current_text`, enquanto a revisão pode mudar na fila. As operações de versão/current e lote/questões são requisições separadas ao Supabase. O schema real conserva dez tabelas legadas e não possui as entidades acadêmicas E02; seu histórico registrado de migrations está vazio.

## Alternativas

Manter a geração inicial automática descumpre a conferência humana. Conferir apenas no browser permite bypass HTTP/worker. Copiar o texto novamente em cada job duplica a fonte e dificulta rastrear segmentos. Reescrever o frontend, mudar todos os enums ou importar SQL ilustrativo do manual cria incompatibilidades sem necessidade.

## Decisão

Registrar permissão versionada, separada da conservação de áudio. O job inicial conclui ASR, torna o snapshot durável e resolve retenção; depois registra três avisos preliminares, sem gerar derivados. `materials.review_state` acrescenta o estado acadêmico, enquanto os enums legados de material/job/etapa permanecem. A confirmação pertence ao usuário, material, UUID da revisão e versão da declaração. Edição/restauração produz outra revisão não confirmada.

O enqueue requer a revisão atual confirmada, grava seu UUID e a confirmação no job/params. O worker busca exclusivamente `transcription_versions.full_text` e `segments_snapshot` daquela fonte; edição posterior não troca o conteúdo. Novos resumos e lotes recebem FK da revisão e do job, número legado de revisão, modelo, prompt e timestamp. Registros anteriores continuam com a proveniência disponível, sem backfill fictício de UUID ou confirmação.

RPCs PostgreSQL com `SECURITY INVOKER`, `search_path` vazio e execução restrita a `service_role` concentram operações transacionais. Ownership é verificado na API e na RPC; novas tabelas têm RLS de leitura por conta e não permitem escrita direta autenticada. Locks seguem material → transcrição. A mesma chave retorna o mesmo job e o mesmo derivado; resumo e lote completo são commits indivisíveis. Revisões e fontes de job não podem ser alteradas silenciosamente.

Avisos têm três tipos, quatro estados, UUID da revisão, análise/operação, modelo, prompt versionado, contexto e referências validadas no snapshot. Cada nova análise é acrescentada; retry da mesma operação reutiliza registros. O endpoint de material retorna até 30 avisos recentes, e o painel compacto mostra o resultado mais recente por tipo/revisão, até seis entradas. O banco conserva as demais análises; não existe nova tela de histórico nesta entrega.

## Consequências e limites

Clientes antigos precisam apresentar a declaração vigente e enviar `sourceRevisionId` para nova geração. Leitura/histórico e nomes de rotas legadas permanecem; esta transição obrigatória está no OpenAPI e runbook. Jobs de geração antigos sem fonte fixada falham com erro de domínio, sem adivinhar confirmação ou apagar históricos.

Storage e PostgreSQL não compartilham transação. A finalização detecta um move já concluído antes de falha do banco, valida o destino esperado e retoma o registro; limpeza após ASR independe do LLM. Testes usam transporte Storage falso, sem comprovar TTL remoto.

Aviso ausente não prova veracidade; erro/insuficiência não bloqueia conferência manual. Não há classificação científica validada, verificação automática de direitos, garantia de eliminação em provedores nem avaliação pedagógica realizada. Em MP4, apenas o áudio é processado; conservação de vídeo original é E07, ainda não iniciada.

PGlite 0.5.8 executa PostgreSQL 18.3, transações e RLS em banco descartável de conexão única. O remoto inspecionado é PostgreSQL 17.6. Testes de submissão paralela são serializados; validação em múltiplas conexões, staging/backup/restore e aceite humano continuam necessários.
