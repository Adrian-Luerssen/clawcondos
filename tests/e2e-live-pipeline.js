#!/usr/bin/env node
/**
 * Full end-to-end live pipeline test.
 *
 * Runs against the REAL OpenClaw gateway with REAL LLM agents.
 * Creates a condo, clones a repo, plans via PM, creates goals/tasks,
 * kicks off agents, waits for completion, and verifies results.
 *
 * Usage:
 *   node tests/e2e-live-pipeline.js                  # full run
 *   node tests/e2e-live-pipeline.js --resume <condoId>  # resume from existing condo
 */

import WebSocket from 'ws';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import os from 'os';

// ── Config ──────────────────────────────────────────────────
const GATEWAY_WS = process.env.GATEWAY_WS_URL || 'ws://127.0.0.1:18789/ws';
const BEARER = process.env.GATEWAY_AUTH
  || (() => {
    try {
      const svc = readFileSync(join(os.homedir(), '.config/systemd/user/openclaw-gateway.service'), 'utf-8');
      return svc.match(/OPENCLAW_GATEWAY_TOKEN=(\S+)/)?.[1] || '';
    } catch { return ''; }
  })();
const PASSWORD = (() => {
  if (process.env.GATEWAY_PASSWORD) return process.env.GATEWAY_PASSWORD;
  try {
    const conf = JSON.parse(readFileSync(join(os.homedir(), '.openclaw/openclaw.json'), 'utf-8'));
    return conf?.gateway?.auth?.token || conf?.gateway?.auth?.password || '';
  } catch { return ''; }
})();

const REPO_URL = 'https://github.com/Adrian-Luerssen/clawcondos-test-project.git';
const PROJECT_DESC = `A recipe box — a personal web app to store, browse, and search your recipes.
Add recipes with a title, ingredients list, step-by-step instructions, prep/cook time, and tags (cuisine, meal type, dietary).
Browse by tag, search by ingredient or name, and mark favorites.
Single Node.js server, vanilla HTML/CSS/JS frontend, JSON file storage.
Clean minimal UI with a card grid layout.`;

const AGENT_TIMEOUT_MS = 15 * 60 * 1000; // 15 min total for all agents
const POLL_INTERVAL_MS = 15_000;          // poll every 15s
const PM_POLL_INTERVAL_MS = 5_000;        // poll PM every 5s
const PM_TIMEOUT_MS = 5 * 60 * 1000;     // 5 min for PM

// ── CLI args ────────────────────────────────────────────────
const args = process.argv.slice(2);
const resumeIdx = args.indexOf('--resume');
const RESUME_CONDO_ID = resumeIdx >= 0 ? args[resumeIdx + 1] : null;

// ── Helpers ─────────────────────────────────────────────────
let reqCounter = 0;
function nextId() { return 'e2e-' + (++reqCounter); }
function ts() { return new Date().toLocaleTimeString('en-GB'); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }
function logErr(msg) { console.error(`[${ts()}] ❌ ${msg}`); }
function logOk(msg) { console.log(`[${ts()}] ✅ ${msg}`); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Gateway client ──────────────────────────────────────────
let ws;
const pending = new Map();

function sendRpc(method, params, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const id = nextId();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`RPC timeout: ${method} (${timeoutMs}ms)`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ type: 'req', id, method, params }));
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(GATEWAY_WS, {
      headers: { Origin: 'http://127.0.0.1:18789', Authorization: 'Bearer ' + BEARER },
    });

    const timeout = setTimeout(() => { ws.terminate(); reject(new Error('Connect timeout')); }, 15_000);
    let authDone = false;

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        ws.send(JSON.stringify({
          type: 'req', id: nextId(), method: 'connect',
          params: {
            minProtocol: 3, maxProtocol: 3,
            client: { id: 'webchat-ui', displayName: 'E2E Pipeline', mode: 'webchat', version: '2.0.0', platform: 'node' },
            auth: { token: PASSWORD },
          },
        }));
        return;
      }

      // Auth result
      if (msg.type === 'res' && !authDone && !pending.has(msg.id)) {
        authDone = true;
        clearTimeout(timeout);
        if (msg.ok) resolve();
        else reject(new Error('Auth failed: ' + JSON.stringify(msg.error)));
        return;
      }

      // RPC responses
      if (msg.type === 'res' && msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.payload);
        else p.reject(new Error(msg.error?.message || JSON.stringify(msg.error)));
      }
    });

    ws.on('error', (e) => { clearTimeout(timeout); reject(e); });
    ws.on('close', () => {
      for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error('WS closed')); }
      pending.clear();
    });
  });
}

