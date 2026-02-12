import { buildGoalContext, getProjectSummaryForGoal } from './context-builder.js';
import { createEmptyPlan } from './plan-manager.js';
import { resolveAutonomyMode, buildAutonomyDirective } from './autonomy.js';
import { join } from 'path';
import os from 'os';

/**
 * Build workspace path convention for a task's plan file
 * Convention: ~/.openclaw/workspace-<agentId>/plans/<goalId>/<taskId>/PLAN.md
 * @param {string} agentId - Agent ID
 * @param {string} goalId - Goal ID
 * @param {string} taskId - Task ID
 * @returns {string} Expected plan file path
 */
export function buildPlanFilePath(agentId, goalId, taskId) {
  const agent = agentId || 'main';
  const workspaceDir = join(os.homedir(), '.openclaw', `workspace-${agent}`);
  return join(workspaceDir, 'plans', goalId, taskId, 'PLAN.md');
}

export function createTaskSpawnHandler(store) {
  return function handler({ params, respond }) {
    try {
      const { goalId, taskId, agentId, model } = params;
      if (!goalId || !taskId) {
        respond(false, undefined, { message: 'goalId and taskId are required' });
        return;
      }

      const data = store.load();
      const goal = data.goals.find(g => g.id === goalId);
      if (!goal) {
        respond(false, undefined, { message: 'Goal not found' });
        return;
      }
      const task = (goal.tasks || []).find(t => t.id === taskId);
      if (!task) {
        respond(false, undefined, { message: 'Task not found in goal' });
        return;
      }

      // Guard against re-spawning already-assigned tasks
      if (task.sessionKey) {
        respond(false, undefined, { message: 'Task already has a session' });
        return;
      }

      // Generate a session key for the spawned subagent
      const suffix = store.newId('spawn').replace('spawn_', '');
      const agent = agentId || 'main';
      const sessionKey = `agent:${agent}:subagent:${suffix}`;

      // Initialize plan with workspace path convention
      const planFilePath = buildPlanFilePath(agent, goalId, taskId);
      if (!task.plan) {
        task.plan = createEmptyPlan();
      }
      task.plan.expectedFilePath = planFilePath;
      task.plan.updatedAtMs = Date.now();

      // Resolve autonomy mode
      let condo = null;
      if (goal.condoId) {
        condo = data.condos.find(c => c.id === goal.condoId);
      }
      const autonomyMode = resolveAutonomyMode(task, condo);
      const autonomyDirective = buildAutonomyDirective(autonomyMode);

      // Build spawned agent context: project summary (if in condo) + goal state + task assignment
      const goalContext = buildGoalContext(goal, { currentSessionKey: sessionKey });
      const ps = getProjectSummaryForGoal(goal, data);
      const projectPrefix = ps ? ps + '\n\n' : '';
      const taskContext = [
        projectPrefix + goalContext,
        '',
        '---',
        `## Your Assignment: ${task.text}`,
        task.description ? `\n${task.description}` : null,
        '',
        autonomyDirective,
        '',
        `**Plan File:** If you need to create a plan, write it to: \`${planFilePath}\``,
        'Use \`goal_update\` with \`planStatus="awaiting_approval"\` when your plan is ready for review.',
        '',
        'When you complete this task, use the goal_update tool to mark it done.',
      ].filter(line => line != null).join('\n');

      // Link session to goal and update task
      task.sessionKey = sessionKey;
      task.status = 'in-progress';
      task.autonomyMode = autonomyMode;
      task.updatedAtMs = Date.now();
      goal.sessions.push(sessionKey);
      goal.updatedAtMs = Date.now();
      data.sessionIndex[sessionKey] = { goalId };
      store.save(data);

      respond(true, {
        sessionKey,
        taskContext,
        agentId: agent,
        model: model || null,
        goalId,
        taskId,
        autonomyMode,
        planFilePath,
      });
    } catch (err) {
      respond(false, undefined, { message: String(err) });
    }
  };
}
