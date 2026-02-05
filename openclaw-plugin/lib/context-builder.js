export function buildGoalContext(goal, opts = {}) {
  if (!goal) return null;
  const { currentSessionKey } = opts;

  const lines = [
    `# Goal: ${goal.title}`,
  ];

  if (goal.description) lines.push('', goal.description);

  const meta = [];
  if (goal.status) meta.push(`Status: ${goal.status}`);
  if (goal.priority) meta.push(`Priority: ${goal.priority}`);
  if (goal.deadline) meta.push(`Deadline: ${goal.deadline}`);
  if (goal.sessions?.length) meta.push(`Sessions: ${goal.sessions.length}`);
  if (meta.length) lines.push('', meta.join(' | '));

  if (goal.tasks?.length) {
    lines.push('', '## Tasks');
    for (const t of goal.tasks) {
      const marker = t.done ? 'x' : ' ';
      let suffix = '';
      if (currentSessionKey && t.sessionKey === currentSessionKey) {
        suffix = ' (you)';
      } else if (t.sessionKey) {
        suffix = ` (assigned: ${t.sessionKey})`;
      } else if (!t.done) {
        suffix = ' (unassigned)';
      }
      lines.push(`- [${marker}] ${t.text}${suffix}`);
      if (t.done && t.summary) {
        lines.push(`  > ${t.summary}`);
      }
    }
  }

  const hasPendingTasks = (goal.tasks || []).some(t => !t.done);
  if (hasPendingTasks) {
    lines.push('');
    lines.push('> When you complete a task, use the `goal_update` tool to report it as done with a brief summary of what was accomplished.');
  }

  return lines.join('\n');
}
