export function createGoalHandlers(store) {
  function loadData() { return store.load(); }
  function saveData(data) { store.save(data); }

  return {
    'goals.list': ({ params, respond }) => {
      try {
        const data = loadData();
        respond(true, { goals: data.goals });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'goals.create': ({ params, respond }) => {
      try {
        const { title, condoId, description, completed, status, priority, deadline, notes, tasks } = params;
        if (!title || typeof title !== 'string' || !title.trim()) {
          respond(false, undefined, { message: 'title is required' });
          return;
        }
        const data = loadData();
        const now = Date.now();
        const isCompleted = completed === true || status === 'done';
        const goal = {
          id: store.newId('goal'),
          title: title.trim(),
          description: description || notes || '',
          notes: notes || '',
          status: isCompleted ? 'done' : 'active',
          completed: isCompleted,
          condoId: condoId || null,
          priority: priority || null,
          deadline: deadline || null,
          tasks: Array.isArray(tasks) ? tasks : [],
          sessions: [],
          createdAtMs: now,
          updatedAtMs: now,
        };
        data.goals.unshift(goal);
        saveData(data);
        respond(true, { goal });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'goals.get': ({ params, respond }) => {
      try {
        const data = loadData();
        const goal = data.goals.find(g => g.id === params.id);
        if (!goal) {
          respond(false, undefined, { message: 'Goal not found' });
          return;
        }
        respond(true, { goal });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'goals.update': ({ params, respond }) => {
      try {
        const data = loadData();
        const idx = data.goals.findIndex(g => g.id === params.id);
        if (idx === -1) {
          respond(false, undefined, { message: 'Goal not found' });
          return;
        }
        const goal = data.goals[idx];

        // Whitelist allowed patch fields (prevent overwriting internal fields)
        const allowed = ['title', 'description', 'status', 'completed', 'condoId', 'priority', 'deadline', 'notes', 'tasks'];
        for (const f of allowed) {
          if (f in params) goal[f] = params[f];
        }
        if (typeof goal.title === 'string') goal.title = goal.title.trim();
        goal.updatedAtMs = Date.now();

        // Sync completed/status
        if ('status' in params) {
          goal.completed = goal.status === 'done';
        } else if ('completed' in params) {
          goal.status = goal.completed ? 'done' : 'active';
        }

        saveData(data);
        respond(true, { goal });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'goals.delete': ({ params, respond }) => {
      try {
        const data = loadData();
        const idx = data.goals.findIndex(g => g.id === params.id);
        if (idx === -1) {
          respond(false, undefined, { message: 'Goal not found' });
          return;
        }
        // Clean up session index entries pointing to this goal
        for (const [key, val] of Object.entries(data.sessionIndex)) {
          if (val.goalId === params.id) delete data.sessionIndex[key];
        }
        data.goals.splice(idx, 1);
        saveData(data);
        respond(true, { ok: true });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'goals.addSession': ({ params, respond }) => {
      try {
        const { id, sessionKey } = params;
        if (!sessionKey) {
          respond(false, undefined, { message: 'sessionKey is required' });
          return;
        }
        const data = loadData();
        const goal = data.goals.find(g => g.id === id);
        if (!goal) {
          respond(false, undefined, { message: 'Goal not found' });
          return;
        }
        // Remove session from any other goal (move semantics)
        for (const g of data.goals) {
          const sIdx = (g.sessions || []).indexOf(sessionKey);
          if (sIdx !== -1) {
            g.sessions.splice(sIdx, 1);
            g.updatedAtMs = Date.now();
          }
        }
        // Add to target goal
        if (!goal.sessions.includes(sessionKey)) {
          goal.sessions.unshift(sessionKey);
        }
        goal.updatedAtMs = Date.now();
        data.sessionIndex[sessionKey] = { goalId: id };
        saveData(data);
        respond(true, { ok: true, goal });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'goals.removeSession': ({ params, respond }) => {
      try {
        const { id, sessionKey } = params;
        const data = loadData();
        const goal = data.goals.find(g => g.id === id);
        if (!goal) {
          respond(false, undefined, { message: 'Goal not found' });
          return;
        }
        goal.sessions = (goal.sessions || []).filter(s => s !== sessionKey);
        goal.updatedAtMs = Date.now();
        delete data.sessionIndex[sessionKey];
        saveData(data);
        respond(true, { ok: true, goal });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'goals.sessionLookup': ({ params, respond }) => {
      try {
        const data = loadData();
        const entry = data.sessionIndex[params.sessionKey];
        respond(true, { goalId: entry?.goalId ?? null });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'goals.setSessionCondo': ({ params, respond }) => {
      try {
        const { sessionKey, condoId } = params;
        if (!sessionKey || !condoId) {
          respond(false, undefined, { message: 'sessionKey and condoId are required' });
          return;
        }
        const data = loadData();
        data.sessionCondoIndex[sessionKey] = condoId;
        saveData(data);
        respond(true, { ok: true, sessionKey, condoId });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'goals.getSessionCondo': ({ params, respond }) => {
      try {
        const data = loadData();
        respond(true, { condoId: data.sessionCondoIndex[params.sessionKey] ?? null });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'goals.listSessionCondos': ({ params, respond }) => {
      try {
        const data = loadData();
        respond(true, { sessionCondoIndex: data.sessionCondoIndex });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },
  };
}
