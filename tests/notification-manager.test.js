import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createGoalsStore } from '../clawcondos/condo-management/lib/goals-store.js';
import {
  createNotification,
  markRead,
  dismiss,
  getUnreadCount,
  getNotifications,
  createNotificationHandlers,
} from '../clawcondos/condo-management/lib/notification-manager.js';

const TEST_DIR = join(import.meta.dirname, '__fixtures__', 'notification-manager-test');

describe('Notification Manager', () => {
  let store;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = createGoalsStore(TEST_DIR);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('createNotification', () => {
    it('creates a notification with required fields', () => {
      const notif = createNotification(store, {
        type: 'plan_approved',
        title: 'Test notification',
      });

      expect(notif).toHaveProperty('id');
      expect(notif.id).toMatch(/^notif_/);
      expect(notif.type).toBe('plan_approved');
      expect(notif.title).toBe('Test notification');
      expect(notif.read).toBe(false);
      expect(notif.dismissed).toBe(false);
      expect(notif.createdAtMs).toBeTypeOf('number');
    });

    it('includes optional fields', () => {
      const notif = createNotification(store, {
        type: 'plan_rejected',
        goalId: 'goal_123',
        taskId: 'task_456',
        sessionKey: 'agent:main:main',
        title: 'Plan rejected',
        detail: 'Please revise',
      });

      expect(notif.goalId).toBe('goal_123');
      expect(notif.taskId).toBe('task_456');
      expect(notif.sessionKey).toBe('agent:main:main');
      expect(notif.detail).toBe('Please revise');
    });

    it('persists notifications', () => {
      createNotification(store, { type: 'test', title: 'Test' });
      
      const data = store.load();
      expect(data.notifications).toHaveLength(1);
    });

    it('trims notifications to 500', () => {
      // Create 510 notifications
      for (let i = 0; i < 510; i++) {
        createNotification(store, { type: 'test', title: `Test ${i}` });
      }
      
      const data = store.load();
      expect(data.notifications).toHaveLength(500);
      // Most recent should be preserved
      expect(data.notifications[499].title).toBe('Test 509');
    });
  });

  describe('markRead', () => {
    it('marks notifications as read', () => {
      const n1 = createNotification(store, { type: 'test', title: 'Test 1' });
      const n2 = createNotification(store, { type: 'test', title: 'Test 2' });

      const count = markRead(store, [n1.id, n2.id]);
      expect(count).toBe(2);

      const data = store.load();
      expect(data.notifications[0].read).toBe(true);
      expect(data.notifications[1].read).toBe(true);
    });

    it('returns 0 for empty array', () => {
      const count = markRead(store, []);
      expect(count).toBe(0);
    });

    it('does not re-mark already read notifications', () => {
      const n1 = createNotification(store, { type: 'test', title: 'Test' });
      markRead(store, [n1.id]);
      
      const count = markRead(store, [n1.id]);
      expect(count).toBe(0);
    });
  });

  describe('dismiss', () => {
    it('dismisses a notification', () => {
      const n1 = createNotification(store, { type: 'test', title: 'Test' });
      
      const result = dismiss(store, n1.id);
      expect(result).toBe(true);

      const data = store.load();
      expect(data.notifications[0].dismissed).toBe(true);
    });

    it('returns false for nonexistent notification', () => {
      const result = dismiss(store, 'notif_nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getUnreadCount', () => {
    it('returns 0 for no notifications', () => {
      expect(getUnreadCount(store)).toBe(0);
    });

    it('counts unread notifications', () => {
      createNotification(store, { type: 'test', title: 'Test 1' });
      createNotification(store, { type: 'test', title: 'Test 2' });
      
      expect(getUnreadCount(store)).toBe(2);
    });

    it('excludes read notifications', () => {
      const n1 = createNotification(store, { type: 'test', title: 'Test 1' });
      createNotification(store, { type: 'test', title: 'Test 2' });
      markRead(store, [n1.id]);
      
      expect(getUnreadCount(store)).toBe(1);
    });

    it('excludes dismissed notifications', () => {
      const n1 = createNotification(store, { type: 'test', title: 'Test 1' });
      createNotification(store, { type: 'test', title: 'Test 2' });
      dismiss(store, n1.id);
      
      expect(getUnreadCount(store)).toBe(1);
    });
  });

  describe('getNotifications', () => {
    it('returns notifications sorted by createdAtMs descending', async () => {
      createNotification(store, { type: 'test', title: 'First' });
      // Small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 5));
      createNotification(store, { type: 'test', title: 'Second' });
      
      const notifs = getNotifications(store);
      expect(notifs[0].title).toBe('Second');
      expect(notifs[1].title).toBe('First');
    });

    it('filters by unreadOnly', () => {
      const n1 = createNotification(store, { type: 'test', title: 'Read' });
      createNotification(store, { type: 'test', title: 'Unread' });
      markRead(store, [n1.id]);
      
      const notifs = getNotifications(store, { unreadOnly: true });
      expect(notifs).toHaveLength(1);
      expect(notifs[0].title).toBe('Unread');
    });

    it('filters by type', () => {
      createNotification(store, { type: 'plan_approved', title: 'Approved' });
      createNotification(store, { type: 'plan_rejected', title: 'Rejected' });
      
      const notifs = getNotifications(store, { type: 'plan_approved' });
      expect(notifs).toHaveLength(1);
      expect(notifs[0].title).toBe('Approved');
    });

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) {
        createNotification(store, { type: 'test', title: `Test ${i}` });
      }
      
      const notifs = getNotifications(store, { limit: 5 });
      expect(notifs).toHaveLength(5);
    });
  });

  describe('RPC handlers', () => {
    it('notifications.list returns notifications and unread count', () => {
      createNotification(store, { type: 'test', title: 'Test' });
      
      const handlers = createNotificationHandlers(store);
      let result;
      handlers['notifications.list']({
        params: {},
        respond: (ok, payload) => { result = { ok, payload }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.notifications).toHaveLength(1);
      expect(result.payload.unreadCount).toBe(1);
    });

    it('notifications.markRead marks notifications', () => {
      const n1 = createNotification(store, { type: 'test', title: 'Test' });
      
      const handlers = createNotificationHandlers(store);
      let result;
      handlers['notifications.markRead']({
        params: { ids: [n1.id] },
        respond: (ok, payload) => { result = { ok, payload }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.marked).toBe(1);
    });

    it('notifications.dismiss dismisses a notification', () => {
      const n1 = createNotification(store, { type: 'test', title: 'Test' });
      
      const handlers = createNotificationHandlers(store);
      let result;
      handlers['notifications.dismiss']({
        params: { id: n1.id },
        respond: (ok, payload) => { result = { ok, payload }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.dismissed).toBe(true);
    });

    it('notifications.unreadCount returns count', () => {
      createNotification(store, { type: 'test', title: 'Test 1' });
      createNotification(store, { type: 'test', title: 'Test 2' });
      
      const handlers = createNotificationHandlers(store);
      let result;
      handlers['notifications.unreadCount']({
        respond: (ok, payload) => { result = { ok, payload }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.count).toBe(2);
    });
  });
});
