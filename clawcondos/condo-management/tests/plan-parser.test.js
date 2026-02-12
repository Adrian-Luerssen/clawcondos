/**
 * Tests for plan-parser - parsing tasks from PM plans
 */
import { test, describe } from 'node:test';
import { strict as assert } from 'assert';
import {
  normalizeAgentToRole,
  parseTasksFromTable,
  parseTasksFromLists,
  detectPlan,
  parseTasksFromPlan,
  getSupportedRoles,
} from '../lib/plan-parser.js';

describe('Plan Parser - Agent Normalization', () => {
  test('normalizes Félix to frontend', () => {
    assert.equal(normalizeAgentToRole('Félix'), 'frontend');
    assert.equal(normalizeAgentToRole('Felix'), 'frontend');
    assert.equal(normalizeAgentToRole('Félix 🎨'), 'frontend');
    assert.equal(normalizeAgentToRole('🎨 Félix'), 'frontend');
    assert.equal(normalizeAgentToRole('FELIX'), 'frontend');
  });

  test('normalizes Blake to backend', () => {
    assert.equal(normalizeAgentToRole('Blake'), 'backend');
    assert.equal(normalizeAgentToRole('Blake 🔧'), 'backend');
    assert.equal(normalizeAgentToRole('🔧 Blake'), 'backend');
    assert.equal(normalizeAgentToRole('backend'), 'backend');
  });

  test('normalizes Dana to designer', () => {
    assert.equal(normalizeAgentToRole('Dana'), 'designer');
    assert.equal(normalizeAgentToRole('Dana ✨'), 'designer');
    assert.equal(normalizeAgentToRole('designer'), 'designer');
  });

  test('normalizes Quinn to tester', () => {
    assert.equal(normalizeAgentToRole('Quinn'), 'tester');
    assert.equal(normalizeAgentToRole('Quinn 🧪'), 'tester');
    assert.equal(normalizeAgentToRole('qa'), 'tester');
    assert.equal(normalizeAgentToRole('tester'), 'tester');
  });

  test('normalizes Devon to devops', () => {
    assert.equal(normalizeAgentToRole('Devon'), 'devops');
    assert.equal(normalizeAgentToRole('Devon 🚀'), 'devops');
    assert.equal(normalizeAgentToRole('devops'), 'devops');
  });

  test('normalizes Claudia to pm', () => {
    assert.equal(normalizeAgentToRole('Claudia'), 'pm');
    assert.equal(normalizeAgentToRole('Claudia 📋'), 'pm');
    assert.equal(normalizeAgentToRole('pm'), 'pm');
  });

  test('returns null for empty/null input', () => {
    assert.equal(normalizeAgentToRole(null), null);
    assert.equal(normalizeAgentToRole(''), null);
    assert.equal(normalizeAgentToRole(undefined), null);
  });

  test('returns trimmed input for unknown agents', () => {
    assert.equal(normalizeAgentToRole('  CustomAgent  '), 'CustomAgent');
  });
});

describe('Plan Parser - Table Parsing', () => {
  test('parses basic task table', () => {
    const content = `
## Plan

| # | Task | Agent | Time |
|---|------|-------|------|
| 1 | Create login page | Félix 🎨 | 2h |
| 2 | Add API endpoint | Blake 🔧 | 1h |
| 3 | Design mockups | Dana ✨ | 3h |
`;

    const tasks = parseTasksFromTable(content);
    
    assert.equal(tasks.length, 3);
    assert.equal(tasks[0].text, 'Create login page');
    assert.equal(tasks[0].agent, 'frontend');
    assert.equal(tasks[0].time, '2h');
    
    assert.equal(tasks[1].text, 'Add API endpoint');
    assert.equal(tasks[1].agent, 'backend');
    
    assert.equal(tasks[2].text, 'Design mockups');
    assert.equal(tasks[2].agent, 'designer');
  });

  test('handles table without time column', () => {
    const content = `
| Task | Agent |
|------|-------|
| Write tests | Quinn |
| Deploy | Devon |
`;

    const tasks = parseTasksFromTable(content);
    
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].text, 'Write tests');
    assert.equal(tasks[0].agent, 'tester');
    assert.equal(tasks[1].text, 'Deploy');
    assert.equal(tasks[1].agent, 'devops');
  });

  test('returns empty array for non-table content', () => {
    const content = 'Just some regular text without tables';
    const tasks = parseTasksFromTable(content);
    assert.deepEqual(tasks, []);
  });

  test('returns empty array for null/undefined', () => {
    assert.deepEqual(parseTasksFromTable(null), []);
    assert.deepEqual(parseTasksFromTable(undefined), []);
  });
});

