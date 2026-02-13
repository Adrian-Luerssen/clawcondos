import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import register from '../clawcondos/condo-management/index.js';

const TEST_DIR = join(import.meta.dirname, '__fixtures__', 'lifecycle-test');
const WORKSPACES_DIR = join(TEST_DIR, 'workspaces');

function createMockApi(dataDir, workspacesDir) {
  const methods = {};
  const hooks = {};
  const toolFactories = [];

  return {
    pluginConfig: { dataDir, workspacesDir },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerGatewayMethod(name, handler) { methods[name] = handler; },
    registerHook(name, fn) { hooks[name] = fn; },
    registerTool(factory, opts) { toolFactories.push({ factory, opts }); },
    _methods: methods,
    _hooks: hooks,
    _toolFactories: toolFactories,
    _getToolFactory(name) {
      const entry = toolFactories.find(e => e.opts?.names?.includes(name));
      return entry?.factory ?? null;
    },
  };
}

/**
 * Promise-based wrapper to invoke a registered RPC method.
 * Works for both sync and async handlers.
 */
function callMethod(api, name, params) {
  return new Promise((resolve, reject) => {
    const result = api._methods[name]({
      params,
      respond: (ok, payload, error) => {
        if (ok) resolve(payload);
        else reject(new Error(typeof error === 'object' ? error.message || JSON.stringify(error) : error || 'Handler error'));
      },
    });
    if (result && typeof result.then === 'function') {
      result.catch(reject);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// Canned PM plan content — must satisfy parseGoalsFromPlan
// ═══════════════════════════════════════════════════════════════
const CANNED_PLAN = `## Goals

| # | Goal | Description | Priority |
|---|------|-------------|----------|
| 1 | Frontend UI | Build the Todo app user interface with React components | high |
| 2 | Backend API | Implement REST API with Express and SQLite database | high |
| 3 | Testing & QA | End-to-end testing and quality validation | medium |

#### Frontend UI
- Create Todo list component with add/delete/toggle (frontend)
- Build responsive layout with CSS Grid (frontend)
- Implement client-side state management (frontend)

#### Backend API
- Set up Express server with SQLite (backend)
- Implement CRUD endpoints for todos (backend)
- Add input validation and error handling (backend)

#### Testing & QA
- Write unit tests for API endpoints (tester)
- Write component tests for UI (tester)
- Perform integration testing across the full stack (tester)`;

describe('Full Lifecycle Integration — Condo Pipeline', () => {
  let api;

  beforeAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    api = createMockApi(TEST_DIR, WORKSPACES_DIR);
    register(api);
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // Shared state across phases
  let condoId;
  let goalIds;       // [frontendGoalId, backendGoalId, testingGoalId]
  let allSpawned;    // [{taskId, sessionKey, agentId, goalId}, ...]

  // ───────────────────────────────────────────────────────────
  // Phase 1: Create Condo
  // ───────────────────────────────────────────────────────────
  describe('Phase 1 — Create Condo', () => {
    it('creates a Todo App condo', async () => {
      const result = await callMethod(api, 'condos.create', {
        name: 'Todo App',
        description: 'A full-stack todo list application',
      });

      expect(result.condo).toBeDefined();
      expect(result.condo.name).toBe('Todo App');
      expect(result.condo.description).toBe('A full-stack todo list application');
      condoId = result.condo.id;
    });

    it('condo appears in condos.list with goalCount 0', async () => {
      const result = await callMethod(api, 'condos.list', {});
      const condo = result.condos.find(c => c.id === condoId);
      expect(condo).toBeDefined();
      expect(condo.goalCount).toBe(0);
    });

    it('condo is retrievable via condos.get', async () => {
      const result = await callMethod(api, 'condos.get', { id: condoId });
      expect(result.condo.id).toBe(condoId);
      expect(result.condo.name).toBe('Todo App');
    });

    it('condo workspace was created as a git repo', async () => {
      const result = await callMethod(api, 'condos.get', { id: condoId });
      const ws = result.condo.workspace;

      expect(ws).toBeDefined();
      expect(ws.path).toBeTruthy();
      expect(ws.createdAtMs).toBeTypeOf('number');

      // Workspace directory exists on disk
      expect(existsSync(ws.path)).toBe(true);

      // It is a valid git repository
      expect(existsSync(join(ws.path, '.git'))).toBe(true);

      // Has an initial commit
      const log = execSync('git log --oneline -1', { cwd: ws.path, encoding: 'utf-8' });
      expect(log).toContain('Initial commit');

      // Has goals/ subdirectory
      expect(existsSync(join(ws.path, 'goals'))).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────
  // Phase 2: PM Plans the Condo
  // ───────────────────────────────────────────────────────────
  describe('Phase 2 — PM Plans the Condo', () => {
    it('pm.condoChat creates enriched message and PM session', async () => {
      const result = await callMethod(api, 'pm.condoChat', {
        condoId,
        message: 'Build a full-stack Todo app with frontend, backend, and testing',
      });

      expect(result.enrichedMessage).toContain('Build a full-stack Todo app');
      expect(result.enrichedMessage).toContain('Todo App');
      expect(result.pmSession).toContain(':webchat:pm-condo-');
      expect(result.condoId).toBe(condoId);
    });

    it('pm.condoSaveResponse saves canned plan and detects it', async () => {
      const result = await callMethod(api, 'pm.condoSaveResponse', {
        condoId,
        content: CANNED_PLAN,
      });

      expect(result.ok).toBe(true);
      expect(result.hasPlan).toBe(true);
      expect(result.condoId).toBe(condoId);
    });

    it('pm.condoGetHistory shows 2 messages (user + assistant)', async () => {
      const result = await callMethod(api, 'pm.condoGetHistory', { condoId });

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.total).toBe(2);
      expect(result.condoName).toBe('Todo App');
    });
  });

  // ───────────────────────────────────────────────────────────
  // Phase 3: Create Goals from Plan
  // ───────────────────────────────────────────────────────────
  describe('Phase 3 — Create Goals from Plan', () => {
    it('pm.condoCreateGoals creates 3 goals from history', async () => {
      const result = await callMethod(api, 'pm.condoCreateGoals', { condoId });

      expect(result.ok).toBe(true);
      expect(result.goalsCreated).toBe(3);
      expect(result.goals).toHaveLength(3);
      expect(result.condoId).toBe(condoId);

      // Verify goal titles
      const titles = result.goals.map(g => g.title);
      expect(titles).toContain('Frontend UI');
      expect(titles).toContain('Backend API');
      expect(titles).toContain('Testing & QA');

      // Store goal IDs in order: Frontend, Backend, Testing
      goalIds = [
        result.goals.find(g => g.title === 'Frontend UI').id,
        result.goals.find(g => g.title === 'Backend API').id,
        result.goals.find(g => g.title === 'Testing & QA').id,
      ];
    });

    it('each goal has the correct number of tasks', async () => {
      for (const goalId of goalIds) {
        const result = await callMethod(api, 'goals.get', { id: goalId });
        expect(result.goal.tasks).toHaveLength(3);
      }
    });

    it('condo stores pmPlanContent', async () => {
      const result = await callMethod(api, 'condos.get', { id: condoId });
      expect(result.condo.pmPlanContent).toBe(CANNED_PLAN);
    });

    it('goals are active and belong to the condo', async () => {
      for (const goalId of goalIds) {
        const result = await callMethod(api, 'goals.get', { id: goalId });
        expect(result.goal.status).toBe('active');
        expect(result.goal.condoId).toBe(condoId);
        expect(result.goal.completed).toBe(false);
      }
    });

    it('each goal has a git worktree created in the condo workspace', async () => {
      // Get the condo workspace path
      const condoResult = await callMethod(api, 'condos.get', { id: condoId });
      const condoWsPath = condoResult.condo.workspace.path;

      for (const goalId of goalIds) {
        const result = await callMethod(api, 'goals.get', { id: goalId });
        const wt = result.goal.worktree;

        // Worktree metadata is stored on goal
        expect(wt).toBeDefined();
        expect(wt.path).toBeTruthy();
        expect(wt.branch).toBe(`goal/${goalId}`);
        expect(wt.createdAtMs).toBeTypeOf('number');

        // Worktree directory exists on disk
        expect(existsSync(wt.path)).toBe(true);

        // Worktree is inside the condo workspace goals/ directory
        expect(wt.path).toContain(join(condoWsPath, 'goals'));
      }

      // All 3 goal branches exist in the condo repo
      const branches = execSync('git branch --list', { cwd: condoWsPath, encoding: 'utf-8' });
      for (const goalId of goalIds) {
        expect(branches).toContain(`goal/${goalId}`);
      }
    });
  });

  // ───────────────────────────────────────────────────────────
  // Phase 4: Validate Task Structure
  // ───────────────────────────────────────────────────────────
  describe('Phase 4 — Validate Task Structure', () => {
    it('Frontend UI tasks are assigned to frontend agent', async () => {
      const result = await callMethod(api, 'goals.get', { id: goalIds[0] });
      for (const task of result.goal.tasks) {
        expect(task.assignedAgent).toBe('frontend');
        expect(task.status).toBe('pending');
        expect(task.sessionKey).toBeNull();
      }
    });

    it('Backend API tasks are assigned to backend agent', async () => {
      const result = await callMethod(api, 'goals.get', { id: goalIds[1] });
      for (const task of result.goal.tasks) {
        expect(task.assignedAgent).toBe('backend');
        expect(task.status).toBe('pending');
        expect(task.sessionKey).toBeNull();
      }
    });

    it('Testing & QA tasks are assigned to tester agent', async () => {
      const result = await callMethod(api, 'goals.get', { id: goalIds[2] });
      for (const task of result.goal.tasks) {
        expect(task.assignedAgent).toBe('tester');
        expect(task.status).toBe('pending');
        expect(task.sessionKey).toBeNull();
      }
    });

    it('pm.createTasksFromPlan works on a per-goal basis with explicit plan content', async () => {
      // Create a temporary goal to test the per-goal planning path
      const goalResult = await callMethod(api, 'goals.create', {
        title: 'Temp Goal',
        condoId,
      });
      const tempGoalId = goalResult.goal.id;

      const perGoalPlan = `## Tasks

| # | Task | Agent |
|---|------|-------|
| 1 | Build login page | frontend |
| 2 | Add JWT auth | backend |`;

      const result = await callMethod(api, 'pm.createTasksFromPlan', {
        goalId: tempGoalId,
        planContent: perGoalPlan,
      });

      expect(result.ok).toBe(true);
      expect(result.tasksCreated).toBe(2);
      expect(result.tasks[0].assignedAgent).toBe('frontend');
      expect(result.tasks[1].assignedAgent).toBe('backend');

      // Clean up temp goal
      await callMethod(api, 'goals.delete', { id: tempGoalId });
    });
  });

  // ───────────────────────────────────────────────────────────
  // Phase 5: Kickoff — Spawn All Tasks
  // ───────────────────────────────────────────────────────────
  describe('Phase 5 — Kickoff (Spawn All Tasks)', () => {
    it('kickoff spawns 3 sessions per goal (9 total)', async () => {
      allSpawned = [];

      for (const goalId of goalIds) {
        const result = await callMethod(api, 'goals.kickoff', { goalId });
        expect(result.spawnedSessions).toHaveLength(3);
        expect(result.goalId).toBe(goalId);

        for (const s of result.spawnedSessions) {
          expect(s.taskId).toBeTruthy();
          expect(s.sessionKey).toBeTruthy();
          expect(s.agentId).toBeTruthy();
          // Session key follows agent:<agentId>:subagent:<suffix> pattern
          expect(s.sessionKey).toMatch(/^agent:[^:]+:subagent:/);
          allSpawned.push({ ...s, goalId });
        }
      }

      expect(allSpawned).toHaveLength(9);
    });

    it('tasks now have sessionKey set and status in-progress', async () => {
      for (const goalId of goalIds) {
        const result = await callMethod(api, 'goals.get', { id: goalId });
        for (const task of result.goal.tasks) {
          expect(task.sessionKey).toBeTruthy();
          expect(task.status).toBe('in-progress');
        }
      }
    });

    it('goals.sessionLookup resolves each spawned session to the correct goal', async () => {
      for (const s of allSpawned) {
        const result = await callMethod(api, 'goals.sessionLookup', {
          sessionKey: s.sessionKey,
        });
        expect(result.goalId).toBe(s.goalId);
      }
    });

    it('second kickoff returns empty spawnedSessions (idempotent)', async () => {
      for (const goalId of goalIds) {
        const result = await callMethod(api, 'goals.kickoff', { goalId });
        expect(result.spawnedSessions).toHaveLength(0);
      }
    });

    it('direct spawnTaskSession returns workspacePath pointing to goal worktree', async () => {
      // Create a temporary goal with a task to test the raw spawn response
      const goalResult = await callMethod(api, 'goals.create', {
        title: 'Workspace Spawn Test',
        condoId,
      });
      const tempGoalId = goalResult.goal.id;
      await callMethod(api, 'goals.addTask', {
        goalId: tempGoalId,
        text: 'Test task',
        assignedAgent: 'backend',
      });
      // Re-fetch to get the task ID
      const goalData = await callMethod(api, 'goals.get', { id: tempGoalId });
      const taskId = goalData.goal.tasks[0].id;

      const spawnResult = await callMethod(api, 'goals.spawnTaskSession', {
        goalId: tempGoalId,
        taskId,
        agentId: 'backend',
      });

      // workspacePath should point to the goal's worktree (created on goals.create since condo has workspace)
      expect(spawnResult.workspacePath).toBeTruthy();
      expect(existsSync(spawnResult.workspacePath)).toBe(true);

      // The task context sent to the agent includes the working directory
      expect(spawnResult.taskContext).toContain('Working Directory');
      expect(spawnResult.taskContext).toContain(spawnResult.workspacePath);

      // Clean up — delete goal (also removes its worktree)
      await callMethod(api, 'goals.delete', { id: tempGoalId });
    });
  });

  // ───────────────────────────────────────────────────────────
  // Phase 6: Simulate Execution via goal_update Tool
  // ───────────────────────────────────────────────────────────
  describe('Phase 6 — Simulate Execution via goal_update', () => {
    it('marks each task done via the goal_update tool', async () => {
      const factory = api._getToolFactory('goal_update');
      expect(factory).toBeTypeOf('function');

      // Group spawned sessions by goalId
      const byGoal = {};
      for (const s of allSpawned) {
        if (!byGoal[s.goalId]) byGoal[s.goalId] = [];
        byGoal[s.goalId].push(s);
      }

      for (const goalId of goalIds) {
        const sessions = byGoal[goalId];

        for (const s of sessions) {
          const tool = factory({ sessionKey: s.sessionKey });
          expect(tool).not.toBeNull();
          expect(tool.name).toBe('goal_update');

          const result = await tool.execute('call-' + s.taskId, {
            taskId: s.taskId,
            status: 'done',
            summary: `Completed: ${s.taskText || s.taskId}`,
          });

          expect(result.content[0].text).toContain('updated');
        }
      }
    });

    it('marks each goal done via goal_update tool', async () => {
      const factory = api._getToolFactory('goal_update');

      // Group spawned sessions by goalId
      const byGoal = {};
      for (const s of allSpawned) {
        if (!byGoal[s.goalId]) byGoal[s.goalId] = [];
        byGoal[s.goalId].push(s);
      }

      for (const goalId of goalIds) {
        // Use the first spawned session for this goal to mark it done
        const sessionKey = byGoal[goalId][0].sessionKey;
        const tool = factory({ sessionKey });

        const result = await tool.execute('done-' + goalId, {
          goalStatus: 'done',
        });

        expect(result.content[0].text).toContain('goal marked done');
      }
    });
  });

  // ───────────────────────────────────────────────────────────
  // Phase 7: Final Validation
  // ───────────────────────────────────────────────────────────
  describe('Phase 7 — Final Validation', () => {
    it('all 3 goals are done', async () => {
      for (const goalId of goalIds) {
        const result = await callMethod(api, 'goals.get', { id: goalId });
        expect(result.goal.status).toBe('done');
        expect(result.goal.completed).toBe(true);
      }
    });

    it('all 9 tasks are done with sessionKey and summary set', async () => {
      let totalTasks = 0;
      for (const goalId of goalIds) {
        const result = await callMethod(api, 'goals.get', { id: goalId });
        for (const task of result.goal.tasks) {
          expect(task.status).toBe('done');
          expect(task.done).toBe(true);
          expect(task.sessionKey).toBeTruthy();
          expect(task.summary).toBeTruthy();
          totalTasks++;
        }
      }
      expect(totalTasks).toBe(9);
    });

    it('all spawned sessions exist in sessionIndex', async () => {
      for (const s of allSpawned) {
        const result = await callMethod(api, 'goals.sessionLookup', {
          sessionKey: s.sessionKey,
        });
        expect(result.goalId).toBe(s.goalId);
      }
    });

    it('condo pmPlanContent is preserved', async () => {
      const result = await callMethod(api, 'condos.get', { id: condoId });
      expect(result.condo.pmPlanContent).toBe(CANNED_PLAN);
    });

    it('before_agent_start hook returns context for spawned sessions', async () => {
      // Pick a spawned session and verify hook returns goal context
      const spawned = allSpawned[0];
      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: spawned.sessionKey },
      });

      expect(result).toHaveProperty('prependContext');
      // Should contain project summary (goal is in a condo)
      expect(result.prependContext).toContain('Todo App');
    });

    it('agent_end hook updates goal timestamps', async () => {
      const spawned = allSpawned[0];

      // Get goal timestamp before
      const before = await callMethod(api, 'goals.get', { id: spawned.goalId });
      const tsBefore = before.goal.updatedAtMs;

      await new Promise(r => setTimeout(r, 5));

      await api._hooks['agent_end']({
        context: { sessionKey: spawned.sessionKey },
        success: true,
      });

      const after = await callMethod(api, 'goals.get', { id: spawned.goalId });
      expect(after.goal.updatedAtMs).toBeGreaterThan(tsBefore);
    });

    it('condos.list shows updated goalCount', async () => {
      const result = await callMethod(api, 'condos.list', {});
      const condo = result.condos.find(c => c.id === condoId);
      // 3 goals from plan; temp goals from Phase 4 and 5 were deleted
      expect(condo.goalCount).toBe(3);
    });

    it('workspace directory structure is intact after full lifecycle', async () => {
      const condoResult = await callMethod(api, 'condos.get', { id: condoId });
      const condoWsPath = condoResult.condo.workspace.path;

      // Condo workspace still exists
      expect(existsSync(condoWsPath)).toBe(true);

      // goals/ subdirectory exists
      expect(existsSync(join(condoWsPath, 'goals'))).toBe(true);

      // All 3 goal worktree directories exist
      for (const goalId of goalIds) {
        const goalResult = await callMethod(api, 'goals.get', { id: goalId });
        expect(existsSync(goalResult.goal.worktree.path)).toBe(true);
      }

      // All 3 goal branches are present in the condo git repo
      const branches = execSync('git branch --list', { cwd: condoWsPath, encoding: 'utf-8' });
      for (const goalId of goalIds) {
        expect(branches).toContain(`goal/${goalId}`);
      }
    });

    it('goal worktrees are independent git checkouts', async () => {
      // Verify each worktree is on its own branch
      for (const goalId of goalIds) {
        const goalResult = await callMethod(api, 'goals.get', { id: goalId });
        const wtPath = goalResult.goal.worktree.path;

        const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: wtPath,
          encoding: 'utf-8',
        }).trim();

        expect(currentBranch).toBe(`goal/${goalId}`);
      }
    });
  });

  // ───────────────────────────────────────────────────────────
  // Phase 8: Kickoff Respects Task Dependencies
  // ───────────────────────────────────────────────────────────
  describe('Phase 8 — Kickoff Respects Task Dependencies', () => {
    let depGoalId;
    let depTasks;

    it('creates a goal with tasks that have dependencies', async () => {
      const goalResult = await callMethod(api, 'goals.create', {
        title: 'Dependency Test Goal',
        condoId,
      });
      depGoalId = goalResult.goal.id;

      // Create 4 tasks
      await callMethod(api, 'goals.addTask', { goalId: depGoalId, text: 'Task A - no deps', assignedAgent: 'backend' });
      await callMethod(api, 'goals.addTask', { goalId: depGoalId, text: 'Task B - no deps', assignedAgent: 'backend' });
      await callMethod(api, 'goals.addTask', { goalId: depGoalId, text: 'Task C - depends on B', assignedAgent: 'frontend' });
      await callMethod(api, 'goals.addTask', { goalId: depGoalId, text: 'Task D - depends on C', assignedAgent: 'tester' });

      const goalData = await callMethod(api, 'goals.get', { id: depGoalId });
      depTasks = goalData.goal.tasks;
      expect(depTasks).toHaveLength(4);

      // Set up dependency chain: C depends on B, D depends on C
      await callMethod(api, 'goals.updateTask', {
        goalId: depGoalId,
        taskId: depTasks[2].id,  // Task C
        dependsOn: [depTasks[1].id],  // depends on Task B
      });
      await callMethod(api, 'goals.updateTask', {
        goalId: depGoalId,
        taskId: depTasks[3].id,  // Task D
        dependsOn: [depTasks[2].id],  // depends on Task C
      });
    });

    it('first kickoff only spawns tasks without unsatisfied dependencies (A and B)', async () => {
      const result = await callMethod(api, 'goals.kickoff', { goalId: depGoalId });

      expect(result.spawnedSessions).toHaveLength(2);
      const spawnedTaskIds = result.spawnedSessions.map(s => s.taskId);
      expect(spawnedTaskIds).toContain(depTasks[0].id);  // Task A
      expect(spawnedTaskIds).toContain(depTasks[1].id);  // Task B
      expect(spawnedTaskIds).not.toContain(depTasks[2].id);  // Task C blocked
      expect(spawnedTaskIds).not.toContain(depTasks[3].id);  // Task D blocked
    });

    it('completing Task B and re-kicking off spawns Task C (dependency satisfied)', async () => {
      // Mark Task B as done
      const factory = api._getToolFactory('goal_update');
      const bSession = depTasks[1].sessionKey ||
        (await callMethod(api, 'goals.get', { id: depGoalId })).goal.tasks[1].sessionKey;
      const tool = factory({ sessionKey: bSession });
      await tool.execute('done-b', {
        taskId: depTasks[1].id,
        status: 'done',
        summary: 'Task B completed',
      });

      // Re-kickoff
      const result = await callMethod(api, 'goals.kickoff', { goalId: depGoalId });

      expect(result.spawnedSessions).toHaveLength(1);
      expect(result.spawnedSessions[0].taskId).toBe(depTasks[2].id);  // Task C now unblocked
    });

    it('completing Task C and re-kicking off spawns Task D', async () => {
      // Mark Task C as done
      const factory = api._getToolFactory('goal_update');
      const goalData = await callMethod(api, 'goals.get', { id: depGoalId });
      const cSession = goalData.goal.tasks[2].sessionKey;
      const tool = factory({ sessionKey: cSession });
      await tool.execute('done-c', {
        taskId: depTasks[2].id,
        status: 'done',
        summary: 'Task C completed',
      });

      // Re-kickoff
      const result = await callMethod(api, 'goals.kickoff', { goalId: depGoalId });

      expect(result.spawnedSessions).toHaveLength(1);
      expect(result.spawnedSessions[0].taskId).toBe(depTasks[3].id);  // Task D now unblocked
    });

    it('final kickoff returns empty (all tasks spawned)', async () => {
      const result = await callMethod(api, 'goals.kickoff', { goalId: depGoalId });
      expect(result.spawnedSessions).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────
  // Phase 9: Clone from Git Repo URL
  // ───────────────────────────────────────────────────────────
  describe('Phase 9 — Clone from Git Repo URL', () => {
    it('creates a condo by cloning a local bare repo', async () => {
      // Create a local bare repo (avoids network dependency in tests)
      const bareRepo = join(TEST_DIR, 'recipe-box-bare.git');
      execSync(`git init --bare ${bareRepo}`, { stdio: 'pipe' });

      // Create a temp repo with a file, push to bare's default branch
      const tempRepo = join(TEST_DIR, 'recipe-box-temp');
      mkdirSync(tempRepo);
      execSync('git init', { cwd: tempRepo, stdio: 'pipe' });
      execSync('echo "# Recipe Box" > README.md', { cwd: tempRepo, stdio: 'pipe' });
      execSync('git add README.md', { cwd: tempRepo, stdio: 'pipe' });
      execSync('git commit -m "Initial commit"', {
        cwd: tempRepo, stdio: 'pipe',
        env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@test', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@test' },
      });
      execSync(`git remote add origin ${bareRepo}`, { cwd: tempRepo, stdio: 'pipe' });
      // Push to the default branch name (master) so HEAD resolves correctly on clone
      execSync('git push origin HEAD:master', { cwd: tempRepo, stdio: 'pipe' });

      // Create condo with repoUrl
      const result = await callMethod(api, 'condos.create', {
        name: 'Recipe Box',
        description: 'A personal web app to store, browse, and search recipes',
        repoUrl: bareRepo,
      });

      expect(result.condo.name).toBe('Recipe Box');
      expect(result.condo.workspace).not.toBeNull();
      expect(result.condo.workspace.repoUrl).toBe(bareRepo);

      const wsPath = result.condo.workspace.path;
      expect(existsSync(wsPath)).toBe(true);

      // Verify the cloned repo has the README
      expect(existsSync(join(wsPath, 'README.md'))).toBe(true);

      // Verify goals/ subdirectory was created
      expect(existsSync(join(wsPath, 'goals'))).toBe(true);

      // Create a goal and verify worktree is created
      const goalResult = await callMethod(api, 'goals.create', {
        title: 'Backend API',
        condoId: result.condo.id,
      });
      expect(goalResult.goal.worktree).not.toBeNull();
      expect(existsSync(goalResult.goal.worktree.path)).toBe(true);

      // Worktree should contain the cloned files (inherited from main branch)
      expect(existsSync(join(goalResult.goal.worktree.path, 'README.md'))).toBe(true);
    });
  });
});
