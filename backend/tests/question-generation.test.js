import test from 'node:test';
import assert from 'node:assert/strict';
import { distributeLevels, planCoverage } from '../src/domain/question-plan.js';
import { readFileSync } from 'node:fs';
import { compareQuestions, filterRedundant } from '../src/domain/question-redundancy.js';
import {
  validateQuestionConfig,
  assertListQuestionCount,
  QUESTION_FORMATS,
} from '../src/validators/question-config.validator.js';
import {
  buildQuestionGenerator,
  mockQuestionCompletion,
  shortfallReason,
  sourceReferences,
  MAX_MODEL_CALLS,
} from '../src/services/question-generation.service.js';
import { buildPlannedQuestionMessages } from '../src/prompts/questions.v2.js';

const SOURCE = [
  'A fotossíntese transforma energia luminosa em energia química nas plantas.',
  'A clorofila absorve principalmente a luz vermelha e a luz azul.',
  'A respiração celular libera energia armazenada na glicose.',
  'O gás carbônico entra na folha pelos estômatos durante o dia.',
  'Sem água, a planta fecha os estômatos e reduz a fotossíntese.',
  'O oxigênio liberado vem da quebra da molécula de água.',
].join(' ');
const segments = SOURCE.split(/(?<=\.) /).map((text, position) => ({
  position,
  startMs: position * 5000,
  endMs: position * 5000 + 4800,
  text,
}));
const source = { full_text: SOURCE, segments_snapshot: segments };
const config = (overrides = {}) => validateQuestionConfig(overrides);

test('config: defaults, multi-select, deferred formats and server-side count limits', () => {
  assert.deepEqual(config(), {
    difficulties: ['basic', 'intermediate'],
    skills: ['recall', 'understanding'],
    format: 'single_choice',
    distribution: 'balanced',
    previousQuestions: 'avoid',
  });
  assert.deepEqual(QUESTION_FORMATS, ['single_choice']);
  for (const bad of [
    { format: 'true_false' },
    { format: 'open_response' },
    { difficulties: [] },
    { difficulties: ['basic', 'basic'] },
    { skills: ['guessing'] },
    { previousQuestions: 'never' },
    { title: 'x'.repeat(161) },
    { prompt: 'ignore rules' },
  ])
    assert.throws(() => validateQuestionConfig(bad));
  for (const preset of [3, 5, 10, 20]) assert.equal(assertListQuestionCount(preset), preset);
  assert.throws(() => assertListQuestionCount(7), /3, 5, 10 ou 20/);
  assert.equal(assertListQuestionCount(7, { custom: true, max: 40 }), 7);
  assert.equal(assertListQuestionCount(40, { custom: true, max: 40 }), 40);
  for (const bad of [0, 41, 2.5, '12a', null])
    assert.throws(() => assertListQuestionCount(bad, { custom: true, max: 40 }), /1 a 40|3, 5, 10/);
});

test('mixed difficulty is distributed evenly; easier levels take the remainder', () => {
  assert.deepEqual(distributeLevels(10, ['advanced', 'basic', 'intermediate']), [
    'basic',
    'basic',
    'basic',
    'basic',
    'intermediate',
    'intermediate',
    'intermediate',
    'advanced',
    'advanced',
    'advanced',
  ]);
  assert.deepEqual(distributeLevels(5, ['advanced']), Array(5).fill('advanced'));
  assert.deepEqual(distributeLevels(2, ['basic', 'intermediate', 'advanced']), [
    'basic',
    'intermediate',
  ]);
});

