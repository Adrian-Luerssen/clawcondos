# Intelligent Session Classification & Goal Auto-Creation

> **Status:** Ready for Implementation  
> **Date:** 2026-02-07  
> **Authors:** Bob (agent swarm synthesis)  
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

---

## Executive Summary

When a new Telegram session starts, automatically classify it to the right condo (project) and optionally create goals with tasks. This eliminates manual session organization.

**Goal:** Zero manual triage - sessions auto-file themselves by project.

**Architecture:** Two-tier classification (fast patterns → LLM fallback) injected at `before_agent_start` hook, with goal auto-creation and continuous learning.

**Tech Stack:** JavaScript, OpenClaw goals plugin, Gateway LLM proxy.

---

## Design Decisions (Locked)

| Question | Decision | Rationale |
|----------|----------|-----------|
| LLM call location | Gateway proxy | Reuse existing routing, no extra credentials |
| Initial keywords | Auto-seed from goal titles + manual tune | Bootstrap with data we have |
| Telegram topics | Bind to matching condos | Simplest mental model |
| Rate limiting | First message classifies, rest inherit | No debounce complexity |
| Confidence threshold | Start at 0.92, relax to 0.85 after 2 weeks | Conservative launch |
| Backfill old sessions | No - new sessions only | Simpler, avoid noisy reclassification |
| Latency budget | 3s max for Tier 2, else fallback | Don't block agent startup |
| Goal creation | Suggest with confirm buttons | Don't auto-create without consent |
| Learning | Record corrections, batch retrain weekly | Continuous improvement |

---

## What This Does (User Perspective)

### Scenario 1: Telegram Topic
```
You: [in "Subastas" topic] "Check for new auctions in Murcia"

→ Instantly routed to condo:subastas
→ Shows in ClawCondos sidebar under Subastas project
```

### Scenario 2: Keyword Match
```
You: "Update the investor pipeline with new VC contacts"

→ Words "investor" + "pipeline" trigger match
→ Auto-route to condo:investor-crm
→ Work is tracked
```

### Scenario 3: Task Detected
```
You: "Build a landing page for MoltCourt - design, implement, deploy"

→ Classified to condo:moltcourt
→ Detects task language ("build", list of steps)
→ Shows: "📋 Create goal? [Yes] [Edit] [No]"
   **Build MoltCourt landing page**
   • Design mockups
   • Implement  
   • Deploy
→ Tap Yes → Goal created, session attached
```

### Scenario 4: Ambiguous Message
```
You: "How's progress on that thing?"

→ Tier 1 has no match
→ LLM checks recent context, sees you were discussing GenLayer
→ Routes with 0.7 confidence
→ Shows: "📁 GenLayer? [✓] [Change]" (auto-accepts in 5s)
```

### Scenario 5: Correction & Learning
```
You: "Update the subastas scraper"

→ System routes to condo:subastas
→ You tap [Change] → select condo:system
→ Correction logged
→ Next week: "subastas scraper" → condo:system (learned)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    INCOMING MESSAGE                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              SESSION CREATION (resolveSession)                   │
│              isNewSession = true                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 TIER 1: FAST PATTERN MATCHER (~0ms)              │
│  • Telegram topic → condo name match                            │
│  • Explicit @condo:name syntax                                  │
│  • Keyword/trigger scoring per condo                            │
│  • Confidence ≥0.92 → Route immediately                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                    confidence < 0.92
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 TIER 2: LLM CLASSIFIER (~1-3s)                   │
│  • Semantic analysis via Gateway proxy                          │
│  • Match against condo descriptions + recent goals              │
│  • Recent conversation context                                  │
│  • 3s timeout → fallback to uncategorized                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 DECISION ENGINE                                  │
│  • confidence ≥ 0.85 → Auto-route (small indicator)             │
│  • confidence 0.5-0.85 → Confirm buttons (5s auto-accept)       │
│  • confidence < 0.5 → Uncategorized (no prompt)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 GOAL DETECTION                                   │
│  • Heuristic: task-like language patterns                       │
│  • LLM: extract title + subtasks                                │
│  • Show suggestion with [Yes] [Edit] [No]                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 LEARNING LOOP                                    │
│  • Log all classifications + user corrections                   │
│  • Weekly batch: update keywords from corrections               │
│  • Metrics: accuracy, correction rate, adoption                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Condo Schema (Extended)

```javascript
{
  id: "condo:investor-crm",
  name: "Investor CRM",
  description: "Track investor relationships for GenLayer Series A",
  emoji: "💼",
  
  // Classification hints
  keywords: ["investor", "crm", "pipeline", "fundraising", "series a", "vc"],
  triggers: ["/investor\\s+\\w+/i", "/pipeline/i", "/series\\s+[ab]/i"],
  excludePatterns: ["/test/i"],
  telegramTopicIds: [106],
  
  // Learning data
  classificationStats: {
    totalRouted: 0,
    corrections: 0,
    lastCorrectionMs: null,
  },
  
  // Metadata
  createdAtMs: 1707300000000,
  updatedAtMs: 1707300000000,
}
```

### Classification Log Entry

```javascript
{
  id: "clf_abc123",
  timestamp: 1707300000000,
  sessionKey: "agent:main:telegram:...",
  message: "Update the investor pipeline",
  messageHash: "sha256:...",  // For dedup
  
  // Classification result
  tier: 1,  // or 2
  predictedCondo: "condo:investor-crm",
  confidence: 0.87,
  reasoning: "keywords: investor, pipeline",
  alternatives: [
    { condo: "condo:personal", confidence: 0.3 }
  ],
  latencyMs: 12,
  
  // User feedback
  accepted: true,  // null = no feedback yet
  correctedTo: null,  // condo id if corrected
  feedbackMs: null,
  
  // Goal creation
  goalSuggested: false,
  goalCreated: false,
  goalId: null,
}
```

### Configuration

```javascript
const CLASSIFICATION_CONFIG = {
  // Tier 1 thresholds
  tier1ConfidenceThreshold: 0.92,
  
  // Tier 2 settings  
  tier2Model: "claude-sonnet-4-20250514",
  tier2MaxTokens: 500,
  tier2TimeoutMs: 3000,
  tier2Enabled: true,
  
  // Decision thresholds
  autoRouteThreshold: 0.85,
  softConfirmThreshold: 0.5,
  
  // Goal creation
  goalSuggestThreshold: 0.6,
  
  // UX
  softConfirmAutoAcceptMs: 5000,
  
  // Learning
  learningEnabled: true,
  retrainIntervalMs: 604800000,  // 1 week
  minCorrectionsForRetrain: 10,
  
  // Context
  recentMessageWindowMs: 600000,  // 10 minutes
};
```

---

## Implementation Phases Overview

| Phase | Scope | Duration | Outcome |
|-------|-------|----------|---------|
| 1 | Tier 1 Classification | 3 days | 60-70% auto-classified |
| 2 | Tier 2 LLM + Confirm UI | 5 days | 85-90% auto-classified |
| 3 | Goal Auto-Creation | 5 days | Tasks created from messages |
| 4 | Learning Loop | 3 days | Continuous improvement |

**Total: ~16 days**

---

# Phase 1: Tier 1 Classification

**Goal:** Fast pattern matching with zero latency. Gets 60-70% of sessions auto-classified.

---

## Task 1.1: Add Classification Fields to Condo Schema

**Files:**
- Modify: `condo-management/store.js`

**Step 1: Update condo schema in store.js**

Find where condos are created/validated and add fields:

```javascript
function createCondo(opts) {
  return {
    id: opts.id || `condo:${slugify(opts.name)}`,
    name: opts.name,
    description: opts.description || '',
    emoji: opts.emoji || '🏢',
    
    // NEW: Classification hints
    keywords: opts.keywords || [],
    triggers: opts.triggers || [],
    excludePatterns: opts.excludePatterns || [],
    telegramTopicIds: opts.telegramTopicIds || [],
    
    // NEW: Learning stats
    classificationStats: {
      totalRouted: 0,
      corrections: 0,
      lastCorrectionMs: null,
    },
    
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  };
}
```

**Step 2: Add migration for existing condos**

```javascript
function migrateCondos(data) {
  for (const condo of (data.condos || [])) {
    if (!condo.keywords) condo.keywords = [];
    if (!condo.triggers) condo.triggers = [];
    if (!condo.excludePatterns) condo.excludePatterns = [];
    if (!condo.telegramTopicIds) condo.telegramTopicIds = [];
    if (!condo.classificationStats) {
      condo.classificationStats = { totalRouted: 0, corrections: 0, lastCorrectionMs: null };
    }
  }
  return data;
}

