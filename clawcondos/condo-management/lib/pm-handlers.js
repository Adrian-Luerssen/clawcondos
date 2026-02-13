/**
 * PM (Project Manager) Mode Handlers
 * Routes messages to the configured PM agent session
 */

import { getPmSession, getAgentForRole, getDefaultRoles, getOrCreatePmSessionForGoal, getOrCreatePmSessionForCondo } from './agent-roles.js';
import { getPmSkillContext, getCondoPmSkillContext } from './skill-injector.js';
import { parseTasksFromPlan, detectPlan, parseGoalsFromPlan, detectCondoPlan } from './plan-parser.js';

/** Default max history entries per goal */
const DEFAULT_HISTORY_LIMIT = 100;

/**
 * Set sequential dependencies on an array of tasks.
 * Each task (after the first) depends on the previous task.
 * @param {Array} tasks - Array of task objects with `id` property
 */
function setSequentialDependencies(tasks) {
  for (let i = 1; i < tasks.length; i++) {
    tasks[i].dependsOn = [tasks[i - 1].id];
  }
}

/**
 * Get or initialize PM chat history for a goal
 * @param {object} goal - Goal object
 * @returns {Array} Chat history array
 */
function getGoalPmHistory(goal) {
  if (!Array.isArray(goal.pmChatHistory)) {
    goal.pmChatHistory = [];
  }
  return goal.pmChatHistory;
}

/**
 * Add a message to PM chat history for a goal
 * @param {object} goal - Goal object
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - Message content
 * @param {number} [maxHistory] - Max entries to keep
 */
function addToHistory(goal, role, content, maxHistory = DEFAULT_HISTORY_LIMIT) {
  const history = getGoalPmHistory(goal);
  history.push({
    role,
    content,
    timestamp: Date.now(),
  });
  // Trim old entries if over limit
  while (history.length > maxHistory) {
    history.shift();
  }
}

/**
 * Create PM RPC handlers
 * @param {object} store - Goals store instance
 * @param {object} options - Options
 * @param {function} options.sendToSession - Function to send message to a session and get response
 * @param {function} [options.logger] - Logger instance
 * @returns {object} Map of method names to handlers
 */
