import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createGoalsStore } from '../clawcondos/condo-management/lib/goals-store.js';
import { createRolesHandlers } from '../clawcondos/condo-management/lib/roles-handlers.js';

const TEST_DIR = join(import.meta.dirname, '__fixtures__', 'roles-handlers-test');

describe('Roles Handlers', () => {
  let store;
  let handlers;
  let broadcastCalls;
  let logger;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = createGoalsStore(TEST_DIR);
    broadcastCalls = [];
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    handlers = createRolesHandlers(store, {
      broadcast: (msg) => broadcastCalls.push(msg),
      logger,
    });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('roles.assign', () => {
    it('assigns a role to an agent', () => {
      let result;
      handlers['roles.assign']({
        params: { agentId: 'felix', role: 'frontend' },
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.agentId).toBe('felix');
      expect(result.payload.role).toBe('frontend');
      expect(result.payload.label).toContain('Félix');

      // Verify persistence
      const data = store.load();
      expect(data.config.agentRoles.frontend).toBe('felix');
    });

    it('broadcasts roles.updated event', () => {
      handlers['roles.assign']({
        params: { agentId: 'blake', role: 'backend' },
        respond: () => {},
      });

      expect(broadcastCalls).toHaveLength(1);
      expect(broadcastCalls[0].event).toBe('roles.updated');
      expect(broadcastCalls[0].payload.agentId).toBe('blake');
      expect(broadcastCalls[0].payload.role).toBe('backend');
    });

    it('returns error if agentId missing', () => {
      let result;
      handlers['roles.assign']({
        params: { role: 'frontend' },
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(false);
      expect(result.err).toContain('agentId is required');
    });

    it('returns error if role missing', () => {
      let result;
      handlers['roles.assign']({
        params: { agentId: 'felix' },
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(false);
      expect(result.err).toContain('role is required');
    });

    it('normalizes role to lowercase', () => {
      let result;
      handlers['roles.assign']({
        params: { agentId: 'felix', role: 'FrontEnd' },
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.role).toBe('frontend');
    });
  });

  describe('roles.list', () => {
    it('returns default roles when no custom assignments', () => {
      let result;
      handlers['roles.list']({
        params: {},
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.agents).toBeInstanceOf(Array);
      
      // Should include default role assignments
      const frontend = result.payload.agents.find(a => a.roles.includes('frontend'));
      expect(frontend).toBeTruthy();
    });

    it('returns custom assignments', () => {
      // Assign custom role
      handlers['roles.assign']({
        params: { agentId: 'felix', role: 'frontend' },
        respond: () => {},
      });

      let result;
      handlers['roles.list']({
        params: {},
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(true);
      const felix = result.payload.agents.find(a => a.id === 'felix');
      expect(felix).toBeTruthy();
      expect(felix.roles).toContain('frontend');
      expect(felix.isConfigured).toBe(true);
      expect(felix.label).toContain('Félix');
    });

    it('includes emoji and name in agent entries', () => {
      handlers['roles.assign']({
        params: { agentId: 'blake', role: 'backend' },
        respond: () => {},
      });

      let result;
      handlers['roles.list']({
        params: {},
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      const blake = result.payload.agents.find(a => a.id === 'blake');
      expect(blake.emoji).toBe('⚙️');
      expect(blake.name).toBe('Blake');
    });

    it('generates default label for unknown agents', () => {
      handlers['roles.assign']({
        params: { agentId: 'newagent', role: 'custom' },
        respond: () => {},
      });

      let result;
      handlers['roles.list']({
        params: {},
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      const newagent = result.payload.agents.find(a => a.id === 'newagent');
      expect(newagent).toBeTruthy();
      expect(newagent.emoji).toBe('🤖');
      expect(newagent.name).toBe('Newagent');
    });
  });

  describe('roles.unassign', () => {
    it('removes role assignment', () => {
      // First assign
      handlers['roles.assign']({
        params: { agentId: 'felix', role: 'frontend' },
        respond: () => {},
      });

      // Then unassign
      let result;
      handlers['roles.unassign']({
        params: { role: 'frontend' },
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.previousAgent).toBe('felix');

      // Verify removal
      const data = store.load();
      expect(data.config.agentRoles?.frontend).toBeUndefined();
    });

    it('returns ok for unassigned role', () => {
      let result;
      handlers['roles.unassign']({
        params: { role: 'nonexistent' },
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(true);
      // Returns appropriate message for no assignments or role not found
      expect(result.payload.note).toMatch(/No custom role assignments exist|Role was not assigned/);
    });

    it('broadcasts roles.updated event', () => {
      handlers['roles.assign']({
        params: { agentId: 'felix', role: 'frontend' },
        respond: () => {},
      });
      broadcastCalls = [];

      handlers['roles.unassign']({
        params: { role: 'frontend' },
        respond: () => {},
      });

      expect(broadcastCalls).toHaveLength(1);
      expect(broadcastCalls[0].event).toBe('roles.updated');
      expect(broadcastCalls[0].payload.agentId).toBeNull();
    });
  });

  describe('roles.setLabel', () => {
    it('sets custom label for agent', () => {
      let result;
      handlers['roles.setLabel']({
        params: { agentId: 'myagent', emoji: '🚀', name: 'Rocket Agent' },
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.emoji).toBe('🚀');
      expect(result.payload.name).toBe('Rocket Agent');
      expect(result.payload.label).toBe('Rocket Agent 🚀');

      // Verify persistence
      const data = store.load();
      expect(data.config.agentLabels.myagent).toEqual({ emoji: '🚀', name: 'Rocket Agent' });
    });

    it('updates only emoji if name not provided', () => {
      handlers['roles.setLabel']({
        params: { agentId: 'felix', emoji: '🌟' },
        respond: () => {},
      });

      let result;
      handlers['roles.list']({
        params: {},
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      // Felix should use the configured emoji but keep existing name pattern
      const data = store.load();
      expect(data.config.agentLabels.felix.emoji).toBe('🌟');
    });

    it('returns error if agentId missing', () => {
      let result;
      handlers['roles.setLabel']({
        params: { emoji: '🚀' },
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(false);
      expect(result.err).toContain('agentId is required');
    });

    it('returns error if neither emoji nor name provided', () => {
      let result;
      handlers['roles.setLabel']({
        params: { agentId: 'myagent' },
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(false);
      expect(result.err).toContain('emoji or name is required');
    });
  });

  describe('roles.list with descriptions', () => {
    it('returns role descriptions when configured', () => {
      // First set up a role with description via config
      const data = store.load();
      data.config = data.config || {};
      data.config.agentRoles = { frontend: 'felix' };
      data.config.roles = {
        frontend: { description: 'UI/UX and React specialist' },
      };
      store.save(data);

      let result;
      handlers['roles.list']({
        params: {},
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.roleDescriptions).toBeDefined();
      expect(result.payload.roleDescriptions.frontend).toBe('UI/UX and React specialist');
    });
  });

  describe('roles.autoDetect', () => {
    const AGENT_WORKSPACES_DIR = join(TEST_DIR, 'agent-workspaces');

    beforeEach(() => {
      mkdirSync(AGENT_WORKSPACES_DIR, { recursive: true });
    });

    it('returns empty suggestions when env var not set', () => {
      delete process.env.CLAWCONDOS_AGENT_WORKSPACES;

      let result;
      handlers['roles.autoDetect']({
        params: {},
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.suggestions).toEqual([]);
      expect(result.payload.note).toContain('CLAWCONDOS_AGENT_WORKSPACES');
    });

    it('detects frontend role from SOUL.md', () => {
      // Create a mock agent workspace with SOUL.md
      const felixDir = join(AGENT_WORKSPACES_DIR, 'felix');
      mkdirSync(felixDir, { recursive: true });
      writeFileSync(
        join(felixDir, 'SOUL.md'),
        '# Felix\n\nI am a frontend developer specializing in React and UI development.\nI work with CSS, HTML, and modern web technologies.'
      );

      process.env.CLAWCONDOS_AGENT_WORKSPACES = `felix=${felixDir}`;

      let result;
      handlers['roles.autoDetect']({
        params: {},
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.suggestions).toHaveLength(1);
      expect(result.payload.suggestions[0].agentId).toBe('felix');
      expect(result.payload.suggestions[0].suggestedRole).toBe('frontend');
      expect(result.payload.suggestions[0].confidence).toBeGreaterThan(0);
      expect(result.payload.suggestions[0].matchedKeywords).toContain('frontend');
    });

    it('detects backend role from IDENTITY.md', () => {
      const blakeDir = join(AGENT_WORKSPACES_DIR, 'blake');
      mkdirSync(blakeDir, { recursive: true });
      writeFileSync(
        join(blakeDir, 'IDENTITY.md'),
        '# Blake\n\nBackend developer focused on API design and database management.\nI work with Node.js, Python, and SQL databases.'
      );

      process.env.CLAWCONDOS_AGENT_WORKSPACES = `blake=${blakeDir}`;

      let result;
      handlers['roles.autoDetect']({
        params: {},
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.suggestions).toHaveLength(1);
      expect(result.payload.suggestions[0].agentId).toBe('blake');
      expect(result.payload.suggestions[0].suggestedRole).toBe('backend');
    });

    it('detects multiple agents', () => {
      const felixDir = join(AGENT_WORKSPACES_DIR, 'felix');
      const blakeDir = join(AGENT_WORKSPACES_DIR, 'blake');
      mkdirSync(felixDir, { recursive: true });
      mkdirSync(blakeDir, { recursive: true });

      writeFileSync(join(felixDir, 'SOUL.md'), 'Frontend React developer');
      writeFileSync(join(blakeDir, 'SOUL.md'), 'Backend API developer');

      process.env.CLAWCONDOS_AGENT_WORKSPACES = `felix=${felixDir},blake=${blakeDir}`;

      let result;
      handlers['roles.autoDetect']({
        params: {},
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.suggestions).toHaveLength(2);
    });

    afterEach(() => {
      delete process.env.CLAWCONDOS_AGENT_WORKSPACES;
    });
  });

  describe('roles.applyAutoDetect', () => {
    it('applies role suggestions', () => {
      let result;
      handlers['roles.applyAutoDetect']({
        params: {
          suggestions: [
            { agentId: 'felix', role: 'frontend', description: 'React specialist' },
            { agentId: 'blake', role: 'backend', description: 'API developer' },
          ],
        },
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.applied).toBe(2);

      // Verify persistence
      const data = store.load();
      expect(data.config.agentRoles.frontend).toBe('felix');
      expect(data.config.agentRoles.backend).toBe('blake');
      expect(data.config.roles.frontend.description).toBe('React specialist');
      expect(data.config.roles.backend.description).toBe('API developer');
    });

    it('broadcasts roles.updated event', () => {
      handlers['roles.applyAutoDetect']({
        params: {
          suggestions: [{ agentId: 'felix', role: 'frontend' }],
        },
        respond: () => {},
      });

      expect(broadcastCalls.length).toBeGreaterThan(0);
      const event = broadcastCalls.find(c => c.event === 'roles.updated' && c.payload.action === 'autoDetect');
      expect(event).toBeTruthy();
      expect(event.payload.applied).toBe(1);
    });

    it('returns error if suggestions array is empty', () => {
      let result;
      handlers['roles.applyAutoDetect']({
        params: { suggestions: [] },
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(false);
      expect(result.err).toContain('suggestions array is required');
    });

    it('skips suggestions without required fields', () => {
      let result;
      handlers['roles.applyAutoDetect']({
        params: {
          suggestions: [
            { agentId: 'felix', role: 'frontend' },
            { agentId: 'blake' },  // Missing role
            { role: 'designer' },  // Missing agentId
          ],
        },
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.applied).toBe(1);
      expect(result.payload.results).toHaveLength(3);
      expect(result.payload.results[1].error).toBeDefined();
      expect(result.payload.results[2].error).toBeDefined();
    });
  });
});
