# Jogo com sentido — Voz em Estudo 3.5

Complementa a seção 6 de `EXPERIENCE_VISION_3_5.md` e substitui, para o ciclo 3.5, a proposta de
`GAMIFICACAO_2_0_DESIGN.md` (que continua valendo como referência de princípios: só eventos
registrados pelo servidor contam).

## 1. O ciclo

**Aula → Pergunta significativa → Investigação → Descoberta → Colecionável → Personalização.**

1. **Pergunta.** A pessoa escreve o que quer entender, ou parte de sugestões tiradas da própria
   aula (título, um termo que a aula define, questões que a aula já tem). Nenhuma chamada de IA.
2. **Investigação**, sobre uma aula da própria conta com **transcrição confirmada**:
   explorar os trechos → reunir evidências (citações conferidas no banco) → explicar com as
   próprias palavras → aplicar (opcional: ligar questões respondidas, cartões, destaques, o
   caderno) → refletir (opcional). Basta pergunta + 1 evidência + explicação.
3. **Descoberta**, no Arquivo de Descobertas: evolui com versões, novas evidências, reflexões,
   conexões com outras descobertas (inclusive de outras disciplinas) e revisitas.
4. **Colecionável**: selo, objeto ou capa no Gabinete, com a data, o evento e a aula de origem.
5. **Personalização**: objetos encontrados podem ser colocados na mesa (`objeto + lugar`).

## 2. Eventos → recompensas (regras versão 1, no banco)

| Item | Evento verificado | Quando |
| --- | --- | --- |
| `stamp.first-evidence` — Primeira evidência | `evidence_verified` | 1ª citação conferida |
| `stamp.own-explanation` — Com as próprias palavras | `explanation_written` | 1ª explicação com ≥ 20 caracteres |
| `stamp.first-investigation` — Primeira investigação | `investigation_completed` | 1ª investigação concluída |
| `stamp.first-reflection` — Primeira reflexão | `reflection_written` | 1ª reflexão com ≥ 20 caracteres |
| `stamp.connection` — Ponte entre disciplinas | `connection_made` | 1ª conexão entre descobertas de disciplinas diferentes |
| `stamp.revisit` — Revisita | `revisit_made` | 1ª revisita significativa |
| `object.magnifying-glass` — Lupa | `investigation_completed` | 3ª investigação concluída |
| `object.desk-lamp` — Luminária de mesa | `investigation_completed` | 5ª investigação concluída |
| `object.specimen-box` — Pote de espécimes | `evidence_verified` | 10ª evidência |
| `object.pressed-flower-jar` — Flor prensada | `revisit_made` | 3ª revisita |
| `object.globe` — Globo | `subjects_explored` | descobertas em 3 disciplinas |
| `cover.matcha-linen` — Capa de linho matcha | `connection_made` | 3ª conexão |

- **Revisita significativa**: a pessoa abre a descoberta e **muda algo** (explicação, evidência,
  reflexão, conexão, ligação) pelo menos **um dia** depois de registrá-la; conta **uma por
  descoberta e por dia**. Abrir sem mudar nada não conta.
- Cada desbloqueio guarda a linha que o comprovou (a n-ésima), a investigação/descoberta, a aula
  (título) e a data. É uma **lembrança do aprendizado**, não um prêmio por clique.
- O catálogo vive em `collection_catalog()` (SQL) e os nomes/textos em
  `frontend/js/utils/collectibles.js`. A arte é referenciada por id (`data-art-slot`,
  `data-art-id`); sem arte, só o texto aparece.

## 3. Princípios contra manipulação

- **O servidor é dono de tudo**: desbloqueios só nascem de gatilhos nas linhas que comprovam o
  evento; não há rota nem função para "dar" item; as funções de gatilho não são executáveis.
- **Idempotente**: chave `(conta, item)`; repetir, reenviar ou concorrer não duplica.
- **Nada se perde, nada expira**: sem sequências, sem penalidades, sem prazos; remover uma
  evidência ou excluir a aula não tira o selo; desbloqueios não podem ser reescritos.
- **Esforço real, não tempo de tela**: citações conferidas palavra por palavra, explicação própria
  com mínimo de texto, revisitas limitadas a uma por dia e só com mudança.
- **Sem alegar domínio**: os textos dizem o que a pessoa fez ("você investigou", "você explicou",
  "você revisitou"), nunca que ela "domina" um assunto. Ninguém corrige a explicação.