// Call in load()
function load() {
  const raw = fs.readFileSync(STORE_PATH, 'utf8');
  const data = JSON.parse(raw);
  return migrateCondos(data);
}
```

**Step 3: Commit**

```bash
git add condo-management/store.js
git commit -m "feat(classification): extend condo schema with classification fields"
```

---

## Task 1.2: Create Classifier Module

**Files:**
- Create: `condo-management/classifier.js`

**Full implementation:**

```javascript
// condo-management/classifier.js
'use strict';

const crypto = require('crypto');

const CONFIG = {
  tier1ConfidenceThreshold: 0.92,
  tier2Model: 'claude-sonnet-4-20250514',
  tier2MaxTokens: 500,
  tier2TimeoutMs: 3000,
  tier2Enabled: true,
  autoRouteThreshold: 0.85,
  softConfirmThreshold: 0.5,
  goalSuggestThreshold: 0.6,
  softConfirmAutoAcceptMs: 5000,
  learningEnabled: true,
  retrainIntervalMs: 604800000,
  minCorrectionsForRetrain: 10,
  recentMessageWindowMs: 600000,
};

/**
 * Parse regex string to RegExp
 */
function parseRegex(str) {
  if (str instanceof RegExp) return str;
  const match = str.match(/^\/(.+)\/([gimsu]*)$/);
  if (match) return new RegExp(match[1], match[2]);
  return new RegExp(str, 'i');
}

/**
 * Hash message for dedup
 */
function hashMessage(msg) {
  return crypto.createHash('sha256').update(msg).digest('hex').slice(0, 16);
}

/**
 * Check if message is a one-off (skip classification)
 */
function isOneOffMessage(message) {
  if (!message || message.length > 150) return false;
  
  const ONE_OFF_PATTERNS = [
    /^(what|when|where|who|how|why)\s+(is|are|was|were|do|does|did|time|day)/i,
    /^(hi|hello|hey|yo|thanks|thank you|ok|okay|sure|yes|no|yep|nope|cool|nice|great|lol|haha)\s*[.!?]*$/i,
    /^(remind|tell)\s+me\b/i,
    /^\d+$/,  // Just numbers
    /^[👍👎✅❌🔥💯🎉]+$/,  // Just emoji
  ];
  
  return ONE_OFF_PATTERNS.some(p => p.test(message.trim()));
}

/**
 * Tier 1: Fast pattern classification
 */
function tier1Classify(message, context, condos) {
  const result = {
    condo: null,
    confidence: 0,
    reasoning: null,
    alternatives: [],
    needsTier2: false,
    tier: 1,
  };

  if (!message || !condos?.length) {
    result.needsTier2 = true;
    return result;
  }

  // 1. Explicit @condo:name mention (highest priority)
  const explicit = message.match(/@condo:(\S+)/i);
  if (explicit) {
    const target = explicit[1].toLowerCase();
    const condo = condos.find(c =>
      c.id.toLowerCase().includes(target) ||
      c.name.toLowerCase().includes(target) ||
      c.name.toLowerCase().replace(/\s+/g, '-').includes(target)
    );
    if (condo) {
      return {
        condo: condo.id,
        confidence: 1.0,
        reasoning: 'Explicit @condo mention',
        alternatives: [],
        needsTier2: false,
        tier: 1,
      };
    }
  }

  // 2. Telegram topic binding (explicit or fuzzy)
  if (context.telegramTopicId) {
    // Explicit binding
    const boundCondo = condos.find(c =>
      (c.telegramTopicIds || []).includes(context.telegramTopicId)
    );
    if (boundCondo) {
      return {
        condo: boundCondo.id,
        confidence: 0.95,
        reasoning: 'Telegram topic binding',
        alternatives: [],
        needsTier2: false,
        tier: 1,
      };
    }

    // Fuzzy match topic name to condo name
    if (context.telegramTopicName) {
      const topicLower = context.telegramTopicName.toLowerCase().trim();
      const matchedCondo = condos.find(c => {
        const condoLower = c.name.toLowerCase().trim();
        return (
          condoLower === topicLower ||
          condoLower.includes(topicLower) ||
          topicLower.includes(condoLower)
        );
      });
      if (matchedCondo) {
        return {
          condo: matchedCondo.id,
          confidence: 0.90,
          reasoning: `Topic "${context.telegramTopicName}" matches condo name`,
          alternatives: [],
          needsTier2: false,
          tier: 1,
        };
      }
    }
  }

  // 3. Keyword/trigger scoring
  const scores = new Map();
  const messageLower = message.toLowerCase();

  for (const condo of condos) {
    let score = 0;
    const reasons = [];

    // Keyword hits (+0.15 each, max 0.6)
    const keywords = condo.keywords || [];
    const keywordHits = keywords.filter(k =>
      messageLower.includes(k.toLowerCase())
    );
    if (keywordHits.length > 0) {
      const keywordScore = Math.min(keywordHits.length * 0.15, 0.6);
      score += keywordScore;
      reasons.push(`keywords: ${keywordHits.slice(0, 3).join(', ')}`);
    }

    // Trigger pattern hits (+0.3 each, max 0.6)
    const triggers = (condo.triggers || []).map(parseRegex);
    const triggerHits = triggers.filter(t => t.test(message));
    if (triggerHits.length > 0) {
      const triggerScore = Math.min(triggerHits.length * 0.3, 0.6);
      score += triggerScore;
      reasons.push(`${triggerHits.length} trigger(s)`);
    }

    // Exclude pattern penalty (-0.5 each)
    const excludes = (condo.excludePatterns || []).map(parseRegex);
    const excludeHits = excludes.filter(e => e.test(message));
    if (excludeHits.length > 0) {
      score -= excludeHits.length * 0.5;
    }

    // Recency boost (+0.1 if active in last 24h)
    if (condo.updatedAtMs && Date.now() - condo.updatedAtMs < 86400000) {
      score += 0.1;
      reasons.push('recent');
    }

    // Name match boost (+0.2 if condo name appears in message)
    if (messageLower.includes(condo.name.toLowerCase())) {
      score += 0.2;
      reasons.push('name match');
    }

    if (score > 0) {
      scores.set(condo.id, {
        score: Math.max(0, Math.min(score, 1.0)),
        reasoning: reasons.join(', '),
      });
    }
  }

  // Sort by score descending
  const sorted = [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score);

  if (sorted.length > 0) {
    const [topId, topData] = sorted[0];
    result.condo = topId;
    result.confidence = topData.score;
    result.reasoning = topData.reasoning;
    result.alternatives = sorted.slice(1, 4).map(([id, data]) => ({
      condo: id,
      confidence: data.score,
    }));
  }

  // Need Tier 2 if not confident enough
  result.needsTier2 = result.confidence < CONFIG.tier1ConfidenceThreshold;

  return result;
}

