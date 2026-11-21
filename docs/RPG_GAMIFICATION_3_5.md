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
| `object.specimen-jar` — Pote de espécimes | `evidence_verified` | 10ª evidência |
| `object.pressed-flower` — Flor prensada | `revisit_made` | 3ª revisita |
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

Hoje o modo é uma preferência **deste aparelho** (`localStorage`, `voz-experience-mode`), escolhida
no Gabinete; a preferência global (Aparência, sincronizada) fica para o sistema visual.

## 5. Implementado × futuro

Implementado (Marco 6, atrás de `FEATURE_DISCOVERIES`, migration só em staging):
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
- Modo sincronizado entre aparelhos.