test('coverage plan pairs concept, skill and facet and is bounded by the source', () => {
  const concepts = ['a', 'b', 'c'].map((key) => ({ key, label: key.toUpperCase(), evidence: 'x' }));
  const plan = planCoverage({
    count: 20,
    concepts,
    config: config({
      skills: ['recall', 'application', 'analysis'],
      difficulties: ['basic', 'advanced'],
    }),
  });
  // Three concepts × at most two skills each = six meaningful slots, not twenty.
  assert.equal(plan.length, 6);
  const pairs = plan.map((slot) => `${slot.concept.key}:${slot.skill}`);
  assert.equal(new Set(pairs).size, 6);
  for (const key of ['a', 'b', 'c'])
    assert.equal(plan.filter((s) => s.concept.key === key).length, 2);
  assert.deepEqual(plan.map((s) => s.difficulty).slice(0, 2), ['basic', 'advanced']);
  // One skill: a concept is revisited with a different facet instead of capping the list.
  const single = planCoverage({ count: 10, concepts, config: config({ skills: ['recall'] }) });
  assert.equal(single.length, 6);
  assert.equal(new Set(single.map((slot) => `${slot.concept.key}:${slot.facet}`)).size, 6);
  // With the transcript size known, the source (not the concept list) bounds the plan.
  const long = planCoverage({
    count: 10,
    concepts,
    config: config({ skills: ['recall'] }),
    words: 1000,
  });
  assert.equal(long.length, 10);
  assert(
    long.filter((slot) => slot.concept.key === 'a').length >= 3,
    'broad concepts are revisited',
  );
  const short = planCoverage({
    count: 10,
    concepts,
    config: config({ skills: ['recall'] }),
    words: 60,
  });
  assert.equal(short.length, 3, 'a tiny transcript is not padded');
  const progressive = planCoverage({
    count: 6,
    concepts,
    config: config({
      skills: ['recall', 'analysis'],
      difficulties: ['basic', 'intermediate', 'advanced'],
      distribution: 'progressive',
    }),
  });
  assert.deepEqual(
    progressive.map((s) => s.difficulty),
    ['basic', 'basic', 'intermediate', 'intermediate', 'advanced', 'advanced'],
  );
  const fresh = planCoverage({
    count: 2,
    concepts,
    config: config({ skills: ['recall'], previousQuestions: 'prioritize_new' }),
    testedConcepts: ['A'],
  });
  assert.deepEqual(
    fresh.map((s) => s.concept.key),
    ['b', 'c'],
  );
});

test('redundancy: exact, paraphrase, same knowledge — but not recall vs application', () => {
  const base = {
    statement: 'Qual é a função da clorofila na fotossíntese?',
    options: ['Absorver luz', 'Liberar gás', 'Fixar água', 'Produzir glicose'],
    correctIndex: 0,
    concept: 'Clorofila',
    skill: 'recall',
  };
  assert.equal(
    compareQuestions(base, { ...base, statement: 'qual é a FUNÇÃO da clorofila na fotossíntese' }),
    'exact',
  );
  assert.equal(
    compareQuestions(base, {
      ...base,
      statement: 'Na fotossíntese, qual é a função da clorofila?',
      concept: 'Outro',
    }),
    'paraphrase',
  );
  assert.equal(
    compareQuestions(base, {
      ...base,
      statement: 'Que papel a aula atribui ao pigmento verde das folhas?',
    }),
    'same_knowledge',
  );
  // Same concept, different cognitive purpose: allowed.
  assert.equal(
    compareQuestions(base, {
      ...base,
      skill: 'application',
      statement:
        'Uma planta mantida sob luz verde fraca terá que efeito na produção de energia química?',
      options: ['Produção menor', 'Produção maior', 'Nenhuma mudança', 'Mais oxigênio'],
    }),
    null,
  );
  const { accepted, rejected } = filterRedundant(
    [
      base,
      { ...base },
      {
        ...base,
        statement: 'Pergunta nova sobre estômatos e gás carbônico?',
        concept: 'Estômatos',
      },
    ],
    { previous: [{ statement: 'Pergunta nova sobre estômatos e gás carbônico' }], policy: 'avoid' },
  );
  assert.equal(accepted.length, 1);
  assert.deepEqual(
    rejected.map((r) => r.reason),
    ['exact', 'previous_exact'],
  );
  assert.equal(
    filterRedundant([{ ...base, statement: 'Pergunta nova sobre estômatos e gás carbônico?' }], {
      previous: [{ statement: 'Pergunta nova sobre estômatos e gás carbônico' }],
      policy: 'review',
    }).accepted.length,
    1,
  );
});

