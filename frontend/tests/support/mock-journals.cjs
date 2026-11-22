// SIMULATED /api/journals for browser journeys (3.6 Milestone D, Diário de estudo). It mirrors the
// contract of backend/src/routes/journal.routes.js: versions (409 on a stale version), replays by
// request id, the decoration allowlist and ranges, own links and quotes that keep their source.
// The real rules are tested against Postgres in backend/tests/journals-*.test.js.
const ART = /^(sticker|tape|stamp|frame|divider|label)\.[a-z0-9]+(-[a-z0-9]+)*$/;
const PAPERS = ['ruled', 'grid', 'dot', 'kraft', 'linen', 'vellum', 'aged'];
const now = () => new Date().toISOString();
const error = (json, status, code, message) => json({ error: { code, message } }, status);

function init(data) {
  if (!data.journalState) data.journalState = { journals: new Map(), pages: new Map(), requests: [] };
  return data.journalState;
}
const journalRow = (s, j) => ({
  id: j.id, title: j.title, cover: j.cover, paper: j.paper, version: j.version, createdAt: j.createdAt, updatedAt: j.updatedAt,
  pageCount: [...s.pages.values()].filter((p) => p.journalId === j.id && !p.deleted).length,
});
const pageRow = (p) => ({
  id: p.id, journalId: p.journalId, position: p.position, template: p.template, paper: p.paper, title: p.title,
  content: p.content, decorations: p.decorations, links: p.links, version: p.version, updatedAt: p.updatedAt,
});

function target(data, materials, link) {
  if (link.kind === 'lesson') {
    const m = materials.find((item) => item.id === link.id);
    return m ? { kind: 'lesson', id: m.id, title: m.title, subject: m.subject } : null;
  }
  const d = (data.journalDiscoveries || []).find((item) => item.id === link.id);
  return d ? { kind: 'discovery', id: d.id, title: d.title, subject: d.subject } : null;
}

function handleJournals({ request, p, method, json, data, materials }) {
  const s = init(data);
  if (data.journalsDown) return error(json, 503, 'JOURNAL_SCHEMA_REQUIRED', 'O Diário de estudo ainda não foi habilitado no banco.');
  const parts = p.split('/').filter(Boolean); // api, journals, id?, pages?, pageId?
  if (parts.length === 2 && method === 'GET')
    return json({ journals: [...s.journals.values()].filter((j) => !j.deleted).map((j) => journalRow(s, j)) });
  if (parts[2] === 'link-options' && method === 'GET')
    return json({
      lessons: materials.map((m) => ({ kind: 'lesson', id: m.id, title: m.title, subject: m.subject })),
      discoveries: (data.journalDiscoveries || []).map((d) => ({ kind: 'discovery', ...d })),
    });
  const journal = s.journals.get(parts[2]);
  if (parts.length === 3 && method === 'GET') {
    if (!journal || journal.deleted) return error(json, 404, 'JOURNAL_NOT_FOUND', 'Diário ou página não encontrada.');
    const pages = [...s.pages.values()].filter((x) => x.journalId === journal.id && !x.deleted).sort((a, b) => a.position - b.position);
    const seen = new Map();
    for (const link of pages.flatMap((x) => x.links)) {
      const t = target(data, materials, link);
      if (t) seen.set(`${t.kind}:${t.id}`, t);
    }
    return json({ journal: journalRow(s, journal), pages: pages.map(pageRow), linkTargets: [...seen.values()] });
  }
  const input = request.postDataJSON();
  s.requests.push({ path: p, ...input });
  if (parts.length === 3 && method === 'PUT') {
    if (journal && journal.lastRequest === input.requestId) return json({ journal: journalRow(s, journal), replayed: true });
    if ((journal?.version || 0) !== input.version) return error(json, 409, 'JOURNAL_VERSION_CONFLICT', 'Esta página mudou em outro aparelho. Atualize antes de editar.');
    const body = input.body || {};
    if ((body.title !== undefined && !String(body.title).trim()) || (body.cover && !/^cover\./.test(body.cover)) || (body.paper && !PAPERS.includes(body.paper)))
      return error(json, 400, 'JOURNAL_INVALID', 'Os dados do diário são inválidos.');
    const next = journal || { id: parts[2], createdAt: now(), version: 0, paper: 'ruled' };
    Object.assign(next, {
      title: body.title?.trim() ?? next.title, cover: body.cover ?? next.cover, paper: body.paper ?? next.paper,
      deleted: Boolean(body.deleted), version: next.version + 1, lastRequest: input.requestId, updatedAt: now(),
    });
    s.journals.set(next.id, next);
    return json({ journal: journalRow(s, next), replayed: false });
  }
  if (parts[3] === 'pages' && method === 'PUT') {
    if (!journal || journal.deleted) return error(json, 404, 'JOURNAL_NOT_FOUND', 'Diário ou página não encontrada.');
    if (data.journalSaveFailures > 0) {
      data.journalSaveFailures -= 1;
      return error(json, 503, 'DATABASE_TEMPORARY_ERROR', 'O banco está temporariamente indisponível.');
    }
    const page = s.pages.get(parts[4]);
    if (page && page.lastRequest === input.requestId) return json({ page: pageRow(page), journal: journalRow(s, journal), replayed: true });
    if ((page?.version || 0) !== input.version) return error(json, 409, 'JOURNAL_VERSION_CONFLICT', 'Esta página mudou em outro aparelho. Atualize antes de editar.');
    const body = input.body || {};
    const decorations = body.decorations ?? page?.decorations ?? [];
    if (decorations.length > 24) return error(json, 409, 'JOURNAL_LIMIT', 'Limite de decorações.');
    for (const d of decorations)
      if (!ART.test(d.art) || d.x < 0 || d.x > 100 || d.y < 0 || d.y > 100 || d.scale < 0.4 || d.scale > 2.5 || Math.abs(d.rotation) > 180 || Object.keys(d).length !== 6)
        return error(json, 400, 'JOURNAL_DECORATION_INVALID', 'Uma decoração é inválida ou está fora da página.');
    const links = body.links ?? page?.links ?? [];
    if (links.some((l) => !target(data, materials, l))) return error(json, 409, 'JOURNAL_LINK_INVALID', 'Só é possível ligar aulas e descobertas suas.');
    const content = body.content ?? page?.content ?? {};
    if (content.quote?.text?.trim() && !links.some((l) => l.kind === content.quote.source?.kind && l.id === content.quote.source?.id))
      return error(json, 409, 'JOURNAL_QUOTE_SOURCE_REQUIRED', 'Uma citação precisa da fonte.');
    if (JSON.stringify(content).includes('<')) return error(json, 400, 'JOURNAL_INVALID', 'Use apenas texto.');
    const next = page || {
      id: parts[4], journalId: journal.id, template: body.template, version: 0,
      position: [...s.pages.values()].filter((x) => x.journalId === journal.id).length,
    };
    Object.assign(next, {
      title: body.title ?? next.title ?? '', paper: body.paper ?? next.paper ?? journal.paper, content, decorations, links,
      deleted: Boolean(body.deleted), version: next.version + 1, lastRequest: input.requestId, updatedAt: now(),
    });
    s.pages.set(next.id, next);
    return json({ page: pageRow(next), journal: journalRow(s, journal), replayed: false });
  }
  return error(json, 404, 'NOT_FOUND', `Sem simulação para ${method} ${p}`);
}

module.exports = { handleJournals };
