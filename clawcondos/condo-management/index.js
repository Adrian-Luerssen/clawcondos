import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { watch, existsSync } from 'fs';
import { createGoalsStore } from './lib/goals-store.js';
import { createGoalHandlers } from './lib/goals-handlers.js';
import { createCondoHandlers } from './lib/condos-handlers.js';
import { createPlanHandlers, getPlanLogBuffer } from './lib/plan-handlers.js';
import { createPmHandlers } from './lib/pm-handlers.js';
import { createConfigHandlers } from './lib/config-handlers.js';
import { createTeamHandlers } from './lib/team-handlers.js';
import { createRolesHandlers } from './lib/roles-handlers.js';
import { createNotificationHandlers } from './lib/notification-manager.js';
import { createAutonomyHandlers } from './lib/autonomy.js';
import { buildGoalContext, buildCondoContext, buildCondoMenuContext, getProjectSummaryForGoal } from './lib/context-builder.js';
import { createGoalUpdateExecutor } from './lib/goal-update-tool.js';
import { createTaskSpawnHandler, buildPlanFilePath } from './lib/task-spawn.js';
import { matchLogToStep } from './lib/plan-manager.js';
import { resolveAgent, getAgentForRole } from './lib/agent-roles.js';
import {
  createCondoBindExecutor,
  createCondoCreateGoalExecutor,
  createCondoAddTaskExecutor,
  createCondoSpawnTaskExecutor,
} from './lib/condo-tools.js';
import * as workspaceManager from './lib/workspace-manager.js';
import {
  CLASSIFIER_CONFIG,
  extractLastUserMessage,
  parseTelegramContext,
  isSkippableMessage,
  tier1Classify,
  detectGoalIntent,
} from './lib/classifier.js';
import { createClassificationLog } from './lib/classification-log.js';
import { analyzeCorrections, applyLearning } from './lib/learning.js';

