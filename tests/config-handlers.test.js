import { describe, it, expect, beforeEach } from 'vitest';
import { createConfigHandlers } from '../clawcondos/condo-management/lib/config-handlers.js';

describe('config-handlers', () => {
  let store;
  let data;
  let handlers;

  beforeEach(() => {
    data = {
      version: 2,
      goals: [],
      condos: [],
      sessionIndex: {},
      sessionCondoIndex: {},
      notifications: [],
      config: {},
    };

    store = {
      load: () => data,
      save: (newData) => { data = newData; },
      newId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`,
    };

    handlers = createConfigHandlers(store);
  });

  function callHandler(method, params = {}) {
    return new Promise((resolve) => {
      handlers[method]({
        params,
        respond: (success, result, error) => {
          resolve({ success, result, error });
        },
      });
    });
  }

  describe('config.get', () => {
    it('returns empty config by default', async () => {
      const { success, result } = await callHandler('config.get', {});
      expect(success).toBe(true);
      // Config has agentRoles: {} when empty
      expect(result.config.agentRoles).toEqual({});
      expect(result.defaults.agentRoles).toHaveProperty('pm');
      expect(result.defaults.pmSession).toBe('agent:main:main');
    });

    it('returns configured values', async () => {
      data.config = {
        pmSession: 'agent:claudia:main',
        agentRoles: { backend: 'blake' },
      };

      const { success, result } = await callHandler('config.get', {});
      expect(success).toBe(true);
      expect(result.config.pmSession).toBe('agent:claudia:main');
      expect(result.config.agentRoles.backend).toBe('blake');
      expect(result.effective.pmSession).toBe('agent:claudia:main');
      expect(result.effective.agentRoles.backend).toBe('blake');
    });
  });

  describe('config.set', () => {
    it('sets pmSession', async () => {
      const { success, result } = await callHandler('config.set', {
        pmSession: 'agent:custom-pm:main',
      });

      expect(success).toBe(true);
      expect(result.ok).toBe(true);
      expect(data.config.pmSession).toBe('agent:custom-pm:main');
    });

    it('clears pmSession with null', async () => {
      data.config.pmSession = 'agent:old:main';
      
      const { success } = await callHandler('config.set', {
        pmSession: null,
      });

      expect(success).toBe(true);
      expect(data.config.pmSession).toBeUndefined();
    });

    it('sets agentRoles (merges)', async () => {
      data.config.agentRoles = { pm: 'claudia' };
      
      const { success } = await callHandler('config.set', {
        agentRoles: { backend: 'blake', frontend: 'felix' },
      });

      expect(success).toBe(true);
      expect(data.config.agentRoles.pm).toBe('claudia');
      expect(data.config.agentRoles.backend).toBe('blake');
      expect(data.config.agentRoles.frontend).toBe('felix');
    });

    it('removes role mapping with null', async () => {
      data.config.agentRoles = { backend: 'blake' };
      
      const { success } = await callHandler('config.set', {
        agentRoles: { backend: null },
      });

      expect(success).toBe(true);
      expect(data.config.agentRoles).toBeUndefined(); // Cleaned up empty object
    });

    it('sets allowed fields', async () => {
      const { success } = await callHandler('config.set', {
        defaultModel: 'claude-opus',
        defaultAutonomy: 'auto',
      });

      expect(success).toBe(true);
      expect(data.config.defaultModel).toBe('claude-opus');
      expect(data.config.defaultAutonomy).toBe('auto');
    });
  });

  describe('config.setRole', () => {
    it('sets a single role mapping', async () => {
      const { success, result } = await callHandler('config.setRole', {
        role: 'Backend',
        agentId: 'blake',
      });

      expect(success).toBe(true);
      expect(result.role).toBe('backend'); // Lowercase
      expect(result.agentId).toBe('blake');
      expect(result.resolved).toBe('blake');
      expect(data.config.agentRoles.backend).toBe('blake');
    });

    it('sets role with description', async () => {
      const { success, result } = await callHandler('config.setRole', {
        role: 'frontend',
        agentId: 'felix',
        description: 'UI/UX and React specialist',
      });

      expect(success).toBe(true);
      expect(result.role).toBe('frontend');
      expect(result.description).toBe('UI/UX and React specialist');
      expect(data.config.agentRoles.frontend).toBe('felix');
      expect(data.config.roles.frontend.description).toBe('UI/UX and React specialist');
    });

    it('updates description only', async () => {
      data.config.agentRoles = { backend: 'blake' };
      
      const { success, result } = await callHandler('config.setRole', {
        role: 'backend',
        agentId: 'blake',
        description: 'API and database specialist',
      });

      expect(success).toBe(true);
      expect(result.description).toBe('API and database specialist');
      expect(data.config.roles.backend.description).toBe('API and database specialist');
    });

    it('clears description with null', async () => {
      data.config.agentRoles = { backend: 'blake' };
      data.config.roles = { backend: { description: 'Old description' } };
      
      const { success, result } = await callHandler('config.setRole', {
        role: 'backend',
        agentId: 'blake',
        description: null,
      });

      expect(success).toBe(true);
      expect(result.description).toBeNull();
      expect(data.config.roles).toBeUndefined(); // Cleaned up empty object
    });

    it('clears role mapping with null', async () => {
      data.config.agentRoles = { backend: 'blake' };
      
      const { success } = await callHandler('config.setRole', {
        role: 'backend',
        agentId: null,
      });

      expect(success).toBe(true);
      expect(data.config.agentRoles).toBeUndefined();
    });

    it('returns error for missing role', async () => {
      const { success, error } = await callHandler('config.setRole', {});
      expect(success).toBe(false);
      expect(error).toContain('role is required');
    });
  });

  describe('config.getRole', () => {
    it('returns configured role', async () => {
      data.config.agentRoles = { backend: 'blake' };
      
      const { success, result } = await callHandler('config.getRole', {
        role: 'backend',
      });

      expect(success).toBe(true);
      expect(result.agentId).toBe('blake');
      expect(result.configured).toBe('blake');
      expect(result.default).toBe('backend');
    });

    it('returns default for unconfigured role', async () => {
      const { success, result } = await callHandler('config.getRole', {
        role: 'pm',
      });

      expect(success).toBe(true);
      // When not configured and no env var, falls back to role name
      expect(result.agentId).toBe(result.default);
      expect(result.configured).toBeNull();
    });
  });

  describe('config.listRoles', () => {
    it('lists all roles with resolution', async () => {
      data.config.agentRoles = { backend: 'blake' };
      
      const { success, result } = await callHandler('config.listRoles', {});

      expect(success).toBe(true);
      expect(result.roles.backend.agentId).toBe('blake');
      expect(result.roles.backend.configured).toBe('blake');
      // When not configured and no env var, falls back to default (from getDefaultRoles)
      expect(result.roles.pm).toBeDefined();
      expect(result.roles.pm.configured).toBeNull();
    });

    it('includes role descriptions', async () => {
      data.config.agentRoles = { frontend: 'felix' };
      data.config.roles = {
        frontend: { description: 'UI/UX specialist' },
        backend: { description: 'API developer' },
      };
      
      const { success, result } = await callHandler('config.listRoles', {});

      expect(success).toBe(true);
      expect(result.roles.frontend.description).toBe('UI/UX specialist');
      expect(result.roles.backend.description).toBe('API developer');
      expect(result.roles.pm.description).toBeNull();  // No description set
    });
  });
});
