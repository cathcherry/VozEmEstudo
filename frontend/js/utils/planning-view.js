export function progressForGoal(goal, tasks) {
  const linked = tasks.filter((task) => task.goal_id === goal.id);
  const completed = linked.filter((task) => Boolean(task.completed_at)).length;
  return { completed, total: linked.length };
}

export function dateLabel(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return '';
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

export function sortedPlanningTasks(tasks, { filter = 'all', sort = 'due' } = {}) {
  const filtered = tasks.filter((task) => {
    if (filter === 'pending') return !task.completed_at;
    if (filter === 'completed') return Boolean(task.completed_at);
    return true;
  });
  return [...filtered].sort((a, b) => {
    if (sort === 'manual')
      return (Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
        || (a.created_at || '').localeCompare(b.created_at || '')
        || a.id.localeCompare(b.id);
    if (sort === 'title') return a.title.localeCompare(b.title, 'pt-BR') || a.id.localeCompare(b.id);
    if (sort === 'recent')
      return (b.created_at || '').localeCompare(a.created_at || '') || a.id.localeCompare(b.id);
    const done = Number(Boolean(a.completed_at)) - Number(Boolean(b.completed_at));
    if (done) return done;
    const dateA = a.due_date || '9999-12-31';
    const dateB = b.due_date || '9999-12-31';
    return dateA.localeCompare(dateB) || (a.created_at || '').localeCompare(b.created_at || '') || a.id.localeCompare(b.id);
  });
}
