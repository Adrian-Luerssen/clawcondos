/**
 * Frontend Goals Tests
 *
 * Tests the real-time goal refresh infrastructure and tracked files UI
 * added to index.html. Since the frontend is vanilla JS (no modules),
 * we replicate the pure functions here and test them in isolation.
 *
 * Covered functionality:
 * - GOAL_TOOL_NAMES set (which tool names trigger goal refresh)
 * - getFileIcon() extension-to-emoji mapping
 * - debouncedGoalRefresh() debounce behaviour
 * - renderGoalView() tracked files section (DOM rendering)
 * - removeGoalFile() RPC call and refresh cycle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ════════════════════════════════════════════════════════════════
// Replicated pure functions from index.html (no module exports)
// ════════════════════════════════════════════════════════════════

const GOAL_TOOL_NAMES = new Set([
  'goal_update',
  'condo_bind',
  'condo_create_goal',
  'condo_add_task',
  'condo_spawn_task',
]);

function getFileIcon(ext) {
  const map = {
    js: '📜', ts: '📜', mjs: '📜', cjs: '📜',
    json: '📋', yaml: '📋', yml: '📋', toml: '📋',
    md: '🗒️', txt: '🗒️',
    css: '🎨', scss: '🎨', less: '🎨',
    html: '🌐', htm: '🌐',
    py: '🐍', rb: '💎', go: '📦', rs: '⚙️',
    sh: '⚡', bash: '⚡',
    png: '🖼️', jpg: '🖼️', svg: '🖼️', gif: '🖼️',
    sql: '🗄️', db: '🗄️',
  };
  return map[ext] || '📄';
}

function escapeHtml(text) {
  // Simplified version matching the intent of the browser implementation
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// ════════════════════════════════════════════════════════════════
// GOAL_TOOL_NAMES
// ════════════════════════════════════════════════════════════════

describe('GOAL_TOOL_NAMES', () => {
  it('contains all five goal-related tool names', () => {
    expect(GOAL_TOOL_NAMES.size).toBe(5);
    expect(GOAL_TOOL_NAMES.has('goal_update')).toBe(true);
    expect(GOAL_TOOL_NAMES.has('condo_bind')).toBe(true);
    expect(GOAL_TOOL_NAMES.has('condo_create_goal')).toBe(true);
    expect(GOAL_TOOL_NAMES.has('condo_add_task')).toBe(true);
    expect(GOAL_TOOL_NAMES.has('condo_spawn_task')).toBe(true);
  });

  it('does not match unrelated tool names', () => {
    expect(GOAL_TOOL_NAMES.has('read_file')).toBe(false);
    expect(GOAL_TOOL_NAMES.has('bash')).toBe(false);
    expect(GOAL_TOOL_NAMES.has('goal_update_extra')).toBe(false);
    expect(GOAL_TOOL_NAMES.has('')).toBe(false);
    expect(GOAL_TOOL_NAMES.has(undefined)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
// getFileIcon
// ════════════════════════════════════════════════════════════════

describe('getFileIcon', () => {
  it('returns script icon for JS/TS extensions', () => {
    const icon = getFileIcon('js');
    expect(icon).toBe('📜');
    expect(getFileIcon('ts')).toBe(icon);
    expect(getFileIcon('mjs')).toBe(icon);
    expect(getFileIcon('cjs')).toBe(icon);
  });

  it('returns clipboard icon for config formats', () => {
    const icon = getFileIcon('json');
    expect(icon).toBe('📋');
    expect(getFileIcon('yaml')).toBe(icon);
    expect(getFileIcon('yml')).toBe(icon);
    expect(getFileIcon('toml')).toBe(icon);
  });

  it('returns art icon for style files', () => {
    expect(getFileIcon('css')).toBe('🎨');
    expect(getFileIcon('scss')).toBe('🎨');
    expect(getFileIcon('less')).toBe('🎨');
  });

  it('returns globe icon for HTML', () => {
    expect(getFileIcon('html')).toBe('🌐');
    expect(getFileIcon('htm')).toBe('🌐');
  });

  it('returns language-specific icons', () => {
    expect(getFileIcon('py')).toBe('🐍');
    expect(getFileIcon('rb')).toBe('💎');
    expect(getFileIcon('go')).toBe('📦');
    expect(getFileIcon('rs')).toBe('⚙️');
  });

  it('returns bolt icon for shell scripts', () => {
    expect(getFileIcon('sh')).toBe('⚡');
    expect(getFileIcon('bash')).toBe('⚡');
  });

  it('returns image icon for image formats', () => {
    expect(getFileIcon('png')).toBe('🖼️');
    expect(getFileIcon('jpg')).toBe('🖼️');
    expect(getFileIcon('svg')).toBe('🖼️');
    expect(getFileIcon('gif')).toBe('🖼️');
  });

  it('returns database icon for SQL/DB', () => {
    expect(getFileIcon('sql')).toBe('🗄️');
    expect(getFileIcon('db')).toBe('🗄️');
  });

  it('returns default document icon for unknown extensions', () => {
    expect(getFileIcon('xyz')).toBe('📄');
    expect(getFileIcon('exe')).toBe('📄');
    expect(getFileIcon('')).toBe('📄');
    expect(getFileIcon('UNKNOWN')).toBe('📄');
  });
});

// ════════════════════════════════════════════════════════════════
// debouncedGoalRefresh — debounce behaviour
// ════════════════════════════════════════════════════════════════

describe('debouncedGoalRefresh', () => {
  let goalRefreshTimer;
  let loadGoalsCalls;
  let renderGoalViewCalls;

  // Replicate the debounce function from index.html
  function debouncedGoalRefresh() {
    clearTimeout(goalRefreshTimer);
    goalRefreshTimer = setTimeout(async () => {
      loadGoalsCalls++;
      renderGoalViewCalls++;
    }, 500);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    goalRefreshTimer = null;
    loadGoalsCalls = 0;
    renderGoalViewCalls = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fire immediately', () => {
    debouncedGoalRefresh();
    expect(loadGoalsCalls).toBe(0);
  });

  it('fires after 500ms', () => {
    debouncedGoalRefresh();
    vi.advanceTimersByTime(500);
    expect(loadGoalsCalls).toBe(1);
    expect(renderGoalViewCalls).toBe(1);
  });

  it('coalesces rapid calls into a single refresh', () => {
    debouncedGoalRefresh();
    vi.advanceTimersByTime(100);
    debouncedGoalRefresh();
    vi.advanceTimersByTime(100);
    debouncedGoalRefresh();
    vi.advanceTimersByTime(500);
    expect(loadGoalsCalls).toBe(1);
  });

  it('fires separately for calls spaced > 500ms apart', () => {
    debouncedGoalRefresh();
    vi.advanceTimersByTime(500);
    expect(loadGoalsCalls).toBe(1);

    debouncedGoalRefresh();
    vi.advanceTimersByTime(500);
    expect(loadGoalsCalls).toBe(2);
  });

  it('resets timer on each call', () => {
    debouncedGoalRefresh();
    vi.advanceTimersByTime(400);  // 400ms in, hasn't fired
    expect(loadGoalsCalls).toBe(0);

    debouncedGoalRefresh();  // reset to 500ms again
    vi.advanceTimersByTime(400);  // 400ms into second timer
    expect(loadGoalsCalls).toBe(0);

    vi.advanceTimersByTime(100);  // now at 500ms since last call
    expect(loadGoalsCalls).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════
// Tracked files rendering
// ════════════════════════════════════════════════════════════════

describe('Tracked files rendering', () => {
  /**
   * Simulates the file-rendering section of renderGoalView().
   * This is extracted verbatim from the template in index.html.
   */
  function renderFilesHtml(goal) {
    const files = Array.isArray(goal.files) ? goal.files : [];
    if (!files.length) {
      return '<div class="empty-state">No files tracked yet.</div>';
    }
    return files.map(f => {
      const filePath = typeof f === 'string' ? f : (f.path || '');
      const ext = filePath.split('.').pop().toLowerCase();
      const source = (typeof f === 'object' && f.source) ? escapeHtml(f.source) : '';
      const addedAt = (typeof f === 'object' && f.addedAtMs) ? timeAgo(f.addedAtMs) : '';
      const meta = [source, addedAt].filter(Boolean).join(' · ');
      return `
              <div class="goal-file-row">
                <div class="goal-file-icon">${getFileIcon(ext)}</div>
                <div class="goal-file-path" title="${escapeHtml(filePath)}">${escapeHtml(filePath)}</div>
                <div class="goal-file-meta">${meta}</div>
                <button class="goal-file-del" onclick="removeGoalFile('${escapeHtml(goal.id)}','${escapeHtml(filePath)}')" title="Remove">×</button>
              </div>
            `;
    }).join('');
  }

  it('renders empty state when goal has no files', () => {
    const html = renderFilesHtml({ id: 'goal_1', files: [] });
    expect(html).toContain('No files tracked yet.');
    expect(html).toContain('empty-state');
  });

  it('renders empty state when files is undefined', () => {
    const html = renderFilesHtml({ id: 'goal_1' });
    expect(html).toContain('No files tracked yet.');
  });

  it('renders a file row with correct structure', () => {
    const html = renderFilesHtml({
      id: 'goal_1',
      files: [{ path: 'src/index.js', source: 'agent', addedAtMs: Date.now() - 5000 }],
    });
    expect(html).toContain('goal-file-row');
    expect(html).toContain('goal-file-icon');
    expect(html).toContain('goal-file-path');
    expect(html).toContain('goal-file-meta');
    expect(html).toContain('goal-file-del');
  });

  it('shows correct icon based on file extension', () => {
    const html = renderFilesHtml({
      id: 'g1',
      files: [{ path: 'styles/app.css', source: 'manual', addedAtMs: Date.now() }],
    });
    expect(html).toContain('🎨');
  });

  it('escapes file paths to prevent XSS', () => {
    const maliciousPath = '<script>alert("xss")</script>.js';
    const html = renderFilesHtml({
      id: 'g1',
      files: [{ path: maliciousPath, source: 'agent', addedAtMs: Date.now() }],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes goal ID in remove button onclick', () => {
    const html = renderFilesHtml({
      id: "g'\"<>1",
      files: [{ path: 'file.js', source: 'agent', addedAtMs: Date.now() }],
    });
    expect(html).not.toContain("g'\"<>1");
    expect(html).toContain('&#39;');
  });

  it('shows source metadata', () => {
    const html = renderFilesHtml({
      id: 'g1',
      files: [{ path: 'f.js', source: 'agent', addedAtMs: Date.now() }],
    });
    expect(html).toContain('agent');
  });

  it('shows relative time via timeAgo', () => {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const html = renderFilesHtml({
      id: 'g1',
      files: [{ path: 'f.js', source: 'manual', addedAtMs: fiveMinAgo }],
    });
    expect(html).toContain('5m ago');
  });

  it('handles string-only file entries (legacy format)', () => {
    const html = renderFilesHtml({
      id: 'g1',
      files: ['src/app.ts'],
    });
    expect(html).toContain('src/app.ts');
    expect(html).toContain('📜'); // ts icon
    expect(html).not.toContain('empty-state');
  });

  it('renders multiple files', () => {
    const html = renderFilesHtml({
      id: 'g1',
      files: [
        { path: 'a.js', source: 'agent', addedAtMs: Date.now() },
        { path: 'b.py', source: 'manual', addedAtMs: Date.now() },
        { path: 'c.css', source: 'agent', addedAtMs: Date.now() },
      ],
    });
    const rowCount = (html.match(/goal-file-row/g) || []).length;
    expect(rowCount).toBe(3);
  });

  it('handles file with empty path gracefully', () => {
    const html = renderFilesHtml({
      id: 'g1',
      files: [{ path: '', source: 'agent', addedAtMs: Date.now() }],
    });
    // Should still render a row (path is empty but not missing)
    expect(html).toContain('goal-file-row');
  });

  it('shows no metadata when source and addedAtMs are missing', () => {
    const html = renderFilesHtml({
      id: 'g1',
      files: [{ path: 'plain.txt' }],
    });
    expect(html).toContain('goal-file-meta');
    // Meta div should be empty (no · separator)
    expect(html).not.toContain(' · ');
  });
});

