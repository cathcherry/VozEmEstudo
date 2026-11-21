/** Probes de leitura: presença de schema não comprova homologação funcional. */
export const featureSchema = Object.freeze({
  catalog_units: { migration: '20261104190000_catalog_units.sql', tables: { study_subjects: 'id,user_id', study_units: 'id,subject_id', materials: 'id,subject_id,unit_id' } },
  planning: { migration: '20261104203000_study_planning.sql', tables: { study_goals: 'id,user_id', study_subgoals: 'id,goal_id', study_tasks: 'id,reference_url,sort_order,completed_at' } },
  quiz_v2: { migration: '20261104223000_quiz_sessions.sql', tables: { quiz_sessions: 'id,batch_id', quiz_session_answers: 'session_id,question_id' } },
  quiz_review: { migration: '20261104233000_quiz_review.sql', tables: { quiz_sessions: 'id,kind,source_session_id', quiz_session_items: 'session_id,question_id' } },
  flashcards: { migration: '20261104234500_flashcards.sql', tables: { study_flashcards: 'id,due_at', study_flashcard_reviews: 'id,request_id' } },
  mp4_retention: { migration: '20261105003500_player_video.sql', tables: { material_videos: 'material_id,storage_path,clip_start_ms,clip_end_ms' } },
  study_tracking: { migration: '20261105011000_study_tracking.sql', tables: { study_settings: 'user_id,timezone', study_progress: 'material_id,version', study_sessions: 'id,last_sequence', study_time_credits: 'session_id,sequence' } },
  annotations: { migration: '20261105014000_annotations.sql', tables: { study_annotations: 'id,source_revision_id,version' } },
  calendar: { migration: '20261105014500_calendar_sharing.sql', tables: { study_calendar_events: 'id,version', study_tasks: 'id,due_date' } },
  sharing: { migration: '20261105014500_calendar_sharing.sql', tables: { material_shares: 'id,token_hash,expires_at,revoked_at' } },
  study_authoring: { migration: '20261119120000_study_authoring.sql', tables: { question_batches: 'id,title,config,coverage', summary_versions: 'id,label,options', question_list_shares: 'id,token_hash,expires_at,revoked_at' } },
  flashcard_sets: { migration: '20261119121000_flashcard_sets.sql', tables: { study_flashcard_sets: 'id,user_id,status', study_flashcards: 'id,set_id,source_revision_id' } },
  generation_reuse: { migration: '20261121160000_generation_reuse.sql', tables: { ai_generations: 'id,generation_key,status,job_id' } },
  flashcards_v3: { migration: '20261121150000_flashcards_3_0.sql', tables: { study_card_templates: 'id,user_id,version', study_flashcards: 'id,note_type,content_hash,media', study_flashcard_sets: 'id,template_id,template_base' } },
  classrooms: { migration: '20261121140000_classrooms.sql', tables: { classrooms: 'id,owner_id,status', classroom_members: 'classroom_id,user_id,role,status', classroom_invites: 'id,token_hash,max_uses,use_count', classroom_submissions: 'id,status,teacher_confirmed_revision_id', classroom_lessons: 'id,published_revision_id,status', classroom_shared_items: 'id,flashcard_set_id,revoked_at' } },
  multi_lesson: { migration: '20261121170000_multi_lesson.sql', tables: { ai_generations: 'id,generation_key,status', multi_lesson_materials: 'id,user_id,sources,status', multi_lesson_jobs: 'id,status,next_attempt_at,locked_by' } },
  notebooks: { migration: '20261121130000_notes_3_0.sql', tables: { study_notebooks: 'id,user_id,material_id,version,visibility', study_annotations: 'id,end_segment_position,anchor_version,visibility' } },
});

/**
 * Optional sub-features of an active flag: probed and reported, but a missing migration does not
 * block startup; the API answers a scoped 503 for that sub-feature only.
 */
export const optionalSchema = Object.freeze({
  classroom_contributions: { flag: 'classrooms', migration: '20261122090000_classroom_contributions.sql', tables: { classroom_contributions: 'id,status,feedback,integrated_material_id,shared_item_id' } },
  // Turning an integrated material into a question list / a deck (503 for that action only).
  multi_lesson_exports: { flag: 'multi_lesson', migration: '20261121180000_multi_lesson_exports.sql', tables: { multi_lesson_exports: 'id,multi_lesson_id,kind,request_id' } },
  // Cache of knowledge maps: without it every lesson is mapped again (more AI calls, same result).
  knowledge_map_cache: { flag: 'multi_lesson', migration: '20261121171000_knowledge_map_cache.sql', tables: { knowledge_maps: 'id,source_revision_id,prompt_version' } },
});

