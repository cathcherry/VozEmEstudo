export const milestones = [
  ['first-class','Primeira aula','aulas',1,'curious',20],
  ['library-5','Acervo em construção','aulas',5,'reading',30],
  ['library-10','Coleção de aulas','aulas',10,'laptop',50],
  ['library-25','Biblioteca viva','aulas',25,'laptop',100],
  ['review-1','Primeira revisão','revisoes',1,'glasses',25],
  ['review-5','Ritmo de revisão','revisoes',5,'listening',60],
  ['review-20','Revisão em dia','revisoes',20,'glasses',120],
  ['answer-1','Primeira resposta','questoes',1,'happy',15],
  ['answer-10','Curiosidade ativa','questoes',10,'celebrate',40],
  ['answer-50','Prática constante','questoes',50,'rest',100],
  ['answer-100','Cem descobertas','questoes',100,'celebrate',150],
  ['listen-10','Escuta atenta','minutos',10,'listening',40],
  ['listen-60','Uma hora de descobertas','minutos',60,'reading',100],
].map(([id,title,metric,target,avatar,xp]) => ({id,title,metric,target,avatar,xp}));

export function evaluateMilestones(facts, previous = {}, now = new Date().toISOString()) {
  const best = {...previous.best};
  for (const metric of ['aulas','revisoes','questoes','minutos']) best[metric] = Math.max(Number(best[metric]) || 0, Number(facts[metric]) || 0);
  const unlocked = {...previous.unlocked};
  for (const badge of milestones) if (best[badge.metric] >= badge.target && !unlocked[badge.id]) unlocked[badge.id] = now;
  const xp = milestones.reduce((sum,badge) => sum + (unlocked[badge.id] ? badge.xp : 0),0);
  return {best,unlocked,xp,level:Math.floor(xp / 100) + 1};
}

export function orderedMilestones(state) {
  return [...milestones].sort((a,b) => {
    const first=state.unlocked?.[a.id], second=state.unlocked?.[b.id];
    if (first && second) return new Date(first)-new Date(second);
    return first ? -1 : second ? 1 : 0;
  });
}
export function unlockedAvatars(state) {
  return new Set(['reading', ...milestones.filter(badge => state.unlocked?.[badge.id]).map(badge => badge.avatar)]);
}

/**
 * Combines two copies of the milestone state (e.g. from two devices): earliest unlock date per
 * milestone, highest value per metric, XP and level recomputed. Only milestones that exist in
 * this version count, so stray entries cannot inflate XP.
 * These values are derived in the browser and are cosmetic (provisional), not server-verified.
 */
export function mergeMilestoneStates(remote = {}, local = {}) {
  const best = {};
  for (const metric of ['aulas', 'revisoes', 'questoes', 'minutos'])
    best[metric] = Math.max(Number(remote?.best?.[metric]) || 0, Number(local?.best?.[metric]) || 0);
  const unlocked = {};
  for (const badge of milestones) {
    const dates = [remote?.unlocked?.[badge.id], local?.unlocked?.[badge.id]].filter(
      (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)),
    );
    if (dates.length) unlocked[badge.id] = dates.sort()[0];
  }
  const xp = milestones.reduce((sum, badge) => sum + (unlocked[badge.id] ? badge.xp : 0), 0);
  return { best, unlocked, xp, level: Math.floor(xp / 100) + 1 };
}
