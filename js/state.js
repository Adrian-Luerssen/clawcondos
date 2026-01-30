const config = window.SharpConfig ? window.SharpConfig.getConfig() : {};

const subscribers = new Map();

const data = {
  // Data
  sessions: [],
  apps: [],
  agents: [],

  // UI
  currentView: 'overview',
  currentSession: null,
  chatHistory: [],
  isThinking: false,
  messageQueue: [],

  // Agent status per session: 'idle' | 'thinking' | 'error' | 'offline'
  sessionStatus: {},

  // Multi-select
  multiSelectMode: false,
  selectedSessions: new Set(),

  // Auth - loaded from config or localStorage
  // Token should be set via config.json or login modal, NOT hardcoded
  token: localStorage.getItem('sharp_token') || (window.location.port === '9000' ? 'REDACTED' : null),
  gatewayUrl: (() => {
    // Priority: localStorage > config > auto-detect
    const saved = localStorage.getItem('sharp_gateway');
    if (saved && !saved.includes(':18789')) {
      return saved;
    }
    // Clear invalid old URLs
    if (saved && saved.includes(':18789') && window.location.hostname !== 'localhost') {
      localStorage.removeItem('sharp_gateway');
    }
    // Use config if available
    if (config.gatewayWsUrl) {
      return config.gatewayWsUrl;
    }
    // Auto-detect from location
    const host = window.location.hostname || 'localhost';
    if (host.includes('.ts.net') && window.location.protocol === 'http:') {
      return 'wss://' + host;
    }
    const proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const port = window.location.port;
    return port ? proto + host + ':' + port : proto + host;
  })(),

  // WebSocket
  ws: null,
  wsReconnectTimer: null,
  wsKeepaliveTimer: null,
  wsStaleTimer: null,
  wsLastMessageAt: 0,
  wsReconnectAttempts: 0,
  connected: false,
  connectNonce: null,
  connectSent: false,
  rpcIdCounter: 0,
  rpcPending: new Map(),

  // Streaming
  activeRuns: new Map(),
  activeRunsStore: JSON.parse(localStorage.getItem('sharp_active_runs') || '{}'),
  sessionInputReady: new Map(),

  // Pin & Archive
  pinnedSessions: JSON.parse(localStorage.getItem('sharp_pinned_sessions') || '[]'),
  archivedSessions: JSON.parse(localStorage.getItem('sharp_archived_sessions') || '[]'),
  showArchived: false,

  // Custom session names
  sessionNames: JSON.parse(localStorage.getItem('sharp_session_names') || '{}'),

  // Search
  searchQuery: '',

  // Auto-title generation tracking
  generatingTitles: new Set(),
  attemptedTitles: new Set(),

  // Auto-archive: 'never' or number of days
  autoArchiveDays: localStorage.getItem('sharp_auto_archive_days') || '7',

  // Track when sessions were last viewed (for unread indicator)
  lastViewedAt: JSON.parse(localStorage.getItem('sharp_last_viewed') || '{}'),

  // Track which session groups are expanded (for nested view)
  expandedGroups: JSON.parse(localStorage.getItem('sharp_expanded_groups') || '{}'),

  // Session status brief (click-to-generate status line)
  sessionStatusBrief: JSON.parse(localStorage.getItem('sharp_session_status') || '{}'),
  generatingStatus: new Set(),

  // Tool activity tracking (for compact indicator)
  activeTools: new Map(),
  toolActivityExpanded: false
};

function notify(key) {
  const cbs = subscribers.get(key);
  if (!cbs) return;
  cbs.forEach((cb) => cb(data[key]));
}

function subscribe(key, cb) {
  if (!subscribers.has(key)) {
    subscribers.set(key, new Set());
  }
  subscribers.get(key).add(cb);
  return () => subscribers.get(key)?.delete(cb);
}

function set(key, value) {
  data[key] = value;
  notify(key);
}

function update(key, updater) {
  data[key] = updater(data[key]);
  notify(key);
}

const api = {
  get: (key) => data[key],
  set,
  update,
  subscribe,
  notify
};

const state = new Proxy(api, {
  get(target, prop) {
    if (prop in target) return target[prop];
    return data[prop];
  },
  set(target, prop, value) {
    if (prop in target) {
      target[prop] = value;
      return true;
    }
    data[prop] = value;
    notify(prop);
    return true;
  }
});

export { state, config };