describe('Plan Parser - List Parsing', () => {
  test('parses tasks with parenthetical agent', () => {
    const content = `
## Tasks

- Create login form (Félix)
- Add authentication endpoint (Blake)
- Design user flow (Dana)
`;

    const tasks = parseTasksFromLists(content);
    
    assert.equal(tasks.length, 3);
    assert.equal(tasks[0].text, 'Create login form');
    assert.equal(tasks[0].agent, 'frontend');
    assert.equal(tasks[1].text, 'Add authentication endpoint');
    assert.equal(tasks[1].agent, 'backend');
    assert.equal(tasks[2].text, 'Design user flow');
    assert.equal(tasks[2].agent, 'designer');
  });

  test('parses tasks with dash-separated agent', () => {
    const content = `
- Implement feature — Blake
- Style component — Félix
`;

    const tasks = parseTasksFromLists(content);
    
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].text, 'Implement feature');
    assert.equal(tasks[0].agent, 'backend');
  });

  test('parses numbered list tasks', () => {
    const content = `
1. Create component (Frontend)
2. Add tests (QA)
`;

    const tasks = parseTasksFromLists(content);
    
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].text, 'Create component');
    assert.equal(tasks[0].agent, 'frontend');
  });

  test('parses checkbox-style tasks', () => {
    const content = `
- [ ] Review PR (Quinn)
- [x] Deploy to staging (Devon)
`;

    const tasks = parseTasksFromLists(content);
    
    assert.equal(tasks.length, 2);
  });

  test('returns empty array for null/undefined', () => {
    assert.deepEqual(parseTasksFromLists(null), []);
    assert.deepEqual(parseTasksFromLists(undefined), []);
  });
});

describe('Plan Parser - Plan Detection', () => {
  test('detects ## Plan header', () => {
    assert(detectPlan('Some text\n## Plan\nMore text'));
    assert(detectPlan('## plan'));
    assert(detectPlan('## PLAN'));
  });

  test('detects ## Tasks header', () => {
    assert(detectPlan('## Tasks\n- Task 1'));
  });

  test('detects awaiting approval marker', () => {
    assert(detectPlan('Status: Awaiting approval'));
    assert(detectPlan('⏳ Awaiting approval'));
    assert(detectPlan('pending approval from user'));
  });

  test('detects task tables', () => {
    assert(detectPlan('| Task | Agent |'));
    assert(detectPlan('| # | Task | Time |'));
  });

  test('detects tasks with agent in parentheses', () => {
    assert(detectPlan('1. Create component (Félix)'));
    assert(detectPlan('- Add endpoint (Blake)'));
  });

  test('returns false for regular content', () => {
    assert(!detectPlan('Just a regular message'));
    assert(!detectPlan('Some code:\n```js\nconst x = 1;\n```'));
    assert(!detectPlan(''));
    assert(!detectPlan(null));
  });
});

describe('Plan Parser - Full Plan Parsing', () => {
  test('parses complex plan with table and lists', () => {
    const content = `
## Plan

Here's the implementation plan:

| # | Task | Agent | Time |
|---|------|-------|------|
| 1 | Create React component | Félix 🎨 | 2h |
| 2 | Add REST endpoint | Blake 🔧 | 1.5h |

Additional tasks:
- Write unit tests (Quinn)
- Update documentation (Claudia)

Status: Awaiting Approval
`;

    const { tasks, hasPlan } = parseTasksFromPlan(content);
    
    assert(hasPlan, 'Should detect as plan');
    assert(tasks.length >= 4, `Should have at least 4 tasks, got ${tasks.length}`);
    
    // Check for frontend task
    const frontendTask = tasks.find(t => t.agent === 'frontend');
    assert(frontendTask, 'Should have frontend task');
    assert(frontendTask.text.includes('React component'));
    
    // Check for backend task  
    const backendTask = tasks.find(t => t.agent === 'backend');
    assert(backendTask, 'Should have backend task');
  });

  test('deduplicates tasks from tables and lists', () => {
    const content = `
| Task | Agent |
|------|-------|
| Create form | Félix |

- Create form (Félix)
`;

    const { tasks } = parseTasksFromPlan(content);
    
    // Should dedupe the same task
    const formTasks = tasks.filter(t => t.text.toLowerCase().includes('create form'));
    assert.equal(formTasks.length, 1, 'Should dedupe identical tasks');
  });

  test('returns empty tasks for non-plan content', () => {
    const { tasks, hasPlan } = parseTasksFromPlan('Just a regular message');
    
    assert(!hasPlan);
    assert.deepEqual(tasks, []);
  });
});

describe('Plan Parser - Utility Functions', () => {
  test('getSupportedRoles returns all roles', () => {
    const roles = getSupportedRoles();
    
    assert(roles.includes('frontend'));
    assert(roles.includes('backend'));
    assert(roles.includes('designer'));
    assert(roles.includes('tester'));
    assert(roles.includes('devops'));
    assert(roles.includes('pm'));
  });
});
