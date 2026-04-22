#!/usr/bin/env node
'use strict';

// Hook: SessionStart
// Fires when Claude Code opens a session.
// Injects project-level rules and facts into Claude's context.

const { getDb, logError, loadSession, createSession } = require('../db.js');
const { listFacts } = require('../memory/semantic.js');
const { listRules } = require('../memory/rules.js');
const crypto = require('crypto');

function projectId(cwd) {
  return crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 12);
}

async function main() {
  let input = {};
  try {
    let raw = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) raw += chunk;
    input = JSON.parse(raw);
  } catch (_) {
    exit();
    return;
  }

  const { session_id, cwd = process.cwd() } = input;
  const pid = projectId(cwd);

  // Create session state file (accumulates events for Stop hook)
  if (!loadSession(session_id)) {
    createSession(session_id, pid, cwd);
  }

  let additionalContext = null;

  try {
    const db = getDb();
    const facts = listFacts(db, pid);
    const rules = listRules(db, 5);

    const lines = [];

    if (facts.length > 0) {
      lines.push('[claude-reforge: project knowledge]');
      for (const f of facts.slice(0, 6)) {
        lines.push(`  ${f.fact_key}: ${f.fact_value}`);
      }
      lines.push('');
    }

    if (rules.length > 0) {
      lines.push('[claude-reforge: learned rules from past sessions]');
      for (const r of rules.slice(0, 4)) {
        lines.push(`  • ${r.condition}`);
        lines.push(`    → ${r.action}`);
      }
      lines.push('');
    }

    if (lines.length > 0) additionalContext = lines.join('\n').trim();
  } catch (e) {
    logError(e);
  }

  const response = {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      ...(additionalContext ? { additionalContext } : {})
    }
  };

  process.stdout.write(JSON.stringify(response) + '\n');
}

function exit() {
  process.stdout.write(JSON.stringify({
    continue: true, suppressOutput: true,
    hookSpecificOutput: { hookEventName: 'SessionStart' }
  }) + '\n');
}

main().catch(e => { try { logError(e); } catch (_) {} exit(); });