/** Scripted fake model: records calls and replays prepared answers per stage. */
function scripted(responses) {
  const calls = [];
  return {
    calls,
    complete: async (args) => {
      calls.push(args);
      const next = responses[args.stage];
      return typeof next === 'function' ? next(args) : next;
    },
  };
}
const concepts = {
  concepts: [
    {
      label: 'Fotossíntese',
      evidence: 'A fotossíntese transforma energia luminosa em energia química',
    },
    {
      label: 'Clorofila',
      evidence: 'A clorofila absorve principalmente a luz vermelha e a luz azul',
    },
    { label: 'fotossintese', evidence: 'A fotossíntese transforma energia luminosa' }, // duplicate label
    { label: 'Inventado', evidence: 'A mitocôndria produz ATP por fosforilação oxidativa' }, // not in source
    {
      label: 'Estômatos',
      evidence: 'O gás carbônico entra na folha pelos estômatos durante o dia',
    },
  ],
};
const question = (slot, statement, evidence, extra = {}) => ({
  slot,
  statement,
  options: ['Opção um', 'Opção dois', 'Opção três', 'Opção quatro'],
  correctIndex: 1,
  explanation: 'Explicação sustentada.',
  evidence,
  ...extra,
});

test('source-grounded generation drops unsupported concepts/items and replaces redundant ones once', async () => {
  const fake = scripted({
    concepts,
    questions: ({ messages }) => {
      const plan = JSON.parse(messages[1].content).plan;
      assert.equal(plan.length, 3);
      return {
        questions: [
          question(
            's1',
            'O que a fotossíntese transforma segundo a aula?',
            'A fotossíntese transforma energia luminosa em energia química',
          ),
          question(
            's2',
            'O que a fotossíntese transforma segundo a aula',
            'A fotossíntese transforma energia luminosa em energia química',
          ), // exact duplicate
          question(
            's3',
            'Por onde o gás carbônico entra na folha?',
            'Texto que não está na transcrição de forma alguma',
          ), // unsupported
        ],
      };
    },
    replacement: ({ messages }) => {
      const input = JSON.parse(messages[1].content);
      assert.deepEqual(
        input.plan.map((slot) => slot.slot),
        ['s2', 's3'],
      );
      assert(input.avoid.includes('O que a fotossíntese transforma segundo a aula?'));
      return {
        questions: [
          question(
            's2',
            'Quais cores de luz a clorofila absorve principalmente?',
            'A clorofila absorve principalmente a luz vermelha e a luz azul',
          ),
          question(
            's3',
            'Por onde o gás carbônico entra na folha durante o dia?',
            'O gás carbônico entra na folha pelos estômatos durante o dia',
          ),
        ],
      };
    },
  });
  const result = await buildQuestionGenerator(fake)({
    source,
    count: 3,
    config: config({ skills: ['recall'] }),
  });
  assert.equal(fake.calls.length, 3);
  assert.equal(result.questions.length, 3);
  assert.deepEqual(result.coverage.rejected, { exact: 1, unsupported: 1 });
  assert.equal(result.coverage.shortfall, null);
  assert.equal(result.coverage.distinctConcepts, 3);
  const [first] = result.questions;
  assert.deepEqual(Object.keys(first).sort(), [
    'correctIndex',
    'explanation',
    'metadata',
    'options',
    'statement',
  ]);
  assert.equal(first.metadata.concept, 'Fotossíntese');
  assert.equal(first.metadata.skill, 'recall');
  assert.deepEqual(first.metadata.sourceRefs, [{ position: 0, startMs: 0, endMs: 4800 }]);
});

