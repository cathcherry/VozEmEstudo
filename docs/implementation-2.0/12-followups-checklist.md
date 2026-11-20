# 12 — Pendências para conferir depois (branch `feat/study-authoring-followups`)

Esta branch parte de `feat/study-authoring` (pronta para merge) e reúne mudanças que ainda precisam da sua conferência. **Nada desta branch foi aplicado no banco de produção.**

## 1. Banco: migration candidata de performance

Arquivo: `database/migrations/20261119140000_rls_performance.sql` (não aplicada).

- Reescreve 13 políticas de RLS da `001_initial` para `(select auth.uid())` usando `ALTER POLICY` (nenhuma política é apagada; mesmas regras, papéis e comandos). Resolve os avisos "Auth RLS Initialization Plan" do Supabase.
- Cria índices para as chaves estrangeiras apontadas como sem índice, somente quando a tabela e as colunas existem.
- Testada no PostgreSQL embutido: cada conta vê exatamente as mesmas linhas antes e depois, o dono continua conseguindo atualizar a própria aula e o outro usuário não; pode ser reaplicada.

Para aplicar no `audioestudo`, quando puder conferir:
1. Pedir o ensaio com `rollback` (o mesmo processo usado na migration de autoria).
2. Aplicar com o nome `rls_performance`.
3. Rodar os advisors de performance e segurança e conferir que os avisos `auth_rls_initplan` e `unindexed_foreign_keys` sumiram.

Observação: `CREATE INDEX` sem `CONCURRENTLY` bloqueia escritas por instantes em cada tabela; com o volume atual (18 aulas) isso é imperceptível.

## 2. Interface: "Compartilhar uma cópia para leitura"

O formulário antigo (anterior a esta atualização), que aparecia como um bloco grande no meio da página da aula quando `FEATURE_SHARING` está ligado, agora abre num diálogo compacto pelo botão **Compartilhar** do cabeçalho da aula, ao lado de **Exportar**. O comportamento (transcrição/resumo, validade, revogação) é o mesmo. Conferir: captura `frontend/tests/artifacts/material-share-dialog.png` gerada pelo teste de navegador.

## 3. Ainda dependem de você (fora do código)

- ~~Supabase → proteção contra senhas vazadas~~: disponível só no plano Pro; substituída pela verificação do app (seção 8). O aviso correspondente continua no advisor de segurança.
- **Merge de `feat/study-authoring`** e deploy; depois `FEATURE_STUDY_AUTHORING=true`.
- **Conjuntos de flashcards:** dependem das migrations E03, E05 e E13, que não estão no `audioestudo`. Aplicá-las exige o mesmo processo de diagnóstico, ensaio e confirmação.

## Como juntar esta branch

Depois do merge de `feat/study-authoring` em `main`, esta branch pode ser comparada com `main` e mesclada separadamente; ela contém apenas os itens acima.

## 4. Aplicado em 19/11/2026: tabela de vídeos (MP4 original)

Sintoma: com `FEATURE_MP4_RETENTION=true`, o app mostrava "A conservação de vídeos ainda não foi habilitada no banco". Causa: no **audioestudo** existiam o bucket `study-videos` e as políticas de upload/leitura, mas não a tabela `material_videos`, que depende da chave `materials (id, user_id)` criada pela E05 (planejamento, não aplicada).

Com autorização, `20261119150000_material_videos_table.sql` foi ensaiada com `rollback` e aplicada (nome `material_videos_table`): cria a chave (sem alterar linhas; `id` já é a chave primária) e a tabela com RLS, sem acesso do navegador. Conferido: 19 aulas intactas; 1 arquivo de vídeo já existia no bucket de uma tentativa anterior — reenviar o mesmo MP4 para a mesma aula reaproveita esse arquivo.

A E05 foi ajustada para pular a chave quando ela já existe, então continua aplicável depois (testado: E03 → E05 sobre a tabela de vídeos).

## 5. Envio do áudio: MP3 compacto e upload retomável

Sintoma: "NetworkError when attempting to fetch resource" ao enviar um trecho de 10 min. Os logs mostraram que o upload do navegador para o Storage nunca terminou (conexão caiu no meio). O trecho ia como WAV sem compressão (16 kHz, ~1,9 MB/min), e um trecho de 54 min (~104 MB) passaria do limite de 100 MB do bucket.

