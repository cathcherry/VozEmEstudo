import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceLocator } from '../src/domain/evidence-match.js';
import { compareQuestions } from '../src/domain/question-redundancy.js';
import {
  buildQuestionGenerator,
  conceptTarget,
} from '../src/services/question-generation.service.js';
import { validateQuestionConfig } from '../src/validators/question-config.validator.js';

// Spoken-lesson style: fillers, repetitions and loose punctuation, as ASR returns it.
const LESSON = [
  'Fala pessoal, beleza? Hoje a gente vai falar de vegetação, tá?',
  'Então quando eu falo de sistema Terra, né, eu tô falando na verdade de interações, né, que ocorrem,',
  'porque uma corrente das geociências entende que a Terra é um sistema, né, que é resultado de',
  'múltiplas interações entre atmosfera, biosfera, geosfera, hidrosfera, né.',
  'Obviamente, a vegetação ela recebe uma influência muito grande do clima.',
  'Então a quantidade de chuvas ela varia de região para região e também as temperaturas variam.',
  'O relevo também interfere, porque em áreas mais altas a temperatura cai e a vegetação muda.',
  'E o solo, né, com mais ou menos nutrientes, define que tipo de planta consegue se fixar ali.',
  'Na Amazônia, com muita chuva e calor o ano inteiro, a gente tem uma floresta densa e úmida.',
  'Já na Caatinga, com pouca chuva, as plantas perdem as folhas na seca para economizar água.',
].join(' ');

test('evidence: tolerates fillers, ellipses and casing; returns the transcript wording', () => {
  const locate = createEvidenceLocator(LESSON);
  const found = locate(
    '...a Terra é um sistema que é resultado de múltiplas interações entre Atmosfera, Biosfera, Geosfera e Hidrosfera...',
  );
  assert(found, 'paraphrased-by-omission quote is supported');
  assert.match(found.text, /^a Terra é um sistema, né, que é resultado de/);
  assert(LESSON.includes(found.text), 'stored evidence is literal transcript text');
  // A word changed by the model ("influência enorme" vs "muito grande") still locates the passage.
  assert(locate('a vegetação recebe uma influência enorme do clima, a quantidade de chuvas varia'));
});

test('evidence: invented, too short or off-topic quotes are rejected', () => {
  const locate = createEvidenceLocator(LESSON);
  for (const quote of [
    'A floresta boreal é dominada por coníferas adaptadas ao frio intenso.',
    'clima e relevo',
    'a vegetação depende da posição das estrelas e da cor da terra no verão',
  ])
    assert.equal(locate(quote), null, quote);
});

test('redundancy: same answer on the same concept is one fact, whatever the skill label', () => {
  const base = {
    concept: 'Sistema Terra',
    options: ['Atmosfera, biosfera, geosfera e hidrosfera', 'b', 'c', 'd'],
    correctIndex: 0,
  };
  const a = {
    ...base,
    skill: 'recall',
    statement: 'Quais são as quatro esferas do Sistema Terra?',
  };
  const b = {
    ...base,
    skill: 'understanding',
    statement: 'Que combinação descreve as esferas que interagem para formar o Sistema Terra?',
    options: ['x', 'y', 'Atmosfera, hidrosfera, geosfera e biosfera', 'z'],
    correctIndex: 2,
  };
  assert.equal(compareQuestions(a, b), 'same_knowledge');
  // A different fact about the same concept still coexists.
  const c = {
    ...base,
    skill: 'understanding',
    statement: 'Por que a aula descreve a Terra como um sistema?',
    options: ['Porque suas esferas interagem e se transformam constantemente', 'b', 'c', 'd'],
  };
  assert.equal(compareQuestions(a, c), null);
});

test('concept target leaves room for the plan and for rejections', () => {
  assert.equal(conceptTarget(3), 8);
  assert.equal(conceptTarget(5), 8);
  assert.equal(conceptTarget(20), 30);
  assert.equal(conceptTarget(100), 60);
});

test('pipeline: quotes copied without fillers are accepted and stored literally', async () => {
  const quotes = {
    terra: 'a Terra é um sistema que é resultado de múltiplas interações entre atmosfera, biosfera',
    clima: 'a vegetação ela recebe uma influência muito grande do clima',
    relevo: 'O relevo também interfere porque em áreas mais altas a temperatura cai',
    solo: 'E o solo com mais ou menos nutrientes define que tipo de planta consegue se fixar',
    amazonia: 'Na Amazônia com muita chuva e calor o ano inteiro a gente tem uma floresta densa',
    caatinga: 'na Caatinga com pouca chuva as plantas perdem as folhas na seca',
  };
  const prompts = [];
  const complete = async ({ stage, messages }) => {
    prompts.push({ stage, system: messages[0].content });
    if (stage === 'concepts')
      return {
        concepts: Object.entries(quotes).map(([label, evidence]) => ({ label, evidence })),
      };
    const { plan } = JSON.parse(messages[1].content);
    return {
      questions: plan.map((slot, index) => ({
        slot: slot.slot,
        statement: `Questão ${index + 1} sobre ${slot.concept} (${slot.skill})?`,
        options: [
          `Resposta ${slot.slot}`,
          `Outra ${index} a`,
          `Outra ${index} b`,
          `Outra ${index} c`,
        ],
        correctIndex: 0,
        explanation: 'Sustentada pela aula.',
        evidence: quotes[slot.concept],
      })),
    };
  };
  const generate = buildQuestionGenerator({ complete });
  const result = await generate({
    source: { full_text: LESSON, segments_snapshot: [] },
    count: 5,
    config: validateQuestionConfig({ skills: ['recall', 'understanding', 'application'] }),
  });
  assert.equal(result.questions.length, 5);
  assert.equal(result.coverage.shortfall, null);
  assert.deepEqual(result.coverage.rejected, {});
  assert.equal(result.coverage.distinctConcepts, 6);
  for (const question of result.questions)
    assert(LESSON.includes(question.metadata.evidence), question.metadata.evidence);
  const conceptPrompt = prompts.find((p) => p.stage === 'concepts').system;
  assert.match(conceptPrompt, /Liste de 5 a 8 pontos de conteúdo DISTINTOS/);
  assert.match(conceptPrompt, /Percorra a aula inteira/);
  const questionPrompt = prompts.find((p) => p.stage === 'questions').system;
  assert.match(questionPrompt, /nunca use alternativas absurdas/);
  assert.match(
    questionPrompt,
    /uma pergunta de memória nunca é avançada|application \(aplicação\)/,
  );
});
