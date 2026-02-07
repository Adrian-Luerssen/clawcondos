# Intelligent Session Classification & Goal Auto-Creation

> **Status:** Proposal  
> **Date:** 2026-02-07  
> **Authors:** Bob (agent swarm synthesis)

## Executive Summary

When a new Telegram session is initiated, automatically evaluate whether it fits an existing condo, and optionally create goals with subtasks. This eliminates manual session organization and ensures work is tracked from the first message.

---

## Problem Statement

Currently, all session-to-condo/goal binding is **manual**:
- User creates session, explicitly assigns to goal via UI
- Agent uses `condo_bind` tool to self-bind
- Subagent spawning pre-assigns session

**Pain points:**
- Sessions pile up as "uncategorized" in dashboard
- Context is lost when work isn't tracked in goals
- Manual triage is tedious and often forgotten

---

## Proposed Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    INCOMING TELEGRAM MESSAGE                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              SESSION CREATION (resolveSession)                   │
│              isNewSession = true detected                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 TIER 1: FAST PATTERN MATCHER                     │
│  • Explicit condo mentions (@condo:investor-crm)                │
│  • Keyword triggers (defined per condo)                         │
│  • Thread/topic continuity                                      │
│  • Confidence: HIGH (≥0.9) → Route immediately                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                    confidence < 0.9
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 TIER 2: LLM CLASSIFIER                           │
│  • Semantic analysis of message intent                          │
│  • Match against condo descriptions + recent goals              │
│  • Returns: {condo, confidence, suggestedGoal?, reasoning}      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 DECISION ENGINE                                  │
│  • confidence ≥ 0.85 → Auto-route (with indicator)              │
│  • confidence 0.5-0.85 → Suggest with confirm buttons           │
│  • confidence < 0.5 → Treat as general session                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 GOAL DETECTION                                   │
│  • Detect task-like language patterns                           │
│  • LLM extracts title + subtasks if needed                      │
│  • Auto-create or suggest based on confidence                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Injection Point

### Location: `before_agent_start` Hook

The ClawCondos goals plugin already has this hook. We extend it:

```javascript
api.registerHook('before_agent_start', async (event) => {
  const sessionKey = event.context?.sessionKey;
  const message = event.context?.message;
  const data = store.load();
  
  // Skip if already bound
  if (data.sessionCondoIndex[sessionKey] || data.sessionIndex[sessionKey]) {
    return existingContextInjection();
  }
  
  // NEW: Classify and bind
  const classification = await classifySession(message, data);
  
  if (classification.condo && classification.confidence >= CONFIG.autoRouteThreshold) {
    // Auto-bind
    data.sessionCondoIndex[sessionKey] = classification.condo;
    store.save(data);
    
    // Optionally create goal
    if (classification.suggestedGoal?.autoCreate) {
      await createGoalFromClassification(classification, sessionKey, data);
    }
    
    return { 
      prependContext: buildCondoContext(classification.condo, data),
      announce: `📁 Routed to ${classification.condoName}`
    };
  }
  
  if (classification.confidence >= CONFIG.askUserThreshold) {
    // Return inline buttons for user choice
    return {
      buttons: buildCondoSelectionButtons(classification.alternatives)
    };
  }
  
  // Low confidence - treat as general
  return null;
});
```

---

## Tier 1: Fast Pattern Matcher

Zero-latency classification for obvious cases.

### Data Model Addition

```javascript
// Add to condo schema
{
  id: "condo:investor-crm",
  name: "Investor CRM",
  description: "Track investor relationships for GenLayer Series A",
  
  // NEW: Classification hints
  keywords: ["investor", "crm", "pipeline", "fundraising", "series a", "vc"],
  triggers: [
    /investor\s+\w+/i,
    /deal\s+(flow|#?\d+)/i,
    /pipeline/i,
    /series\s+[ab]/i
  ],
  excludePatterns: [
    /test/i  // Don't match "test investor" 
  ]
}
```

### Algorithm

