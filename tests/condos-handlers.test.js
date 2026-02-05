import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createGoalsStore } from '../openclaw-plugin/lib/goals-store.js';
import { createCondoHandlers } from '../openclaw-plugin/lib/condos-handlers.js';
import { createGoalHandlers } from '../openclaw-plugin/lib/goals-handlers.js';

const TEST_DIR = join(import.meta.dirname, '__fixtures__', 'condos-handlers-test');

function makeResponder() {
  let result = null;
  const respond = (ok, payload, error) => { result = { ok, payload, error }; };
  return { respond, getResult: () => result };
}

describe('CondoHandlers', () => {
  let store, handlers, goalHandlers;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = createGoalsStore(TEST_DIR);
    handlers = createCondoHandlers(store);
    goalHandlers = createGoalHandlers(store);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('condos.create', () => {
    it('creates a condo with required fields', () => {
      const { respond, getResult } = makeResponder();
      handlers['condos.create']({ params: { name: 'GenLayer' }, respond });
      const r = getResult();
      expect(r.ok).toBe(true);
      expect(r.payload.condo.name).toBe('GenLayer');
      expect(r.payload.condo.id).toMatch(/^condo_/);
      expect(r.payload.condo.description).toBe('');
      expect(r.payload.condo.color).toBeNull();
      expect(r.payload.condo.createdAtMs).toBeTypeOf('number');
      expect(r.payload.condo.updatedAtMs).toBeTypeOf('number');
    });

    it('rejects missing name', () => {
      const { respond, getResult } = makeResponder();
      handlers['condos.create']({ params: {}, respond });
      expect(getResult().ok).toBe(false);
      expect(getResult().error.message).toBe('name is required');
    });

    it('rejects empty string name', () => {
      const { respond, getResult } = makeResponder();
      handlers['condos.create']({ params: { name: '   ' }, respond });
      expect(getResult().ok).toBe(false);
      expect(getResult().error.message).toBe('name is required');
    });

    it('trims name', () => {
      const { respond, getResult } = makeResponder();
      handlers['condos.create']({ params: { name: '  GenLayer  ' }, respond });
      expect(getResult().payload.condo.name).toBe('GenLayer');
    });

    it('accepts optional fields', () => {
      const { respond, getResult } = makeResponder();
      handlers['condos.create']({
        params: { name: 'GenLayer', description: 'Layer 1 validator', color: '#ff0000' },
        respond,
      });
      const condo = getResult().payload.condo;
      expect(condo.description).toBe('Layer 1 validator');
      expect(condo.color).toBe('#ff0000');
    });
  });

  describe('condos.list', () => {
    it('returns empty list initially', () => {
      const { respond, getResult } = makeResponder();
      handlers['condos.list']({ params: {}, respond });
      expect(getResult().ok).toBe(true);
      expect(getResult().payload.condos).toEqual([]);
    });

    it('returns condos with goalCount enrichment', () => {
      // Create a condo
      const r1 = makeResponder();
      handlers['condos.create']({ params: { name: 'Project A' }, respond: r1.respond });
      const condoId = r1.getResult().payload.condo.id;

      // Create goals linked to this condo
      goalHandlers['goals.create']({
        params: { title: 'Goal 1', condoId },
        respond: makeResponder().respond,
      });
      goalHandlers['goals.create']({
        params: { title: 'Goal 2', condoId },
        respond: makeResponder().respond,
      });
      // Create a goal NOT linked to this condo
      goalHandlers['goals.create']({
        params: { title: 'Goal 3' },
        respond: makeResponder().respond,
      });

      const r2 = makeResponder();
      handlers['condos.list']({ params: {}, respond: r2.respond });
      const condos = r2.getResult().payload.condos;
      expect(condos).toHaveLength(1);
      expect(condos[0].goalCount).toBe(2);
    });

    it('returns multiple condos', () => {
      handlers['condos.create']({ params: { name: 'A' }, respond: makeResponder().respond });
      handlers['condos.create']({ params: { name: 'B' }, respond: makeResponder().respond });

      const { respond, getResult } = makeResponder();
      handlers['condos.list']({ params: {}, respond });
      expect(getResult().payload.condos).toHaveLength(2);
    });
  });

  describe('condos.get', () => {
    it('returns a condo by id with linked goals', () => {
      // Create condo
      const r1 = makeResponder();
      handlers['condos.create']({ params: { name: 'Project X' }, respond: r1.respond });
      const condoId = r1.getResult().payload.condo.id;

      // Create a goal linked to this condo
      const rg = makeResponder();
      goalHandlers['goals.create']({
        params: { title: 'Task 1', condoId },
        respond: rg.respond,
      });

      const r2 = makeResponder();
      handlers['condos.get']({ params: { id: condoId }, respond: r2.respond });
      expect(r2.getResult().ok).toBe(true);
      expect(r2.getResult().payload.condo.name).toBe('Project X');
      expect(r2.getResult().payload.goals).toHaveLength(1);
      expect(r2.getResult().payload.goals[0].title).toBe('Task 1');
    });

    it('returns error for missing condo', () => {
      const { respond, getResult } = makeResponder();
      handlers['condos.get']({ params: { id: 'condo_nonexistent' }, respond });
      expect(getResult().ok).toBe(false);
      expect(getResult().error.message).toBe('Condo not found');
    });
  });

  describe('condos.update', () => {
    it('patches allowed fields', () => {
      const r1 = makeResponder();
      handlers['condos.create']({ params: { name: 'Original' }, respond: r1.respond });
      const id = r1.getResult().payload.condo.id;

      const r2 = makeResponder();
      handlers['condos.update']({
        params: { id, name: 'Updated', description: 'New desc', color: '#00ff00' },
        respond: r2.respond,
      });
      const updated = r2.getResult().payload.condo;
      expect(updated.name).toBe('Updated');
      expect(updated.description).toBe('New desc');
      expect(updated.color).toBe('#00ff00');
      expect(updated.updatedAtMs).toBeGreaterThanOrEqual(updated.createdAtMs);
    });

    it('ignores internal fields in patch', () => {
      const r1 = makeResponder();
      handlers['condos.create']({ params: { name: 'Condo' }, respond: r1.respond });
      const condo = r1.getResult().payload.condo;

      const r2 = makeResponder();
      handlers['condos.update']({
        params: { id: condo.id, createdAtMs: 0, id: condo.id, name: 'Safe' },
        respond: r2.respond,
      });
      const updated = r2.getResult().payload.condo;
      expect(updated.name).toBe('Safe');
      expect(updated.createdAtMs).toBe(condo.createdAtMs);
    });

    it('trims name on update', () => {
      const r1 = makeResponder();
      handlers['condos.create']({ params: { name: 'C' }, respond: r1.respond });
      const id = r1.getResult().payload.condo.id;

      const r2 = makeResponder();
      handlers['condos.update']({ params: { id, name: '  Trimmed  ' }, respond: r2.respond });
      expect(r2.getResult().payload.condo.name).toBe('Trimmed');
    });

    it('rejects empty name after trim', () => {
      const r1 = makeResponder();
      handlers['condos.create']({ params: { name: 'C' }, respond: r1.respond });
      const id = r1.getResult().payload.condo.id;

      const r2 = makeResponder();
      handlers['condos.update']({ params: { id, name: '   ' }, respond: r2.respond });
      expect(r2.getResult().ok).toBe(false);
      expect(r2.getResult().error.message).toBe('name is required');
    });

    it('rejects non-string name', () => {
      const r1 = makeResponder();
      handlers['condos.create']({ params: { name: 'C' }, respond: r1.respond });
      const id = r1.getResult().payload.condo.id;

      const r2 = makeResponder();
      handlers['condos.update']({ params: { id, name: 123 }, respond: r2.respond });
      expect(r2.getResult().ok).toBe(false);
      expect(r2.getResult().error.message).toBe('name is required');
    });

    it('returns error for missing condo', () => {
      const { respond, getResult } = makeResponder();
      handlers['condos.update']({ params: { id: 'condo_nonexistent', name: 'X' }, respond });
      expect(getResult().ok).toBe(false);
      expect(getResult().error.message).toBe('Condo not found');
    });
  });

  describe('condos.delete', () => {
    it('deletes a condo and nullifies condoId on linked goals', () => {
      // Create condo
      const r1 = makeResponder();
      handlers['condos.create']({ params: { name: 'Doomed' }, respond: r1.respond });
      const condoId = r1.getResult().payload.condo.id;

      // Create goals linked to this condo
      const rg1 = makeResponder();
      goalHandlers['goals.create']({
        params: { title: 'Linked Goal', condoId },
        respond: rg1.respond,
      });
      const goalId = rg1.getResult().payload.goal.id;

      // Delete the condo
      const r2 = makeResponder();
      handlers['condos.delete']({ params: { id: condoId }, respond: r2.respond });
      expect(r2.getResult().ok).toBe(true);

      // Verify condo is gone
      const r3 = makeResponder();
      handlers['condos.list']({ params: {}, respond: r3.respond });
      expect(r3.getResult().payload.condos).toHaveLength(0);

      // Verify goal's condoId is nullified
      const r4 = makeResponder();
      goalHandlers['goals.get']({ params: { id: goalId }, respond: r4.respond });
      expect(r4.getResult().payload.goal.condoId).toBeNull();
    });

    it('returns error for missing condo', () => {
      const { respond, getResult } = makeResponder();
      handlers['condos.delete']({ params: { id: 'condo_nonexistent' }, respond });
      expect(getResult().ok).toBe(false);
      expect(getResult().error.message).toBe('Condo not found');
    });
  });
});
