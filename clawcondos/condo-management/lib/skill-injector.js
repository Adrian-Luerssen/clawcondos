/**
 * Skill Injector
 * Reads skill files and builds context strings for PM and worker agents
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Skill file paths (relative to plugin root)
const SKILL_PM_PATH = join(__dirname, '..', '..', '..', 'docs', 'SKILL-PM.md');
const SKILL_WORKER_PATH = join(__dirname, '..', '..', '..', 'docs', 'SKILL-WORKER.md');

// Cache for skill file contents
let skillCache = {
  pm: null,
  worker: null,
  loadedAt: null,
};

const CACHE_TTL_MS = 60_000; // 1 minute cache

/**
 * Load skill file with caching
 * @param {string} type - 'pm' or 'worker'
 * @returns {string|null} Skill content or null if not found
 */
function loadSkillFile(type) {
  const now = Date.now();
  
  // Check cache
  if (skillCache.loadedAt && (now - skillCache.loadedAt) < CACHE_TTL_MS) {
    return skillCache[type];
  }
  
  // Load files
  try {
    skillCache.pm = existsSync(SKILL_PM_PATH)
      ? readFileSync(SKILL_PM_PATH, 'utf-8')
      : null;
  } catch {
    skillCache.pm = null;
  }
  
  try {
    skillCache.worker = existsSync(SKILL_WORKER_PATH)
      ? readFileSync(SKILL_WORKER_PATH, 'utf-8')
      : null;
  } catch {
    skillCache.worker = null;
  }
  
  skillCache.loadedAt = now;
  return skillCache[type];
}

/**
 * Clear skill cache (for testing or hot reload)
 */
export function clearSkillCache() {
  skillCache = { pm: null, worker: null, loadedAt: null };
}

/**
 * Get PM skill context for injection into agent prompts
 * @param {object} options - Context options
 * @param {string} [options.condoId] - Current condo ID
 * @param {string} [options.condoName] - Current condo name
 * @param {number} [options.activeGoals] - Number of active goals
 * @param {number} [options.totalTasks] - Total task count
 * @param {number} [options.pendingTasks] - Pending task count
 * @param {object} [options.roles] - Available roles with descriptions { role: { description, agentId } }
 * @returns {string|null} PM skill context or null if unavailable
 */
export function getPmSkillContext(options = {}) {
  const skillContent = loadSkillFile('pm');
  if (!skillContent) return null;
  
  const {
    condoId,
    condoName,
    activeGoals,
    totalTasks,
    pendingTasks,
    roles,
  } = options;
  
  // Build PM session context header
  const header = [
    '---',
    '## PM Session Context',
  ];
  
  if (condoId && condoName) {
    header.push(`- **Project:** ${condoName} (${condoId})`);
  }
  
  if (typeof activeGoals === 'number') {
    header.push(`- **Active Goals:** ${activeGoals}`);
  }
  
  if (typeof totalTasks === 'number') {
    const pending = typeof pendingTasks === 'number' ? pendingTasks : '?';
    header.push(`- **Tasks:** ${totalTasks} total, ${pending} pending`);
  }
  
  // Add available roles section if provided
  if (roles && typeof roles === 'object' && Object.keys(roles).length > 0) {
    header.push('');
    header.push('## Available Roles');
    
    for (const [role, info] of Object.entries(roles)) {
      const desc = info?.description || getDefaultRoleDescription(role);
      const agentId = info?.agentId || role;
      header.push(`- **${role}** (${agentId}): ${desc}`);
    }
  }
  
  header.push('---', '');
  
  return header.join('\n') + skillContent;
}

/**
 * Get default description for a role
 * @param {string} role - Role name
 * @returns {string} Default description
 */
function getDefaultRoleDescription(role) {
  const defaults = {
    pm: 'Project manager, coordinates tasks and agents',
    frontend: 'UI/UX specialist, handles client-side code and interfaces',
    backend: 'API developer, handles server-side logic and databases',
    designer: 'Visual designer, creates mockups and design systems',
    tester: 'QA specialist, writes and runs tests',
    devops: 'Infrastructure and deployment specialist',
    qa: 'Quality assurance, reviews and validates work',
    researcher: 'Research and analysis specialist',
  };
  return defaults[role.toLowerCase()] || 'Specialist agent';
}

/**
 * Get worker skill context for injection into agent prompts
 * @param {object} taskContext - Task-specific context
 * @param {string} taskContext.goalId - Goal ID
 * @param {string} taskContext.taskId - Task ID
 * @param {string} taskContext.taskText - Task description
 * @param {string} [taskContext.taskDescription] - Detailed task description
 * @param {string} [taskContext.goalTitle] - Parent goal title
 * @param {string} [taskContext.condoId] - Condo ID (if applicable)
 * @param {string} [taskContext.condoName] - Condo name (if applicable)
 * @param {string} [taskContext.autonomyMode] - Autonomy level
 * @param {string} [taskContext.planFilePath] - Expected plan file path
 * @param {string} [taskContext.assignedRole] - Role assigned to this task
 * @returns {string|null} Worker skill context or null if unavailable
 */
export function getWorkerSkillContext(taskContext = {}) {
  const skillContent = loadSkillFile('worker');
  if (!skillContent) return null;
  
  const {
    goalId,
    taskId,
    taskText,
    taskDescription,
    goalTitle,
    condoId,
    condoName,
    autonomyMode,
    planFilePath,
    assignedRole,
  } = taskContext;
  
  // Build task assignment header
  const header = [
    '---',
    '## Your Task Assignment',
  ];
  
  if (condoName) {
    header.push(`- **Project:** ${condoName}`);
  }
  
  if (goalTitle) {
    header.push(`- **Goal:** ${goalTitle} (\`${goalId}\`)`);
  }
  
  header.push(`- **Task ID:** \`${taskId}\``);
  header.push(`- **Task:** ${taskText}`);
  
  if (taskDescription) {
    header.push(`- **Details:** ${taskDescription}`);
  }
  
  if (assignedRole) {
    header.push(`- **Your Role:** ${assignedRole}`);
  }
  
  if (autonomyMode) {
    header.push(`- **Autonomy:** ${autonomyMode}`);
  }
  
  if (planFilePath) {
    header.push(`- **Plan File:** \`${planFilePath}\``);
  }
  
  header.push('---', '');
  
  return header.join('\n') + skillContent;
}

/**
 * Check if skill files are available
 * @returns {{ pm: boolean, worker: boolean }}
 */
export function getSkillAvailability() {
  return {
    pm: existsSync(SKILL_PM_PATH),
    worker: existsSync(SKILL_WORKER_PATH),
  };
}
