import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError } from '../domain/errors.js';
import { assertLearningDb } from './learning-tools.repository.js';

// Lesson notebooks (Notes 3.0). A missing schema answers a 503 scoped to the notebook, so the
// rest of the lesson keeps working when the flag is on before the migration.
const SCHEMA_CODES = ['42P01', '42883', '42703', 'PGRST202', 'PGRST205'];
async function rpc(name, body) {
  const { data, error } = await getAdminSupabase().rpc(name, body);
  if (error && SCHEMA_CODES.includes(error.code))
    throw new AppError(
      'NOTEBOOK_SCHEMA_REQUIRED',
      'O caderno da aula ainda não foi habilitado no banco. As anotações continuam disponíveis.',
      503,
    );
  assertLearningDb(error);
  return data;
}
export const getNotebook = (user, materialId) =>
  rpc('study_get_notebook_admin', { p_user_id: user, p_material_id: materialId });
export const saveNotebook = (user, materialId, data) =>
  rpc('study_save_notebook_admin', {
    p_user_id: user,
    p_material_id: materialId,
    p_version: data.version,
    p_request_id: data.requestId,
    p_body: { title: data.title, doc: data.doc },
  });