// ── Poll for PM response via chat.history ───────────────────
async function waitForPmResponse(pmSessionKey) {
  const deadline = Date.now() + PM_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const hist = await sendRpc('chat.history', { sessionKey: pmSessionKey, limit: 10 });
      const messages = hist?.messages || [];

      // Find the assistant response
      const assistant = messages.find(m => m.role === 'assistant');
      if (assistant) {
        // Extract text from content blocks
        const text = Array.isArray(assistant.content)
          ? assistant.content.filter(c => c.type === 'text').map(c => c.text).join('')
          : (typeof assistant.content === 'string' ? assistant.content : '');
        if (text.length > 0) return text;
      }
    } catch (err) {
      // Session might not exist yet, keep polling
      if (!err.message.includes('timeout')) {
        log(`  PM poll: ${err.message}`);
      }
    }

    await sleep(PM_POLL_INTERVAL_MS);
  }

  throw new Error(`PM response timeout (${PM_TIMEOUT_MS / 1000}s)`);
}

// ── Poll for goal completion ────────────────────────────────
async function waitForGoalsComplete(goalIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const completed = new Set();

  while (Date.now() < deadline) {
    log('── Progress ──');
    for (const goalId of goalIds) {
      if (completed.has(goalId)) continue;
      try {
        const { goal } = await sendRpc('goals.get', { id: goalId });
        const tasks = goal.tasks || [];
        const done = tasks.filter(t => t.status === 'done' || t.done).length;
        const total = tasks.length;
        const inProg = tasks.filter(t => t.status === 'in-progress').length;
        const pend = tasks.filter(t => t.status === 'pending').length;

        log(`  ${goal.title}: ${done}/${total} done, ${inProg} in-progress, ${pend} pending`);

        if (done === total && total > 0) {
          completed.add(goalId);
          logOk(`Goal "${goal.title}" — all ${total} tasks done!`);
        }

        // Re-kickoff to handle dependency chains — spawn newly unblocked tasks
        if (pend > 0 && done > 0) {
          try {
            const kick = await sendRpc('goals.kickoff', { goalId }, 30_000);
            if (kick.spawnedSessions?.length > 0) {
              log(`  ↳ Re-kickoff: ${kick.spawnedSessions.length} newly unblocked task(s)`);
              // Start the newly spawned agents
              for (const s of kick.spawnedSessions) {
                if (!s.taskContext) continue;
                try {
                  await sendRpc('chat.send', {
                    sessionKey: s.sessionKey,
                    message: s.taskContext,
                    idempotencyKey: 'e2e-rekick-' + s.taskId + '-' + Date.now(),
                  }, 30_000);
                  log(`    Started: ${s.assignedRole || s.agentId} → "${s.taskText}"`);
                } catch (err) {
                  logErr(`    Failed to start ${s.sessionKey}: ${err.message}`);
                }
              }
            }
          } catch {}
        }
      } catch (err) {
        logErr(`Error polling goal ${goalId}: ${err.message}`);
      }
    }

    if (completed.size === goalIds.length) return true;

    await sleep(POLL_INTERVAL_MS);
  }

  return completed.size === goalIds.length;
}

