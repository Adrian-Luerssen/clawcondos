import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createGoalsStore } from '../clawcondos/condo-management/lib/goals-store.js';
import {
  AUTONOMY_MODES,
  DEFAULT_AUTONOMY_MODE,
  resolveAutonomyMode,
  buildAutonomyDirective,
  setTaskAutonomy,
  setCondoAutonomy,
  getTaskAutonomyInfo,
  createAutonomyHandlers,
} from '../clawcondos/condo-management/lib/autonomy.js';

const TEST_DIR = join(import.meta.dirname, '__fixtures__', 'autonomy-test');

describe('Autonomy Manager', () => {
  let store;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = createGoalsStore(TEST_DIR);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('constants', () => {
    it('exports valid autonomy modes', () => {
      expect(AUTONOMY_MODES).toContain('full');
      expect(AUTONOMY_MODES).toContain('plan');
      expect(AUTONOMY_MODES).toContain('step');
      expect(AUTONOMY_MODES).toContain('supervised');
    });

    it('has plan as default mode', () => {
      expect(DEFAULT_AUTONOMY_MODE).toBe('plan');
    });
  });

  describe('resolveAutonomyMode', () => {
    it('returns default for null task and condo', () => {
      expect(resolveAutonomyMode(null, null)).toBe('plan');
    });

    it('returns task autonomyMode when set', () => {
      const task = { autonomyMode: 'full' };
      expect(resolveAutonomyMode(task, null)).toBe('full');
    });

    it('returns condo autonomyMode when task has none', () => {
      const task = {};
      const condo = { autonomyMode: 'supervised' };
      expect(resolveAutonomyMode(task, condo)).toBe('supervised');
    });

    it('task mode overrides condo mode', () => {
      const task = { autonomyMode: 'full' };
      const condo = { autonomyMode: 'supervised' };
      expect(resolveAutonomyMode(task, condo)).toBe('full');
    });

    it('ignores invalid autonomy modes', () => {
      const task = { autonomyMode: 'invalid' };
      expect(resolveAutonomyMode(task, null)).toBe('plan');
    });
  });

  describe('buildAutonomyDirective', () => {
    it('returns directive for full mode', () => {
      const directive = buildAutonomyDirective('full');
      expect(directive).toContain('Full');
      expect(directive).toContain('autonomy');
    });

    it('returns directive for plan mode', () => {
      const directive = buildAutonomyDirective('plan');
      expect(directive).toContain('Plan Approval Required');
      expect(directive).toContain('PLAN.md');
    });

    it('returns directive for step mode', () => {
      const directive = buildAutonomyDirective('step');
      expect(directive).toContain('Step-by-Step');
    });

    it('returns directive for supervised mode', () => {
      const directive = buildAutonomyDirective('supervised');
      expect(directive).toContain('Supervised');
      expect(directive).toContain('supervision');
    });

    it('returns default directive for unknown mode', () => {
      const directive = buildAutonomyDirective('unknown');
      expect(directive).toContain('Plan Approval Required');
    });
  });

  describe('setTaskAutonomy', () => {
    function seedGoalWithTask() {
      const data = store.load();
      const goal = {
        id: 'goal_test',
        title: 'Test Goal',
        tasks: [{ id: 'task_test', text: 'Test task' }],
        sessions: [],
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };
      data.goals.push(goal);
      store.save(data);
      return goal;
    }

    it('sets autonomy mode on task', () => {
      seedGoalWithTask();
      
      const result = setTaskAutonomy(store, 'goal_test', 'task_test', 'full');
      expect(result.success).toBe(true);
      expect(result.task.autonomyMode).toBe('full');
    });

    it('persists autonomy mode', () => {
      seedGoalWithTask();
      setTaskAutonomy(store, 'goal_test', 'task_test', 'supervised');
      
      const data = store.load();
      expect(data.goals[0].tasks[0].autonomyMode).toBe('supervised');
    });

    it('rejects invalid mode', () => {
      seedGoalWithTask();
      
      const result = setTaskAutonomy(store, 'goal_test', 'task_test', 'invalid');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid mode');
    });

    it('returns error for unknown goal', () => {
      const result = setTaskAutonomy(store, 'goal_unknown', 'task_test', 'full');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error for unknown task', () => {
      seedGoalWithTask();
      
      const result = setTaskAutonomy(store, 'goal_test', 'task_unknown', 'full');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('setCondoAutonomy', () => {
    function seedCondo() {
      const data = store.load();
      const condo = {
        id: 'condo_test',
        name: 'Test Condo',
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };
      data.condos.push(condo);
      store.save(data);
      return condo;
    }

    it('sets autonomy mode on condo', () => {
      seedCondo();
      
      const result = setCondoAutonomy(store, 'condo_test', 'step');
      expect(result.success).toBe(true);
      expect(result.condo.autonomyMode).toBe('step');
    });

    it('persists autonomy mode', () => {
      seedCondo();
      setCondoAutonomy(store, 'condo_test', 'supervised');
      
      const data = store.load();
      expect(data.condos[0].autonomyMode).toBe('supervised');
    });

    it('rejects invalid mode', () => {
      seedCondo();
      
      const result = setCondoAutonomy(store, 'condo_test', 'invalid');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid mode');
    });

    it('returns error for unknown condo', () => {
      const result = setCondoAutonomy(store, 'condo_unknown', 'full');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('getTaskAutonomyInfo', () => {
    function seedGoalWithTaskAndCondo() {
      const data = store.load();
      const condo = {
        id: 'condo_test',
        name: 'Test Condo',
        autonomyMode: 'step',
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };
      const goal = {
        id: 'goal_test',
        title: 'Test Goal',
        condoId: 'condo_test',
        tasks: [{ id: 'task_test', text: 'Test task' }],
        sessions: [],
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };
      data.condos.push(condo);
      data.goals.push(goal);
      store.save(data);
      return { goal, condo };
    }

    it('returns autonomy info for a task', () => {
      seedGoalWithTaskAndCondo();
      
      const result = getTaskAutonomyInfo(store, 'goal_test', 'task_test');
      expect(result.success).toBe(true);
      expect(result.mode).toBe('step'); // From condo
      expect(result.directive).toContain('Step-by-Step');
      expect(result.condoMode).toBe('step');
      expect(result.taskMode).toBeNull();
    });

    it('task mode overrides condo mode', () => {
      seedGoalWithTaskAndCondo();
      setTaskAutonomy(store, 'goal_test', 'task_test', 'full');
      
      const result = getTaskAutonomyInfo(store, 'goal_test', 'task_test');
      expect(result.mode).toBe('full');
      expect(result.taskMode).toBe('full');
      expect(result.condoMode).toBe('step');
    });

    it('returns error for unknown goal', () => {
      const result = getTaskAutonomyInfo(store, 'goal_unknown', 'task_test');
      expect(result.success).toBe(false);
    });
  });

  describe('RPC handlers', () => {
    function seedGoalWithTask() {
      const data = store.load();
      const goal = {
        id: 'goal_test',
        title: 'Test Goal',
        tasks: [{ id: 'task_test', text: 'Test task' }],
        sessions: [],
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };
      data.goals.push(goal);
      store.save(data);
    }

    function seedCondo() {
      const data = store.load();
      data.condos.push({
        id: 'condo_test',
        name: 'Test Condo',
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      });
      store.save(data);
    }

    it('autonomy.modes returns available modes', () => {
      const handlers = createAutonomyHandlers(store);
      let result;
      handlers['autonomy.modes']({
        respond: (ok, payload) => { result = { ok, payload }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.modes).toEqual(AUTONOMY_MODES);
      expect(result.payload.default).toBe('plan');
      expect(result.payload.descriptions).toHaveProperty('full');
    });

    it('autonomy.setTask sets task autonomy', () => {
      seedGoalWithTask();
      const handlers = createAutonomyHandlers(store);
      let result;
      handlers['autonomy.setTask']({
        params: { goalId: 'goal_test', taskId: 'task_test', mode: 'full' },
        respond: (ok, payload) => { result = { ok, payload }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.mode).toBe('full');
    });

    it('autonomy.setCondo sets condo autonomy', () => {
      seedCondo();
      const handlers = createAutonomyHandlers(store);
      let result;
      handlers['autonomy.setCondo']({
        params: { condoId: 'condo_test', mode: 'supervised' },
        respond: (ok, payload) => { result = { ok, payload }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.mode).toBe('supervised');
    });

    it('autonomy.getTaskInfo returns autonomy info', () => {
      seedGoalWithTask();
      const handlers = createAutonomyHandlers(store);
      let result;
      handlers['autonomy.getTaskInfo']({
        params: { goalId: 'goal_test', taskId: 'task_test' },
        respond: (ok, payload) => { result = { ok, payload }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.mode).toBe('plan'); // Default
      expect(result.payload.directive).toBeTruthy();
    });
  });
});