/**
 * Tier 2: LLM classification (placeholder - implemented in Phase 2)
 */
async function tier2Classify(message, context, condos, goals, llmClient) {
  // Phase 2 implementation
  return null;
}

/**
 * Detect if message looks like a task/goal
 */
function detectGoalIntent(message) {
  if (!message || message.length < 20) return { isGoal: false, score: 0 };

  const GOAL_INDICATORS = [
    { pattern: /\b(need to|should|must|have to|gotta|let's|let us|gonna)\b/i, weight: 0.25 },
    { pattern: /\b(fix|implement|add|create|build|design|review|update|refactor|deploy|ship)\b/i, weight: 0.25 },
    { pattern: /\b(bug|issue|problem|feature|task|todo|ticket)\b/i, weight: 0.15 },
    { pattern: /\b(by|before|deadline|urgent|asap|priority|blocking)\b/i, weight: 0.15 },
    { pattern: /\b(first|then|after|finally|step|phase)\b/i, weight: 0.1 },  // Sequential language
    { pattern: /[-•*]\s+\w/m, weight: 0.2 },  // Bullet points
    { pattern: /\d+\.\s+\w/m, weight: 0.2 },  // Numbered list
  ];

  let score = 0;
  const matched = [];

  for (const indicator of GOAL_INDICATORS) {
    if (indicator.pattern.test(message)) {
      score += indicator.weight;
      matched.push(indicator.pattern.source.slice(0, 20));
    }
  }

  // Length bonus
  if (message.length > 100) score += 0.1;
  if (message.length > 200) score += 0.1;

  return {
    isGoal: score >= CONFIG.goalSuggestThreshold,
    score: Math.min(score, 1.0),
    indicators: matched,
  };
}

/**
 * Main classification entry point
 */
async function classifySession(message, context, condos, options = {}) {
  const startMs = Date.now();

  // Skip one-off messages
  if (isOneOffMessage(message)) {
    return {
      condo: null,
      confidence: 0,
      reasoning: 'One-off message',
      skip: true,
      tier: 0,
      latencyMs: Date.now() - startMs,
    };
  }

  // Tier 1: Fast pattern matching
  const tier1Result = tier1Classify(message, context, condos);
  tier1Result.latencyMs = Date.now() - startMs;

  // Return early if confident or Tier 2 disabled
  if (!tier1Result.needsTier2 || options.tier1Only || !CONFIG.tier2Enabled) {
    return tier1Result;
  }

  // Tier 2: LLM classification
  if (options.llmClient) {
    const tier2Result = await tier2Classify(
      message,
      context,
      condos,
      options.goals || [],
      options.llmClient
    );
    if (tier2Result) {
      tier2Result.latencyMs = Date.now() - startMs;
      return tier2Result;
    }
  }

  // Fallback to Tier 1 result
  return tier1Result;
}

/**
 * Create classification log entry
 */
function createLogEntry(sessionKey, message, result, opts = {}) {
  return {
    id: `clf_${crypto.randomBytes(8).toString('hex')}`,
    timestamp: Date.now(),
    sessionKey,
    message: message.slice(0, 500),  // Truncate for storage
    messageHash: hashMessage(message),
    
    tier: result.tier || 1,
    predictedCondo: result.condo,
    confidence: result.confidence,
    reasoning: result.reasoning,
    alternatives: result.alternatives || [],
    latencyMs: result.latencyMs || 0,
    
    accepted: null,
    correctedTo: null,
    feedbackMs: null,
    
    goalSuggested: opts.goalSuggested || false,
    goalCreated: opts.goalCreated || false,
    goalId: opts.goalId || null,
  };
}

module.exports = {
  CONFIG,
  parseRegex,
  hashMessage,
  isOneOffMessage,
  tier1Classify,
  tier2Classify,
  detectGoalIntent,
  classifySession,
  createLogEntry,
};
```

**Commit:**

```bash
git add condo-management/classifier.js
git commit -m "feat(classification): add comprehensive classifier module"
```

---

## Task 1.3: Create Classification Log Store

**Files:**
- Create: `condo-management/classification-log.js`

```javascript
// condo-management/classification-log.js
'use strict';

const fs = require('fs');
const path = require('path');

const LOG_PATH = process.env.CLASSIFICATION_LOG_PATH ||
  path.join(process.env.HOME, 'clawd/data/classification-log.json');

const MAX_ENTRIES = 10000;  // Rolling window

function ensureFile() {
  if (!fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(LOG_PATH, JSON.stringify({ entries: [], stats: {} }, null, 2));
  }
}

function load() {
  ensureFile();
  return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
}

function save(data) {
  // Trim to max entries
  if (data.entries.length > MAX_ENTRIES) {
    data.entries = data.entries.slice(-MAX_ENTRIES);
  }
  fs.writeFileSync(LOG_PATH, JSON.stringify(data, null, 2));
}

function logClassification(entry) {
  const data = load();
  data.entries.push(entry);
  save(data);
  return entry;
}

function recordFeedback(entryId, { accepted, correctedTo }) {
  const data = load();
  const entry = data.entries.find(e => e.id === entryId);
  if (!entry) return null;
  
  entry.accepted = accepted;
  entry.correctedTo = correctedTo || null;
  entry.feedbackMs = Date.now();
  
  save(data);
  return entry;
}

function getCorrections(since = 0) {
  const data = load();
  return data.entries.filter(e =>
    e.correctedTo !== null &&
    e.feedbackMs > since
  );
}

function getStats() {
  const data = load();
  const entries = data.entries;
  
  const total = entries.length;
  const withFeedback = entries.filter(e => e.accepted !== null).length;
  const accepted = entries.filter(e => e.accepted === true).length;
  const corrected = entries.filter(e => e.correctedTo !== null).length;
  
  const byTier = {
    1: entries.filter(e => e.tier === 1).length,
    2: entries.filter(e => e.tier === 2).length,
  };
  
  const avgLatency = entries.length > 0
    ? entries.reduce((sum, e) => sum + (e.latencyMs || 0), 0) / entries.length
    : 0;
  
  return {
    total,
    withFeedback,
    accepted,
    corrected,
    accuracy: withFeedback > 0 ? (accepted / withFeedback) : null,
    correctionRate: withFeedback > 0 ? (corrected / withFeedback) : null,
    byTier,
    avgLatencyMs: Math.round(avgLatency),
  };
}

module.exports = {
  load,
  save,
  logClassification,
  recordFeedback,
  getCorrections,
  getStats,
};
```

**Commit:**

```bash
git add condo-management/classification-log.js
git commit -m "feat(classification): add classification log store"
```

---

## Task 1.4: Wire Classifier into before_agent_start Hook

**Files:**
- Modify: `condo-management/handlers.js`

**Step 1: Add imports at top**

```javascript
const { classifySession, CONFIG, createLogEntry, detectGoalIntent } = require('./classifier');
const classificationLog = require('./classification-log');
```

**Step 2: Add classification to before_agent_start hook**

Find existing hook and extend:

```javascript
api.registerHook('before_agent_start', async (event) => {
  const sessionKey = event.context?.sessionKey;
  const message = event.context?.message;
  
  if (!sessionKey) return null;
  
  const data = store.load();

  // Skip if already bound to a condo or goal
  if (data.sessionCondoIndex?.[sessionKey] || data.sessionIndex?.[sessionKey]) {
    return buildExistingContext(sessionKey, data);
  }

  // Skip if no message
  if (!message) return null;

  // Build context for classifier
  const context = {
    telegramTopicId: event.context?.telegramTopicId,
    telegramTopicName: event.context?.telegramTopicName,
    recentMessages: event.context?.recentMessages || [],
    sessionKey,
  };

  // Get active condos
  const condos = data.condos || [];
  if (condos.length === 0) return null;

  // Classify (Tier 1 only in Phase 1)
  const classification = await classifySession(message, context, condos, { 
    tier1Only: true,
    goals: data.goals || [],
  });

  // Skip if one-off or no match
  if (classification.skip || !classification.condo) {
    return null;
  }

  // Log the classification
  const logEntry = createLogEntry(sessionKey, message, classification);
  classificationLog.logClassification(logEntry);

  // Auto-route if confident enough
  if (classification.confidence >= CONFIG.autoRouteThreshold) {
    // Bind session to condo
    if (!data.sessionCondoIndex) data.sessionCondoIndex = {};
    data.sessionCondoIndex[sessionKey] = classification.condo;
    
    // Update condo stats
    const condo = condos.find(c => c.id === classification.condo);
    if (condo) {
      if (!condo.classificationStats) condo.classificationStats = { totalRouted: 0, corrections: 0 };
      condo.classificationStats.totalRouted++;
      condo.updatedAtMs = Date.now();
    }
    
    store.save(data);

    const condoName = condo?.name || classification.condo;
    const condoEmoji = condo?.emoji || '📁';

    return {
      prependContext: buildCondoContext(classification.condo, data),
      systemNote: `${condoEmoji} ${condoName}`,
      classificationId: logEntry.id,  // For feedback tracking
    };
  }

  // Medium confidence - Phase 2 will add confirm buttons
  // For now, don't route
  return null;
});

/**
 * Build context injection for a condo
 */
function buildCondoContext(condoId, data) {
  const condo = (data.condos || []).find(c => c.id === condoId);
  if (!condo) return '';

  const goals = (data.goals || [])
    .filter(g => g.condoId === condoId && g.status === 'active')
    .slice(0, 5);

  let ctx = `## Current Project: ${condo.name}\n`;
  if (condo.description) ctx += `${condo.description}\n`;
  ctx += '\n';

  if (goals.length > 0) {
    ctx += `### Active Goals\n`;
    for (const goal of goals) {
      ctx += `- **${goal.title}**`;
      if (goal.nextTask) ctx += ` → Next: ${goal.nextTask}`;
      ctx += '\n';
    }
    ctx += '\n';
  }

  return ctx;
}

/**
 * Build context for already-bound session
 */
function buildExistingContext(sessionKey, data) {
  // Check goal binding first
  const goalBinding = data.sessionIndex?.[sessionKey];
  if (goalBinding?.goalId) {
    const goal = (data.goals || []).find(g => g.id === goalBinding.goalId);
    if (goal) {
      return {
        prependContext: buildGoalContext(goal, data),
      };
    }
  }

  // Check condo binding
  const condoId = data.sessionCondoIndex?.[sessionKey];
  if (condoId) {
    return {
      prependContext: buildCondoContext(condoId, data),
    };
  }

  return null;
}
```

**Commit:**

```bash
git add condo-management/handlers.js
git commit -m "feat(classification): wire classifier into before_agent_start hook"
```

---

## Task 1.5: Add Telegram Topic Binding Helpers

**Files:**
- Modify: `condo-management/store.js`

```javascript
/**
 * Bind a Telegram topic to a condo
 */
function bindTelegramTopic(condoId, topicId) {
  const data = load();
  const condo = (data.condos || []).find(c => c.id === condoId);
  if (!condo) return false;

  if (!condo.telegramTopicIds) condo.telegramTopicIds = [];
  if (!condo.telegramTopicIds.includes(topicId)) {
    condo.telegramTopicIds.push(topicId);
    condo.updatedAtMs = Date.now();
    save(data);
  }
  return true;
}

/**
 * Unbind a Telegram topic from a condo
 */
function unbindTelegramTopic(condoId, topicId) {
  const data = load();
  const condo = (data.condos || []).find(c => c.id === condoId);
  if (!condo) return false;

  const idx = (condo.telegramTopicIds || []).indexOf(topicId);
  if (idx >= 0) {
    condo.telegramTopicIds.splice(idx, 1);
    condo.updatedAtMs = Date.now();
    save(data);
  }
  return true;
}

/**
 * Get condo for a Telegram topic
 */
function getCondoForTopic(topicId) {
  const data = load();
  return (data.condos || []).find(c =>
    (c.telegramTopicIds || []).includes(topicId)
  );
}

/**
 * Update condo keywords
 */
function updateCondoClassification(condoId, { keywords, triggers, excludePatterns }) {
  const data = load();
  const condo = (data.condos || []).find(c => c.id === condoId);
  if (!condo) return null;

  if (keywords !== undefined) condo.keywords = keywords;
  if (triggers !== undefined) condo.triggers = triggers;
  if (excludePatterns !== undefined) condo.excludePatterns = excludePatterns;
  condo.updatedAtMs = Date.now();

  save(data);
  return condo;
}

// Add to exports
module.exports = {
  // ... existing exports
  bindTelegramTopic,
  unbindTelegramTopic,
  getCondoForTopic,
  updateCondoClassification,
};
```

**Commit:**

```bash
git add condo-management/store.js
git commit -m "feat(classification): add topic binding and keyword update helpers"
```

---

## Task 1.6: Add RPC Methods for Management

**Files:**
- Modify: `condo-management/handlers.js`

```javascript
// Classification management RPCs

api.registerMethod('goals.updateCondoKeywords', async ({ condoId, keywords, triggers, excludePatterns }) => {
  const result = store.updateCondoClassification(condoId, { keywords, triggers, excludePatterns });
  if (!result) throw new Error(`Condo not found: ${condoId}`);
  return { ok: true, condo: result };
});

api.registerMethod('goals.bindTelegramTopic', async ({ condoId, topicId }) => {
  const result = store.bindTelegramTopic(condoId, topicId);
  if (!result) throw new Error(`Failed to bind topic ${topicId} to condo ${condoId}`);
  return { ok: true };
});

api.registerMethod('goals.unbindTelegramTopic', async ({ condoId, topicId }) => {
  const result = store.unbindTelegramTopic(condoId, topicId);
  return { ok: true };
});

api.registerMethod('goals.classificationStats', async () => {
  const stats = classificationLog.getStats();
  return { ok: true, stats };
});

api.registerMethod('goals.recordClassificationFeedback', async ({ classificationId, accepted, correctedTo }) => {
  const entry = classificationLog.recordFeedback(classificationId, { accepted, correctedTo });
  
  // If corrected, update condo stats
  if (correctedTo && entry) {
    const data = store.load();
    const condo = (data.condos || []).find(c => c.id === entry.predictedCondo);
    if (condo && condo.classificationStats) {
      condo.classificationStats.corrections++;
      condo.classificationStats.lastCorrectionMs = Date.now();
      store.save(data);
    }
  }
  
  return { ok: true, entry };
});
```

**Commit:**

```bash
git add condo-management/handlers.js
git commit -m "feat(classification): add RPC methods for classification management"
```

---

## Task 1.7: Create Keyword Seeding Script

**Files:**
- Create: `condo-management/scripts/seed-keywords.js`

```javascript
#!/usr/bin/env node
// condo-management/scripts/seed-keywords.js
'use strict';

const fs = require('fs');
const path = require('path');

const STORE_PATH = process.env.CONDO_STORE_PATH ||
  path.join(process.env.HOME, 'clawd/data/condo-management.json');

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
  'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them',
  'we', 'us', 'our', 'you', 'your', 'i', 'me', 'my', 'he', 'she',
  'his', 'her', 'test', 'testing', 'new', 'add', 'create', 'update',
  'fix', 'implement', 'build', 'make', 'get', 'set', 'use', 'using',
  'work', 'working', 'check', 'look', 'see', 'try', 'want', 'like',
]);

