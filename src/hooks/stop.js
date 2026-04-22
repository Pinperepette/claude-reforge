#!/usr/bin/env node
'use strict';

// Hook: Stop
// Fires when Claude finishes responding.
// Analyzes the session, saves meaningful episodes, extracts rules.

const fs = require('fs');
const { getDb, logError, loadSession, deleteSession } = require('../db.js');
const { scoreEpisode, shouldSaveEpisode } = require('../importance.js');
const { saveEpisode } = require('../memory/episodic.js');
const { extractRules } = require('../memory/rules.js');
const { saveFact } = require('../memory/semantic.js');

// Read the first user message from the transcript (JSONL format)
function readFirstUserMessage(transcriptPath) {
  if (!transcriptPath) return '';
  try {
    if (!fs.existsSync(transcriptPath)) return '';
    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines.slice(0, 30)) {
      try {
        const msg = JSON.parse(line);
        const role = msg.role || (msg.message && msg.message.role);
        if (role !== 'user' && role !== 'human') continue;
        const content = msg.content || (msg.message && msg.message.content);
        if (typeof content === 'string' && content.trim()) return content.trim().slice(0, 250);
        if (Array.isArray(content)) {
          const part = content.find(p => p && p.type === 'text' && p.text);
          if (part) return part.text.trim().slice(0, 250);
        }
      } catch (_) {}
    }
  } catch (_) {}
  return '';
}

function deriveTask(session, transcriptTask) {
  if (transcriptTask && transcriptTask.length > 5) return transcriptTask;
  if (session.task && session.task.length > 3) return session.task;
  if (session.fileChanges.length > 0) {
    const names = session.fileChanges.map(f => f.split('/').pop()).join(', ');
    return `Edited: ${names.slice(0, 200)}`;
  }
  if (session.commands.length > 0) {
    return `Ran: ${session.commands[0].slice(0, 100)}`;
  }
  return 'Unknown task';
}

function deriveOutcome(session) {
  if (session.errors.length === 0) return 'success';
  if (session.errorsResolved) return 'success';

  // If file changes happened after the last error-producing command,
  // assume the error was fixed
  const errorIdx = session.commands.findIndex(c =>
    session.lastErrorTool === 'Bash' && session.errors.length > 0
  );
  if (session.fileChanges.length > 0 && errorIdx >= 0) return 'success';

  return 'failure';
}

function deriveSolution(session, outcome) {
  if (session.errors.length === 0 || outcome === 'failure') return null;

  // Solution = what files were changed to fix the problem
  if (session.fileChanges.length > 0) {
    const names = session.fileChanges.slice(-3).map(f => f.split('/').pop()).join(', ');
    return `Modified ${names}`;
  }
  // Or the last bash command that ran successfully
  const lastCmd = session.commands[session.commands.length - 1];
  if (lastCmd && lastCmd.length > 5) return `Ran: ${lastCmd.slice(0, 100)}`;
  return null;
}

function detectProjectStack(session) {
  const extMap = {};
  for (const f of session.fileChanges) {
    const ext = f.split('.').pop()?.toLowerCase();
    if (ext && ext.length <= 6) extMap[ext] = (extMap[ext] || 0) + 1;
  }
  return Object.entries(extMap)
    .sort((a, b) => b[1] - a[1])
    .map(([ext]) => ext)
    .slice(0, 5);
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

  const { session_id, transcript_path, last_assistant_message } = input;

  try {
    const session = loadSession(session_id);
    if (!session) { exit(); return; }

    const outcome = deriveOutcome(session);
    session.outcome = outcome;

    // Check if we should save based on what happened
    if (shouldSaveEpisode(session)) {
      const transcriptTask = readFirstUserMessage(transcript_path);
      const task     = deriveTask(session, transcriptTask);
      const error    = session.errors.length > 0 ? session.errors[0] : null;
      const solution = deriveSolution(session, outcome);
      const importance = scoreEpisode({ ...session, solution, outcome });

      const db = getDb();

      saveEpisode(db, {
        task,
        context:    session.projectPath,
        actions:    session.actions.map(a => a.hint || a.tool).filter(Boolean).slice(0, 20),
        error,
        solution,
        outcome,
        importance,
        projectId:  session.projectId
      });

      // Update project facts: file types used
      const stack = detectProjectStack(session);
      if (stack.length > 0) {
        saveFact(db, 'primary_file_types', stack.join(', '), session.projectId);
      }

      // Run rule extraction after saving (throttled by internal checks)
      const epCount = db.prepare(
        'SELECT COUNT(*) as n FROM episodes WHERE project_id = ?'
      ).get(session.projectId)?.n || 0;

      if (epCount >= 2) extractRules(db);
    }
  } catch (e) {
    logError(e);
  }

  // Always clean up the session file
  try { deleteSession(session_id); } catch (_) {}

  exit();
}

function exit() {
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
}

main().catch(e => {
  try { logError(e); } catch (_) {}
  try { deleteSession(process.env.SESSION_ID); } catch (_) {}
  exit();
});