export default function register(api) {
  const dataDir = api.pluginConfig?.dataDir
    || join(dirname(fileURLToPath(import.meta.url)), '.data');
  const store = createGoalsStore(dataDir);
  const classificationLog = createClassificationLog(dataDir);

  // ── Workspace management ──
  const workspacesDir = process.env.CLAWCONDOS_WORKSPACES_DIR || api.pluginConfig?.workspacesDir || null;
  const wsOps = workspacesDir
    ? { dir: workspacesDir, ...workspaceManager }
    : null;

  if (wsOps) {
    api.logger.info(`clawcondos-goals: workspaces enabled at ${workspacesDir}`);
  }

  const handlers = createGoalHandlers(store, { wsOps, logger: api.logger });

  // Wrap setSessionCondo to track reclassifications
  const originalSetSessionCondo = handlers['goals.setSessionCondo'];
  handlers['goals.setSessionCondo'] = (msg) => {
    const { params } = msg;
    if (params?.sessionKey && params?.condoId) {
      try {
        const data = store.load();
        const previousCondo = data.sessionCondoIndex[params.sessionKey];
        if (previousCondo && previousCondo !== params.condoId) {
          classificationLog.recordReclassification(params.sessionKey, previousCondo, params.condoId);
          api.logger.info(`clawcondos-goals: reclassification ${params.sessionKey}: ${previousCondo} → ${params.condoId}`);
        }
      } catch (err) {
        api.logger.error(`clawcondos-goals: reclassification tracking failed: ${err.message}`);
      }
    }
    return originalSetSessionCondo(msg);
  };

  for (const [method, handler] of Object.entries(handlers)) {
    // Wrap goals.delete to add broadcast support (for PM chat cleanup)
    if (method === 'goals.delete') {
      api.registerGatewayMethod(method, (msg) => {
        const goalId = msg.params?.id;
        const originalRespond = msg.respond;
        msg.respond = (success, data, error) => {
          // Broadcast on success so frontend can cleanup (e.g., PM chat state)
          if (success && goalId) {
            if (api.broadcast) {
              api.broadcast({
                type: 'event',
                event: 'goal.deleted',
                payload: {
                  goalId,
                  timestamp: Date.now(),
                },
              });
            }
          }
          originalRespond(success, data, error);
        };
        handler(msg);
      });
    // Wrap goals.updatePlan to add broadcast support
    } else if (method === 'goals.updatePlan') {
      api.registerGatewayMethod(method, (msg) => {
        const originalRespond = msg.respond;
        msg.respond = (success, data, error) => {
          // Broadcast on success
          if (success && data?.plan && data?.goal) {
            if (api.broadcast) {
              api.broadcast({
                type: 'event',
                event: 'goal.plan_updated',
                payload: {
                  goalId: data.goal.id,
                  plan: data.plan,
                  timestamp: Date.now(),
                },
              });
            }
          }
          originalRespond(success, data, error);
        };
        handler(msg);
      });
    } else {
      api.registerGatewayMethod(method, handler);
    }
  }

  const condoHandlers = createCondoHandlers(store, { wsOps, logger: api.logger });
  for (const [method, handler] of Object.entries(condoHandlers)) {
    api.registerGatewayMethod(method, handler);
  }

  // ── WebSocket broadcasting for real-time plan updates ──
  const broadcastPlanUpdate = (payload) => {
    if (api.broadcast) {
      api.broadcast({
        type: 'event',
        event: payload.event || 'plan.update',
        payload,
      });
    }
  };

  // ── Send message to a specific session (for approval/rejection notifications) ──
  const sendToSession = (sessionKey, message) => {
    if (api.sendToSession) {
      api.sendToSession(sessionKey, message);
    } else {
      api.logger.warn(`clawcondos-goals: sendToSession not available, cannot notify ${sessionKey}`);
    }
  };

  // Plan management handlers (with broadcast and session notification)
  const planHandlers = createPlanHandlers(store, {
    broadcastPlanUpdate,
    sendToSession,
  });
  for (const [method, handler] of Object.entries(planHandlers)) {
    api.registerGatewayMethod(method, handler);
  }

  // PM (Project Manager) mode handlers
  const pmHandlers = createPmHandlers(store, {
    sendToSession: api.sendToSession,
    logger: api.logger,
    wsOps,
  });
  for (const [method, handler] of Object.entries(pmHandlers)) {
    api.registerGatewayMethod(method, handler);
  }

  // Config handlers (agent roles, global settings)
  const configHandlers = createConfigHandlers(store, {
    logger: api.logger,
  });
  for (const [method, handler] of Object.entries(configHandlers)) {
    api.registerGatewayMethod(method, handler);
  }

  // Team handlers (team chat, broadcast)
  const teamHandlers = createTeamHandlers(store, {
    sendToSession: api.sendToSession,
    getSessionHistory: api.getSessionHistory,
    broadcast: api.broadcast,
    logger: api.logger,
  });
  for (const [method, handler] of Object.entries(teamHandlers)) {
    api.registerGatewayMethod(method, handler);
  }

  // Roles handlers (agent role assignment with labels)
  const rolesHandlers = createRolesHandlers(store, {
    broadcast: api.broadcast,
    logger: api.logger,
  });
  for (const [method, handler] of Object.entries(rolesHandlers)) {
    api.registerGatewayMethod(method, handler);
  }

  // Notification handlers
  const notificationHandlers = createNotificationHandlers(store);
  for (const [method, handler] of Object.entries(notificationHandlers)) {
    api.registerGatewayMethod(method, handler);
  }

  // Autonomy handlers
  const autonomyHandlers = createAutonomyHandlers(store);
  for (const [method, handler] of Object.entries(autonomyHandlers)) {
    api.registerGatewayMethod(method, handler);
  }

  api.registerGatewayMethod('goals.spawnTaskSession', createTaskSpawnHandler(store));

  // goals.kickoff - Spawn sessions for all tasks with assigned agents
  const taskSpawnHandler = createTaskSpawnHandler(store);
  api.registerGatewayMethod('goals.kickoff', async ({ params, respond }) => {
    const { goalId } = params || {};

    if (!goalId) {
      return respond(false, null, 'goalId is required');
    }

    try {
      const data = store.load();
      const goal = data.goals.find(g => g.id === goalId);

      if (!goal) {
        return respond(false, null, `Goal ${goalId} not found`);
      }

      const tasks = goal.tasks || [];

      // Collect IDs of tasks that are already done
      const doneTasks = new Set(tasks.filter(t => t.status === 'done' || t.done).map(t => t.id));

      const tasksToSpawn = tasks.filter(t => {
        // Skip already-assigned or done tasks
        if (t.sessionKey || t.status === 'done') return false;

        // Check dependency ordering: only spawn if ALL dependencies are done
        if (Array.isArray(t.dependsOn) && t.dependsOn.length > 0) {
          const allDepsDone = t.dependsOn.every(depId => doneTasks.has(depId));
          if (!allDepsDone) return false;
        }

        return true;
      });

      if (tasksToSpawn.length === 0) {
        return respond(true, {
          goalId,
          spawnedSessions: [],
          message: 'No tasks to spawn',
        });
      }

      const spawnedSessions = [];
      const errors = [];

      for (const task of tasksToSpawn) {
        try {
          // Resolve role -> actual agent ID using config, fall back to 'main'
          const resolvedAgentId = resolveAgent(store, task.assignedAgent) || 'main';

          // Create a promise-based wrapper for the spawn handler
          const result = await new Promise((resolve, reject) => {
            taskSpawnHandler({
              params: {
                goalId,
                taskId: task.id,
                agentId: resolvedAgentId,
                model: task.model || null,
              },
              respond: (success, data, error) => {
                if (success) {
                  resolve(data);
                } else {
                  reject(new Error(error?.message || error || 'Spawn failed'));
                }
              },
            });
          });

          spawnedSessions.push({
            taskId: task.id,
            taskText: task.text,
            sessionKey: result.sessionKey,
            agentId: result.agentId,
            assignedRole: task.assignedAgent,  // Original role/spec from task
            autonomyMode: result.autonomyMode,
          });
        } catch (err) {
          errors.push({
            taskId: task.id,
            taskText: task.text,
            error: err.message,
          });
        }
      }

      // Update goal status to 'in-progress' if any sessions spawned
      if (spawnedSessions.length > 0) {
        const updatedData = store.load();
        const updatedGoal = updatedData.goals.find(g => g.id === goalId);
        if (updatedGoal && updatedGoal.status !== 'done') {
          updatedGoal.status = 'active';
          updatedGoal.updatedAtMs = Date.now();
          store.save(updatedData);
        }

        // Broadcast kickoff event
        broadcastPlanUpdate({
          event: 'goal.kickoff',
          goalId,
          spawnedCount: spawnedSessions.length,
          spawnedSessions,
        });
      }

      respond(true, {
        goalId,
        spawnedSessions,
        errors: errors.length > 0 ? errors : undefined,
        message: `Spawned ${spawnedSessions.length} session(s)${errors.length > 0 ? `, ${errors.length} error(s)` : ''}`,
      });
    } catch (err) {
      respond(false, null, err.message);
    }
  });

  // ── Plan file watching ──
  const planLogBuffer = getPlanLogBuffer();
  const planFileWatchers = new Map(); // sessionKey -> { watcher, filePath, debounceTimer }
  const PLAN_WATCH_DEBOUNCE_MS = 500;

  /**
   * Start watching a plan file for a session
   */
  function watchPlanFile(sessionKey, filePath) {
    if (planFileWatchers.has(sessionKey)) {
      return; // Already watching
    }

    if (!existsSync(filePath)) {
      // File doesn't exist yet, skip watching
      return;
    }

    try {
      const watcher = watch(filePath, { persistent: false }, (eventType) => {
        const existing = planFileWatchers.get(sessionKey);
        if (!existing) return;

        // Debounce rapid changes
        if (existing.debounceTimer) {
          clearTimeout(existing.debounceTimer);
        }

        existing.debounceTimer = setTimeout(() => {
          if (!existsSync(filePath)) return;

          // Emit plan.update event
          broadcastPlanUpdate({
            event: 'plan.file_changed',
            sessionKey,
            filePath,
            timestamp: Date.now(),
          });

          // Log to plan buffer
          planLogBuffer.append(sessionKey, {
            type: 'file_change',
            message: 'Plan file updated',
            filePath,
          });

          api.logger.debug(`clawcondos-goals: plan file changed for ${sessionKey}: ${filePath}`);
        }, PLAN_WATCH_DEBOUNCE_MS);
      });

      planFileWatchers.set(sessionKey, { watcher, filePath, debounceTimer: null });
      api.logger.info(`clawcondos-goals: watching plan file for ${sessionKey}: ${filePath}`);
    } catch (err) {
      api.logger.error(`clawcondos-goals: failed to watch plan file ${filePath}: ${err.message}`);
    }
  }

  /**
   * Stop watching a plan file for a session
   */
  function unwatchPlanFile(sessionKey) {
    const existing = planFileWatchers.get(sessionKey);
    if (existing) {
      if (existing.debounceTimer) {
        clearTimeout(existing.debounceTimer);
      }
      try {
        existing.watcher.close();
      } catch {}
      planFileWatchers.delete(sessionKey);
      api.logger.info(`clawcondos-goals: stopped watching plan file for ${sessionKey}`);
    }
  }

  /**
   * Initialize plan file watchers for all active task sessions
   */
  function initPlanFileWatchers() {
    const data = store.load();
    for (const goal of data.goals) {
      if (goal.completed) continue;
      for (const task of goal.tasks || []) {
        if (!task.sessionKey || task.status === 'done') continue;

        // Get expected plan file path
        const agentMatch = task.sessionKey.match(/^agent:([^:]+):/);
        const agentId = agentMatch ? agentMatch[1] : 'main';
        const planFilePath = task.plan?.expectedFilePath || buildPlanFilePath(agentId, goal.id, task.id);

        watchPlanFile(task.sessionKey, planFilePath);
      }
    }
  }

  // Initialize watchers on plugin load
  try {
    initPlanFileWatchers();
  } catch (err) {
    api.logger.error(`clawcondos-goals: failed to initialize plan file watchers: ${err.message}`);
  }

  // Classification RPC methods
  api.registerGatewayMethod('classification.stats', ({ respond }) => {
    try {
      const stats = classificationLog.getStats();
      respond(true, { stats });
    } catch (err) {
      api.logger.error(`clawcondos-goals: classification.stats error: ${err.message}`);
      respond(false, null, err.message);
    }
  });

  api.registerGatewayMethod('classification.learningReport', ({ respond }) => {
    try {
      const suggestions = analyzeCorrections(classificationLog);
      respond(true, { suggestions });
    } catch (err) {
      api.logger.error(`clawcondos-goals: classification.learningReport error: ${err.message}`);
      respond(false, null, err.message);
    }
  });

  api.registerGatewayMethod('classification.applyLearning', ({ params, respond }) => {
    try {
      const dryRun = params?.dryRun !== false;
      const suggestions = analyzeCorrections(classificationLog);
      const applied = applyLearning(store, suggestions, dryRun);
      respond(true, { dryRun, applied });
    } catch (err) {
      api.logger.error(`clawcondos-goals: classification.applyLearning error: ${err.message}`);
      respond(false, null, err.message);
    }
  });

  // Hook: inject goal/condo context into agent prompts
  api.registerHook('before_agent_start', async (event) => {
    const sessionKey = event.context?.sessionKey;
    if (!sessionKey) return;
    const data = store.load();

    // 1. Check sessionCondoIndex (condo orchestrator path)
    const condoId = data.sessionCondoIndex[sessionKey];
    if (condoId) {
      const condo = data.condos.find(c => c.id === condoId);
      if (condo) {
        const goals = data.goals.filter(g => g.condoId === condoId);
        const context = buildCondoContext(condo, goals, { currentSessionKey: sessionKey });
        if (context) return { prependContext: context };
      }
    }

    // 2. Check sessionIndex (individual goal path — includes project summary if in a condo)
    const entry = data.sessionIndex[sessionKey];
    if (entry) {
      const goal = data.goals.find(g => g.id === entry.goalId);
      if (goal) {
        const projectSummary = getProjectSummaryForGoal(goal, data);
        const context = buildGoalContext(goal, { currentSessionKey: sessionKey });
        if (context) {
          return { prependContext: projectSummary ? `${projectSummary}\n\n${context}` : context };
        }
      }
    }

    // 3. Auto-classification for unbound sessions
    if (!CLASSIFIER_CONFIG.enabled) return;

    try {
      const message = extractLastUserMessage(event.messages);
      if (!message || isSkippableMessage(message)) return;

      const telegramCtx = parseTelegramContext(sessionKey) || {};
      const startMs = Date.now();
      const classification = tier1Classify(message, telegramCtx, data.condos);
      const latencyMs = Date.now() - startMs;

      // Log classification attempt
      classificationLog.append({
        sessionKey,
        tier: classification.tier,
        predictedCondo: classification.condoId,
        confidence: classification.confidence,
        reasoning: classification.reasoning,
        latencyMs,
      });

      // High confidence → auto-bind
      if (classification.condoId && classification.confidence >= CLASSIFIER_CONFIG.autoRouteThreshold) {
        data.sessionCondoIndex[sessionKey] = classification.condoId;
        store.save(data);

        const condo = data.condos.find(c => c.id === classification.condoId);
        if (condo) {
          const goals = data.goals.filter(g => g.condoId === classification.condoId);
          const context = buildCondoContext(condo, goals, { currentSessionKey: sessionKey });

          // Goal intent detection
          if (context) {
            const goalIntent = detectGoalIntent(message);
            const hint = goalIntent.isGoal
              ? '\n\n> This message looks like a goal or multi-step task. Consider using `condo_create_goal` to track it.'
              : '';
            api.logger.info(`clawcondos-goals: auto-routed ${sessionKey} → ${condo.name} (confidence: ${classification.confidence.toFixed(2)}, reason: ${classification.reasoning})`);
            return { prependContext: context + hint };
          }
        }
      }

      // Low confidence → inject condo menu for agent to decide
      if (data.condos.length > 0) {
        const menu = buildCondoMenuContext(data.condos, data.goals);
        if (menu) return { prependContext: menu };
      }
    } catch (err) {
      api.logger.error(`clawcondos-goals: classification error for ${sessionKey}: ${err.message}`);
    }
  });

  // Hook: track session activity on goals and condos + cleanup plan file watchers
  api.registerHook('agent_end', async (event) => {
    const sessionKey = event.context?.sessionKey;
    if (!sessionKey || !event.success) return;

    try {
      const data = store.load();

      // Update condo timestamp if session is bound to one
      const condoId = data.sessionCondoIndex[sessionKey];
      if (condoId) {
        const condo = data.condos.find(c => c.id === condoId);
        if (condo) {
          condo.updatedAtMs = Date.now();
          store.save(data);
          api.logger.info(`clawcondos-goals: agent_end for session ${sessionKey} (condo: ${condo.name})`);
          return;
        }
      }

      // Update goal timestamp if session is assigned to one
      const entry = data.sessionIndex[sessionKey];
      if (!entry) return;
      const goal = data.goals.find(g => g.id === entry.goalId);
      if (!goal) return;
      goal.updatedAtMs = Date.now();
      store.save(data);
      api.logger.info(`clawcondos-goals: agent_end for session ${sessionKey} (goal: ${goal.title})`);

      // Check if task is complete and cleanup watcher
      const task = (goal.tasks || []).find(t => t.sessionKey === sessionKey);
      if (task && task.status === 'done') {
        unwatchPlanFile(sessionKey);
        // Clear plan log buffer for completed sessions
        planLogBuffer.clear(sessionKey);
      }
    } catch (err) {
      api.logger.error(`clawcondos-goals: agent_end error for ${sessionKey}: ${err.message}`);
    }
  });

  // Hook: intercept agent stream for plan.log events
  if (api.registerHook) {
    api.registerHook('agent_stream', async (event) => {
      const sessionKey = event.context?.sessionKey;
      if (!sessionKey) return;

      // Check if session is assigned to a goal with a task
      const data = store.load();
      const entry = data.sessionIndex[sessionKey];
      if (!entry) return;

      const goal = data.goals.find(g => g.id === entry.goalId);
      if (!goal) return;

      const task = (goal.tasks || []).find(t => t.sessionKey === sessionKey);
      if (!task || !task.plan) return;

      // Extract log-worthy events from stream
      const chunk = event.chunk;
      if (!chunk) return;

      // Handle tool calls
      if (chunk.type === 'tool_call' || chunk.type === 'tool_result') {
        const logEntry = {
          type: chunk.type,
          message: chunk.type === 'tool_call'
            ? `Tool call: ${chunk.name || 'unknown'}`
            : `Tool result: ${chunk.success ? 'success' : 'failure'}`,
          toolName: chunk.name,
          metadata: chunk.type === 'tool_result' ? { success: chunk.success } : null,
        };

        // Try to match to a plan step
        if (task.plan.steps && task.plan.steps.length > 0) {
          const match = matchLogToStep(logEntry.message, task.plan.steps);
          if (match.matched) {
            logEntry.stepIndex = match.stepIndex;
            logEntry.matchConfidence = match.confidence;
          }
        }

        planLogBuffer.append(sessionKey, logEntry);

        // Broadcast plan.log event
        broadcastPlanUpdate({
          event: 'plan.log',
          sessionKey,
          goalId: goal.id,
          taskId: task.id,
          entry: {
            ...logEntry,
            timestamp: Date.now(),
          },
        });
      }

      // Handle text output (selective logging)
      if (chunk.type === 'text' && chunk.text) {
        const text = chunk.text.trim();
        // Only log significant text (headings, status updates, etc.)
        if (text.startsWith('#') || text.startsWith('✓') || text.startsWith('✗') ||
            text.includes('Starting') || text.includes('Completed') ||
            text.includes('Error:') || text.includes('Step ')) {
          const logEntry = {
            type: 'text',
            message: text.slice(0, 200), // Truncate long text
          };

          // Try to match to a plan step
          if (task.plan.steps && task.plan.steps.length > 0) {
            const match = matchLogToStep(text, task.plan.steps);
            if (match.matched) {
              logEntry.stepIndex = match.stepIndex;
              logEntry.matchConfidence = match.confidence;
            }
          }

          planLogBuffer.append(sessionKey, logEntry);
        }
      }
    });
  }

  // Hook: start watching plan file when task is spawned
  api.registerHook('after_rpc', async (event) => {
    if (event.method !== 'goals.spawnTaskSession') return;
    if (!event.success || !event.result) return;

    const { sessionKey, goalId, taskId, planFilePath } = event.result;
    if (!sessionKey || !planFilePath) return;

    // Start watching the expected plan file path
    watchPlanFile(sessionKey, planFilePath);
  });

  // Tool: goal_update for agents to report task status
  const goalUpdateExecute = createGoalUpdateExecutor(store);

  api.registerTool(
    (ctx) => {
      if (!ctx.sessionKey) return null;

      // Always expose the tool for any session with a key.  The executor validates
      // that the session is actually assigned to a goal at call time, which avoids
      // timing issues between goals.addSession and tool-factory evaluation.
      return {
        name: 'goal_update',
        label: 'Update Goal/Task Status',
        description: 'Update your assigned goal: report task progress, create tasks, set next task, or mark the goal done. For condo sessions, specify goalId.',
        parameters: {
          type: 'object',
          properties: {
            goalId: { type: 'string', description: 'ID of the goal to update (required for condo sessions, optional for single-goal sessions)' },
            taskId: { type: 'string', description: 'ID of the task to update (from goal context, shown in brackets like [task_abc])' },
            status: { type: 'string', enum: ['done', 'in-progress', 'blocked', 'waiting'], description: 'New task status (use with taskId)' },
            summary: { type: 'string', description: 'Brief summary of what was accomplished or what is blocking' },
            addTasks: {
              type: 'array',
              description: 'Create new tasks on the goal',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string', description: 'Task description' },
                  description: { type: 'string', description: 'Detailed task description' },
                },
                required: ['text'],
              },
            },
            nextTask: { type: 'string', description: 'What you are working on next (shown in dashboard)' },
            goalStatus: { type: 'string', enum: ['active', 'done'], description: 'Mark overall goal as done (only if all tasks are complete) or re-activate' },
            notes: { type: 'string', description: 'Append notes to the goal' },
            files: {
              type: 'array',
              description: 'Files created or modified while working on this goal/task. Paths (strings).',
              items: { type: 'string' },
            },
            planFile: { type: 'string', description: 'Path to a plan markdown file to sync with the task (requires taskId)' },
            planStatus: { type: 'string', enum: ['none', 'draft', 'awaiting_approval', 'approved', 'rejected', 'executing', 'completed'], description: 'Update the plan status for the task (requires taskId)' },
          },
        },
        async execute(toolCallId, params) {
          return goalUpdateExecute(toolCallId, { ...params, sessionKey: ctx.sessionKey });
        },
      };
    },
    { names: ['goal_update'] }
  );

  // Tool: condo_bind for agents to bind their session to a condo
  const condoBindExecute = createCondoBindExecutor(store, wsOps);

  api.registerTool(
    (ctx) => {
      if (!ctx.sessionKey) return null;
      const data = store.load();
      // Only offer if NOT already bound to a condo AND condos exist (or allow creation)
      if (data.sessionCondoIndex[ctx.sessionKey]) return null;

      return {
        name: 'condo_bind',
        label: 'Bind Session to Condo',
        description: 'Bind this session to a condo (project). Provide condoId to bind to an existing condo, or name to create a new one.',
        parameters: {
          type: 'object',
          properties: {
            condoId: { type: 'string', description: 'ID of an existing condo to bind to' },
            name: { type: 'string', description: 'Name for a new condo to create and bind to' },
            description: { type: 'string', description: 'Description for the new condo (only used with name)' },
          },
        },
        async execute(toolCallId, params) {
          return condoBindExecute(toolCallId, { ...params, sessionKey: ctx.sessionKey });
        },
      };
    },
    { names: ['condo_bind'] }
  );

  // Tool: condo_create_goal for agents to create goals in their bound condo
  const condoCreateGoalExecute = createCondoCreateGoalExecutor(store, wsOps);

  api.registerTool(
    (ctx) => {
      if (!ctx.sessionKey) return null;
      const data = store.load();
      if (!data.sessionCondoIndex[ctx.sessionKey]) return null;

      return {
        name: 'condo_create_goal',
        label: 'Create Goal in Condo',
        description: 'Create a new goal in the bound condo, optionally with initial tasks.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Goal title' },
            description: { type: 'string', description: 'Goal description' },
            priority: { type: 'string', description: 'Priority (e.g. P0, P1, P2)' },
            tasks: {
              type: 'array',
              description: 'Initial tasks (strings or {text, description, priority} objects)',
              items: {
                oneOf: [
                  { type: 'string' },
                  { type: 'object', properties: { text: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string' } } },
                ],
              },
            },
          },
          required: ['title'],
        },
        async execute(toolCallId, params) {
          return condoCreateGoalExecute(toolCallId, { ...params, sessionKey: ctx.sessionKey });
        },
      };
    },
    { names: ['condo_create_goal'] }
  );

  // Tool: condo_add_task for agents to add tasks to goals in their bound condo
  const condoAddTaskExecute = createCondoAddTaskExecutor(store);

  api.registerTool(
    (ctx) => {
      if (!ctx.sessionKey) return null;
      const data = store.load();
      if (!data.sessionCondoIndex[ctx.sessionKey]) return null;

      return {
        name: 'condo_add_task',
        label: 'Add Task to Goal',
        description: 'Add a task to a goal in the bound condo.',
        parameters: {
          type: 'object',
          properties: {
            goalId: { type: 'string', description: 'ID of the goal to add the task to' },
            text: { type: 'string', description: 'Task description' },
            description: { type: 'string', description: 'Detailed task description' },
            priority: { type: 'string', description: 'Priority (e.g. P0, P1, P2)' },
          },
          required: ['goalId', 'text'],
        },
        async execute(toolCallId, params) {
          return condoAddTaskExecute(toolCallId, { ...params, sessionKey: ctx.sessionKey });
        },
      };
    },
    { names: ['condo_add_task'] }
  );

  // Tool: condo_spawn_task for agents to spawn subagent sessions for tasks
  const condoSpawnTaskExecute = createCondoSpawnTaskExecutor(store);

  api.registerTool(
    (ctx) => {
      if (!ctx.sessionKey) return null;
      const data = store.load();
      if (!data.sessionCondoIndex[ctx.sessionKey]) return null;

      return {
        name: 'condo_spawn_task',
        label: 'Spawn Task Subagent',
        description: 'Spawn a subagent session to work on a specific task in the bound condo.',
        parameters: {
          type: 'object',
          properties: {
            goalId: { type: 'string', description: 'ID of the goal containing the task' },
            taskId: { type: 'string', description: 'ID of the task to assign to the subagent' },
            agentId: { type: 'string', description: 'Agent ID (default: main)' },
            model: { type: 'string', description: 'Model to use for the subagent' },
          },
          required: ['goalId', 'taskId'],
        },
        async execute(toolCallId, params) {
          return condoSpawnTaskExecute(toolCallId, { ...params, sessionKey: ctx.sessionKey });
        },
      };
    },
    { names: ['condo_spawn_task'] }
  );

  const totalMethods = Object.keys(handlers).length + Object.keys(condoHandlers).length + Object.keys(planHandlers).length + Object.keys(pmHandlers).length + Object.keys(configHandlers).length + Object.keys(teamHandlers).length + Object.keys(rolesHandlers).length + Object.keys(notificationHandlers).length + Object.keys(autonomyHandlers).length + 2 + 3; // +2 spawnTaskSession/kickoff, +3 classification RPC methods
  api.logger.info(`clawcondos-goals: registered ${totalMethods} gateway methods, 5 tools, ${planFileWatchers.size} plan file watchers, data at ${dataDir}`);
}
