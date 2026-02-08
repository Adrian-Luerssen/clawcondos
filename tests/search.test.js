import { describe, it, expect } from 'vitest';
import { filterGoals, filterSessions } from '../lib/search.js';

describe('filterGoals', () => {
  const goals = [
    { id: '1', title: 'Rebrand Dashboard', description: 'Update the UI', notes: '', tasks: [{ text: 'Fix CSS', description: '' }] },
    { id: '2', title: 'API Refactor', description: '', notes: 'migrate to v2', tasks: [] },
    { id: '3', title: 'Bug Fixes', description: '', notes: '', tasks: [{ text: 'Fix login page', description: 'authentication broken' }] },
  ];

  it('matches on title', () => {
    const r = filterGoals(goals, 'rebrand');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('1');
  });

  it('matches on description', () => {
    const r = filterGoals(goals, 'update the ui');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('1');
  });

  it('matches on notes', () => {
    const r = filterGoals(goals, 'migrate');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('2');
  });

  it('matches on task text', () => {
    const r = filterGoals(goals, 'fix css');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('1');
  });

  it('matches on task description', () => {
    const r = filterGoals(goals, 'authentication');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('3');
  });

  it('case insensitive', () => {
    expect(filterGoals(goals, 'DASHBOARD')).toHaveLength(1);
  });

  it('returns empty for no match', () => {
    expect(filterGoals(goals, 'zzz')).toHaveLength(0);
  });

  it('returns empty for empty query', () => {
    expect(filterGoals(goals, '')).toHaveLength(0);
  });

  it('handles null/undefined input', () => {
    expect(filterGoals(null, 'test')).toHaveLength(0);
    expect(filterGoals(undefined, 'test')).toHaveLength(0);
  });
});

describe('filterSessions', () => {
  const sessions = [
    { key: 'agent:main:main', displayName: 'Main Session', label: '' },
    { key: 'agent:main:telegram:group:123:topic:456', displayName: 'Chat about weather', label: 'telegram' },
    { key: 'cron:daily-report', displayName: 'Daily Report', label: 'cron' },
  ];

  it('matches on displayName', () => {
    const r = filterSessions(sessions, 'weather');
    expect(r).toHaveLength(1);
    expect(r[0].key).toBe('agent:main:telegram:group:123:topic:456');
  });

  it('matches on key', () => {
    const r = filterSessions(sessions, 'cron:daily');
    expect(r).toHaveLength(1);
    expect(r[0].key).toBe('cron:daily-report');
  });

  it('matches on label', () => {
    const r = filterSessions(sessions, 'telegram');
    expect(r).toHaveLength(1);
  });

  it('returns empty for no match', () => {
    expect(filterSessions(sessions, 'zzz')).toHaveLength(0);
  });

  it('returns empty for empty query', () => {
    expect(filterSessions(sessions, '')).toHaveLength(0);
  });

  it('handles null/undefined input', () => {
    expect(filterSessions(null, 'test')).toHaveLength(0);
  });
});