/** Not flags, but configuration with its own schema (checked when the setting is active). */
export const configSchema = Object.freeze({
  assemblyai: { migration: '20261119030000_ai_executions.sql', tables: { ai_job_executions: 'job_id,state', transcription_word_alignments: 'transcription_version_id' } },
});

export function readinessFlagErrors(flags) {
  const errors = [];
  if (flags.social_basic) errors.push('FEATURE_SOCIAL_BASIC não está implementada; mantenha false.');
  if (flags.quiz_review && !flags.quiz_v2) errors.push('FEATURE_QUIZ_REVIEW exige FEATURE_QUIZ_V2=true.');
  if (flags.flashcard_sets && !flags.flashcards) errors.push('FEATURE_FLASHCARD_SETS exige FEATURE_FLASHCARDS=true.');
  if (flags.flashcards_v3 && !flags.flashcard_sets) errors.push('FEATURE_FLASHCARDS_V3 exige FEATURE_FLASHCARD_SETS=true.');
  if (flags.classrooms && !flags.flashcard_sets) errors.push('FEATURE_CLASSROOMS exige FEATURE_FLASHCARD_SETS=true.');
  if (flags.notebooks && !flags.annotations) errors.push('FEATURE_NOTEBOOKS exige FEATURE_ANNOTATIONS=true.');
  if (flags.multi_lesson && !flags.catalog_units) errors.push('FEATURE_MULTI_LESSON exige FEATURE_CATALOG_UNITS=true.');
  return errors;
}

export function createReadinessChecks(db, flags, audioBucket, permissionVersion, { asrProvider } = {}) {
  const table = (label, name, columns) => ({ label, run: () => db.from(name).select(columns, { head: true }) });
  const checks = [
    table('Banco de materiais', 'materials', 'id'),
    ...['material_permissions', 'transcription_confirmations', 'content_warnings'].map((name) => table(`E02: ${name}`, name, 'id')),
    { label: 'E02: current_permission_version', run: () => db.rpc('current_permission_version'), validate: (data) => data === permissionVersion },
    { label: 'Bucket privado de áudio', run: () => db.storage.getBucket(audioBucket), validate: (data) => data?.public === false },
  ];
  for (const [flag, module] of Object.entries(featureSchema)) {
    if (!flags[flag]) continue;
    for (const [name, columns] of Object.entries(module.tables)) {
      checks.push(table(`${flag}: ${name} — conferir ${module.migration}`, name, columns));
    }
  }
  for (const [name, module] of Object.entries(optionalSchema)) {
    if (!flags[module.flag]) continue;
    for (const [tableName, columns] of Object.entries(module.tables)) {
      checks.push({ ...table(`${module.flag} (opcional, ${name}): ${tableName} — conferir ${module.migration}`, tableName, columns), optional: true });
    }
  }
  if (asrProvider === 'assemblyai')
    for (const [name, columns] of Object.entries(configSchema.assemblyai.tables))
      checks.push(table(`ASR_PROVIDER=assemblyai: ${name} — conferir ${configSchema.assemblyai.migration}`, name, columns));
  if (flags.flashcards_v3) checks.push({
    label: 'Bucket flashcard-media: privado, imagens, limite 2 MiB',
    run: () => db.storage.getBucket('flashcard-media'),
    validate: (data) => data?.public === false && Number(data.file_size_limit) === 2097152,
  });
  if (flags.mp4_retention) checks.push({
    label: 'Bucket study-videos: privado, MP4, limite 100 MiB',
    run: () => db.storage.getBucket('study-videos'),
    validate: (data) => data?.public === false && Number(data.file_size_limit) === 104857600
      && data.allowed_mime_types?.length === 1 && data.allowed_mime_types[0] === 'video/mp4',
  });
  return checks;
}

export async function runReadinessChecks(checks, timeoutMs = 20000) {
  return Promise.all(checks.map(async ({ label, run, validate, optional }) => {
    const result = await runOne({ label, run, validate }, timeoutMs);
    return optional ? { ...result, optional: true } : result;
  }));
}

async function runOne({ label, run, validate }, timeoutMs) {
  {
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(run),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
      ]);
      if (result.error) return { label, ok: false, reason: 'Consulta recusada ou estrutura ausente; confira o preflight e as configurações.' };
      if (validate && !validate(result.data)) return { label, ok: false, reason: 'Configuração incompatível com a aplicação.' };
      return { label, ok: true };
    } catch (error) {
      // Nunca registrar mensagens recebidas de provedores nem valores de ambiente.
      return { label, ok: false, reason: error.message === 'timeout' ? 'Tempo limite de 20 segundos.' : 'Falha de conexão ou consulta.' };
    } finally {
      clearTimeout(timer);
    }
  }
}
