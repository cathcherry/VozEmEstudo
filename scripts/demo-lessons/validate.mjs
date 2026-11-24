#!/usr/bin/env node
/**
 * Validates the demonstration lessons in database/demo-lessons/<slug>/lesson.json against the
 * schema the seed relies on and against the app's own validators. No network, no database.
 *
 * Checks: exact schema; segment continuity (increasing, non-overlapping, inside the audio);
 * evidence literalness and sourceRefs consistency (also against the app's sourceReferences);
 * question options/correctIndex/difficulty/skill/facet with the backend validators; flashcard
 * set shape with validateNewFlashcardSet and validateGeneratedFlashcards; the summary rendered
 * with the frontend renderer (jsdom); file sizes; and, when ffmpeg/ffprobe are available, the
 * audio duration and that every segment boundary falls on silence in the decoded audio.
 *
 * Usage: node scripts/demo-lessons/validate.mjs [slug ...]   (exit code 1 on any error)
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LESSONS = join(ROOT, 'database/demo-lessons');
const imp = (path) => import(new URL(`file://${join(ROOT, path)}`).href);

const { DIFFICULTIES, SKILLS } = await imp('backend/src/validators/question-config.validator.js');
const { FACETS } = await imp('backend/src/domain/question-plan.js');
const { validateQuestionsPayload } = await imp('backend/src/validators/llm-output.validator.js');
const { sourceReferences } = await imp('backend/src/services/question-generation.service.js');
const { filterRedundant, normalizeText } = await imp('backend/src/domain/question-redundancy.js');
const { validateNewFlashcardSet, validateGeneratedFlashcards } = await imp(
  'backend/src/validators/flashcard-generation.validator.js',
);
const { EMBLEM_IDS } = await imp('frontend/js/art/manifest.js');
const { renderMarkdown } = await imp('frontend/js/utils/markdown.js');
const { JSDOM } = createRequire(join(ROOT, 'frontend/package.json'))('jsdom');

const TONES = ['rose', 'matcha', 'honey', 'mist', 'lavender'];
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const MAX_VIDEO_BYTES = 8 * 1024 * 1024;
const QUESTION_COUNT = 8;
const CARD_COUNT = 10;
const DURATION_TOLERANCE_MS = 200;
const SOURCE_PHRASES =
  /transcri[cç][aã]o|segundo o texto|o trecho|conforme o texto|a aula menciona/i;
const FFMPEG = process.env.FFMPEG_PATH || join(ROOT, 'backend/node_modules/ffmpeg-static/ffmpeg');
const FFPROBE =
  process.env.FFPROBE_PATH ||
  join(ROOT, 'backend/node_modules/ffprobe-static/bin', process.platform, process.arch, 'ffprobe');

const KEYS = {
  lesson: [
    'slug',
    'version',
    'language',
    'title',
    'subject',
    'description',
    'cover',
    'durationMs',
    'media',
    'credits',
    'segments',
    'words',
    'summary',
    'questions',
    'flashcards',
  ],
  cover: ['tone', 'emblem'],
  media: ['audio', 'audioMime', 'sizeBytes', 'video', 'videoMime', 'videoSizeBytes'],
  segment: ['position', 'startMs', 'endMs', 'text'],
  summary: ['label', 'text'],
  questions: ['title', 'items'],
  question: ['statement', 'options', 'correctIndex', 'explanation', 'metadata'],
  metadata: ['difficulty', 'skill', 'facet', 'concept', 'evidence', 'sourceRefs'],
  ref: ['position', 'startMs', 'endMs'],
  flashcards: ['name', 'cards'],
  card: ['front', 'back', 'evidence', 'sourceSegments'],
};

let errors = 0;
let warnings = 0;
function check(condition, slug, message) {
  if (!condition) {
    errors += 1;
    console.error(`  ERRO [${slug}] ${message}`);
  }
  return Boolean(condition);
}
function warn(slug, message) {
  warnings += 1;
  console.warn(`  aviso [${slug}] ${message}`);
}
const sameKeys = (object, keys) =>
  object &&
  typeof object === 'object' &&
  !Array.isArray(object) &&
  JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...keys].sort());
const isInt = (value) => Number.isInteger(value) && value >= 0;
const isText = (value, max = 10000) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value === value.trim() &&
  value.length <= max;

function checkRefs(slug, label, evidence, refs, segments) {
  if (!check(Array.isArray(refs) && refs.length >= 1, slug, `${label}: referências ausentes`))
    return;
  for (const ref of refs) {
    if (!check(sameKeys(ref, KEYS.ref), slug, `${label}: referência fora do formato`)) continue;
    const segment = segments.find((item) => item.position === ref.position);
    check(segment, slug, `${label}: posição ${ref.position} não existe`);
    if (!segment) continue;
    check(
      ref.startMs === segment.startMs && ref.endMs === segment.endMs,
      slug,
      `${label}: tempos da referência diferem do segmento ${ref.position}`,
    );
    check(
      segment.text.includes(evidence),
      slug,
      `${label}: evidence não é trecho literal do segmento ${ref.position}`,
    );
  }
  const app = sourceReferences(evidence, segments);
  check(
    JSON.stringify(app) === JSON.stringify(refs),
    slug,
    `${label}: sourceRefs diferem do que o app calcularia (${JSON.stringify(app)})`,
  );
}

function checkSummary(slug, summary) {
  if (!check(sameKeys(summary, KEYS.summary), slug, 'summary fora do formato')) return;
  check(isText(summary.label, 160), slug, 'summary.label inválido');
  check(isText(summary.text, 20000), slug, 'summary.text inválido');
  // The summary prompt allows only headings, lists, bold and italics.
  check(!/<[a-z/][^>]*>/i.test(summary.text), slug, 'summary contém HTML');
  check(!/!?\[[^\]]*\]\([^)]*\)/.test(summary.text), slug, 'summary contém link ou imagem');
  check(!/^\s*\|/m.test(summary.text), slug, 'summary contém tabela');
  check(
    !/^\s{2,}[-*+] /m.test(summary.text),
    slug,
    'summary tem lista aninhada (o renderer é plano)',
  );
  const { window } = new JSDOM('<!doctype html><article></article>');
  const previous = globalThis.document;
  globalThis.document = window.document;
  try {
    const target = window.document.querySelector('article');
    renderMarkdown(target, summary.text);
    check(target.querySelectorAll('h4, h5').length >= 2, slug, 'summary sem seções (##)');
    check(target.querySelectorAll('li').length >= 3, slug, 'summary sem itens de lista');
    check(!/\*\*|__/.test(target.textContent), slug, 'summary deixou marcação sem renderizar');
  } catch (error) {
    check(false, slug, `summary não renderiza: ${error.message}`);
  } finally {
    globalThis.document = previous;
  }
}

function checkQuestions(slug, questions, segments) {
  if (!check(sameKeys(questions, KEYS.questions), slug, 'questions fora do formato')) return;
  check(isText(questions.title, 160), slug, 'questions.title inválido');
  const items = questions.items;
  if (
    !check(
      Array.isArray(items) && items.length === QUESTION_COUNT,
      slug,
      `são esperadas ${QUESTION_COUNT} questões`,
    )
  )
    return;
  try {
    validateQuestionsPayload(
      { questions: items.map(({ metadata: _m, ...rest }) => rest) },
      QUESTION_COUNT,
    );
  } catch (error) {
    check(
      false,
      slug,
      `validateQuestionsPayload: ${JSON.stringify(error.details || error.message)}`,
    );
  }
  const positions = new Set();
  items.forEach((item, index) => {
    const label = `questão ${index + 1}`;
    if (!check(sameKeys(item, KEYS.question), slug, `${label}: chaves fora do formato`)) return;
    check(
      isText(item.statement, 1000) && item.statement.length >= 8,
      slug,
      `${label}: enunciado inválido`,
    );
    check(
      Array.isArray(item.options) && item.options.length === 4,
      slug,
      `${label}: precisa de 4 alternativas`,
    );
    check(
      item.options.every((o) => isText(o, 500)),
      slug,
      `${label}: alternativa inválida`,
    );
    check(
      new Set(item.options.map(normalizeText)).size === 4,
      slug,
      `${label}: alternativas repetidas`,
    );
    check(
      Number.isInteger(item.correctIndex) && item.correctIndex >= 0 && item.correctIndex <= 3,
      slug,
      `${label}: correctIndex fora de 0..3`,
    );
    positions.add(item.correctIndex);
    check(isText(item.explanation, 2000), slug, `${label}: explicação inválida`);
    check(!SOURCE_PHRASES.test(item.explanation), slug, `${label}: explicação cita a fonte`);
    check(!SOURCE_PHRASES.test(item.statement), slug, `${label}: enunciado cita a fonte`);
    const meta = item.metadata;
    if (!check(sameKeys(meta, KEYS.metadata), slug, `${label}: metadata fora do formato`)) return;
    check(DIFFICULTIES.includes(meta.difficulty), slug, `${label}: difficulty inválida`);
    check(SKILLS.includes(meta.skill), slug, `${label}: skill inválida`);
    check(FACETS.includes(meta.facet), slug, `${label}: facet inválido`);
    check(isText(meta.concept, 200), slug, `${label}: concept inválido`);
    check(
      isText(meta.evidence, 400) && meta.evidence.length >= 15,
      slug,
      `${label}: evidence deve ter 15 a 400 caracteres`,
    );
    checkRefs(slug, label, meta.evidence, meta.sourceRefs, segments);
  });
  check(positions.size >= 3, slug, 'respostas corretas concentradas em poucas posições');
  for (const key of ['difficulty', 'skill']) {
    const values = new Set(items.map((item) => item.metadata?.[key]));
    check(values.size >= (key === 'skill' ? 4 : 3), slug, `pouca variedade de ${key}`);
  }
  const { rejected } = filterRedundant(
    items.map((item) => ({ ...item, evidence: item.metadata.evidence })),
  );
  for (const { item, reason } of rejected)
    check(false, slug, `questão redundante (${reason}): ${item.statement}`);
}

function checkFlashcards(slug, flashcards, segments) {
  if (!check(sameKeys(flashcards, KEYS.flashcards), slug, 'flashcards fora do formato')) return;
  const cards = flashcards.cards;
  if (
    !check(
      Array.isArray(cards) && cards.length === CARD_COUNT,
      slug,
      `são esperados ${CARD_COUNT} cartões`,
    )
  )
    return;
  try {
    validateNewFlashcardSet({
      id: '00000000-0000-4000-8000-000000000000',
      name: flashcards.name,
      cards,
    });
    validateGeneratedFlashcards(
      { cards: cards.map(({ front, back, evidence }) => ({ front, back, evidence })) },
      CARD_COUNT,
      segments.map((segment) => segment.text).join(' '),
    );
  } catch (error) {
    check(false, slug, `validadores de cartões: ${error.message}`);
  }
  cards.forEach((card, index) => {
    const label = `cartão ${index + 1}`;
    if (!check(sameKeys(card, KEYS.card), slug, `${label}: chaves fora do formato`)) return;
    check(
      isText(card.front, 1000) && isText(card.back, 2000),
      slug,
      `${label}: frente/verso inválidos`,
    );
    check(
      isText(card.evidence, 1500) && card.evidence.length >= 15,
      slug,
      `${label}: evidence inválida`,
    );
    checkRefs(slug, label, card.evidence, card.sourceSegments, segments);
  });
}

function probeDuration(file) {
  if (!existsSync(FFPROBE)) return null;
  const out = spawnSync(FFPROBE, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    file,
  ]);
  return out.status === 0 ? Math.round(Number(String(out.stdout).trim()) * 1000) : null;
}

/** Decodes to 8 kHz mono PCM and checks speech inside segments and silence just outside them. */
function checkAlignment(slug, file, segments) {
  if (!existsSync(FFMPEG)) return warn(slug, 'ffmpeg ausente: alinhamento do áudio não verificado');
  const rate = 8000;
  const out = spawnSync(
    FFMPEG,
    ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'],
    {
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (!check(out.status === 0, slug, 'ffmpeg não decodificou o áudio')) return;
  const pcm = new Int16Array(
    out.stdout.buffer,
    out.stdout.byteOffset,
    Math.floor(out.stdout.length / 2),
  );
  const peak = (fromMs, toMs) => {
    let max = 0;
    for (
      let i = Math.max(0, Math.floor((fromMs * rate) / 1000));
      i < Math.min(pcm.length, (toMs * rate) / 1000);
      i++
    )
      max = Math.max(max, Math.abs(pcm[i]));
    return max;
  };
  const SILENT = 900; // ~ -31 dBFS, allows MP3 ringing
  const LOUD = 3000;
  for (const segment of segments) {
    check(
      peak(segment.startMs, segment.endMs) > LOUD,
      slug,
      `segmento ${segment.position} sem fala no áudio`,
    );
    check(
      peak(segment.startMs - 150, segment.startMs - 10) < SILENT,
      slug,
      `segmento ${segment.position}: há som logo antes do início`,
    );
    check(
      peak(segment.endMs + 10, segment.endMs + 150) < SILENT,
      slug,
      `segmento ${segment.position}: há som logo após o fim`,
    );
  }
}

function validate(slug) {
  const folder = join(LESSONS, slug);
  const lesson = JSON.parse(readFileSync(join(folder, 'lesson.json'), 'utf8'));
  if (
    !check(
      sameKeys(lesson, KEYS.lesson),
      slug,
      `chaves de topo fora do formato: ${Object.keys(lesson)}`,
    )
  )
    return;
  check(lesson.slug === slug && /^[a-z0-9-]+$/.test(slug), slug, 'slug difere da pasta');
  check(Number.isInteger(lesson.version) && lesson.version >= 1, slug, 'version inválida');
  check(lesson.language === 'pt', slug, 'language deve ser "pt"');
  for (const key of ['title', 'subject', 'description', 'credits'])
    check(
      isText(lesson[key], key === 'description' || key === 'credits' ? 400 : 160),
      slug,
      `${key} inválido`,
    );
  check(
    sameKeys(lesson.cover, KEYS.cover) && TONES.includes(lesson.cover.tone),
    slug,
    'cover.tone inválido',
  );
  check(
    EMBLEM_IDS.includes(lesson.cover?.emblem),
    slug,
    `emblema inexistente: ${lesson.cover?.emblem}`,
  );
  check(isInt(lesson.durationMs) && lesson.durationMs > 0, slug, 'durationMs inválido');
  check(lesson.words === null, slug, 'words deve ser null (sem tempos por palavra reais)');

  const media = lesson.media;
  if (check(sameKeys(media, KEYS.media), slug, 'media fora do formato')) {
    const audio = join(folder, media.audio);
    check(
      media.audio === 'audio.mp3' && media.audioMime === 'audio/mpeg',
      slug,
      'áudio deve ser audio.mp3 (audio/mpeg)',
    );
    if (check(existsSync(audio), slug, 'audio.mp3 ausente')) {
      const size = statSync(audio).size;
      check(
        size === media.sizeBytes,
        slug,
        `sizeBytes ${media.sizeBytes} difere do arquivo (${size})`,
      );
      check(size < MAX_AUDIO_BYTES, slug, `áudio maior que 3 MB (${size})`);
      const probed = probeDuration(audio);
      if (probed === null) warn(slug, 'ffprobe ausente: duração não conferida');
      else
        check(
          Math.abs(probed - lesson.durationMs) <= DURATION_TOLERANCE_MS,
          slug,
          `duração ${probed} ms difere de durationMs`,
        );
    }
    if (media.video === null) {
      check(
        media.videoMime === null && media.videoSizeBytes === null,
        slug,
        'campos de vídeo devem ser null',
      );
      check(
        !existsSync(join(folder, 'video.mp4')),
        slug,
        'video.mp4 existe mas não está no lesson.json',
      );
    } else {
      const video = join(folder, media.video);
      check(
        media.video === 'video.mp4' && media.videoMime === 'video/mp4',
        slug,
        'vídeo deve ser video.mp4 (video/mp4)',
      );
      if (check(existsSync(video), slug, 'video.mp4 ausente')) {
        const size = statSync(video).size;
        check(size === media.videoSizeBytes, slug, `videoSizeBytes difere do arquivo (${size})`);
        check(size <= MAX_VIDEO_BYTES, slug, `vídeo maior que 8 MB (${size})`);
        const probed = probeDuration(video);
        if (probed !== null)
          check(
            Math.abs(probed - lesson.durationMs) <= 500,
            slug,
            `vídeo dura ${probed} ms, áudio ${lesson.durationMs} ms`,
          );
      }
    }
  }

  const segments = lesson.segments;
  if (!check(Array.isArray(segments) && segments.length > 0, slug, 'segments vazio')) return;
  let previousEnd = 0;
  segments.forEach((segment, index) => {
    if (!check(sameKeys(segment, KEYS.segment), slug, `segmento ${index}: chaves fora do formato`))
      return;
    check(segment.position === index, slug, `segmento ${index}: position ${segment.position}`);
    check(
      isInt(segment.startMs) && isInt(segment.endMs) && segment.startMs < segment.endMs,
      slug,
      `segmento ${index}: tempos inválidos`,
    );
    check(segment.startMs >= previousEnd, slug, `segmento ${index}: sobrepõe o anterior`);
    check(segment.endMs <= lesson.durationMs, slug, `segmento ${index}: termina depois do áudio`);
    check(isText(segment.text, 2000), slug, `segmento ${index}: texto inválido`);
    const seconds = (segment.endMs - segment.startMs) / 1000;
    if (seconds < 3 || seconds > 16) warn(slug, `segmento ${index} dura ${seconds.toFixed(1)} s`);
    previousEnd = segment.endMs;
  });
  const tail = lesson.durationMs - segments.at(-1).endMs;
  check(tail >= 0 && tail <= 1500, slug, `fim do último segmento a ${tail} ms do fim do áudio`);
  if (existsSync(join(folder, 'audio.mp3')))
    checkAlignment(slug, join(folder, 'audio.mp3'), segments);

  checkSummary(slug, lesson.summary);
  checkQuestions(slug, lesson.questions, segments);
  checkFlashcards(slug, lesson.flashcards, segments);
  check(isText(lesson.flashcards?.name, 160), slug, 'nome do baralho inválido');

  const words = segments.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);
  console.log(
    `${slug}: "${lesson.title}" — ${(lesson.durationMs / 1000).toFixed(1)} s, ${segments.length} segmentos, ` +
      `${words} palavras, áudio ${(lesson.media.sizeBytes / 1024).toFixed(0)} KB` +
      (lesson.media.video
        ? `, vídeo ${(lesson.media.videoSizeBytes / 1024).toFixed(0)} KB`
        : ', sem vídeo') +
      `, ${lesson.questions.items.length} questões, ${lesson.flashcards.cards.length} cartões`,
  );
}

const slugs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(LESSONS)
      .filter((name) => existsSync(join(LESSONS, name, 'lesson.json')))
      .sort();
if (!slugs.length) {
  console.error('Nenhuma aula de demonstração encontrada.');
  process.exit(1);
}
for (const slug of slugs) {
  try {
    validate(slug);
  } catch (error) {
    check(false, slug, error.stack || String(error));
  }
}
console.log(`\n${slugs.length} aulas, ${errors} erro(s), ${warnings} aviso(s).`);
process.exit(errors ? 1 : 0);
