# Agents Page Specification

## Overview

Add an **Agents** page to Sharp's Next.js app that displays and manages configured Clawdbot agents.

## Data Model (from `clawdbot agents list --json`)

```typescript
interface Agent {
  id: string;              // e.g., "main", "codex", "caffeine"
  name?: string;           // Display name, e.g., "Codex"
  identityName: string;    // e.g., "Bob", "Caffeine"
  identityEmoji: string;   // e.g., "🤖", "☕"
  identitySource: string;  // "identity" | "config"
  workspace: string;       // e.g., "/home/albert/clawd"
  agentDir: string;        // e.g., "~/.clawdbot/agents/main/agent"
  model: string;           // e.g., "anthropic/claude-opus-4-5"
  bindings: number;        // Number of routing rules
  isDefault: boolean;      // Is this the default agent?
  routes?: string[];       // Routing rule descriptions
}
```

## Gateway RPC

The gateway exposes `agents.list` RPC method. Add this to the gateway client:

```typescript
// In gateway.ts
async listAgents(): Promise<{ agents: Agent[] }> {
  return this.call('agents.list', {});
}
```

## UI Requirements

### 1. Navigation

Add "Agents" to the sidebar (`/agents` route) between Dashboard and Sessions:
- Icon: 🤖 (or suitable icon)
- Label: "Agents"

### 2. Agents Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Header: "Agents" | "Agent Configuration"                    │
│ [+ New Agent] button (disabled for now - future feature)    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🤖 Bob (main)                          [default] ⚡  │   │
│  │ Model: claude-opus-4-5                              │   │
│  │ Workspace: ~/clawd                                  │   │
│  │ Routes: default (no explicit rules)                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🤖 Bob (codex)                                 ⚡    │   │
│  │ Model: gpt-5.2-codex                               │   │
│  │ Workspace: ~/clawd                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ☕ Caffeine (caffeine)                         ⚡    │   │
│  │ Model: claude-opus-4-5                              │   │
│  │ Workspace: ~/clawd-caffeine                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3. Agent Card Component

Each agent displayed as a card showing:
- **Header row**: `{emoji} {identityName} ({id})` + badges
  - `[default]` badge if `isDefault`
  - Activity indicator (⚡ if agent has active sessions)
- **Model**: Short model name (strip provider prefix for display)
- **Workspace**: Path (use ~ for home dir)
- **Routes**: If `bindings > 0`, show routing rule count

### 4. Interaction

- **Click on card**: Navigate to filtered Sessions view for that agent
  - URL: `/sessions?agent={agentId}`
  - Sessions page should filter by agent
- **Future**: Edit agent config, view agent details, create new agents

### 5. Loading/Error States

- Loading spinner while fetching agents
- Error state with retry button if fetch fails
- Empty state if no agents configured (unlikely but handle it)

## Files to Create/Modify

### New Files
- `next-app/src/app/(dashboard)/agents/page.tsx` - Agents page
- `next-app/src/components/agents/AgentCard.tsx` - Agent card component
- `next-app/src/components/agents/AgentList.tsx` - Agent list component
- `next-app/src/components/agents/index.ts` - Barrel export

### Modifications
- `next-app/src/lib/gateway.ts` - Add `listAgents()` method
- `next-app/src/lib/types.ts` - Add `Agent` type
- `next-app/src/hooks/use-gateway.ts` - Expose `listAgents`
- `next-app/src/components/sidebar/Sidebar.tsx` - Add Agents nav item

## Styling

Use existing Sharp design system (CSS variables):
- `var(--bg-card)` for card background
- `var(--border-subtle)` for borders
- `var(--accent)` for highlights
- Match existing SessionCard styling patterns

## Testing

After implementation:
1. Build passes: `pnpm build`
2. Page loads and shows agents
3. Cards display correct information
4. Click navigation works
5. Loading/error states work

## Out of Scope (Future)

- Creating new agents
- Editing agent configuration
- Deleting agents
- Agent activity monitoring (real-time session count)
- Routing rule management
