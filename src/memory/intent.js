'use strict';

// Maps tool calls to semantic intent categories (action:target)
// Intent abstraction lets prevention match on MEANING, not raw strings.

const BASH_INTENTS = [
  [/git\s+push\s+.*--force|git\s+push\s+-f\b/i,    'git:force_push'],
  [/git\s+reset\s+--hard/i,                          'git:reset_hard'],
  [/git\s+rebase/i,                                  'git:rebase'],
  [/git\s+merge/i,                                   'git:merge'],
  [/npm\s+install|yarn\s+add|pnpm\s+add/i,           'dep:install'],
  [/npm\s+uninstall|yarn\s+remove|pnpm\s+remove/i,   'dep:remove'],
  [/npm\s+run\s+build|tsc\b|webpack|vite\s+build/i,  'build:run'],
  [/npm\s+test|pytest|jest\b|mocha\b|vitest/i,       'test:run'],
  [/rm\s+-rf|rimraf|unlink|rmdir/i,                  'fs:delete'],
  [/docker\s+build|docker\s+run|docker-compose/i,    'docker:op'],
  [/migrate|knex|sequelize|prisma\s+migrate/i,       'db:migrate'],
  [/curl\s|wget\s|fetch\s/i,                         'net:request'],
  [/chmod|chown/i,                                   'fs:permissions'],
];

const FILE_INTENTS = [
  [/package\.json$/i,                                'dep:config'],
  [/webpack|vite\.config|rollup|tsconfig/i,          'build:config'],
  [/\.(sql|graphql)$|schema\.(js|ts)$/i,             'schema:edit'],
  [/\.env($|\.)/i,                                   'env:edit'],
  [/\.(test|spec)\.(js|ts|jsx|tsx|py)$/i,            'test:file'],
  [/(api|route|handler|controller|endpoint)\./i,     'api:file'],
  [/(model|entity|schema|migration)\./i,             'model:file'],
  [/(component|view|page|widget)\./i,                'ui:component'],
  [/(util|helper|lib|shared)\./i,                    'util:file'],
  [/(config|setting|options)\./i,                    'config:file'],
];

const SIGNATURE_RE = /\bfunction\s+\w+\s*\(|^\s*(export\s+)?(async\s+)?function|\bdef\s+\w+\s*\(|\w+\s*=\s*\(.*\)\s*=>/m;

function extractBashIntent(command) {
  if (!command) return 'bash:generic';
  const cmd = command.trim();
  for (const [re, intent] of BASH_INTENTS) {
    if (re.test(cmd)) return intent;
  }
  return 'bash:generic';
}

function extractFileIntent(filePath, oldString) {
  if (!filePath) return 'file:edit';
  for (const [re, intent] of FILE_INTENTS) {
    if (re.test(filePath)) return intent;
  }
  if (oldString && SIGNATURE_RE.test(oldString)) return 'code:signature_change';
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext && ext.length <= 6 ? `code:${ext}` : 'file:edit';
}

function extractIntent(toolName, toolInput) {
  if (!toolInput) return null;
  if (toolName === 'Bash') return extractBashIntent(toolInput.command || '');
  if (toolName === 'Edit' || toolName === 'Write') {
    return extractFileIntent(toolInput.file_path, toolInput.old_string);
  }
  if (toolName === 'MultiEdit') {
    const files = (toolInput.edits || []).map(e => e.file_path).filter(Boolean);
    return files.length > 0 ? extractFileIntent(files[0], null) : 'file:edit';
  }
  return null;
}

module.exports = { extractIntent };
