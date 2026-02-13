import { AUTONOMY_MODES } from './autonomy.js';

export function createCondoHandlers(store, options = {}) {
  const { wsOps, logger } = options;
  function loadData() { return store.load(); }
  function saveData(data) { store.save(data); }

  return {
    'condos.create': ({ params, respond }) => {
      try {
        const { name, description, color, repoUrl, autonomyMode } = params;
        if (!name || typeof name !== 'string' || !name.trim()) {
          respond(false, undefined, { message: 'name is required' });
          return;
        }
        if (autonomyMode && !AUTONOMY_MODES.includes(autonomyMode)) {
          respond(false, undefined, { message: `Invalid autonomyMode. Must be one of: ${AUTONOMY_MODES.join(', ')}` });
          return;
        }
        const data = loadData();
        const now = Date.now();
        const condoId = store.newId('condo');
        const condo = {
          id: condoId,
          name: name.trim(),
          description: typeof description === 'string' ? description : '',
          color: color || null,
          keywords: Array.isArray(params.keywords) ? params.keywords : [],
          telegramTopicIds: Array.isArray(params.telegramTopicIds) ? params.telegramTopicIds : [],
          autonomyMode: autonomyMode || null,
          workspace: null,
          createdAtMs: now,
          updatedAtMs: now,
        };

        // Create workspace if workspaces are enabled
        if (wsOps) {
          const wsResult = wsOps.createCondoWorkspace(wsOps.dir, condoId, name.trim(), repoUrl || undefined);
          if (wsResult.ok) {
            condo.workspace = { path: wsResult.path, repoUrl: repoUrl || null, createdAtMs: now };
          } else if (logger) {
            logger.error(`clawcondos-goals: workspace creation failed for condo ${condoId}: ${wsResult.error}`);
          }
        }

        data.condos.unshift(condo);
        saveData(data);
        respond(true, { condo });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'condos.list': ({ params, respond }) => {
      try {
        const data = loadData();
        const condos = data.condos.map(c => ({
          ...c,
          goalCount: data.goals.filter(g => g.condoId === c.id).length,
        }));
        respond(true, { condos });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'condos.get': ({ params, respond }) => {
      try {
        const data = loadData();
        const condo = data.condos.find(c => c.id === params.id);
        if (!condo) {
          respond(false, undefined, { message: 'Condo not found' });
          return;
        }
        const goals = data.goals.filter(g => g.condoId === condo.id);
        respond(true, { condo, goals });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'condos.update': ({ params, respond }) => {
      try {
        const data = loadData();
        const idx = data.condos.findIndex(c => c.id === params.id);
        if (idx === -1) {
          respond(false, undefined, { message: 'Condo not found' });
          return;
        }
        const condo = data.condos[idx];

        // Validate name if provided (match condos.create rigor)
        if ('name' in params && (!params.name || typeof params.name !== 'string' || !params.name.trim())) {
          respond(false, undefined, { message: 'name is required' });
          return;
        }

        // Whitelist allowed patch fields (prevent overwriting internal fields)
        // Validate autonomyMode if provided
        if ('autonomyMode' in params && params.autonomyMode !== null && !AUTONOMY_MODES.includes(params.autonomyMode)) {
          respond(false, undefined, { message: `Invalid autonomyMode. Must be one of: ${AUTONOMY_MODES.join(', ')}` });
          return;
        }

        const allowed = ['name', 'description', 'color', 'keywords', 'telegramTopicIds', 'autonomyMode'];
        for (const f of allowed) {
          if (f in params) {
            // Validate array fields
            if ((f === 'keywords' || f === 'telegramTopicIds') && !Array.isArray(params[f])) continue;
            condo[f] = params[f];
          }
        }
        if (typeof condo.name === 'string') condo.name = condo.name.trim();
        condo.updatedAtMs = Date.now();

        saveData(data);
        respond(true, { condo });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'condos.delete': ({ params, respond }) => {
      try {
        const data = loadData();
        const idx = data.condos.findIndex(c => c.id === params.id);
        if (idx === -1) {
          respond(false, undefined, { message: 'Condo not found' });
          return;
        }
        const deletedCondo = data.condos[idx];

        // Remove workspace if it exists
        if (wsOps && deletedCondo.workspace?.path) {
          const rmResult = wsOps.removeCondoWorkspace(deletedCondo.workspace.path);
          if (!rmResult.ok && logger) {
            logger.error(`clawcondos-goals: workspace removal failed for condo ${params.id}: ${rmResult.error}`);
          }
        }

        // Nullify condoId on all linked goals (cascade)
        for (const goal of data.goals) {
          if (goal.condoId === params.id) {
            goal.condoId = null;
          }
        }
        // Clean up sessionCondoIndex entries pointing to this condo
        if (data.sessionCondoIndex) {
          for (const [key, val] of Object.entries(data.sessionCondoIndex)) {
            if (val === params.id) delete data.sessionCondoIndex[key];
          }
        }
        // Clean up sessionIndex entries for this condo's PM session
        if (deletedCondo.pmCondoSessionKey && data.sessionIndex) {
          delete data.sessionIndex[deletedCondo.pmCondoSessionKey];
        }
        data.condos.splice(idx, 1);
        saveData(data);
        respond(true, { ok: true });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },
  };
}