function extractKeywords(text) {
  if (!text) return [];

  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));

  // Count frequency
  const freq = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }

  // Return top keywords by frequency
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word]) => word);
}

function seedKeywords(dryRun = false) {
  console.log(`Loading store from: ${STORE_PATH}`);
  const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));

  for (const condo of (data.condos || [])) {
    // Gather text from condo and its goals
    const texts = [condo.name, condo.description];

    const condoGoals = (data.goals || []).filter(g => g.condoId === condo.id);
    for (const goal of condoGoals) {
      texts.push(goal.title);
      texts.push(goal.description);
      // Also include task text
      for (const task of (goal.tasks || [])) {
        texts.push(task.text);
      }
    }

    const combinedText = texts.filter(Boolean).join(' ');
    const newKeywords = extractKeywords(combinedText);

    // Merge with existing (don't overwrite manual ones)
    const existing = new Set(condo.keywords || []);
    for (const kw of newKeywords) {
      existing.add(kw);
    }
    const merged = [...existing].slice(0, 20);

    console.log(`\n${condo.emoji || '🏢'} ${condo.name}`);
    console.log(`  Goals: ${condoGoals.length}`);
    console.log(`  Keywords: ${merged.join(', ')}`);

    if (!dryRun) {
      condo.keywords = merged;
    }
  }

  if (!dryRun) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
    console.log('\n✅ Keywords seeded and saved.');
  } else {
    console.log('\n(dry run - no changes saved)');
  }
}