```javascript
function tier1Classify(message, context, condos) {
  // 1. Explicit mention (highest priority)
  const explicit = message.match(/@condo:(\S+)/i);
  if (explicit) {
    const condo = condos.find(c => c.id.includes(explicit[1]) || c.name.toLowerCase().includes(explicit[1].toLowerCase()));
    if (condo) return { condo: condo.id, confidence: 1.0, reasoning: "Explicit @condo mention" };
  }
  
  // 2. Telegram topic continuity
  if (context.telegramTopicId && context.topicCondoBinding) {
    return { 
      condo: context.topicCondoBinding, 
      confidence: 0.95, 
      reasoning: "Telegram topic continuation" 
    };
  }
  
  // 3. Keyword/trigger scoring
  const scores = new Map();
  
  for (const condo of condos) {
    let score = 0;
    const messageLower = message.toLowerCase();
    
    // Keyword hits (+0.15 each, max 0.6)
    const keywordHits = (condo.keywords || []).filter(k => messageLower.includes(k.toLowerCase()));
    score += Math.min(keywordHits.length * 0.15, 0.6);
    
    // Trigger pattern hits (+0.3 each)
    const triggerHits = (condo.triggers || []).filter(t => t.test(message));
    score += triggerHits.length * 0.3;
    
    // Exclude pattern penalty
    const excludeHits = (condo.excludePatterns || []).filter(e => e.test(message));
    score -= excludeHits.length * 0.5;
    
    // Recency boost (active in last 24h)
    if (condo.updatedAtMs && Date.now() - condo.updatedAtMs < 86400000) {
      score += 0.1;
    }
    
    if (score > 0) scores.set(condo.id, Math.min(score, 1.0));
  }
  
  // Return best match if confident
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0 && sorted[0][1] >= 0.9) {
    return {
      condo: sorted[0][0],
      confidence: sorted[0][1],
      reasoning: `Keyword match`,
      alternatives: sorted.slice(1, 4).map(([id, conf]) => ({ condo: id, confidence: conf }))
    };
  }
  
  // Not confident, return partial for Tier 2
  return {
    condo: sorted[0]?.[0] || null,
    confidence: sorted[0]?.[1] || 0,
    alternatives: sorted.slice(0, 4).map(([id, conf]) => ({ condo: id, confidence: conf })),
    needsTier2: true
  };
}
```

---

## Tier 2: LLM Classifier

For ambiguous messages that Tier 1 can't confidently classify.

```javascript
async function tier2Classify(message, context, condos, goals) {
  const condoSummaries = condos.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description,
    recentGoals: goals
      .filter(g => g.condoId === c.id && g.status === 'active')
      .slice(0, 3)
      .map(g => g.title)
  }));

  const prompt = `You are a message classifier for a project management system.

## Available Projects (Condos)
${condoSummaries.map(c => `
### ${c.name} (${c.id})
${c.description}
${c.recentGoals.length ? `Active goals: ${c.recentGoals.join(', ')}` : 'No active goals'}
`).join('\n')}

## Incoming Message
"${message}"

${context.recentMessages?.length ? `## Recent Context\n${context.recentMessages.slice(-3).map(m => `- ${m}`).join('\n')}` : ''}

## Task
Classify this message. Respond with JSON only:

{
  "condo": "<condo-id or null if general/unclear>",
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation>",
  "suggestedGoal": {
    "shouldCreate": <boolean - true if this looks like a new task/project>,
    "title": "<goal title if shouldCreate>",
    "tasks": ["<subtask 1>", "<subtask 2>", ...],
    "existingGoalId": "<goal-id if this relates to an existing goal>"
  }
}

Guidelines:
- confidence > 0.8 only for clear matches
- Quick questions/chat → condo: null
- Multi-project messages → pick primary project
- Task-like language ("fix", "implement", "need to") → suggestedGoal.shouldCreate: true`;

  const response = await llm.complete({
    model: "claude-sonnet-4-20250514",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 500,
    temperature: 0
  });

  return JSON.parse(extractJson(response));
}
```

---

## Goal Auto-Creation

