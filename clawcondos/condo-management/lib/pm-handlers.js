/**
 * PM (Project Manager) Mode Handlers
 * Routes messages to the configured PM agent session
 */

import { getPmSession, getAgentForRole } from './agent-roles.js';
import { getPmSkillContext } from './skill-injector.js';
import { parseTasksFromPlan, detectPlan } from './plan-parser.js';

/** Default max history entries per condo */
const DEFAULT_HISTORY_LIMIT = 100;

/**
 * Get or initialize PM chat history for a condo
 * @param {object} condo - Condo object
 * @returns {Array} Chat history array
 */
function getCondoPmHistory(condo) {
  if (!Array.isArray(condo.pmChatHistory)) {
    condo.pmChatHistory = [];
  }
  return condo.pmChatHistory;
}

/**
 * Add a message to PM chat history
 * @param {object} condo - Condo object
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - Message content
 * @param {number} [maxHistory] - Max entries to keep
 */
function addToHistory(condo, role, content, maxHistory = DEFAULT_HISTORY_LIMIT) {
  const history = getCondoPmHistory(condo);
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
  const { sendToSession, logger } = options;
  const handlers = {};

  /**
   * pm.chat - Send a message to the PM agent session and get response
   * Params: { condoId: string, message: string, pmSession?: string }
   * Response: { response: string, pmSession: string, history: Array }
   */
  handlers['pm.chat'] = async ({ params, respond }) => {
    const { condoId, message, pmSession: overrideSession } = params || {};

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

      // Save user message to history BEFORE sending
      const userMessage = message.trim();
      addToHistory(condo, 'user', userMessage);
      store.save(data);

      // Use override session, or resolve via configurable hierarchy
      const targetSession = overrideSession || getPmSession(store, condoId);

      if (!sendToSession) {
        return respond(false, null, 'sendToSession not available');
      }

      // Build context message with condo info
      const goals = data.goals.filter(g => g.condoId === condoId);
      const activeGoals = goals.filter(g => !g.completed);
      const allTasks = goals.flatMap(g => g.tasks || []);
      const pendingTasks = allTasks.filter(t => t.status !== 'done');
      
      // Get PM skill context
      const pmSkillContext = getPmSkillContext({
        condoId,
        condoName: condo.name,
        activeGoals: activeGoals.length,
        totalTasks: allTasks.length,
        pendingTasks: pendingTasks.length,
      });
      
      const contextPrefix = [
        pmSkillContext || null,
        '',
        `[PM Mode Context]`,
        `Condo: ${condo.name}`,
        `Active Goals: ${activeGoals.length}`,
        '',
        'User Message:',
      ].filter(line => line != null).join('\n');

      const fullMessage = `${contextPrefix}\n${userMessage}`;

      // Send to PM session and wait for response
      const response = await sendToSession(targetSession, {
        type: 'pm_chat',
        condoId,
        message: fullMessage,
        expectResponse: true,
      });

      const responseText = response?.text || response?.message || 'No response received';

      // Save assistant response to history
      const dataAfter = store.load();
      const condoAfter = dataAfter.condos.find(c => c.id === condoId);
      if (condoAfter) {
        addToHistory(condoAfter, 'assistant', responseText);
        store.save(dataAfter);
      }

      if (logger) {
        logger.info(`pm.chat: sent to ${targetSession} for condo ${condo.name}`);
      }

      // Detect if response contains a plan
      const hasPlan = detectPlan(responseText);

      // Return last N messages for UI
      const history = getCondoPmHistory(condoAfter || condo).slice(-20);

      respond(true, {
        response: responseText,
        pmSession: targetSession,
        history,
        hasPlan,
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
   * pm.getHistory - Get PM chat history for a condo
   * Params: { condoId: string, limit?: number }
   * Response: { messages: Array, pmSession: string }
   */
  handlers['pm.getHistory'] = ({ params, respond }) => {
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
      const pmSession = getPmSession(store, condoId);

      respond(true, {
        messages,
        pmSession,
        condoId,
        condoName: condo.name,
        total: history.length,
      });
    } catch (err) {
      respond(false, null, err.message);
    }
  };

  /**
   * pm.clearHistory - Clear PM chat history for a condo
   * Params: { condoId: string }
   * Response: { ok: boolean, cleared: number }
   */
  handlers['pm.clearHistory'] = ({ params, respond }) => {
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

      const previousCount = (condo.pmChatHistory || []).length;
      condo.pmChatHistory = [];
      condo.updatedAtMs = Date.now();
      store.save(data);

      if (logger) {
        logger.info(`pm.clearHistory: cleared ${previousCount} messages for condo ${condo.name}`);
      }

      respond(true, {
        ok: true,
        cleared: previousCount,
        condoId,
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
          // Try last PM chat message (assistant response)
          const condo = data.condos.find(c => c.id === goal.condoId);
          if (condo?.pmChatHistory?.length) {
            // Find last assistant message
            for (let i = condo.pmChatHistory.length - 1; i >= 0; i--) {
              if (condo.pmChatHistory[i].role === 'assistant') {
                contentToParse = condo.pmChatHistory[i].content;
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

      goal.updatedAtMs = now;

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

  return handlers;
}
