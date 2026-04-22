'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_DIR = path.join(__dirname, 'hooks');

// Hook event → script filename
const HOOK_MAP = {
  SessionStart: 'session-start.js',
  PreToolUse:   'pre-tool.js',
  PostToolUse:  'post-tool.js',
  Stop:         'stop.js'
};

// Matchers: PreToolUse/PostToolUse need .* to run on all tools
const HOOK_MATCHER = {
  SessionStart: '',
  PreToolUse:   '.*',
  PostToolUse:  '.*',
  Stop:         ''
};

function readSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (e) {
    const bak = `${SETTINGS_PATH}.bak.${Date.now()}`;
    fs.copyFileSync(SETTINGS_PATH, bak);
    console.warn(`[claude-reforge] Malformed settings.json backed up to ${bak}`);
    return {};
  }
}

function writeSettings(settings) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// Matches any command that points to one of our hook files
const HOOK_FILE_PATTERN = new RegExp(
  Object.values(HOOK_MAP).map(f => f.replace('.', '\\.')).join('|')
);

function isMemoryCommand(cmd) {
  if (typeof cmd !== 'string') return false;
  // Match by package name OR by hook filenames
  return cmd.includes('claude-reforge') || HOOK_FILE_PATTERN.test(cmd);
}

function install() {
  const settings = readSettings();
  if (!settings.hooks) settings.hooks = {};

  let added = 0;
  for (const [event, file] of Object.entries(HOOK_MAP)) {
    const hookPath = path.join(HOOK_DIR, file);
    const command = `node "${hookPath}"`;

    if (!settings.hooks[event]) settings.hooks[event] = [];

    const exists = settings.hooks[event].some(m =>
      m.hooks && m.hooks.some(h => isMemoryCommand(h.command))
    );

    if (!exists) {
      settings.hooks[event].push({
        matcher: HOOK_MATCHER[event],
        hooks: [{ type: 'command', command }]
      });
      added++;
    }
  }

  writeSettings(settings);
  return added;
}

function uninstall() {
  if (!fs.existsSync(SETTINGS_PATH)) return 0;
  const settings = readSettings();
  if (!settings.hooks) return 0;

  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    const before = settings.hooks[event].length;
    settings.hooks[event] = settings.hooks[event].filter(m =>
      !m.hooks || !m.hooks.some(h => isMemoryCommand(h.command))
    );
    removed += before - settings.hooks[event].length;
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  writeSettings(settings);
  return removed;
}

function isInstalled() {
  if (!fs.existsSync(SETTINGS_PATH)) return false;
  const settings = readSettings();
  if (!settings.hooks) return false;
  return Object.values(settings.hooks).some(matchers =>
    matchers.some(m => m.hooks && m.hooks.some(h => isMemoryCommand(h.command)))
  );
}

module.exports = { install, uninstall, isInstalled, SETTINGS_PATH };