### Detection Heuristics

```javascript
const GOAL_INDICATORS = [
  { pattern: /\b(need to|should|must|have to|gotta|let's)\b/i, weight: 0.3 },
  { pattern: /\b(fix|implement|add|create|build|design|review|update|refactor)\b/i, weight: 0.3 },
  { pattern: /\b(bug|issue|problem|feature|task|todo)\b/i, weight: 0.2 },
  { pattern: /\b(by|before|deadline|urgent|asap)\b/i, weight: 0.1 },
];

function detectGoalIntent(message) {
  let score = 0;
  for (const indicator of GOAL_INDICATORS) {
    if (indicator.pattern.test(message)) {
      score += indicator.weight;
    }
  }
  // Longer messages more likely to be goals
  if (message.length > 100) score += 0.1;
  if (message.length > 200) score += 0.1;
  
  return score;
}
```

### Creation Flow

```javascript
async function createGoalFromClassification(classification, sessionKey, data) {
  const goal = {
    id: `goal_${crypto.randomBytes(12).toString('hex')}`,
    title: classification.suggestedGoal.title,
    description: classification.originalMessage,
    status: 'active',
    condoId: classification.condo,
    tasks: classification.suggestedGoal.tasks.map((text, i) => ({
      id: `task_${crypto.randomBytes(12).toString('hex')}`,
      text,
      status: 'pending',
      done: false,
      createdAtMs: Date.now()
    })),
    sessions: [sessionKey],
    createdAtMs: Date.now(),
    updatedAtMs: Date.now()
  };
  
  data.goals.push(goal);
  data.sessionIndex[sessionKey] = { goalId: goal.id };
  store.save(data);
  
  return goal;
}
```

---

## UX Flows

### Auto-Route (confidence ≥ 0.85)

```
User: "Update the investor pipeline with the new VC contacts"

Bot: 📁 investor-crm
     ────────────────────────────────────────
     [Message processed normally, context injected]
```

Small inline indicator, no interruption.

### Soft Confirm (confidence 0.5-0.85)

```
User: "Need to track some new deals"

Bot: Which project?
     [💼 investor-crm] [🏠 subastas] [💬 general]
     
     (auto-selects investor-crm in 5s based on best match)
```

User can tap to confirm/change, or wait for auto-selection.

### Goal Suggestion (when task detected)

```
User: "We need to revamp the investor outreach flow - 
       first audit current state, then design new stages, 
       finally implement the changes"

Bot: 📋 Create goal in investor-crm?
     
     **Revamp investor outreach flow**
     Tasks:
     • Audit current state
     • Design new stages  
     • Implement changes
     
     [Create] [Edit] [Skip]
```

---

## Edge Cases

### 1. One-Off Questions

```javascript
const ONE_OFF_PATTERNS = [
  /^(what|when|where|who|how)\s+(is|are|was|were|time|day)/i,
  /^(remind|tell) me/i,
  /^(hi|hello|hey|thanks|ok|sure|yes|no)\b/i,
];

function isOneOff(message) {
  if (message.length > 150) return false;
  return ONE_OFF_PATTERNS.some(p => p.test(message.trim()));
}
// One-offs skip classification entirely
```

### 2. Cross-Condo Work

```
User: "Use the map component from subastas in the CRM"

Classification:
{
  condo: "investor-crm",  // Primary
  confidence: 0.75,
  crossReferences: ["subastas"],
  reasoning: "Primary work in CRM, references subastas"
}

Bot: 📁 investor-crm (also refs: subastas)
```

### 3. Context Switch Mid-Thread

```javascript
const CONTEXT_SWITCH = [
  /\b(btw|by the way|also|separately|unrelated|different topic)\b/i,
  /\b(switch(ing)? to|let's talk about|moving on)\b/i,
];

// If detected, ignore thread binding and classify fresh
```

### 4. Ambiguous Follow-Up

```
User: "How's the progress?"

// No clear condo signal, check recent context
if (context.lastCondoMentioned && context.timeSinceLastMessage < 600000) {
  return { condo: context.lastCondoMentioned, confidence: 0.7 };
}
// Otherwise ask
```

