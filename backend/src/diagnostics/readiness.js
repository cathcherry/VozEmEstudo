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
});

export function readinessFlagErrors(flags) {
  const errors = [];
  if (flags.social_basic) errors.push('FEATURE_SOCIAL_BASIC não está implementada; mantenha false.');
  if (flags.quiz_review && !flags.quiz_v2) errors.push('FEATURE_QUIZ_REVIEW exige FEATURE_QUIZ_V2=true.');
  return errors;
}

export function createReadinessChecks(db, flags, audioBucket, permissionVersion) {
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
  if (flags.mp4_retention) checks.push({
    label: 'Bucket study-videos: privado, MP4, limite 100 MiB',
    run: () => db.storage.getBucket('study-videos'),
    validate: (data) => data?.public === false && Number(data.file_size_limit) === 104857600
      && data.allowed_mime_types?.length === 1 && data.allowed_mime_types[0] === 'video/mp4',
  });
  return checks;
}

export async function runReadinessChecks(checks, timeoutMs = 20000) {
  return Promise.all(checks.map(async ({ label, run, validate }) => {
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
  }));
}