// ── Main pipeline ───────────────────────────────────────────
async function run() {
  log('═══════════════════════════════════════════════════');
  log('  Full E2E Pipeline — Recipe Box');
  log('═══════════════════════════════════════════════════');
  if (RESUME_CONDO_ID) log(`  Resuming from condo: ${RESUME_CONDO_ID}`);
  log('');

  // ── Step 1: Connect ──
  log('Step 1: Connecting to gateway...');
  await connect();
  logOk('Connected and authenticated');

  let condoId;
  let condoWsPath;

  if (RESUME_CONDO_ID) {
    // ── Resume mode: skip creation and PM ──
    condoId = RESUME_CONDO_ID;
    const { condo } = await sendRpc('condos.get', { id: condoId });
    condoWsPath = condo.workspace?.path;
    logOk(`Resumed condo: ${condo.name} (${condoId})`);
    if (condoWsPath) logOk(`Workspace: ${condoWsPath}`);
  } else {
    // ── Step 2: Create condo with repo ──
    log('');
    log('Step 2: Creating condo with repo clone...');
    const { condo } = await sendRpc('condos.create', {
      name: 'Recipe Box',
      description: PROJECT_DESC,
      repoUrl: REPO_URL,
      autonomyMode: 'full',
    }, 120_000);

    condoId = condo.id;
    condoWsPath = condo.workspace?.path;
    logOk(`Condo created: ${condo.name} (${condoId})`);
    if (condoWsPath) {
      logOk(`Workspace: ${condoWsPath}`);
      logOk(`Repo cloned from: ${condo.workspace.repoUrl}`);
    } else {
      logErr('No workspace created!');
    }

    // ── Step 3: PM planning ──
    log('');
    log('Step 3: Sending project to PM for planning...');
    const pmResult = await sendRpc('pm.condoChat', {
      condoId,
      message: PROJECT_DESC,
    }, 30_000);

    const pmSession = pmResult.pmSession;
    log(`  PM session: ${pmSession}`);

    await sendRpc('chat.send', {
      sessionKey: pmSession,
      message: pmResult.enrichedMessage,
      idempotencyKey: 'e2e-pm-' + Date.now(),
    }, 30_000);

    log('  PM agent started — polling for response...');
    const pmResponse = await waitForPmResponse(pmSession);
    logOk(`PM responded (${pmResponse.length} chars)`);
    log(`  Plan preview: ${pmResponse.substring(0, 300).replace(/\n/g, '\\n')}...`);

    // ── Step 4: Save PM response ──
    log('');
    log('Step 4: Saving PM response...');
    const saveResult = await sendRpc('pm.condoSaveResponse', {
      condoId,
      content: pmResponse,
    }, 15_000);
    logOk(`Plan saved (hasPlan: ${saveResult.hasPlan})`);

    // ── Step 5: Create goals from plan ──
    log('');
    log('Step 5: Creating goals from plan...');
    const goalsResult = await sendRpc('pm.condoCreateGoals', { condoId }, 30_000);
    logOk(`Created ${goalsResult.goalsCreated} goals:`);
    for (const g of goalsResult.goals) {
      log(`  • ${g.title} (${g.id}) — ${g.taskCount} tasks`);
    }
  }

  // From here on, works for both fresh and resumed runs
  try {
    // ── Fetch current goals ──
    const condoData = await sendRpc('condos.get', { id: condoId });
    condoWsPath = condoData.condo.workspace?.path;

    const allGoals = await sendRpc('goals.list', {});
    const condoGoals = (allGoals.goals || []).filter(g => g.condoId === condoId);
    const goalIds = condoGoals.map(g => g.id);

    log('');
    log(`Goals for condo: ${condoGoals.length}`);
    for (const g of condoGoals) {
      log(`  • ${g.title} — ${(g.tasks || []).length} tasks, status: ${g.status}`);
    }

    // ── Step 6: Verify worktrees ──
    log('');
    log('Step 6: Verifying worktrees...');
    for (const goalId of goalIds) {
      const { goal } = await sendRpc('goals.get', { id: goalId });
      if (goal.worktree?.path && existsSync(goal.worktree.path)) {
        logOk(`${goal.title}: worktree at ${goal.worktree.path} (branch: ${goal.worktree.branch})`);
      } else {
        logErr(`${goal.title}: no worktree! (worktree: ${JSON.stringify(goal.worktree)})`);
      }
    }

    // ── Step 7: Kickoff all goals ──
    log('');
    log('Step 7: Kicking off all goals...');
    const allSpawned = [];

    for (const goalId of goalIds) {
      const kickResult = await sendRpc('goals.kickoff', { goalId }, 60_000);
      const spawned = kickResult.spawnedSessions || [];
      if (spawned.length > 0) {
        log(`  Goal ${goalId}: spawned ${spawned.length} sessions`);
        for (const s of spawned) allSpawned.push({ ...s, goalId });
      } else {
        log(`  Goal ${goalId}: no new sessions to spawn`);
      }
    }
    logOk(`Spawned: ${allSpawned.length} new agent sessions`);

    // ── Step 8: Start agents via chat.send ──
    if (allSpawned.length > 0) {
      log('');
      log('Step 8: Starting agents via chat.send...');
      let started = 0;
      for (const s of allSpawned) {
        if (!s.taskContext) {
          logErr(`No taskContext for task ${s.taskId}`);
          continue;
        }
        try {
          await sendRpc('chat.send', {
            sessionKey: s.sessionKey,
            message: s.taskContext,
            idempotencyKey: 'e2e-kickoff-' + s.taskId + '-' + Date.now(),
          }, 30_000);
          started++;
          log(`  Started: ${s.assignedRole || s.agentId} → "${s.taskText}"`);
        } catch (err) {
          logErr(`Failed to start ${s.sessionKey}: ${err.message}`);
        }
      }
      logOk(`${started}/${allSpawned.length} agents started`);
    }

    // ── Step 9: Wait for completion ──
    log('');
    log('Step 9: Monitoring progress...');
    log(`  (polling every ${POLL_INTERVAL_MS / 1000}s, timeout ${AGENT_TIMEOUT_MS / 60_000} min)`);
    log('');

    const allDone = await waitForGoalsComplete(goalIds, AGENT_TIMEOUT_MS);

    // ── Step 10: Final report ──
    log('');
    log('═══════════════════════════════════════════════════');
    log('  FINAL REPORT');
    log('═══════════════════════════════════════════════════');
    log('');

    let totalTasks = 0, totalDone = 0;
    for (const goalId of goalIds) {
      const { goal } = await sendRpc('goals.get', { id: goalId });
      const tasks = goal.tasks || [];
      const done = tasks.filter(t => t.status === 'done' || t.done).length;
      totalTasks += tasks.length;
      totalDone += done;

      log(`${goal.status === 'done' || done === tasks.length ? '✅' : '⏳'} ${goal.title} (${done}/${tasks.length} tasks)`);
      for (const t of tasks) {
        const icon = t.status === 'done' ? '  ✅' : t.status === 'in-progress' ? '  🔄' : '  ⬜';
        log(`${icon} [${t.assignedAgent || '?'}] ${t.text}`);
        if (t.summary) log(`      → ${t.summary.substring(0, 120)}`);
      }

      // Show files in worktree
      if (goal.worktree?.path && existsSync(goal.worktree.path)) {
        try {
          const files = listFilesRecursive(goal.worktree.path, '', 3);
          if (files.length > 0) {
            log(`  📁 Files in worktree:`);
            for (const f of files.slice(0, 30)) log(`      ${f}`);
            if (files.length > 30) log(`      ... and ${files.length - 30} more`);
          }
        } catch {}
      }
      log('');
    }

    log(`Overall: ${totalDone}/${totalTasks} tasks completed`);
    log(`All done: ${allDone ? 'YES ✅' : 'NO ❌ (timed out)'}`);

    // Show workspace
    if (condoWsPath && existsSync(condoWsPath)) {
      log('');
      log('Workspace: ' + condoWsPath);
      try {
        const branches = execSync('git branch --list', { cwd: condoWsPath, encoding: 'utf-8' }).trim();
        log('Git branches:\n' + branches);
        log('');
        const worktrees = execSync('git worktree list', { cwd: condoWsPath, encoding: 'utf-8' }).trim();
        log('Git worktrees:\n' + worktrees);
      } catch {}
    }

    log('');
    log('Condo ID: ' + condoId);
    log('To resume: node tests/e2e-live-pipeline.js --resume ' + condoId);
    log('Done.');

  } catch (err) {
    logErr('Pipeline failed: ' + err.message);
    console.error(err);
    log('');
    log('Condo ID: ' + condoId);
    log('To resume: node tests/e2e-live-pipeline.js --resume ' + condoId);
  } finally {
    ws.close();
  }
}

function listFilesRecursive(dir, prefix, maxDepth) {
  if (maxDepth <= 0) return [];
  const results = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === 'goals') continue;
      const rel = prefix ? prefix + '/' + e.name : e.name;
      if (e.isDirectory()) {
        results.push(rel + '/');
        results.push(...listFilesRecursive(join(dir, e.name), rel, maxDepth - 1));
      } else {
        results.push(rel);
      }
    }
  } catch {}
  return results;
}

run().catch(err => {
  logErr('Fatal: ' + err.message);
  console.error(err);
  process.exit(1);
});