test('insufficient content yields fewer meaningful questions, never padding', async () => {
  const fake = scripted({
    concepts: { concepts: concepts.concepts.slice(0, 2) },
    questions: {
      questions: [
        question(
          's1',
          'O que a fotossíntese transforma?',
          'A fotossíntese transforma energia luminosa em energia química',
        ),
        question(
          's2',
          'Que luz a clorofila absorve principalmente?',
          'A clorofila absorve principalmente a luz vermelha e a luz azul',
        ),
      ],
    },
  });
  const result = await buildQuestionGenerator(fake)({
    source,
    count: 20,
    config: config({ skills: ['recall'] }),
  });
  assert.equal(result.questions.length, 2);
  assert.equal(result.coverage.requested, 20);
  assert.equal(result.coverage.shortfall, 'insufficient_content');
  assert.equal(fake.calls.length, 2, 'no replacement round when every planned slot is filled');
  const empty = scripted({ concepts: { concepts: [] } });
  await assert.rejects(
    buildQuestionGenerator(empty)({ source, count: 5, config: config() }),
    (error) => error.code === 'INSUFFICIENT_SOURCE_CONTENT' && error.status === 422,
  );
});

test('earlier lists are avoided by default, allowed for review and the budget is bounded', async () => {
  const previous = [
    { statement: 'O que a fotossíntese transforma?', concept: 'Fotossíntese', skill: 'recall' },
  ];
  const repeat = () => ({
    questions: [
      question(
        's1',
        'O que a fotossíntese transforma?',
        'A fotossíntese transforma energia luminosa em energia química',
      ),
    ],
  });
  const avoid = scripted({
    concepts: { concepts: concepts.concepts.slice(0, 1) },
    questions: repeat,
    replacement: repeat,
  });
  await assert.rejects(
    buildQuestionGenerator(avoid)({
      source,
      count: 1,
      config: config({ skills: ['recall'] }),
      previous,
    }),
    (error) => error.code === 'LLM_INVALID_OUTPUT',
  );
  assert.equal(avoid.calls.length, MAX_MODEL_CALLS);
  const sent = JSON.parse(avoid.calls[1].messages[1].content);
  assert.deepEqual(sent.avoid, ['O que a fotossíntese transforma?']);
  const review = scripted({
    concepts: { concepts: concepts.concepts.slice(0, 1) },
    questions: repeat,
  });
  const reviewed = await buildQuestionGenerator(review)({
    source,
    count: 1,
    config: config({ skills: ['recall'], previousQuestions: 'review' }),
    previous,
  });
  assert.equal(reviewed.questions.length, 1);
  assert.deepEqual(JSON.parse(review.calls[1].messages[1].content).avoid, []);
});

test('malformed provider output fails as retryable; prompts keep skills apart from answer count', async () => {
  await assert.rejects(
    buildQuestionGenerator(scripted({ concepts: { nope: true } }))({
      source,
      count: 3,
      config: config(),
    }),
    (error) => error.code === 'LLM_INVALID_OUTPUT' && error.retryable,
  );
  const content = buildPlannedQuestionMessages('T', {
    slots: [
      {
        id: 's1',
        concept: { label: 'C', evidence: 'E' },
        skill: 'evaluation',
        difficulty: 'advanced',
      },
    ],
  })[0].content;
  assert.match(content, /UMA única alternativa correta/);
  assert.match(
    content,
    /Habilidades cognitivas descrevem o tipo de raciocínio, não o número de respostas corretas/,
  );
  assert.match(
    content,
    /avaliação crítica\): julgar se uma afirmação ou argumento está correto usando critérios que a própria aula apresenta/,
  );
  assert.match(content, /omita esse slot em vez de inventar conteúdo/);
});

