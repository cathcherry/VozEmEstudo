// Pure helpers for summary and question-list authoring. No DOM access: covered by node tests.

export const SUMMARY_FORMATS = Object.freeze({
  paragraphs: 'Narrativo',
  structured: 'Anotações com títulos',
  topics: 'Tópicos',
  definitions: 'Definições e conceitos-chave',
  comparative: 'Comparativo',
  chronological: 'Cronológico',
  cause_effect: 'Causa e efeito',
});
export const SUMMARY_LENGTHS = Object.freeze({
  short: 'Breve',
  standard: 'Padrão',
  detailed: 'Detalhado',
});
export const SUMMARY_FOCUS = Object.freeze({
  concepts: 'Conceitos essenciais',
  terminology: 'Definições e terminologia',
  processes: 'Processos e mecanismos',
  causes: 'Causas e consequências',
  comparisons: 'Comparações',
  dates: 'Datas e eventos, quando houver',
  examples: 'Exemplos da aula',
  arguments: 'Argumentos e conclusões',
  exam: 'Preparação para prova',
});

/** Form values → API options. Narrative/bullets/brief/intermediate keep their original API shape. */
export function normalizeSummaryOptions(values) {
  const focus = [...new Set(values.focus || [])].filter((key) => key in SUMMARY_FOCUS);
  const label = String(values.label || '')
    .trim()
    .slice(0, 120);
  return {
    format: { bullets: 'topics', narrative: 'paragraphs' }[values.format] || values.format,
    length: { brief: 'short', intermediate: 'standard' }[values.length] || values.length,
    // Optional fields are omitted when unused so the request keeps its legacy shape.
    ...(values.readingLevel === 'simple' ? { readingLevel: 'simple' } : {}),
    ...(focus.length ? { focus } : {}),
    ...(label ? { label } : {}),
  };
}

export const summaryName = (summary) => summary?.label || `Versão ${summary?.version ?? '—'}`;

export function summaryDetails(summary) {
  const options = summary?.options || {};
  return [
    summary?.label ? `Versão ${summary.version}` : '',
    SUMMARY_FORMATS[options.format] || '',
    SUMMARY_LENGTHS[options.length] || '',
    options.readingLevel === 'simple' ? 'Linguagem simples' : '',
    summary?.source_transcription_revision
      ? `revisão ${summary.source_transcription_revision}`
      : '',
  ].filter(Boolean);
}

export const DIFFICULTIES = Object.freeze({
  basic: 'Básico',
  intermediate: 'Intermediário',
  advanced: 'Avançado',
});
export const SKILLS = Object.freeze({
  recall: 'Recordação',
  understanding: 'Compreensão conceitual',
  interpretation: 'Interpretação',
  application: 'Aplicação',
  analysis: 'Análise e comparação',
  cause_effect: 'Causa e efeito',
  evaluation: 'Avaliação crítica',
  synthesis: 'Síntese',
});
export const QUESTION_PRESETS = Object.freeze([3, 5, 10, 20]);

export function listName(batch, index, total) {
  return batch?.title || `Conjunto ${total - index}`;
}

export function listDetails(batch) {
  const config = batch?.config || {};
  const levels = (config.difficulties || []).map((key) => DIFFICULTIES[key]).filter(Boolean);
  const skills = (config.skills || []).map((key) => SKILLS[key]).filter(Boolean);
  return { levels, skills };
}

const STOPWORDS = new Set(
  (
    'porque quando então também sobre entre depois antes ainda assim sempre muito mesmo outro outra ' +
    'outros outras essas esses aquele aquela aquilo estão estava estavam foram seria sendo tinha ' +
    'temos vamos vocês nosso nossa nossos nossas dessa desse deste desta nesse nessa neste nesta ' +
    'apenas aqui agora coisa coisas pessoal gente tipo exemplo entendeu certo'
  ).split(' '),
);

/** Rough count of distinct content terms: a density signal, not a concept analysis. */
export function distinctTerms(text = '') {
  const words = String(text)
    .normalize('NFKC')
    .toLocaleLowerCase('pt-BR')
    .match(/\p{L}{6,}/gu);
  return new Set((words || []).filter((word) => !STOPWORDS.has(word))).size;
}

/**
 * Heuristic recommendation from duration, content density and requested skills. It never limits
 * the request: the server applies its own ceiling and may still return fewer questions.
 */
export function recommendQuestionCount({ durationMs = 0, text = '', skills = 1, max = 40 } = {}) {
  const minutes = durationMs / 60000;
  const [low, high] =
    minutes < 5 ? [3, 5] : minutes < 15 ? [5, 10] : minutes < 30 ? [10, 20] : [15, 30];
  const terms = distinctTerms(text);
  // About one meaningful question per eight distinct terms; more skills allow testing a concept twice.
  const capacity = Math.max(
    3,
    Math.round((terms / 8) * Math.min(2, 1 + 0.25 * (Math.max(1, skills) - 1))),
  );
  // Thin content lowers the recommendation below the duration band: fewer meaningful questions.
  const top = Math.min(max, high, capacity);
  const bottom = Math.min(low, top);
  const notes = [];
  if (capacity < high)
    notes.push('A transcrição tem poucos termos distintos para o intervalo usual desta duração.');
  if (minutes >= 30)
    notes.push(
      'Em gravações longas, a quantidade depende da densidade e da cobertura dos conceitos.',
    );
  return { min: bottom, max: top, terms, minutes: Math.round(minutes), notes };
}

/**
 * Question presets (Questões 3.0): one choice sets difficulty, skills and order; the detailed
 * controls stay under "Opções avançadas" and any manual change there makes the list "custom".
 */
export const QUESTION_GOALS = {
  essential: {
    label: 'Essencial',
    hint: 'Conceitos centrais e definições que importam.',
    difficulties: ['basic', 'intermediate'],
    skills: ['recall', 'understanding'],
    distribution: 'balanced',
  },
  understand: {
    label: 'Compreender',
    hint: 'Por quê e como: explicações, causas e consequências.',
    difficulties: ['basic', 'intermediate', 'advanced'],
    skills: ['understanding', 'interpretation', 'cause_effect'],
    distribution: 'balanced',
  },
  apply: {
    label: 'Aplicar',
    hint: 'Situações novas, comparações e resolução de problemas.',
    difficulties: ['intermediate', 'advanced'],
    skills: ['application', 'analysis'],
    distribution: 'balanced',
  },
  balanced: {
    label: 'Equilibrado',
    hint: 'Um pouco de tudo, em níveis intercalados.',
    difficulties: ['basic', 'intermediate', 'advanced'],
    skills: ['recall', 'understanding', 'application', 'analysis'],
    distribution: 'balanced',
  },
  exam: {
    label: 'Preparação para prova',
    hint: 'Do mais fácil ao mais difícil, cobrindo vários tipos de raciocínio.',
    difficulties: ['basic', 'intermediate', 'advanced'],
    skills: ['recall', 'understanding', 'application', 'analysis', 'cause_effect'],
    distribution: 'progressive',
  },
};

/** The preset matching a configuration exactly, or 'custom'. */
export function presetFor({ difficulties = [], skills = [], distribution = 'balanced' }) {
  const same = (a, b) => a.length === b.length && a.every((item) => b.includes(item));
  const found = Object.entries(QUESTION_GOALS).find(
    ([, preset]) =>
      same(preset.difficulties, difficulties) &&
      same(preset.skills, skills) &&
      preset.distribution === distribution,
  );
  return found ? found[0] : 'custom';
}
