import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError } from '../domain/errors.js';

// Diário de estudo (FEATURE_JOURNAL). Every rule lives in the database functions of
// 20261124090000_journals.sql; this module only maps their errors. A missing schema answers a 503
// scoped to these routes; the rest of the app keeps working.
const SCHEMA_CODES = ['42P01', '42883', '42703', 'PGRST202', 'PGRST205'];
const MESSAGES = {
  JOURNAL_NOT_FOUND: [404, 'Diário ou página não encontrada.'],
  JOURNAL_VERSION_CONFLICT: [409, 'Esta página mudou em outro aparelho. Atualize antes de editar.'],
  JOURNAL_REQUEST_CONFLICT: [409, 'Este envio já foi usado com outros dados. Atualize a página.'],
  JOURNAL_INVALID: [400, 'Os dados do diário são inválidos.'],
  JOURNAL_TOO_LARGE: [413, 'Esta página passou do limite de tamanho. Divida o texto em outra página.'],
  JOURNAL_LIMIT: [409, 'Você chegou ao limite deste tipo de item (diários, páginas, decorações ou ligações).'],
  JOURNAL_DECORATION_INVALID: [400, 'Uma decoração é inválida ou está fora da página.'],
  JOURNAL_DECORATION_LOCKED: [409, 'Só é possível usar selos que você já encontrou no Gabinete.'],
  JOURNAL_LINK_INVALID: [409, 'Só é possível ligar aulas e descobertas suas.'],
  JOURNAL_QUOTE_SOURCE_REQUIRED: [409, 'Uma citação precisa da fonte: escolha a aula ou a descoberta de onde ela veio.'],
};

export function assertJournalDb(error) {
  if (!error) return;
  const mapped = MESSAGES[error.message];
  if (mapped) throw new AppError(error.message, mapped[1], mapped[0]);
  if (SCHEMA_CODES.includes(error.code))
    throw new AppError('JOURNAL_SCHEMA_REQUIRED', 'O Diário de estudo ainda não foi habilitado no banco.', 503);
  if (['23505', '23503', '23514', '22001', '22P02'].includes(error.code))
    throw new AppError('JOURNAL_CONFLICT', 'Confira os limites e a versão da página antes de enviar novamente.', 409);
  if (['40001', '40P01', '55P03', '57014'].includes(error.code))
    throw new AppError('DATABASE_TEMPORARY_ERROR', 'O banco está temporariamente indisponível. Tente novamente.', 503, {
      retryable: true,
    });
  throw error;
}

async function rpc(name, body) {
  const { data, error } = await getAdminSupabase().rpc(name, body);
  assertJournalDb(error);
  return data;
}

export const list = (user) => rpc('journal_list_admin', { p_user_id: user });
export const get = (user, id) => rpc('journal_get_admin', { p_user_id: user, p_id: id });
export const linkOptions = (user) => rpc('journal_link_options_admin', { p_user_id: user });
export const save = (user, id, data) =>
  rpc('journal_save_admin', {
    p_user_id: user,
    p_id: id,
    p_version: data.version,
    p_request_id: data.requestId,
    p_body: data.body,
  });
export const savePage = (user, journalId, pageId, data) =>
  rpc('journal_page_save_admin', {
    p_user_id: user,
    p_journal_id: journalId,
    p_page_id: pageId,
    p_version: data.version,
    p_request_id: data.requestId,
    p_body: data.body,
  });