export function createPmHandlers(store, options = {}) {
  const { sendToSession, logger, wsOps } = options;
  const handlers = {};

  /**
   * pm.chat - Send a message to the PM agent session and get response
   * Params: { condoId: string, goalId: string, message: string, pmSession?: string }
   * Response: { response: string, pmSession: string, history: Array }
   */
  handlers['pm.chat'] = async ({ params, respond }) => {
    const { condoId, goalId, message, pmSession: overrideSession } = params || {};

    if (logger) {
      logger.debug(`pm.chat called with: condoId=${condoId}, goalId=${goalId}, messageLen=${message?.length || 0}`);
    }

    if (!condoId) {
      if (logger) logger.warn('pm.chat: missing condoId');
      return respond(false, null, 'condoId is required');
    }

    if (!goalId) {
      if (logger) logger.warn('pm.chat: missing goalId');
      return respond(false, null, 'goalId is required');
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      if (logger) logger.warn('pm.chat: missing or empty message');
      return respond(false, null, 'message is required');
    }

    try {
      const data = store.load();
      const condo = data.condos.find(c => c.id === condoId);

      if (!condo) {
        return respond(false, null, `Condo ${condoId} not found`);
      }

      const goal = data.goals.find(g => g.id === goalId);

      if (!goal) {
        return respond(false, null, `Goal ${goalId} not found`);
      }

      if (goal.condoId !== condoId) {
        return respond(false, null, `Goal ${goalId} does not belong to condo ${condoId}`);
      }

      // Save user message to history
      const userMessage = message.trim();
      addToHistory(goal, 'user', userMessage);
      store.save(data);

      // Resolve PM session — use per-goal dedicated session
      const { pmSessionKey: goalPmSession } = getOrCreatePmSessionForGoal(store, goalId);
      const targetSession = overrideSession || goalPmSession;

      // Build context-enriched message with SKILL-PM.md + condo/goal info
      const goals = data.goals.filter(g => g.condoId === condoId);
      const activeGoals = goals.filter(g => !g.completed);
      const allTasks = goals.flatMap(g => g.tasks || []);
      const pendingTasks = allTasks.filter(t => t.status !== 'done');

      // Dynamically gather available agent roles from config + defaults
      const configuredRoles = data.config?.agentRoles || {};
      const roleDescriptions = data.config?.roles || {};
      const defaultRoles = getDefaultRoles();
      const allRoleNames = new Set([...Object.keys(defaultRoles), ...Object.keys(configuredRoles), ...Object.keys(roleDescriptions)]);
      const availableRoles = {};
      for (const role of allRoleNames) {
        // Skip 'pm' role — PM doesn't assign tasks to itself
        if (role === 'pm') continue;
        const agentId = configuredRoles[role] || defaultRoles[role] || role;
        const description = roleDescriptions[role]?.description || null;
        availableRoles[role] = { agentId, ...(description ? { description } : {}) };
      }

      const pmSkillContext = getPmSkillContext({
        condoId,
        condoName: condo.name,
        activeGoals: activeGoals.length,
        totalTasks: allTasks.length,
        pendingTasks: pendingTasks.length,
        roles: availableRoles,
      });

      const contextPrefix = [
        pmSkillContext || null,
        '',
        `[PM Mode Context]`,
        `Condo: ${condo.name}`,
        `Goal: ${goal.title}`,
        `Active Goals: ${activeGoals.length}`,
        '',
        'User Message:',
      ].filter(line => line != null).join('\n');

      const enrichedMessage = `${contextPrefix}\n${userMessage}`;

      if (logger) {
        logger.info(`pm.chat: prepared message for ${targetSession}, goal "${goal.title}" in condo "${condo.name}"`);
      }

      // Return the enriched message and PM session for the frontend to send via chat.send.
      // The frontend handles streaming and calls pm.saveResponse when the agent replies.
      const history = getGoalPmHistory(goal).slice(-20);

      respond(true, {
        enrichedMessage,
        pmSession: targetSession,
        history,
        goalId,
      });
    } catch (err) {
      if (logger) {
        logger.error(`pm.chat error: ${err.message}`);
      }
      respond(false, null, err.message);
    }
  };

  /**
   * pm.getConfig - Get PM configuration for a condo
   * Params: { condoId: string }
   * Response: { pmSession: string, ... }
   */
  handlers['pm.getConfig'] = ({ params, respond }) => {
    const { condoId } = params || {};

    if (!condoId) {
      return respond(false, null, 'condoId is required');
    }

    try {
      const data = store.load();
      const condo = data.condos.find(c => c.id === condoId);

      if (!condo) {
        return respond(false, null, `Condo ${condoId} not found`);
      }

      // Get resolved PM session (includes fallback chain)
      const resolvedPmSession = getPmSession(store, condoId);

      respond(true, {
        pmSession: condo.pmSession || null,  // Condo-specific setting (may be null)
        resolvedPmSession,                    // Actually resolved session (with fallbacks)
        condoId,
        condoName: condo.name,
        globalPmSession: data.config?.pmSession || null,
      });
    } catch (err) {
      respond(false, null, err.message);
    }
  };

  /**
   * pm.setConfig - Set PM configuration for a condo
   * Params: { condoId: string, pmSession?: string }
   * Response: { ok: boolean }
   */
  handlers['pm.setConfig'] = ({ params, respond }) => {
    const { condoId, pmSession } = params || {};

    if (!condoId) {
      return respond(false, null, 'condoId is required');
    }

    try {
      const data = store.load();
      const condo = data.condos.find(c => c.id === condoId);

      if (!condo) {
        return respond(false, null, `Condo ${condoId} not found`);
      }

      if (pmSession !== undefined) {
        // Allow null to clear condo-specific setting (fall back to global)
        condo.pmSession = pmSession || null;
      }
      condo.updatedAtMs = Date.now();

      store.save(data);

      // Return resolved session (with fallback chain)
      const resolvedPmSession = getPmSession(store, condoId);

      respond(true, { 
        ok: true, 
        pmSession: condo.pmSession,
        resolvedPmSession,
      });
    } catch (err) {
      respond(false, null, err.message);
    }
  };

  /**
   * pm.getAgent - Get the PM agent ID for a condo
   * Params: { condoId?: string }
   * Response: { agentId: string, sessionKey: string }
   */
  handlers['pm.getAgent'] = ({ params, respond }) => {
    const { condoId } = params || {};

    try {
      const pmSession = getPmSession(store, condoId);
      
      // Extract agent ID from session key (format: agent:AGENT_ID:SESSION_TYPE)
      const match = pmSession.match(/^agent:([^:]+):/);
      const agentId = match ? match[1] : 'main';

      respond(true, {
        agentId,
        sessionKey: pmSession,
        role: 'pm',
      });
    } catch (err) {
      respond(false, null, err.message);
    }
  };

  /**
   * pm.getHistory - Get PM chat history for a goal
   * Params: { goalId: string, limit?: number }
   * Response: { messages: Array, pmSession: string }
   */
  handlers['pm.getHistory'] = ({ params, respond }) => {
    const { goalId, limit = 50 } = params || {};

    if (!goalId) {
      return respond(false, null, 'goalId is required');
    }

    try {
      const data = store.load();
      const goal = data.goals.find(g => g.id === goalId);

      if (!goal) {
        return respond(false, null, `Goal ${goalId} not found`);
      }

      const condo = data.condos.find(c => c.id === goal.condoId);
      const history = getGoalPmHistory(goal);
      const messages = history.slice(-Math.min(limit, DEFAULT_HISTORY_LIMIT));
      const pmSession = goal.pmSessionKey || getPmSession(store, goal.condoId);

      respond(true, {
        messages,
        pmSession,
        goalId,
        goalTitle: goal.title,
        condoId: goal.condoId,
        condoName: condo?.name,
        total: history.length,
      });
    } catch (err) {
      respond(false, null, err.message);
    }
  };

  /**
   * pm.clearHistory - Clear PM chat history for a goal
   * Params: { goalId: string }
   * Response: { ok: boolean, cleared: number }
   */
  handlers['pm.clearHistory'] = ({ params, respond }) => {
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

      const previousCount = (goal.pmChatHistory || []).length;
      goal.pmChatHistory = [];
      goal.updatedAtMs = Date.now();
      store.save(data);

      if (logger) {
        logger.info(`pm.clearHistory: cleared ${previousCount} messages for goal ${goal.title}`);
      }

      respond(true, {
        ok: true,
        cleared: previousCount,
        goalId,
      });
    } catch (err) {
      respond(false, null, err.message);
    }
  };

  /**
   * pm.saveResponse - Save a PM assistant response to goal history
   * Called by the frontend after receiving the streamed response from chat.send
   * Params: { goalId: string, content: string }
   * Response: { ok: boolean, hasPlan: boolean }
   */
  handlers['pm.saveResponse'] = ({ params, respond }) => {
    const { goalId, content } = params || {};

    if (!goalId) {
      return respond(false, null, 'goalId is required');
    }

    if (!content || typeof content !== 'string') {
      return respond(false, null, 'content is required');
    }

    try {
      const data = store.load();
      const goal = data.goals.find(g => g.id === goalId);

      if (!goal) {
        return respond(false, null, `Goal ${goalId} not found`);
      }

      addToHistory(goal, 'assistant', content.trim());
      goal.updatedAtMs = Date.now();
      store.save(data);

      const hasPlan = detectPlan(content);

      if (logger) {
        logger.info(`pm.saveResponse: saved response for goal ${goal.title} (hasPlan: ${hasPlan})`);
      }

      respond(true, {
        ok: true,
        hasPlan,
        goalId,
      });
    } catch (err) {
      respond(false, null, err.message);
    }
  };

  /**
   * pm.createTasksFromPlan - Parse a plan and create tasks on a goal
   * Params: { goalId: string, planContent?: string }
   * - If planContent is not provided, uses goal.plan.content
   * - Parses the plan markdown to extract tasks
   * - Creates tasks in the goal with agent assignments
   * Response: { ok: true, tasksCreated: number, tasks: [...] }
   */
  handlers['pm.createTasksFromPlan'] = ({ params, respond }) => {
    const { goalId, planContent } = params || {};

    if (!goalId) {
      return respond(false, null, 'goalId is required');
    }

    try {
      const data = store.load();
      const goal = data.goals.find(g => g.id === goalId);

      if (!goal) {
        return respond(false, null, `Goal ${goalId} not found`);
      }

      // Determine content to parse
      let contentToParse = planContent;
      
      if (!contentToParse) {
        // Try goal.plan.content first
        if (goal.plan?.content) {
          contentToParse = goal.plan.content;
        } else {
          // Try last PM chat message (assistant response) from goal's history
          if (goal.pmChatHistory?.length) {
            // Find last assistant message
            for (let i = goal.pmChatHistory.length - 1; i >= 0; i--) {
              if (goal.pmChatHistory[i].role === 'assistant') {
                contentToParse = goal.pmChatHistory[i].content;
                break;
              }
            }
          }
        }
      }

      if (!contentToParse) {
        return respond(false, null, 'No plan content provided and no plan found on goal or in PM chat history');
      }

      // Parse tasks from the plan
      const { tasks: parsedTasks, hasPlan } = parseTasksFromPlan(contentToParse);

      if (!hasPlan && parsedTasks.length === 0) {
        return respond(false, null, 'No plan or tasks detected in content');
      }

      if (parsedTasks.length === 0) {
        return respond(false, null, 'Plan detected but could not extract any tasks');
      }

      // Create tasks on the goal
      const now = Date.now();
      const createdTasks = [];

      for (const taskData of parsedTasks) {
        const task = {
          id: store.newId('task'),
          text: taskData.text,
          description: taskData.description || '',
          status: 'pending',
          done: false,
          priority: null,
          sessionKey: null,
          assignedAgent: taskData.agent || null,
          model: null,
          dependsOn: [],
          summary: '',
          estimatedTime: taskData.time || null,
          createdAtMs: now,
          updatedAtMs: now,
        };

        goal.tasks.push(task);
        createdTasks.push(task);
      }

      // Set sequential dependencies so tasks run in order
      setSequentialDependencies(createdTasks);

      goal.updatedAtMs = now;

      // Store the full plan content so spawned workers can reference it
      goal.pmPlanContent = contentToParse;

      // Update goal plan status to approved if it was awaiting approval
      if (goal.plan?.status === 'awaiting_approval' || goal.plan?.status === 'draft') {
        goal.plan.status = 'approved';
        goal.plan.approvedAtMs = now;
        goal.plan.updatedAtMs = now;
      }

      store.save(data);

      if (logger) {
        logger.info(`pm.createTasksFromPlan: created ${createdTasks.length} tasks for goal ${goalId}`);
      }

      respond(true, {
        ok: true,
        tasksCreated: createdTasks.length,
        tasks: createdTasks,
        goalId,
      });
    } catch (err) {
      if (logger) {
        logger.error(`pm.createTasksFromPlan error: ${err.message}`);
      }
      respond(false, null, err.message);
    }
  };

  /**
   * pm.regenerateTasks - Delete all existing tasks and re-create from plan
   * Params: { goalId: string, planContent?: string }
   * - Removes ALL existing tasks and replaces with freshly parsed ones
   * - Re-parses the plan (or latest PM assistant message) to create fresh tasks
   * Response: { ok: true, removed: number, tasksCreated: number, tasks: [...] }
   */
  handlers['pm.regenerateTasks'] = ({ params, respond }) => {
    const { goalId, planContent } = params || {};

    if (!goalId) {
      return respond(false, null, 'goalId is required');
    }

    try {
      const data = store.load();
      const goal = data.goals.find(g => g.id === goalId);

      if (!goal) {
        return respond(false, null, `Goal ${goalId} not found`);
      }

      // Remove ALL existing tasks
      const existingTasks = goal.tasks || [];
      for (const task of existingTasks) {
        if (task.sessionKey && data.sessionIndex?.[task.sessionKey]) {
          delete data.sessionIndex[task.sessionKey];
        }
      }
      const removedCount = existingTasks.length;
      goal.tasks = [];

      // Determine content to parse (same logic as createTasksFromPlan)
      let contentToParse = planContent;

      if (!contentToParse) {
        if (goal.plan?.content) {
          contentToParse = goal.plan.content;
        } else if (goal.pmChatHistory?.length) {
          for (let i = goal.pmChatHistory.length - 1; i >= 0; i--) {
            if (goal.pmChatHistory[i].role === 'assistant') {
              contentToParse = goal.pmChatHistory[i].content;
              break;
            }
          }
        }
      }

      if (!contentToParse) {
        store.save(data);
        return respond(false, null, 'No plan content found to regenerate tasks from');
      }

      // Parse and create new tasks
      const { tasks: parsedTasks, hasPlan } = parseTasksFromPlan(contentToParse);

      if (parsedTasks.length === 0) {
        store.save(data);
        return respond(false, null, 'Could not extract tasks from plan');
      }

      const now = Date.now();
      const createdTasks = [];

      for (const taskData of parsedTasks) {
        const task = {
          id: store.newId('task'),
          text: taskData.text,
          description: taskData.description || '',
          status: 'pending',
          done: false,
          priority: null,
          sessionKey: null,
          assignedAgent: taskData.agent || null,
          model: null,
          dependsOn: [],
          summary: '',
          estimatedTime: taskData.time || null,
          createdAtMs: now,
          updatedAtMs: now,
        };

        goal.tasks.push(task);
        createdTasks.push(task);
      }

      // Set sequential dependencies so tasks run in order
      setSequentialDependencies(createdTasks);

      goal.updatedAtMs = now;
      goal.pmPlanContent = contentToParse;
      store.save(data);

      if (logger) {
        logger.info(`pm.regenerateTasks: removed ${removedCount}, created ${createdTasks.length} tasks for goal ${goalId}`);
      }

      respond(true, {
        ok: true,
        removed: removedCount,
        tasksCreated: createdTasks.length,
        tasks: createdTasks,
        goalId,
      });
    } catch (err) {
      if (logger) {
        logger.error(`pm.regenerateTasks error: ${err.message}`);
      }
      respond(false, null, err.message);
    }
  };

  /**
   * pm.detectPlan - Check if content contains a plan (utility method)
   * Params: { content: string }
   * Response: { hasPlan: boolean, taskCount: number }
   */
  handlers['pm.detectPlan'] = ({ params, respond }) => {
    const { content } = params || {};

    if (!content || typeof content !== 'string') {
      return respond(false, null, 'content is required');
    }

    try {
      const hasPlan = detectPlan(content);
      const { tasks } = parseTasksFromPlan(content);

      respond(true, {
        hasPlan,
        taskCount: tasks.length,
        tasks: tasks.map(t => ({ text: t.text, agent: t.agent })), // Preview only
      });
    } catch (err) {
      respond(false, null, err.message);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // CONDO-LEVEL PM HANDLERS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get or initialize PM chat history for a condo
   */
  function getCondoPmHistory(condo) {
    if (!Array.isArray(condo.pmChatHistory)) {
      condo.pmChatHistory = [];
    }
    return condo.pmChatHistory;
  }

  /**
   * Add a message to condo PM chat history
   */
  function addToCondoHistory(condo, role, content, maxHistory = DEFAULT_HISTORY_LIMIT) {
    const history = getCondoPmHistory(condo);
    history.push({
      role,
      content,
      timestamp: Date.now(),
    });
    while (history.length > maxHistory) {
      history.shift();
    }
  }

  /**
   * pm.condoChat - Send a message to the condo-level PM
   * Params: { condoId: string, message: string }
   * Response: { enrichedMessage, pmSession, history, condoId }
   */
  handlers['pm.condoChat'] = async ({ params, respond }) => {
    const { condoId, message } = params || {};

    if (!condoId) {
      return respond(false, null, 'condoId is required');
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      return respond(false, null, 'message is required');
    }

    try {
      const data = store.load();
      const condo = data.condos.find(c => c.id === condoId);

      if (!condo) {
        return respond(false, null, `Condo ${condoId} not found`);
      }

      // Save user message to condo history
      const userMessage = message.trim();
      addToCondoHistory(condo, 'user', userMessage);
      store.save(data);

      // Get/create condo PM session (registers in sessionCondoIndex)
      const { pmSessionKey } = getOrCreatePmSessionForCondo(store, condoId);

      // Build context-enriched message with condo PM skill context
      const goals = data.goals.filter(g => g.condoId === condoId);
      const activeGoals = goals.filter(g => !g.completed && g.status !== 'done');

      // Gather roles
      const configuredRoles = data.config?.agentRoles || {};
      const roleDescriptions = data.config?.roles || {};
      const defaultRoles = getDefaultRoles();
      const allRoleNames = new Set([...Object.keys(defaultRoles), ...Object.keys(configuredRoles), ...Object.keys(roleDescriptions)]);
      const availableRoles = {};
      for (const role of allRoleNames) {
        if (role === 'pm') continue;
        const agentId = configuredRoles[role] || defaultRoles[role] || role;
        const description = roleDescriptions[role]?.description || null;
        availableRoles[role] = { agentId, ...(description ? { description } : {}) };
      }

      const existingGoalSummaries = goals.map(g => ({
        title: g.title,
        status: g.status || (g.completed ? 'done' : 'active'),
        taskCount: (g.tasks || []).length,
      }));

      const condoPmSkillContext = getCondoPmSkillContext({
        condoId,
        condoName: condo.name,
        goalCount: goals.length,
        existingGoals: existingGoalSummaries,
        roles: availableRoles,
      });

      const contextPrefix = [
        `[SESSION IDENTITY] You are the PM for condo "${condo.name}" (ID: ${condoId}). This is an ISOLATED session — do NOT reference context, goals, or conversations from any other condo or project.`,
        '',
        condoPmSkillContext || null,
        '',
        `[Condo PM Context]`,
        `Condo: ${condo.name} (${condoId})`,
        `Active Goals: ${activeGoals.length}`,
        `Total Goals: ${goals.length}`,
        '',
        'User Message:',
      ].filter(line => line != null).join('\n');

      const enrichedMessage = `${contextPrefix}\n${userMessage}`;

      if (logger) {
        logger.info(`pm.condoChat: prepared message for ${pmSessionKey}, condo "${condo.name}"`);
      }

      const history = getCondoPmHistory(condo).slice(-20);

      respond(true, {
        enrichedMessage,
        pmSession: pmSessionKey,
        history,
        condoId,
      });
    } catch (err) {
      if (logger) {
        logger.error(`pm.condoChat error: ${err.message}`);
      }
      respond(false, null, err.message);
    }
  };

  /**
   * pm.condoSaveResponse - Save a condo PM assistant response to history
   * Params: { condoId: string, content: string }
   * Response: { ok, hasPlan, condoId }
   */
  handlers['pm.condoSaveResponse'] = ({ params, respond }) => {
    const { condoId, content } = params || {};

    if (!condoId) {
      return respond(false, null, 'condoId is required');
    }

    if (!content || typeof content !== 'string') {
      return respond(false, null, 'content is required');
    }

    try {
      const data = store.load();
      const condo = data.condos.find(c => c.id === condoId);

      if (!condo) {
        return respond(false, null, `Condo ${condoId} not found`);
      }

      addToCondoHistory(condo, 'assistant', content.trim());
      condo.updatedAtMs = Date.now();
      store.save(data);

      const hasPlan = detectCondoPlan(content);

      if (logger) {
        logger.info(`pm.condoSaveResponse: saved response for condo "${condo.name}" (hasPlan: ${hasPlan})`);
      }

      respond(true, {
        ok: true,
        hasPlan,
        condoId,
      });
    } catch (err) {
      respond(false, null, err.message);
    }
  };

  /**
   * pm.condoGetHistory - Get condo PM chat history
   * Params: { condoId: string, limit?: number }
   * Response: { messages, condoId, condoName, total }
   */
  handlers['pm.condoGetHistory'] = ({ params, respond }) => {
    const { condoId, limit = 50 } = params || {};

    if (!condoId) {
      return respond(false, null, 'condoId is required');
    }

    try {
      const data = store.load();
      const condo = data.condos.find(c => c.id === condoId);

      if (!condo) {
        return respond(false, null, `Condo ${condoId} not found`);
      }

      const history = getCondoPmHistory(condo);
      const messages = history.slice(-Math.min(limit, DEFAULT_HISTORY_LIMIT));

      respond(true, {
        messages,
        condoId,
        condoName: condo.name,
        total: history.length,
      });
    } catch (err) {
      respond(false, null, err.message);
    }
  };

  /**
   * pm.condoCreateGoals - Create goals from a condo PM plan
   * Params: { condoId: string, planContent?: string }
   * If no planContent, uses last assistant message from condo's pmChatHistory
   * Response: { ok, goalsCreated, goals: [{id, title, taskCount}], condoId }
   */
  handlers['pm.condoCreateGoals'] = ({ params, respond }) => {
    const { condoId, planContent } = params || {};

    if (!condoId) {
      return respond(false, null, 'condoId is required');
    }

    try {
      const data = store.load();
      const condo = data.condos.find(c => c.id === condoId);

      if (!condo) {
        return respond(false, null, `Condo ${condoId} not found`);
      }

      // Determine content to parse
      let contentToParse = planContent;

      if (!contentToParse) {
        // Try last assistant message from condo PM history
        const history = getCondoPmHistory(condo);
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].role === 'assistant') {
            contentToParse = history[i].content;
            break;
          }
        }
      }

      if (!contentToParse) {
        return respond(false, null, 'No plan content provided and no PM response found in condo history');
      }

      // Parse goals from the plan
      const { goals: parsedGoals, hasPlan } = parseGoalsFromPlan(contentToParse);

      if (!hasPlan && parsedGoals.length === 0) {
        return respond(false, null, 'No plan or goals detected in content');
      }

      if (parsedGoals.length === 0) {
        return respond(false, null, 'Plan detected but could not extract any goals');
      }

      // Create goal objects
      const now = Date.now();
      const createdGoals = [];

      if (!data.goals) data.goals = [];

      for (const goalData of parsedGoals) {
        const goalId = store.newId('goal');
        const tasks = (goalData.tasks || []).map(t => ({
          id: store.newId('task'),
          text: t.text,
          description: t.description || '',
          status: 'pending',
          done: false,
          priority: null,
          sessionKey: null,
          assignedAgent: t.agent || null,
          model: null,
          dependsOn: [],
          summary: '',
          estimatedTime: t.time || null,
          createdAtMs: now,
          updatedAtMs: now,
        }));

        // Set sequential dependencies so tasks run in order
        setSequentialDependencies(tasks);

        const goal = {
          id: goalId,
          title: goalData.title,
          description: goalData.description || '',
          condoId,
          status: 'active',
          completed: false,
          priority: goalData.priority || null,
          autonomyMode: condo.autonomyMode || null,
          worktree: null,
          tasks,
          sessions: [],
          files: [],
          createdAtMs: now,
          updatedAtMs: now,
        };

        // Store PM plan content on goal so spawned workers can reference it
        goal.pmPlanContent = contentToParse;

        // Create worktree if condo has a workspace
        if (wsOps && condo.workspace?.path) {
          const wtResult = wsOps.createGoalWorktree(condo.workspace.path, goalId);
          if (wtResult.ok) {
            goal.worktree = { path: wtResult.path, branch: wtResult.branch, createdAtMs: now };
          } else if (logger) {
            logger.error(`pm.condoCreateGoals: worktree creation failed for goal ${goalId}: ${wtResult.error}`);
          }
        }

        data.goals.push(goal);
        createdGoals.push({
          id: goalId,
          title: goalData.title,
          taskCount: tasks.length,
        });
      }

      // Store plan content on condo for reference
      condo.pmPlanContent = contentToParse;
      condo.updatedAtMs = now;
      store.save(data);

      if (logger) {
        logger.info(`pm.condoCreateGoals: created ${createdGoals.length} goals for condo "${condo.name}"`);
      }

      respond(true, {
        ok: true,
        goalsCreated: createdGoals.length,
        goals: createdGoals,
        condoId,
      });
    } catch (err) {
      if (logger) {
        logger.error(`pm.condoCreateGoals error: ${err.message}`);
      }
      respond(false, null, err.message);
    }
  };

  /**
   * pm.condoCascade - Prepare goal-level PM sessions for cascade planning/execution
   * Params: { condoId: string, mode: 'plan' | 'full' }
   * - 'plan': Create goal PM sessions and return prompts for frontend to send
   * - 'full': Same as 'plan', plus marks goals for auto-kickoff after planning
   * Response: { goals: [{goalId, title, pmSessionKey, prompt}], mode }
   */
  handlers['pm.condoCascade'] = ({ params, respond }) => {
    const { condoId, mode } = params || {};

    if (!condoId) {
      return respond(false, null, 'condoId is required');
    }

    if (mode !== 'plan' && mode !== 'full') {
      return respond(false, null, 'mode must be "plan" or "full"');
    }

    try {
      const data = store.load();
      const condo = data.condos.find(c => c.id === condoId);

      if (!condo) {
        return respond(false, null, `Condo ${condoId} not found`);
      }

      // Find goals in this condo that need planning (no tasks yet)
      const goals = data.goals.filter(g => g.condoId === condoId && g.status !== 'done');
      const goalsNeedingPlanning = goals.filter(g => !g.tasks || g.tasks.length === 0);

      if (goalsNeedingPlanning.length === 0) {
        return respond(false, null, 'No goals need planning (all already have tasks)');
      }

      const cascadeGoals = [];

      for (const goal of goalsNeedingPlanning) {
        // Create a PM session for this goal
        const { pmSessionKey } = getOrCreatePmSessionForGoal(store, goal.id);

        // Build a prompt for the goal PM
        const prompt = `Plan tasks for this goal: "${goal.title}"` +
          (goal.description ? `\n\nDescription: ${goal.description}` : '') +
          `\n\nThis goal is part of the "${condo.name}" project. Break it into actionable tasks with agent assignments.`;

        cascadeGoals.push({
          goalId: goal.id,
          title: goal.title,
          pmSessionKey,
          prompt,
        });
      }

      // Store cascade mode on condo so frontend knows how to handle responses
      condo.cascadeMode = mode;
      condo.updatedAtMs = Date.now();
      store.save(data);

      if (logger) {
        logger.info(`pm.condoCascade: prepared ${cascadeGoals.length} goal PMs for condo "${condo.name}" (mode: ${mode})`);
      }

      respond(true, {
        goals: cascadeGoals,
        mode,
        condoId,
      });
    } catch (err) {
      if (logger) {
        logger.error(`pm.condoCascade error: ${err.message}`);
      }
      respond(false, null, err.message);
    }
  };

  return handlers;
}