// CLI
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
seedKeywords(dryRun);
```

**Make executable and commit:**

```bash
chmod +x condo-management/scripts/seed-keywords.js
git add condo-management/scripts/seed-keywords.js
git commit -m "feat(classification): add keyword seeding script"
```

---

## Task 1.8: Test Phase 1

**Step 1: Run keyword seeding**

```bash
cd ~/clawd/projects/clawcondos
node condo-management/scripts/seed-keywords.js --dry-run
# If looks good:
node condo-management/scripts/seed-keywords.js
```

**Step 2: Restart ClawCondos**

```bash
systemctl --user restart clawcondos
journalctl --user -u clawcondos -f  # Watch for errors
```

**Step 3: Test scenarios**

1. **Telegram topic match:**
   - Send message in "Subastas" topic
   - Should see `🏠 Subastas` indicator

2. **Explicit @condo:**
   - Send "@condo:investor-crm check the pipeline"
   - Should route to Investor CRM

3. **Keyword match:**
   - Send "update the investor contacts"
   - Should route to Investor CRM (if keywords include "investor")

4. **Verify in ClawCondos UI:**
   - Check that new sessions appear under correct condos

**Step 4: Check stats**

```bash
# Via RPC or direct file check
cat ~/clawd/data/classification-log.json | jq '.entries | length'
```

---

## Phase 1 Success Criteria

- [ ] Telegram topics auto-route to matching condos
- [ ] `@condo:name` syntax works
- [ ] Keyword matches route correctly
- [ ] Classification log records all attempts
- [ ] Stats endpoint returns accuracy data
- [ ] No regression in existing functionality

---

# Phase 2: Tier 2 LLM Classification

**Goal:** Add LLM fallback for ambiguous messages. Increases coverage to 85-90%.

---

## Task 2.1: Implement Tier 2 LLM Classifier

**Files:**
- Modify: `condo-management/classifier.js`

**Replace the placeholder tier2Classify function:**

```javascript
/**
 * Tier 2: LLM semantic classification
 */
