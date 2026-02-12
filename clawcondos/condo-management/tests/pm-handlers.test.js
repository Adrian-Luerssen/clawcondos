/**
 * Tests for PM handlers - specifically the chat history functionality
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'assert';
import { createGoalsStore } from '../lib/goals-store.js';
import { createPmHandlers } from '../lib/pm-handlers.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Test context shared across tests
let tempDir;
let store;
let handlers;

// Helper to create a respond function that captures the result
function createResponder() {
  let result = null;
  const respond = (success, data, error) => {
    result = { success, data, error };
  };
  return { respond, getResult: () => result };
}

// Setup: create a condo
function setupCondo(condoId = 'test-condo') {
  const data = store.load();
  data.condos.push({
    id: condoId,
    name: 'Test Condo',
    createdAtMs: Date.now(),
  });
  data.config = { pmSession: 'agent:test:main' };
  store.save(data);
  return condoId;
}

describe('PM Handlers - Chat History', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pm-handlers-test-'));
    store = createGoalsStore(tempDir);
    
    // Mock sendToSession that returns a canned response
    const mockSendToSession = async (session, payload) => {
      return { text: `Mock response to: ${payload.message.slice(-50)}` };
    };
    
    handlers = createPmHandlers(store, { 
      sendToSession: mockSendToSession,
      logger: { info: () => {}, error: () => {} }
    });
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test('pm.getHistory returns empty array for new condo', async () => {
    const condoId = setupCondo();
    const { respond, getResult } = createResponder();
    
    await handlers['pm.getHistory']({ params: { condoId }, respond });
    
    const result = getResult();
    assert(result.success, 'Should succeed');
    assert.deepEqual(result.data.messages, [], 'Should return empty array');
    assert.equal(result.data.total, 0, 'Total should be 0');
  });

  test('pm.chat saves user and assistant messages to history', async () => {
    const condoId = setupCondo();
    const { respond, getResult } = createResponder();
    
    // Send a chat message
    await handlers['pm.chat']({ 
      params: { condoId, message: 'Hello PM!' }, 
      respond 
    });
    
    const chatResult = getResult();
    assert(chatResult.success, 'Chat should succeed');
    assert(chatResult.data.history, 'Should return history');
    assert(chatResult.data.history.length >= 2, 'Should have user and assistant messages');
    
    // Check history via getHistory
    const { respond: respond2, getResult: getResult2 } = createResponder();
    await handlers['pm.getHistory']({ params: { condoId }, respond: respond2 });
    
    const historyResult = getResult2();
    assert(historyResult.success, 'getHistory should succeed');
    assert.equal(historyResult.data.messages.length, 2, 'Should have 2 messages');
    assert.equal(historyResult.data.messages[0].role, 'user', 'First should be user');
    assert.equal(historyResult.data.messages[0].content, 'Hello PM!', 'Content should match');
    assert.equal(historyResult.data.messages[1].role, 'assistant', 'Second should be assistant');
  });

  test('pm.clearHistory clears all messages', async () => {
    const condoId = setupCondo();
    
    // Add some messages first
    const { respond: r1 } = createResponder();
    await handlers['pm.chat']({ params: { condoId, message: 'Message 1' }, respond: r1 });
    
    const { respond: r2 } = createResponder();
    await handlers['pm.chat']({ params: { condoId, message: 'Message 2' }, respond: r2 });
    
    // Verify we have messages
    const { respond: r3, getResult: gr3 } = createResponder();
    await handlers['pm.getHistory']({ params: { condoId }, respond: r3 });
    assert.equal(gr3().data.total, 4, 'Should have 4 messages (2 user + 2 assistant)');
    
    // Clear history
    const { respond: r4, getResult: gr4 } = createResponder();
    await handlers['pm.clearHistory']({ params: { condoId }, respond: r4 });
    
    const clearResult = gr4();
    assert(clearResult.success, 'Clear should succeed');
    assert.equal(clearResult.data.cleared, 4, 'Should report 4 cleared');
    
    // Verify empty
    const { respond: r5, getResult: gr5 } = createResponder();
    await handlers['pm.getHistory']({ params: { condoId }, respond: r5 });
    assert.equal(gr5().data.total, 0, 'Should be empty after clear');
  });

  test('pm.getHistory respects limit parameter', async () => {
    const condoId = setupCondo();
    
    // Add messages
    const { respond: r1 } = createResponder();
    await handlers['pm.chat']({ params: { condoId, message: 'Msg 1' }, respond: r1 });
    const { respond: r2 } = createResponder();
    await handlers['pm.chat']({ params: { condoId, message: 'Msg 2' }, respond: r2 });
    const { respond: r3 } = createResponder();
    await handlers['pm.chat']({ params: { condoId, message: 'Msg 3' }, respond: r3 });
    
    // Get with limit=2
    const { respond: r4, getResult: gr4 } = createResponder();
    await handlers['pm.getHistory']({ params: { condoId, limit: 2 }, respond: r4 });
    
    const result = gr4();
    assert.equal(result.data.messages.length, 2, 'Should return only 2 messages');
    assert.equal(result.data.total, 6, 'Total should still be 6');
  });

  test('pm.getHistory fails without condoId', async () => {
    const { respond: r1, getResult: gr1 } = createResponder();
    await handlers['pm.getHistory']({ params: {}, respond: r1 });
    assert(!gr1().success, 'Should fail without condoId');
    assert(gr1().error.includes('condoId'), 'Error should mention condoId');
  });

  test('pm.clearHistory fails without condoId', async () => {
    const { respond: r1, getResult: gr1 } = createResponder();
    await handlers['pm.clearHistory']({ params: {}, respond: r1 });
    assert(!gr1().success, 'Should fail without condoId');
  });

  test('pm.getHistory fails for nonexistent condo', async () => {
    const { respond: r1, getResult: gr1 } = createResponder();
    await handlers['pm.getHistory']({ params: { condoId: 'nonexistent' }, respond: r1 });
    assert(!gr1().success, 'Should fail for nonexistent condo');
    assert(gr1().error.includes('not found'), 'Error should mention not found');
  });

  test('pm.clearHistory fails for nonexistent condo', async () => {
    const { respond: r1, getResult: gr1 } = createResponder();
    await handlers['pm.clearHistory']({ params: { condoId: 'nonexistent' }, respond: r1 });
    assert(!gr1().success, 'Should fail for nonexistent condo');
  });
});