---

## Configuration

```javascript
const CLASSIFICATION_CONFIG = {
  // Tier 1 thresholds
  tier1ConfidenceThreshold: 0.9,  // Skip Tier 2 if above
  
  // Tier 2 settings
  tier2Model: "claude-sonnet-4-20250514",
  tier2MaxTokens: 500,
  tier2TimeoutMs: 5000,
  
  // Decision thresholds
  autoRouteThreshold: 0.85,      // Silent routing
  softConfirmThreshold: 0.5,      // Show buttons
  askUserThreshold: 0.3,          // Explicit ask
  
  // Goal creation
  autoCreateGoalThreshold: 0.9,   // Auto-create without confirm
  suggestGoalThreshold: 0.6,      // Suggest with confirm
  
  // UX
  softConfirmAutoAcceptMs: 5000,  // Auto-accept after 5s
  
  // Context
  recentMessageWindowCount: 5,
  recentMessageWindowMs: 600000,  // 10 minutes
};
```

---

## Implementation Phases

### Phase 1: Infrastructure (Week 1)
- [ ] Add `keywords`, `triggers`, `excludePatterns` to condo schema
- [ ] Create `classifier.js` module with Tier 1 logic
- [ ] Extend `before_agent_start` hook to call classifier
- [ ] Add `@condo:` syntax parsing

### Phase 2: Tier 1 Complete (Week 1-2)
- [ ] Implement keyword/trigger scoring
- [ ] Add thread continuity detection
- [ ] Wire up auto-binding for high-confidence matches
- [ ] Add small indicator in replies ("📁 condo-name")

### Phase 3: Tier 2 LLM (Week 2)
- [ ] Implement LLM classifier prompt
- [ ] Add confidence-based UX (buttons vs auto)
- [ ] Handle soft-confirm with timeout

### Phase 4: Goal Creation (Week 3)
- [ ] Implement goal intent detection
- [ ] Add LLM subtask extraction
- [ ] Build goal suggestion UI with inline buttons
- [ ] Wire to existing `condo_create_goal` logic

### Phase 5: Learning & Polish (Week 4)
- [ ] Add feedback collection (user corrections)
- [ ] Implement keyword auto-learning from corrections
- [ ] Tune thresholds based on accuracy data
- [ ] Edge case handling refinements

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `condo-management/classifier.js` | Create | Classification engine |
| `condo-management/handlers.js` | Modify | Hook extension |
| `condo-management/store.js` | Modify | Add keyword fields |
| `condo-management/types.d.ts` | Modify | TypeScript types |
| `docs/CLASSIFICATION.md` | Create | User documentation |

---

## Success Metrics

- **Classification accuracy:** >85% correct on first try
- **User corrections:** <15% of auto-routed sessions
- **Goal creation adoption:** >50% of suggested goals accepted
- **Session organization:** <20% sessions remain "uncategorized"

---

## Open Questions

1. **Telegram topic = condo?** Should we auto-bind Telegram topics to condos by name matching?

2. **Learning persistence:** Store learned keywords in condo definition or separate file?

3. **Multi-agent:** Should classification run in main agent or dedicated classifier agent?

4. **Rate limiting:** How to handle rapid messages during classification (queue? batch?)

---

## Appendix: Existing Tools Reference

### Available Agent Tools
- `condo_bind(condoId | name)` - Bind session to condo
- `goal_update(goalId, status, summary, addTasks, ...)` - Update goal
- `condo_create_goal(title, description, tasks)` - Create goal
- `condo_add_task(goalId, text)` - Add task to goal
- `condo_spawn_task(goalId, taskId)` - Spawn subagent for task

### Available RPC Methods
- `goals.setSessionCondo(sessionKey, condoId)` - Bind session
- `goals.sessionLookup(sessionKey)` - Check binding
- `goals.create(...)` - Create goal programmatically
- `goals.addTask(...)` - Add task programmatically