test('mock completion yields source-quoting questions that pass the real pipeline', async () => {
  const result = await buildQuestionGenerator({ complete: mockQuestionCompletion })({
    source,
    count: 8,
    config: config({
      skills: ['recall', 'application'],
      difficulties: ['basic', 'intermediate', 'advanced'],
    }),
  });
  assert(result.questions.length >= 6, `got ${result.questions.length}`);
  for (const q of result.questions) assert(SOURCE.includes(q.metadata.evidence));
  assert.deepEqual(
    sourceReferences('estômatos durante o dia. Sem água, a planta fecha', segments).map(
      (r) => r.position,
    ),
    [3, 4],
  );
});

// ---- Questions 3.0 regression: a 10-minute lesson must yield five meaningful questions ------
const LESSON = readFileSync(new URL('./fixtures/aula-10min-solos.txt', import.meta.url), 'utf8');
const lessonSource = { full_text: LESSON, segments_snapshot: [] };
const BROAD = {
  concepts: [
    {
      label: 'Formação do solo',
      evidence: 'O processo que transforma a rocha em solo se chama intemperismo.',
    },
    {
      label: 'Horizontes do solo',
      evidence:
        'Quando a gente faz um corte vertical no terreno, que se chama perfil do solo, aparecem camadas diferentes, os horizontes.',
    },
    // A paraphrased quote: the concept is real, so it is kept (its questions still need a quote).
    {
      label: 'Erosão e conservação do solo',
      evidence: 'A erosão acontece quando o solo fica sem proteção e a água o leva.',
    },
  ],
};
// What a good model answers for each concept and facet, quoting the lesson.
const BANK = {
  'Formação do solo': {
    definition: [
      'O que é intemperismo, segundo a aula?',
      'Transformação da rocha em solo',
      'O processo que transforma a rocha em solo se chama intemperismo.',
    ],
    mechanism: [
      'Por que os solos tropicais costumam ser profundos?',
      'Calor e umidade aceleram o intemperismo químico',
      'Por isso os solos tropicais costumam ser profundos.',
    ],
    relation: [
      'Como o clima se relaciona com o tipo de intemperismo?',
      'O clima controla qual intemperismo predomina',
      'o clima controla qual intemperismo predomina',
    ],
  },
  'Horizontes do solo': {
    definition: [
      'Qual horizonte é o mais fértil?',
      'O horizonte A, rico em húmus',
      'Logo abaixo vem o horizonte A, a camada mais fértil, escura, rica em húmus',
    ],
    mechanism: [
      'Por que o horizonte A é mais escuro?',
      'Porque tem húmus',
      'Porque ele tem húmus, que é a matéria orgânica decomposta',
    ],
    relation: [
      'O que diferencia o horizonte C da rocha matriz?',
      'O C é rocha alterada; a matriz deu origem ao solo',
      'O horizonte C é a rocha alterada, parcialmente decomposta.',
    ],
  },
  'Erosão e conservação do solo': {
    definition: [
      'O que é erosão, segundo a aula?',
      'Desgaste e transporte do solo',
      'Erosão é o desgaste e o transporte do solo pela água, pelo vento ou pela ação humana.',
    ],
    mechanism: [
      'Como o plantio em curvas de nível reduz a erosão?',
      'Cada fileira segura a água e reduz a enxurrada',
      'faz com que cada fileira de plantas segure a água da chuva, diminuindo a velocidade da enxurrada',
    ],
    relation: [
      'Qual a relação entre erosão e enchentes?',
      'O assoreamento deixa os rios mais rasos',
      'deixando ele mais raso e aumentando as enchentes',
    ],
  },
};
const answerSlots = ({ messages }, { skip = () => false } = {}) => ({
  questions: JSON.parse(messages[1].content)
    .plan.filter((slot) => !skip(slot))
    .map((slot) => {
      const [statement, answer, evidence] = BANK[slot.concept]?.[slot.facet] || [];
      if (!statement) return null;
      return {
        slot: slot.slot,
        statement,
        options: [
          answer,
          `Distrator A ${slot.slot}`,
          `Distrator B ${slot.slot}`,
          `Distrator C ${slot.slot}`,
        ],
        correctIndex: 0,
        explanation: 'Conforme a aula.',
        evidence,
      };
    })
    .filter(Boolean),
});