- **Formato:** o trecho para transcrição agora é MP3 mono 22,05 kHz / 64 kbps (saída `speech` de `/api/media/convert`, ~0,5 MB/min; 54 min ≈ 26 MB). O limite de duração continua o mesmo. A AssemblyAI recebe o MP3 direto; o fallback síncrono (Whisper/HF) recebe WAV convertido no worker. Áudios antigos em WAV/MP4 seguem funcionando.
- **Upload retomável (TUS):** `frontend/js/api/resumable-upload.js` envia em blocos de 6 MB para `/storage/v1/upload/resumable`; se a conexão cair, consulta o servidor e continua do último bloco confirmado (até 5 novas tentativas: 1 s, 3 s, 5 s, 10 s, 20 s). Nunca sobrescreve (`x-upsert: false`; 409 cai na recuperação existente). Vale para o áudio e para o MP4 original.
- **Mensagens:** progresso em % ("Enviando o áudio… 42%") e, se a conexão não voltar, "A conexão caiu durante o envio e não voltou a tempo…".
- **Verificar depois do deploy:** enviar um trecho real e conferir no Storage o arquivo `…-trecho.mp3`; desligar o Wi-Fi por alguns segundos no meio de um envio de vídeo e ver o envio continuar.
- Sem migration e sem mudança no Supabase.

## 6. Questões: poucas geradas e conteúdo fraco

Sintoma: 5 pedidas, 2 geradas (aula de 10 min, 10 mil caracteres), com "conteúdo insuficiente"; uma questão repetida entre listas. Diagnóstico pelos registros (`question_batches.coverage`): 4–5 candidatas rejeitadas como `unsupported` e só 1–2 conceitos aceitos ("Sistema Terra", "Clima"), então o plano tinha 4 vagas. Causa: a conferência do trecho exigia cópia idêntica; o modelo tira "né"/"tá", põe "..." ou troca uma palavra. Qualidade: duas questões da mesma lista com a mesma resposta (as quatro esferas), "avançada" que era só memória, distratores absurdos ("Cor da terra").

- **Trecho de apoio tolerante** (`domain/evidence-match.js`): localiza o trecho por sequências de palavras e confere palavra a palavra (≥ 75%), ignorando hesitações; salva o texto real da transcrição. Texto inventado continua rejeitado. Vale também para flashcards.
- **Mais conceitos e mais específicos:** pede de ⌈n/2⌉+2 até max(8, 1,5·n) pontos testáveis da aula inteira.
- **Prompt `questions-v2.1`:** o que cada habilidade exige, "pergunta de memória nunca é avançada", distratores plausíveis do mesmo tipo, respostas diferentes entre questões.
- **Redundância:** mesma resposta sobre o mesmo conceito = mesma questão, qualquer que seja a habilidade.
- A repetição entre listas aconteceu porque as duas listas usaram "Permitir repetição para revisão"; com "Evitar repetir" (padrão), questões anteriores são bloqueadas.
- **Verificar:** gerar 5 e 10 questões na aula "Vegetação" e conferir quantidade, níveis e alternativas.

## 7. Disciplinas: menu "⋯" com Editar e Remover

- Na Biblioteca, cada pasta de disciplina tem um "⋯" discreto no canto (mais visível ao passar o mouse); na página da pasta, ele fica ao lado do "+".
- **Editar** abre o mesmo diálogo da criação com o nome preenchido (e o ícone opcional). O rótulo das aulas da disciplina é atualizado junto.
- **Remover** pede confirmação dizendo quantas aulas existem: elas **não são apagadas**, vão para "Sem disciplina"; as unidades da disciplina são removidas.
- API: `PATCH /api/catalog/subjects/:id` e `DELETE /api/catalog/subjects/:id` (só do dono; sem migration).
- Verificar: renomear e remover uma disciplina de teste com 1 aula.

## 8. Senhas: regras visíveis e verificação de vazamento (gratuita)

- No Supabase (feito pela responsável): mínimo de 8 caracteres e "minúsculas, maiúsculas, dígitos e símbolos".
- Cadastro e recuperação de senha mostram as cinco regras abaixo do campo, marcando cada uma quando atendida, e bloqueiam a senha fraca antes de enviar.
- Senhas que cumprem as regras são conferidas no Have I Been Pwned por k-anonimato: só os 5 primeiros caracteres do hash SHA-1 saem do navegador (com padding). Se a senha aparece em vazamentos, o app pede outra. Se o serviço estiver fora do ar, a verificação é pulada (não bloqueia).
- Erros de senha fraca do Supabase aparecem em português.
- Limite: roda no navegador, então quem chamar a API do Supabase diretamente não passa por ela; as regras do Supabase continuam valendo.
