import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import register from '../openclaw-plugin/index.js';

const TEST_DIR = join(import.meta.dirname, '__fixtures__', 'plugin-index-test');

function createMockApi(dataDir) {
  const methods = {};
  const hooks = {};
  let toolFactory = null;

  return {
    pluginConfig: { dataDir },
    logger: { info: vi.fn() },
    registerGatewayMethod(name, handler) { methods[name] = handler; },
    registerHook(name, fn) { hooks[name] = fn; },
    registerTool(factory) { toolFactory = factory; },
    // Accessors for tests
    _methods: methods,
    _hooks: hooks,
    _toolFactory: () => toolFactory,
  };
}

describe('Plugin index.js', () => {
  let api;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    api = createMockApi(TEST_DIR);
    register(api);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('registration', () => {
    it('registers all 20 gateway methods', () => {
      const expected = [
        'goals.list', 'goals.create', 'goals.get', 'goals.update', 'goals.delete',
        'goals.addSession', 'goals.removeSession', 'goals.sessionLookup',
        'goals.setSessionCondo', 'goals.getSessionCondo', 'goals.listSessionCondos',
        'goals.addTask', 'goals.updateTask', 'goals.deleteTask',
        'condos.create', 'condos.list', 'condos.get', 'condos.update', 'condos.delete',
        'goals.spawnTaskSession',
      ];
      for (const name of expected) {
        expect(api._methods).toHaveProperty(name);
      }
      expect(Object.keys(api._methods)).toHaveLength(20);
    });

    it('registers before_agent_start and agent_end hooks', () => {
      expect(api._hooks).toHaveProperty('before_agent_start');
      expect(api._hooks).toHaveProperty('agent_end');
    });

    it('registers goal_update tool factory', () => {
      expect(api._toolFactory()).toBeTypeOf('function');
    });
  });

  describe('before_agent_start hook', () => {
    function seedGoal() {
      const respond = (ok, payload) => ({ ok, payload });
      let result;
      api._methods['goals.create']({
        params: { title: 'Test Goal', description: 'Build something' },
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });
      const goalId = result.payload.goal.id;
      api._methods['goals.addSession']({
        params: { id: goalId, sessionKey: 'agent:main:main' },
        respond: () => {},
      });
      return goalId;
    }

    it('returns context for session assigned to a goal', async () => {
      seedGoal();
      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:main:main' },
      });
      expect(result).toHaveProperty('prependContext');
      expect(result.prependContext).toContain('Test Goal');
    });

    it('returns undefined for session not assigned to a goal', async () => {
      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:orphan:main' },
      });
      expect(result).toBeUndefined();
    });

    it('returns undefined when no sessionKey', async () => {
      const result = await api._hooks['before_agent_start']({
        context: {},
      });
      expect(result).toBeUndefined();
    });
  });

  describe('agent_end hook', () => {
    function seedGoal() {
      let result;
      api._methods['goals.create']({
        params: { title: 'Track Me' },
        respond: (ok, payload) => { result = { ok, payload }; },
      });
      const goalId = result.payload.goal.id;
      api._methods['goals.addSession']({
        params: { id: goalId, sessionKey: 'agent:main:main' },
        respond: () => {},
      });
      return goalId;
    }

    it('updates goal timestamp on success', async () => {
      const goalId = seedGoal();
      let goalBefore;
      api._methods['goals.get']({
        params: { id: goalId },
        respond: (ok, payload) => { goalBefore = payload.goal; },
      });

      await new Promise(r => setTimeout(r, 5));

      await api._hooks['agent_end']({
        context: { sessionKey: 'agent:main:main' },
        success: true,
      });

      let goalAfter;
      api._methods['goals.get']({
        params: { id: goalId },
        respond: (ok, payload) => { goalAfter = payload.goal; },
      });
      expect(goalAfter.updatedAtMs).toBeGreaterThan(goalBefore.updatedAtMs);
      expect(api.logger.info).toHaveBeenCalled();
    });

    it('does nothing on failure', async () => {
      seedGoal();
      const result = await api._hooks['agent_end']({
        context: { sessionKey: 'agent:main:main' },
        success: false,
      });
      expect(result).toBeUndefined();
    });

    it('does nothing for unassigned session', async () => {
      const result = await api._hooks['agent_end']({
        context: { sessionKey: 'agent:orphan:main' },
        success: true,
      });
      expect(result).toBeUndefined();
    });
  });

  describe('goal_update tool factory', () => {
    function seedGoal() {
      let result;
      api._methods['goals.create']({
        params: { title: 'Tooled Goal' },
        respond: (ok, payload) => { result = { ok, payload }; },
      });
      const goalId = result.payload.goal.id;
      api._methods['goals.addSession']({
        params: { id: goalId, sessionKey: 'agent:main:main' },
        respond: () => {},
      });
      return goalId;
    }

    it('returns null for session without sessionKey', () => {
      const factory = api._toolFactory();
      expect(factory({})).toBeNull();
    });

    it('returns null for session not assigned to a goal', () => {
      const factory = api._toolFactory();
      expect(factory({ sessionKey: 'agent:orphan:main' })).toBeNull();
    });

    it('returns tool definition for assigned session', () => {
      seedGoal();
      const factory = api._toolFactory();
      const tool = factory({ sessionKey: 'agent:main:main' });
      expect(tool).not.toBeNull();
      expect(tool.name).toBe('goal_update');
      expect(tool.execute).toBeTypeOf('function');
    });

    it('tool execute works end-to-end', async () => {
      seedGoal();
      const factory = api._toolFactory();
      const tool = factory({ sessionKey: 'agent:main:main' });
      const result = await tool.execute('call1', { status: 'in-progress' });
      expect(result.content[0].text).toContain('updated');
    });
  });
});