async function tier2Classify(message, context, condos, goals, llmClient) {
  if (!llmClient) return null;

  const condoSummaries = condos.map(c => {
    const condoGoals = goals
      .filter(g => g.condoId === c.id && g.status === 'active')
      .slice(0, 3);

    return {
      id: c.id,
      name: c.name,
      description: c.description || '',
      keywords: (c.keywords || []).slice(0, 5).join(', '),
      activeGoals: condoGoals.map(g => g.title),
    };
  });

  const prompt = `You are a message classifier for a project management system.

## Available Projects
${condoSummaries.map(c => `
### ${c.name} (${c.id})
${c.description}
${c.keywords ? `Keywords: ${c.keywords}` : ''}
${c.activeGoals.length ? `Active goals: ${c.activeGoals.join(', ')}` : ''}
`).join('\n')}

## Message to Classify
"${message.slice(0, 500)}"

${context.recentMessages?.length ? `
## Recent Context
${context.recentMessages.slice(-3).map(m => `- ${m}`).join('\n')}
` : ''}

## Instructions
Classify this message to the most appropriate project. Respond with JSON only:

{
  "condo": "<project-id or null if general/unclear>",
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation, max 50 chars>"
}

Rules:
- confidence > 0.8 only for clear, unambiguous matches
- Quick greetings or general questions → condo: null
- If message could apply to multiple projects, pick the primary one
- Consider recent context for follow-up messages`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.tier2TimeoutMs);

    const response = await llmClient.complete({
      model: CONFIG.tier2Model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: CONFIG.tier2MaxTokens,
      temperature: 0,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // Parse JSON from response
    const text = response.content || response.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      condo: parsed.condo,
      confidence: parsed.confidence || 0,
      reasoning: parsed.reasoning || 'LLM classification',
      alternatives: [],
      needsTier2: false,
      tier: 2,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[classifier] Tier 2 timeout, falling back');
    } else {
      console.error('[classifier] Tier 2 error:', err.message);
    }
    return null;
  }
}
```

**Commit:**

```bash
git add condo-management/classifier.js
git commit -m "feat(classification): implement Tier 2 LLM classifier"
```

---

## Task 2.2: Create LLM Client Wrapper

**Files:**
- Create: `condo-management/llm-client.js`

```javascript
// condo-management/llm-client.js
'use strict';

const http = require('http');

/**
 * Simple LLM client that calls OpenClaw gateway proxy
 */
class LLMClient {
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl || 'http://127.0.0.1:18200';
    this.timeout = opts.timeout || 5000;
  }

  async complete({ model, messages, max_tokens, temperature, signal }) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model,
        messages,
        max_tokens,
        temperature,
      });

      const url = new URL('/api/llm/complete', this.baseUrl);
      const req = http.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: this.timeout,
        signal,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) {
              reject(new Error(json.error));
            } else {
              resolve(json);
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (signal) {
        signal.addEventListener('abort', () => {
          req.destroy();
          reject(new Error('AbortError'));
        });
      }

      req.write(body);
      req.end();
    });
  }
}

module.exports = { LLMClient };
```

**Commit:**

```bash
git add condo-management/llm-client.js
git commit -m "feat(classification): add LLM client wrapper"
```

---

## Task 2.3: Wire LLM Client into Classification

**Files:**
- Modify: `condo-management/handlers.js`

**Add at top:**

```javascript
const { LLMClient } = require('./llm-client');
const llmClient = new LLMClient();
```

**Update classifySession call:**

```javascript
// In before_agent_start hook, change:
const classification = await classifySession(message, context, condos, { 
  tier1Only: false,  // Enable Tier 2
  goals: data.goals || [],
  llmClient,  // Pass LLM client
});
```

**Commit:**

```bash
git add condo-management/handlers.js
git commit -m "feat(classification): wire LLM client into classification flow"
```

---

## Task 2.4: Add Confirm Buttons for Medium Confidence

**Files:**
- Modify: `condo-management/handlers.js`

**Update the routing logic:**

```javascript
// After classification, add soft-confirm flow:

if (classification.confidence >= CONFIG.autoRouteThreshold) {
  // ... existing auto-route code ...
  
} else if (classification.confidence >= CONFIG.softConfirmThreshold && classification.condo) {
  // Medium confidence - ask for confirmation
  const condo = condos.find(c => c.id === classification.condo);
  const condoName = condo?.name || classification.condo;
  const condoEmoji = condo?.emoji || '📁';
  
  // Store pending classification
  if (!data.pendingClassifications) data.pendingClassifications = {};
  data.pendingClassifications[sessionKey] = {
    classificationId: logEntry.id,
    condoId: classification.condo,
    confidence: classification.confidence,
    expiresAt: Date.now() + CONFIG.softConfirmAutoAcceptMs,
  };
  store.save(data);
  
  // Build alternatives for buttons
  const alternatives = [classification.condo, ...(classification.alternatives || []).map(a => a.condo)]
    .slice(0, 3)
    .map(id => {
      const c = condos.find(x => x.id === id);
      return { id, name: c?.name || id, emoji: c?.emoji || '📁' };
    });
  
  return {
    buttons: {
      text: `${condoEmoji} Route to ${condoName}?`,
      options: [
        ...alternatives.map(a => ({
          label: `${a.emoji} ${a.name}`,
          action: 'classification_confirm',
          data: { condoId: a.id, classificationId: logEntry.id },
        })),
        {
          label: '💬 General',
          action: 'classification_skip',
          data: { classificationId: logEntry.id },
        },
      ],
      autoAcceptMs: CONFIG.softConfirmAutoAcceptMs,
      autoAcceptIndex: 0,  // First option
    },
    classificationId: logEntry.id,
  };
}
```

**Add button handlers:**

```javascript
api.registerMethod('goals.classificationConfirm', async ({ sessionKey, condoId, classificationId }) => {
  const data = store.load();
  
  // Bind session
  if (!data.sessionCondoIndex) data.sessionCondoIndex = {};
  data.sessionCondoIndex[sessionKey] = condoId;
  
  // Clear pending
  if (data.pendingClassifications) {
    delete data.pendingClassifications[sessionKey];
  }
  
  // Update stats
  const condo = (data.condos || []).find(c => c.id === condoId);
  if (condo) {
    if (!condo.classificationStats) condo.classificationStats = { totalRouted: 0, corrections: 0 };
    condo.classificationStats.totalRouted++;
    condo.updatedAtMs = Date.now();
  }
  
  store.save(data);
  
  // Record feedback
  classificationLog.recordFeedback(classificationId, { accepted: true, correctedTo: null });
  
  return { ok: true, condoId };
});

api.registerMethod('goals.classificationSkip', async ({ sessionKey, classificationId }) => {
  const data = store.load();
  
  // Clear pending
  if (data.pendingClassifications) {
    delete data.pendingClassifications[sessionKey];
  }
  store.save(data);
  
  // Record feedback
  classificationLog.recordFeedback(classificationId, { accepted: false, correctedTo: null });
  
  return { ok: true };
});
```

**Commit:**

```bash
git add condo-management/handlers.js
git commit -m "feat(classification): add confirm buttons for medium confidence"
```

---

## Task 2.5: Test Phase 2

**Test scenarios:**

1. **LLM classification:**
   - Send ambiguous message like "how's the thing going?"
   - Should see confirm buttons if recent context exists

2. **Button confirmation:**
   - Tap confirm button
   - Session should be routed

3. **Auto-accept:**
   - Wait 5s without tapping
   - Should auto-accept first option

4. **Skip:**
   - Tap "General"
   - Should remain uncategorized

---

## Phase 2 Success Criteria

- [ ] Tier 2 LLM kicks in for ambiguous messages
- [ ] Confirm buttons appear for medium confidence
- [ ] Auto-accept works after timeout
- [ ] Skip button works
- [ ] Latency stays under 3s for Tier 2

---

# Phase 3: Goal Auto-Creation

**Goal:** Detect task-like messages and suggest creating goals with subtasks.

---

## Task 3.1: Implement Goal Extraction Prompt

**Files:**
- Create: `condo-management/goal-extractor.js`

```javascript
// condo-management/goal-extractor.js
'use strict';

