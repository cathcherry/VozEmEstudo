import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { PERMISSION_DECLARATION } from './config/permission-declaration.js';
import { featureFlags, isFeatureEnabled } from './config/feature-flags.js';
import { assertPublicSupabaseKey } from './validators/public-config.validator.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { requireAuth } from './middleware/auth.middleware.js';
import { notFoundMiddleware, errorMiddleware } from './middleware/error.middleware.js';
import { materialRouter } from './routes/material.routes.js';
import { catalogRouter } from './routes/catalog.routes.js';
import { planningRouter } from './routes/planning.routes.js';
import { quizSessionRouter } from './routes/quiz-session.routes.js';
import { flashcardRouter } from './routes/flashcard.routes.js';
import { questionRouter } from './routes/question.routes.js';
import { jobRouter } from './routes/job.routes.js';
import { mediaRouter } from './routes/media.routes.js';
import { studyRouter } from './routes/study.routes.js';
import { annotationRouter,calendarRouter,sharingRouter,publicShare } from './routes/learning-tools.routes.js';
import { publicQuestionList } from './routes/question-share.routes.js';
import { searchOwnLibrary } from './services/search.service.js';
import { MEDIA_EXTENSIONS, MAX_TRANSCRIPTION_SECONDS } from './services/media.service.js';
import { getAiRegistry } from './ai/provider-registry.js';
import { disclosureLabels, recordingLanguageOptions } from './ai/provider-config.js';

const processingDisclosure = () => disclosureLabels(getAiRegistry().config);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: env.appOrigin, credentials: false }));
app.use(requestIdMiddleware);
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'audioestudo-api' }));
app.get('/api/config', (_req, res) => {
  assertPublicSupabaseKey(env.supabasePublishableKey);
  res.json({
    supabaseUrl: env.supabaseUrl,
    supabasePublishableKey: env.supabasePublishableKey,
    audioBucket: env.audioBucket,
    allowedQuestionCounts: [3, 5, 10, 20],
    // Custom list sizes exist only once the authoring migration is enabled.
    ...(isFeatureEnabled('study_authoring') ? { maxQuestionListCount: env.maxQuestionListCount } : {}),
    maxAudioBytes: 100 * 1024 * 1024,
    mediaExtensions: MEDIA_EXTENSIONS,
    maxTranscriptionSeconds: MAX_TRANSCRIPTION_SECONDS,
    oauthProviders: env.oauthProviders,
    featureFlags,
    permissionDeclaration: PERMISSION_DECLARATION,
    processingDisclosure: {
      ...processingDisclosure(),
      audioOnly: true,
    },
    recordingLanguages: recordingLanguageOptions(getAiRegistry().config),
  });
});

app.use('/api/media', requireAuth, mediaRouter);
app.use('/api/materials', requireAuth, materialRouter);
if(isFeatureEnabled('annotations'))app.use('/api/annotations',requireAuth,annotationRouter);
if(isFeatureEnabled('calendar'))app.use('/api/calendar',requireAuth,calendarRouter);
if(isFeatureEnabled('sharing')){
  app.use('/api/sharing',requireAuth,sharingRouter);
  app.post('/api/shared-material',publicShare);
  if (isFeatureEnabled('study_authoring')) app.post('/api/shared-question-list', publicQuestionList);
}
if (isFeatureEnabled('catalog_units')) app.use('/api/catalog', requireAuth, catalogRouter);
if (isFeatureEnabled('planning')) app.use('/api/planning', requireAuth, planningRouter);
if (isFeatureEnabled('quiz_v2')) app.use('/api/quiz-sessions', requireAuth, quizSessionRouter);
if (isFeatureEnabled('flashcards')) app.use('/api/flashcards', requireAuth, flashcardRouter);
if (isFeatureEnabled('study_tracking')) app.use('/api/study', requireAuth, studyRouter);
app.use('/api/questions', requireAuth, questionRouter);
// Search in the person's own lessons, questions and transcripts (no answer keys).
app.get('/api/search', requireAuth, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await searchOwnLibrary(req.user.id, req.query));
  } catch (error) {
    next(error);
  }
});
app.use('/api/jobs', requireAuth, jobRouter);

if (env.serveFrontend) {
  const frontendRoot = path.resolve(__dirname, '../../frontend');
  app.use('/css', express.static(path.join(frontendRoot, 'css')));
  app.use('/js', express.static(path.join(frontendRoot, 'js')));
  app.use('/assets', express.static(path.join(frontendRoot, 'assets')));
  app.get('/favicon.ico', (_req, res) =>
    res.sendFile(path.join(frontendRoot, 'assets/brand/favicon.png')),
  );
  app.use(express.static(path.join(frontendRoot, 'pages')));
  app.get('/', (_req, res) => res.redirect('/index.html'));
}

app.use(notFoundMiddleware);
app.use(errorMiddleware);