// ════════════════════════════════════════════════════════════════
// removeGoalFile — RPC call and refresh cycle
// ════════════════════════════════════════════════════════════════

describe('removeGoalFile', () => {
  let rpcCallMock;
  let loadGoalsCalled;
  let renderGoalViewCalled;
  let toastMessages;

  async function removeGoalFile(goalId, path) {
    try {
      await rpcCallMock('goals.removeFile', { goalId, path });
      loadGoalsCalled++;
      renderGoalViewCalled++;
    } catch (e) {
      toastMessages.push('Failed to remove file');
    }
  }

  beforeEach(() => {
    rpcCallMock = vi.fn().mockResolvedValue({ ok: true });
    loadGoalsCalled = 0;
    renderGoalViewCalled = 0;
    toastMessages = [];
  });

  it('calls goals.removeFile RPC with correct params', async () => {
    await removeGoalFile('goal_123', 'src/index.js');
    expect(rpcCallMock).toHaveBeenCalledWith('goals.removeFile', {
      goalId: 'goal_123',
      path: 'src/index.js',
    });
  });

  it('refreshes goals and re-renders after successful removal', async () => {
    await removeGoalFile('goal_123', 'src/index.js');
    expect(loadGoalsCalled).toBe(1);
    expect(renderGoalViewCalled).toBe(1);
  });

  it('shows error toast when RPC fails', async () => {
    rpcCallMock.mockRejectedValue(new Error('Network error'));
    await removeGoalFile('goal_123', 'src/index.js');
    expect(toastMessages).toContain('Failed to remove file');
    expect(loadGoalsCalled).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// timeAgo (replicated helper)
// ════════════════════════════════════════════════════════════════

describe('timeAgo', () => {
  it('returns "just now" for < 1 minute', () => {
    expect(timeAgo(Date.now() - 30000)).toBe('just now');
    expect(timeAgo(Date.now())).toBe('just now');
  });

  it('returns minutes for < 1 hour', () => {
    expect(timeAgo(Date.now() - 5 * 60000)).toBe('5m ago');
    expect(timeAgo(Date.now() - 59 * 60000)).toBe('59m ago');
  });

  it('returns hours for < 24 hours', () => {
    expect(timeAgo(Date.now() - 2 * 3600000)).toBe('2h ago');
    expect(timeAgo(Date.now() - 23 * 3600000)).toBe('23h ago');
  });

  it('returns days for >= 24 hours', () => {
    expect(timeAgo(Date.now() - 25 * 3600000)).toBe('1d ago');
    expect(timeAgo(Date.now() - 72 * 3600000)).toBe('3d ago');
  });
});