const { LLMClient } = require('./llm-client');
const { detectGoalIntent } = require('./classifier');

const CONFIG = {
  model: 'claude-sonnet-4-20250514',
  maxTokens: 500,
  timeoutMs: 5000,
};

/**
 * Extract goal title and tasks from a message
 */
async function extractGoal(message, context = {}) {
  const intent = detectGoalIntent(message);
  if (!intent.isGoal) {
    return { shouldCreate: false, reason: 'No goal intent detected' };
  }

  const llm = new LLMClient();

  const prompt = `Extract a goal (task/project) from this message.

## Message
"${message.slice(0, 1000)}"

${context.condoName ? `## Project Context: ${context.condoName}` : ''}

## Instructions
Extract a clear goal title and subtasks. Respond with JSON only:

{
  "shouldCreate": true,
  "title": "<concise goal title, max 60 chars>",
  "description": "<optional longer description>",
  "tasks": [
    "<task 1>",
    "<task 2>",
    "<task 3>"
  ]
}

Rules:
- Title should be action-oriented (verb + noun)
- Extract 1-5 tasks if the message contains steps/phases
- If no clear subtasks, return empty tasks array
- If message is too vague for a goal, return shouldCreate: false`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

    const response = await llm.complete({
      model: CONFIG.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: CONFIG.maxTokens,
      temperature: 0,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const text = response.content || response.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { shouldCreate: false, reason: 'Failed to parse response' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      shouldCreate: parsed.shouldCreate !== false,
      title: parsed.title || '',
      description: parsed.description || '',
      tasks: parsed.tasks || [],
      confidence: intent.score,
    };
  } catch (err) {
    console.error('[goal-extractor] Error:', err.message);
    return { shouldCreate: false, reason: err.message };
  }
}

module.exports = { extractGoal, CONFIG };
```

**Commit:**

```bash
git add condo-management/goal-extractor.js
git commit -m "feat(goals): add goal extraction from messages"
```

---

## Task 3.2: Add Goal Suggestion to Classification Flow

**Files:**
- Modify: `condo-management/handlers.js`

**Add after successful routing:**

```javascript
const { extractGoal } = require('./goal-extractor');
const { detectGoalIntent } = require('./classifier');

// In before_agent_start, after routing:
if (classification.confidence >= CONFIG.autoRouteThreshold) {
  // ... existing routing code ...
  
  // Check for goal intent
  const goalIntent = detectGoalIntent(message);
  if (goalIntent.isGoal && goalIntent.score >= CONFIG.goalSuggestThreshold) {
    // Extract goal details
    const goalData = await extractGoal(message, { condoName: condo?.name });
    
    if (goalData.shouldCreate && goalData.title) {
      // Store pending goal suggestion
      if (!data.pendingGoalSuggestions) data.pendingGoalSuggestions = {};
      data.pendingGoalSuggestions[sessionKey] = {
        title: goalData.title,
        description: goalData.description,
        tasks: goalData.tasks,
        condoId: classification.condo,
        classificationId: logEntry.id,
        expiresAt: Date.now() + 300000,  // 5 minutes
      };
      store.save(data);
      
      // Return goal suggestion buttons
      return {
        prependContext: buildCondoContext(classification.condo, data),
        systemNote: `${condoEmoji} ${condoName}`,
        classificationId: logEntry.id,
        goalSuggestion: {
          title: goalData.title,
          tasks: goalData.tasks,
          buttons: [
            { label: '✅ Create', action: 'goal_create_confirm', data: { sessionKey } },
            { label: '✏️ Edit', action: 'goal_create_edit', data: { sessionKey } },
            { label: '❌ Skip', action: 'goal_create_skip', data: { sessionKey } },
          ],
        },
      };
    }
  }
  
  // ... rest of existing code ...
}
```

**Add goal creation handlers:**

```javascript
api.registerMethod('goals.createFromSuggestion', async ({ sessionKey, edit }) => {
  const data = store.load();
  const suggestion = data.pendingGoalSuggestions?.[sessionKey];
  if (!suggestion) throw new Error('No pending goal suggestion');
  
  // Create goal
  const goalId = `goal_${require('crypto').randomBytes(12).toString('hex')}`;
  const goal = {
    id: goalId,
    title: suggestion.title,
    description: suggestion.description || '',
    status: 'active',
    condoId: suggestion.condoId,
    tasks: (suggestion.tasks || []).map((text, i) => ({
      id: `task_${require('crypto').randomBytes(8).toString('hex')}`,
      text,
      status: 'pending',
      done: false,
      createdAtMs: Date.now(),
    })),
    sessions: [sessionKey],
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  };
  
  if (!data.goals) data.goals = [];
  data.goals.push(goal);
  
  // Bind session to goal
  if (!data.sessionIndex) data.sessionIndex = {};
  data.sessionIndex[sessionKey] = { goalId };
  
  // Clear suggestion
  delete data.pendingGoalSuggestions[sessionKey];
  
  // Update classification log
  const logData = require('./classification-log').load();
  const entry = logData.entries.find(e => e.id === suggestion.classificationId);
  if (entry) {
    entry.goalCreated = true;
    entry.goalId = goalId;
    require('./classification-log').save(logData);
  }
  
  store.save(data);
  
  return { ok: true, goal };
});

api.registerMethod('goals.skipSuggestion', async ({ sessionKey }) => {
  const data = store.load();
  if (data.pendingGoalSuggestions?.[sessionKey]) {
    delete data.pendingGoalSuggestions[sessionKey];
    store.save(data);
  }
  return { ok: true };
});
```

**Commit:**

```bash
git add condo-management/handlers.js
git commit -m "feat(goals): add goal suggestion and creation flow"
```

---

## Task 3.3: Test Phase 3

**Test scenarios:**

1. **Task detection:**
   - Send "Build a landing page - first design, then implement, finally deploy"
   - Should see goal suggestion with 3 tasks

2. **Create goal:**
   - Tap "Create"
   - Goal should appear in ClawCondos sidebar

3. **Edit flow:**
   - Tap "Edit"
   - Should allow modifying title/tasks

4. **Skip:**
   - Tap "Skip"
   - No goal created, session still routed

---

## Phase 3 Success Criteria

- [ ] Task-like messages trigger goal suggestions
- [ ] Goal extraction produces sensible titles
- [ ] Subtasks extracted correctly
- [ ] Create/Edit/Skip buttons work
- [ ] Goals appear in UI after creation

---

# Phase 4: Learning Loop

**Goal:** Improve classification accuracy over time by learning from corrections.

---

## Task 4.1: Create Learning Module

**Files:**
- Create: `condo-management/learning.js`

```javascript
// condo-management/learning.js
'use strict';

const classificationLog = require('./classification-log');
const store = require('./store');

/**
 * Analyze corrections and extract new keywords
 */
function analyzeCorrections(since = 0) {
  const corrections = classificationLog.getCorrections(since);
  
  // Group corrections by corrected-to condo
  const byTarget = new Map();
  for (const entry of corrections) {
    const target = entry.correctedTo;
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push(entry);
  }
  
  // Extract potential keywords from corrected messages
  const suggestions = [];
  
  for (const [condoId, entries] of byTarget) {
    const words = new Map();
    
    for (const entry of entries) {
      const msgWords = entry.message.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3);
      
      for (const w of msgWords) {
        words.set(w, (words.get(w) || 0) + 1);
      }
    }
    
    // Find words that appear in multiple corrections
    const frequentWords = [...words.entries()]
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
    
    if (frequentWords.length > 0) {
      suggestions.push({
        condoId,
        suggestedKeywords: frequentWords,
        correctionCount: entries.length,
      });
    }
  }
  
  return suggestions;
}

/**
 * Apply learning suggestions to condos
 */
function applyLearning(suggestions, dryRun = false) {
  const data = store.load();
  const applied = [];
  
  for (const suggestion of suggestions) {
    const condo = (data.condos || []).find(c => c.id === suggestion.condoId);
    if (!condo) continue;
    
    const existing = new Set(condo.keywords || []);
    const added = [];
    
    for (const kw of suggestion.suggestedKeywords) {
      if (!existing.has(kw)) {
        existing.add(kw);
        added.push(kw);
      }
    }
    
    if (added.length > 0) {
      if (!dryRun) {
        condo.keywords = [...existing].slice(0, 25);
        condo.updatedAtMs = Date.now();
      }
      applied.push({
        condoId: condo.id,
        condoName: condo.name,
        addedKeywords: added,
      });
    }
  }
  
  if (!dryRun && applied.length > 0) {
    store.save(data);
  }
  
  return applied;
}

/**
 * Get learning report
 */
function getLearningReport() {
  const stats = classificationLog.getStats();
  const suggestions = analyzeCorrections(Date.now() - 604800000);  // Last week
  
  return {
    stats,
    suggestions,
    lastAnalyzed: Date.now(),
  };
}

module.exports = {
  analyzeCorrections,
  applyLearning,
  getLearningReport,
};
```

**Commit:**

```bash
git add condo-management/learning.js
git commit -m "feat(learning): add correction analysis and keyword learning"
```

---

## Task 4.2: Add Learning RPC Methods

**Files:**
- Modify: `condo-management/handlers.js`

```javascript
const learning = require('./learning');

api.registerMethod('goals.learningReport', async () => {
  const report = learning.getLearningReport();
  return { ok: true, report };
});

api.registerMethod('goals.applyLearning', async ({ dryRun }) => {
  const suggestions = learning.analyzeCorrections(Date.now() - 604800000);
  const applied = learning.applyLearning(suggestions, dryRun);
  return { ok: true, applied, dryRun };
});
```

**Commit:**

```bash
git add condo-management/handlers.js
git commit -m "feat(learning): add RPC methods for learning management"
```

---

## Task 4.3: Create Weekly Learning Cron Job

**Files:**
- Create: `condo-management/scripts/weekly-learn.js`

```javascript
#!/usr/bin/env node
// condo-management/scripts/weekly-learn.js
'use strict';

const learning = require('../learning');

console.log('=== Classification Learning Report ===\n');

const report = learning.getLearningReport();

console.log('## Stats');
console.log(`Total classifications: ${report.stats.total}`);
console.log(`With feedback: ${report.stats.withFeedback}`);
console.log(`Accepted: ${report.stats.accepted}`);
console.log(`Corrected: ${report.stats.corrected}`);
if (report.stats.accuracy !== null) {
  console.log(`Accuracy: ${(report.stats.accuracy * 100).toFixed(1)}%`);
}
console.log('');

console.log('## Suggestions');
if (report.suggestions.length === 0) {
  console.log('No suggestions (need more corrections)');
} else {
  for (const s of report.suggestions) {
    console.log(`\n${s.condoId}:`);
    console.log(`  Corrections: ${s.correctionCount}`);
    console.log(`  Suggested keywords: ${s.suggestedKeywords.join(', ')}`);
  }
}

// Apply if --apply flag
if (process.argv.includes('--apply')) {
  console.log('\n## Applying...');
  const applied = learning.applyLearning(report.suggestions, false);
  for (const a of applied) {
    console.log(`  ${a.condoName}: +${a.addedKeywords.join(', ')}`);
  }
  console.log('\n✅ Learning applied.');
} else {
  console.log('\n(run with --apply to save changes)');
}
```

**Make executable:**

```bash
chmod +x condo-management/scripts/weekly-learn.js
git add condo-management/scripts/weekly-learn.js
git commit -m "feat(learning): add weekly learning script"
```

---

## Task 4.4: Add Cron Job for Weekly Learning

**Via OpenClaw cron:**

```javascript
// Add to cron jobs (via cron tool)
{
  name: "classification-learning",
  schedule: { kind: "cron", expr: "0 9 * * 1", tz: "Europe/Madrid" },  // 9am Monday
  payload: {
    kind: "agentTurn",
    message: "Run weekly classification learning: analyze corrections and apply keyword updates. Report results.",
  },
  sessionTarget: "isolated",
}
```

---

## Task 4.5: Add Metrics Dashboard (Optional)

**Files:**
- Modify: `public/app.js` (ClawCondos UI)

Add a Classification Stats section to the dashboard showing:
- Accuracy rate
- Correction rate
- Classifications by tier
- Recent corrections

---

## Phase 4 Success Criteria

- [ ] Corrections are logged
- [ ] Weekly learning extracts new keywords
- [ ] Accuracy improves over time
- [ ] Stats visible in dashboard

---

# Files Summary

| File | Phase | Action | Purpose |
|------|-------|--------|---------|
| `store.js` | 1 | Modify | Condo schema + helpers |
| `classifier.js` | 1,2 | Create | Tier 1 + Tier 2 classification |
| `classification-log.js` | 1 | Create | Log store |
| `handlers.js` | 1,2,3 | Modify | Hooks + RPCs |
| `llm-client.js` | 2 | Create | Gateway LLM wrapper |
| `goal-extractor.js` | 3 | Create | Goal/task extraction |
| `learning.js` | 4 | Create | Correction analysis |
| `scripts/seed-keywords.js` | 1 | Create | Initial seeding |
| `scripts/weekly-learn.js` | 4 | Create | Weekly cron |

---

# Execution

**Plan saved to:** `docs/SESSION-CLASSIFICATION-PROPOSAL.md`

**Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
