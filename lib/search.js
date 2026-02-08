/**
 * Search filter helpers for goals and sessions.
 * Used by /api/search endpoint in serve.js.
 */

function matches(field, q) {
  return (field || '').toLowerCase().includes(q);
}

export function filterGoals(goals, query) {
  if (!query || !Array.isArray(goals)) return [];
  const q = query.toLowerCase();
  return goals.filter(g => {
    if (matches(g.title, q) || matches(g.description, q) || matches(g.notes, q)) return true;
    if (Array.isArray(g.tasks)) {
      for (const t of g.tasks) {
        if (matches(t.text, q) || matches(t.description, q)) return true;
      }
    }
    return false;
  });
}

export function filterSessions(sessions, query) {
  if (!query || !Array.isArray(sessions)) return [];
  const q = query.toLowerCase();
  return sessions.filter(s =>
    matches(s.displayName, q) || matches(s.key, q) || matches(s.label, q)
  );
}
