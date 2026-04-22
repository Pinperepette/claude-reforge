#!/usr/bin/env node
'use strict';

// Hook: PostToolUse
// Fires after every tool call completes.
// Captures errors from Bash output, confirms file changes, tracks tried actions.

const { logError, loadSession, saveSession } = require('../db.js');

const ERROR_RE = [
  /\b(?:Error|error|ERROR)[:\s][^\n]{10,200}/g,
  /\b(?:Exception|EXCEPTION)[:\s][^\n]{10,200}/g,
  /\b(?:failed|FAILED)[:\s][^\n]{5,200}/g,
  /Traceback \(most recent call last\)[\s\S]{0,200}/g,
  /TypeError:[^\n]{5,180}/g,
  /SyntaxError:[^\n]{5,180}/g,
  /ReferenceError:[^\n]{5,180}/g,
  /ModuleNotFoundError:[^\n]{5,180}/g,
  /ImportError:[^\n]{5,180}/g,
  /cannot find module[^\n]{5,180}/gi,
  /ENOENT:[^\n]{5,180}/g,
  /ECONNREFUSED:[^\n]{5,180}/g,
  /ETIMEDOUT:[^\n]{5,180}/g,
  /EACCES:[^\n]{5,180}/g,
  /npm ERR![^\n]{5,180}/g,
  /error TS\d+:[^\n]{5,180}/g,
  /compilation failed/gi,
  /build failed/gi,
  /assert(?:ion)? failed[^\n]{0,150}/gi,
  /panic:[^\n]{5,180}/g,
  /thread '.*' panicked[^\n]{0,150}/g,
];

const SUCCESS_RE = /(?:success|✓|done|passed|completed|ok|green|0 errors|all tests)/i;

function extractErrors(text) {
  if (!text || typeof text !== 'string') return [];
  const found = [];
  for (const re of ERROR_RE) {
    re.lastIndex = 0;
    const matches = text.match(re) || [];
    found.push(...matches.map(m => m.trim().slice(0, 200)));
  }
  return [...new Set(found)].slice(0, 8);
}

function responseToText(toolResponse) {
  if (!toolResponse) return '';
  if (typeof toolResponse === 'string') return toolResponse.slice(0, 8000);
  if (Array.isArray(toolResponse)) {
    return toolResponse
      .filter(r => r && r.type === 'text')
      .map(r => r.text || '')
      .join('\n')
      .slice(0, 8000);
  }
  try { return JSON.stringify(toolResponse).slice(0, 4000); } catch (_) { return ''; }
}

// Describe what was attempted — used for negative memory (what didn't work)
function getTriedHint(toolName, toolInput) {
  if (!toolInput) return null;
  if (toolName === 'Edit' || toolName === 'Write') {
    const fname = (toolInput.file_path || '').split('/').pop();
    return fname ? `edited ${fname}` : null;
  }
  if (toolName === 'MultiEdit') {
    const files = (toolInput.edits || []).map(e => (e.file_path || '').split('/').pop()).filter(Boolean);
    return files.length > 0 ? `edited ${files.join(', ')}` : null;
  }
  if (toolName === 'Bash' && toolInput.command) {
    return toolInput.command.slice(0, 60);
  }
  return null;
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

  const { session_id, tool_name, tool_input, tool_response } = input;

  try {
    const session = loadSession(session_id);
    if (!session) { exit(); return; }

    const text = responseToText(tool_response);

    if (tool_name === 'Bash' && tool_input) {
      const cmd = (tool_input.command || '').slice(0, 200);
      if (cmd && !session.commands.includes(cmd)) {
        session.commands.push(cmd);
      }

      const errors = extractErrors(text);
      if (errors.length > 0) {
        session.errors.push(...errors);
        session.errors = [...new Set(session.errors)].slice(0, 10);
        session.lastErrorTool = tool_name;
      } else if (text && SUCCESS_RE.test(text) && session.errors.length > 0) {
        session.errorsResolved = true;
      }
    }

    // Track file changes
    if (['Edit', 'Write', 'MultiEdit'].includes(tool_name) && tool_input) {
      let files = [];
      if (tool_name === 'MultiEdit') {
        files = (tool_input.edits || []).map(e => e.file_path).filter(Boolean);
      } else if (tool_input.file_path) {
        files = [tool_input.file_path];
      }
      for (const f of files) {
        if (!session.fileChanges.includes(f)) session.fileChanges.push(f);
      }
    }

    // Record what was tried while errors were active and unresolved (negative memory)
    if (session.errors.length > 0 && !session.errorsResolved) {
      const hint = getTriedHint(tool_name, tool_input);
      if (hint) {
        if (!session.triedActions) session.triedActions = [];
        if (!session.triedActions.includes(hint)) session.triedActions.push(hint);
      }
    }

    saveSession(session);
  } catch (e) {
    logError(e);
  }

  exit();
}

function exit() {
  process.stdout.write(JSON.stringify({
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: { hookEventName: 'PostToolUse' }
  }) + '\n');
}

main().catch(e => { try { logError(e); } catch (_) {} exit(); });
