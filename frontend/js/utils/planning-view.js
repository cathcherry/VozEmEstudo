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