- **Nada acadêmico ou de acessibilidade preso a recompensa**; o jogo é opcional (modos).
- **Privado**: tudo é da conta; outra conta não vê nada.

## 4. Modos (mesma base de dados)

| Modo | Interface |
| --- | --- |
| Estudo silencioso (`quiet`) | sem selos, celebrações, Lume ou atalhos do Gabinete (`[data-game-ui]` oculto); investigações e descobertas funcionam igual e tudo continua registrado |
| Estudo aconchegante (`cozy`, padrão) | selos nas descobertas, celebração breve ao desbloquear, gavetas com itens e o que os faz aparecer |
| Estudo aventura (`adventure`) | como o aconchegante + progresso até os próximos itens no Gabinete ("2 de 5") |

Desde o Marco 5, o modo é uma preferência **da conta** (Aparência e Gabinete mostram a mesma
escolha), sincronizada com as outras preferências e aplicada antes da primeira pintura; o valor
antigo deste aparelho (`voz-experience-mode`) é migrado. Ver `EXPERIENCE_VISION_3_5.md`, seção 5.

## 5. Implementado × futuro

Implementado (Marco 6, atrás de `FEATURE_DISCOVERIES`; a migration já está aplicada em produção):
investigação de uma aula confirmada, evidência verificada, explicação, aplicar por referência,
reflexão, descoberta versionada, conexões, revisitas, 12 colecionáveis, mesa (API e escolha de
lugar), modos por aparelho, páginas `investigar.html`, `descobertas.html`, `gabinete.html`.

Futuro:
- **Campanhas**: sequências de perguntas sobre uma unidade ("Expedição: Energia"), com objetos
  temáticos; sem prazo.
- **Aventuras colaborativas** em turma: perguntas compartilhadas, evidências de cada pessoa
  visíveis só com consentimento; nunca ranking.
- **Ambientes desbloqueáveis** (papéis de parede, atmosferas, trajes da Lume) e a arte da mesa.
- Lume reagindo ao estado (`celebrating` numa descoberta).
- Sugestões de pergunta com IA (opcional, com citação obrigatória).
- ~~Modo sincronizado entre aparelhos.~~ Feito no Marco 5, junto com a escrivaninha do Início
  (objetos desbloqueados colocados por arrastar ou pelo teclado) e as oito atmosferas.

## 6. Ciclo 3.6, Marco E: Gabinete, hierarquia e transformações (implementado)

Nenhuma regra de desbloqueio nova: os 12 colecionáveis e os eventos da seção 2 continuam iguais.
O que mudou é como o que a pessoa já fez aparece.

- **Gabinete de curiosidades** (`gabinete.html`): armário com prateleiras e quatro gavetas (Selos,
  Objetos de mesa, Capas, Espécimes). Cada item se inspeciona numa etiqueta de museu com data, aula
  e descoberta de origem; objetos vão para a mesa por "Colocar na mesa". Itens não encontrados são
  contornos com a dica da regra. As prateleiras e as gavetas mostram o que já foi encontrado (a
  **transformação do ambiente**), derivado de `GET /api/collection`.
- **Cartões que evoluem** (`frontend/js/utils/discovery-card.js`): esboço a lápis (investigação
  aberta) → passado a tinta (explicação + evidência) → carimbado (reflexão) → costurado com linha
  (ligação) → flor prensada (revisita significativa, a mesma regra da seção 2). As marcas são
  independentes, derivadas só de dados guardados, explicadas uma a uma e nunca retiradas. Não há
  XP, pontos, níveis, sequências nem prazos; nenhum texto diz que a pessoa "domina" algo.
- **Hierarquia no Arquivo**: grupos por disciplina, fios entre descobertas ligadas (vermelhos entre
  disciplinas), coleções criadas pela pessoa (preferências da conta, sem migração) e **marcos**
  lidos dos desbloqueios: primeira evidência, primeira explicação, primeira descoberta, primeira
  reflexão, primeira ponte entre disciplinas, primeira revisita.
- **Modos**: no silencioso, selos e marcos ilustrados (`[data-game-ui]`) somem; os cartões, os
  estados e as explicações continuam, porque descrevem o estudo, não um prêmio.
- **Dados**: `20261124090000_discovery_archive.sql` acrescenta à lista de descobertas a pergunta,
  as reflexões, as ligações e a primeira revisita (ver `docs/migrations/DISCOVERY_ARCHIVE.md`).

Futuro (não feito): campanhas, aventuras em turma, ambientes desbloqueáveis, fios desenhados por
cima da grade de cartões.
