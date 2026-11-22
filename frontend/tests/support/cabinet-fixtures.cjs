// Synthetic data for the 3.6 cabinet / archive journeys and captures (no real account): four
// discoveries in three subjects, one still a fresh card, others with reflections, connections
// (one across subjects) and revisits; the unlocks the server would have recorded for them.
const ID = (n) => `0b1c2d3e-0000-4000-8000-00000000000${n}`;
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

function populated(data) {
  data.seedDiscoveries = [
    {
      id: ID(1), materialId: 'l-foto', title: 'Por que a folha é verde?', createdAt: ago(12), evidenceCount: 2,
      explanation: 'A clorofila absorve o vermelho e o azul da luz e reflete o verde, que é o que vemos.',
      quote: 'energia luminosa', reflections: ['Eu achava que o verde era a cor que a planta usava.'],
      revisits: [{ createdAt: ago(4), kind: 'reflection' }], connectTo: [ID(2), ID(3)],
    },
    {
      id: ID(2), materialId: 'l-rev', title: 'De onde vinha a energia das fábricas?', createdAt: ago(9), evidenceCount: 3,
      explanation: 'O carvão guardava energia química que as máquinas a vapor transformavam em trabalho.',
      quote: 'máquina a vapor', reflections: ['A energia do carvão também veio da luz, há muito tempo.'],
    },
    {
      id: ID(3), materialId: 'l-foto', title: 'Onde a planta guarda a energia da luz?', createdAt: ago(6),
      explanation: 'Na glicose: a fotossíntese transforma luz em energia química nas ligações.', quote: 'glicose',
    },
    {
      id: ID(4), materialId: 'l-ondas', title: 'O som precisa de ar para viajar?', createdAt: ago(1),
      explanation: 'Sim: o som é uma onda mecânica e precisa de um meio material para se propagar.', quote: 'ondas',
    },
  ];
  const lesson = { 'l-foto': 'Fotossíntese e respiração celular', 'l-rev': 'Revolução Industrial: causas e consequências', 'l-ondas': 'Ondas e som' };
  const unlock = (id, days, discovery, materialId = 'l-foto') => ({
    id, kind: id.split('.')[0], event: 'investigation_completed', sourceId: discovery, investigationId: discovery,
    currentDiscoveryId: discovery, materialId, lessonTitle: lesson[materialId], occurredAt: ago(days),
  });
  data.seedUnlocks = [
    unlock('stamp.first-evidence', 12, ID(1)),
    unlock('stamp.own-explanation', 12, ID(1)),
    unlock('stamp.first-investigation', 12, ID(1)),
    unlock('stamp.first-reflection', 12, ID(1)),
    unlock('stamp.connection', 9, ID(1)),
    unlock('stamp.revisit', 4, ID(1)),
    unlock('object.magnifying-glass', 6, ID(3)),
    unlock('object.globe', 1, ID(4), 'l-ondas'),
  ];
  return data;
}

module.exports = { populated, ID };