test('Questions 3.0: a 10-minute lesson with three broad concepts yields five questions', async () => {
  for (const skills of [['recall'], ['recall', 'understanding']]) {
    const fake = scripted({
      concepts: BROAD,
      questions: (args) => answerSlots(args),
      replacement: (args) => answerSlots(args),
    });
    const result = await buildQuestionGenerator(fake)({
      source: lessonSource,
      count: 5,
      config: config({ skills }),
    });
    assert.equal(result.questions.length, 5, `five questions with skills ${skills}`);
    assert.equal(result.coverage.shortfall, null);
    assert.equal(result.coverage.distinctConcepts, 3, 'the paraphrased concept is kept');
    assert.equal(result.coverage.conceptsWithoutQuote, 1);
    assert(result.coverage.capacity >= 15, 'a 1,000-word lesson supports many more than five');
    assert.equal(
      new Set(result.questions.map((q) => q.metadata.concept)).size,
      3,
      'every concept covered',
    );
    const pairs = result.questions.map(
      (q) => `${q.metadata.concept}:${q.metadata.skill}:${q.metadata.facet}`,
    );
    assert.equal(new Set(pairs).size, 5, 'no two questions share concept, skill and facet');
    assert(fake.calls.length <= MAX_MODEL_CALLS);
  }
});

test('Questions 3.0: a short list names the real cause instead of blaming the lesson', async () => {
  // The model skips two slots: the spare slots absorb it without another call.
  const fewSkips = scripted({
    concepts: BROAD,
    questions: (args) => answerSlots(args, { skip: (slot) => ['s2', 's4'].includes(slot.slot) }),
  });
  const absorbed = await buildQuestionGenerator(fewSkips)({
    source: lessonSource,
    count: 5,
    config: config({ skills: ['recall'] }),
  });
  assert.equal(absorbed.questions.length, 5);
  assert.equal(fewSkips.calls.length, 2, 'spares filled the gaps');
  // It skips more than the spares cover: one bounded replacement round recovers the rest.
  const manySkips = scripted({
    concepts: BROAD,
    questions: (args) =>
      answerSlots(args, { skip: (slot) => ['s1', 's2', 's3'].includes(slot.slot) }),
    replacement: (args) => answerSlots(args),
  });
  const recovered = await buildQuestionGenerator(manySkips)({
    source: lessonSource,
    count: 5,
    config: config({ skills: ['recall'] }),
  });
  assert.equal(recovered.questions.length, 5);
  assert.equal(manySkips.calls.length, 3, 'one bounded replacement round');
  // Quotes that are not in the lesson: "unsupported", never "insufficient content".
  const invented = scripted({
    concepts: BROAD,
    questions: (args) => ({
      questions: answerSlots(args).questions.map((q, i) =>
        i < 2 ? q : { ...q, evidence: 'Frase que a professora nunca disse em momento algum.' },
      ),
    }),
    replacement: () => ({ questions: [] }),
  });
  const result = await buildQuestionGenerator(invented)({
    source: lessonSource,
    count: 5,
    config: config({ skills: ['recall'] }),
  });
  assert.equal(result.questions.length, 2);
  assert.equal(result.coverage.shortfall, 'unsupported');
  assert.equal(
    shortfallReason({ generated: 3, count: 5, planned: 5, rejected: {} }),
    'model_omitted',
  );
  assert.equal(
    shortfallReason({ generated: 3, count: 5, planned: 5, rejected: { same_knowledge: 2 } }),
    'redundancy',
  );
  assert.equal(
    shortfallReason({ generated: 2, count: 5, planned: 2, rejected: {} }),
    'insufficient_content',
  );
  assert.equal(shortfallReason({ generated: 5, count: 5, planned: 5 }), null);
});
