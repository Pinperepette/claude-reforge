#!/usr/bin/env node
'use strict';

// Hook: PreToolUse
// Fires before every tool call.
// On the first "real" tool use of a session, retrieves and injects relevant memories.

const { getDb, logError, loadSession, saveSession } = require('../db.js');
const { retrieveRelevant, formatMemoryContext } = require('../retrieval.js');
const crypto = require('crypto');

// Tools that signal real work (not just navigation/inspection)
const WORK_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'Bash', 'Task', 'NotebookEdit']);

// Bash commands that are too trivial to trigger injection
const TRIVIAL_CMD = /^(ls|pwd|echo|cat|cd|which|type|env|printenv|whoami|date|man |grep -r|find \. -name)\s*/i;

function projectId(cwd) {
  return crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 12);
}

function getTaskHint(toolName, toolInput) {
  if (!toolInput) return '';
  if (toolName === 'Edit' || toolName === 'Write') {
    return `editing ${toolInput.file_path || ''}`;
  }
  if (toolName === 'MultiEdit') {
    const files = (toolInput.edits || []).map(e => e.file_path).filter(Boolean).join(', ');
    return `editing ${files}`;
  }
  if (toolName === 'Bash') {
    const cmd = (toolInput.command || '').trim();
    if (cmd && !TRIVIAL_CMD.test(cmd)) return `running: ${cmd.slice(0, 80)}`;
  }
  if (toolName === 'Task') {
    return toolInput.description || toolInput.prompt || '';
  }
  return '';
}

function trackFiles(session, toolName, toolInput) {
  if (!toolInput) return;
  let files = [];
  if (toolName === 'MultiEdit') {
    files = (toolInput.edits || []).map(e => e.file_path).filter(Boolean);
  } else if (toolName === 'Edit' || toolName === 'Write') {
    if (toolInput.file_path) files = [toolInput.file_path];
  }
  for (const f of files) {
    if (!session.fileChanges.includes(f)) session.fileChanges.push(f);
  }
}

async function main() {
  let input = {};
  try {
    let raw = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) raw += chunk;
    input = JSON.parse(raw);
  } catch (_) {
    exit('PreToolUse');
    return;
  }

  const { session_id, tool_name, tool_input, cwd = process.cwd() } = input;
  const pid = projectId(cwd);

  let additionalContext = null;

  try {
    const session = loadSession(session_id);
    if (!session) { exit('PreToolUse'); return; }

    // Track this action
    const hint = getTaskHint(tool_name, tool_input);
    if (hint) {
      session.actions.push({ tool: tool_name, hint });
      if (!session.task) session.task = hint;
    }

    // Track file changes (intent, before actual write)
    trackFiles(session, tool_name, tool_input);

    // Inject memory once per session on the first real tool use
    if (!session.injectedMemory && WORK_TOOLS.has(tool_name)) {
      session.injectedMemory = true;

      const query = [session.task, hint, cwd.split('/').pop()].filter(Boolean).join(' ');
      const db = getDb();
      const result = retrieveRelevant(db, query, pid, 3);
      const ctx = formatMemoryContext(result);
      if (ctx) {
        additionalContext = ctx;

        // Track this injection for stats
        const episodeIds = result.episodes.map(e => e.id);
        const ruleIds    = result.rules.map(r => r.id);
        const errorsHit  = result.episodes.filter(e => e.error).length;
        const fixesHit   = result.episodes.filter(e => e.solution && e.outcome === 'success').length;

        // Increment hit_count on retrieved episodes
        for (const id of episodeIds) {
          db.prepare('UPDATE episodes SET hit_count = hit_count + 1 WHERE id = ?').run(id);
        }

        // Save injected IDs in session for negative feedback at Stop
        session.injectedEpisodeIds = episodeIds;

        // Record injection event
        db.prepare(`
          INSERT INTO injections (session_id, project_id, episodes_hit, rules_hit, errors_in_eps, solutions_in_eps)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(session_id, pid, JSON.stringify(episodeIds), JSON.stringify(ruleIds), errorsHit, fixesHit);
      }
    }

    saveSession(session);
  } catch (e) {
    logError(e);
  }

  const response = {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      ...(additionalContext ? { additionalContext } : {})
    }
  };

  process.stdout.write(JSON.stringify(response) + '\n');
}

function exit(eventName) {
  process.stdout.write(JSON.stringify({
    continue: true, suppressOutput: true,
    hookSpecificOutput: { hookEventName: eventName || 'PreToolUse' }
  }) + '\n');
}

main().catch(e => { try { logError(e); } catch (_) {} exit('PreToolUse'); });
