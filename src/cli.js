'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const args = process.argv.slice(2);
const command = args[0];
const flags = new Set(args.filter(a => a.startsWith('--')));

function projectId(cwd) {
  return crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 12);
}

function timeAgo(unixSeconds) {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 3600)    return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)   return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800)  return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

function stars(importance) {
  const n = Math.round(importance * 5);
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
}

function hr(char = '─', len = 50) {
  return char.repeat(len);
}

function requireDb() {
  try {
    return require('./db.js').getDb();
  } catch (e) {
    if (e.message && e.message.includes('node:sqlite')) {
      console.error('Error: node:sqlite requires Node.js >= 22.5.0');
    } else {
      console.error('Database error:', e.message);
    }
    process.exit(1);
  }
}

const commands = {

  // ─── INIT ────────────────────────────────────────────────────────────────
  init() {
    const silent = flags.has('--silent');
    const { install, isInstalled, SETTINGS_PATH } = require('./installer.js');
    const { getDb, DATA_DIR } = require('./db.js');

    if (!silent) {
      console.log('\nclaude-reforge init');
      console.log(hr('═', 40));
    }

    // 1. Initialize database
    try {
      getDb();
      if (!silent) console.log(`✓ Database ready  →  ${DATA_DIR}/memory.db`);
    } catch (e) {
      if (!silent) console.error(`✗ Database error: ${e.message}`);
      if (!silent) console.error('  Make sure better-sqlite3 is installed: npm install');
      process.exit(1);
    }

    // 2. Install hooks into ~/.claude/settings.json
    if (isInstalled()) {
      if (!silent) console.log('✓ Hooks already installed  →  settings.json');
    } else {
      try {
        const n = install();
        if (!silent) console.log(`✓ Installed ${n} hooks  →  ${SETTINGS_PATH}`);
      } catch (e) {
        if (!silent) console.error(`✗ Hook install failed: ${e.message}`);
        process.exit(1);
      }
    }

    if (!silent) {
      console.log('\nDone. Restart Claude Code to activate memory.\n');
      console.log('Commands:');
      console.log('  claude-reforge show            view saved memories');
      console.log('  claude-reforge explain <task>  preview memory injection');
      console.log('  claude-reforge stats           storage statistics');
      console.log('  claude-reforge forget <id>     delete an episode');
      console.log('  claude-reforge uninstall       remove hooks');
      console.log();
    }
  },

  // ─── UNINSTALL ────────────────────────────────────────────────────────────
  uninstall() {
    const { uninstall } = require('./installer.js');
    const { DATA_DIR } = require('./db.js');
    const n = uninstall();
    if (n > 0) {
      console.log(`Removed ${n} hook(s) from settings.json.`);
      console.log(`Memory data kept at: ${DATA_DIR}`);
      console.log('To also delete memories: claude-reforge forget --all');
    } else {
      console.log('No claude-reforge hooks found in settings.json.');
    }
  },

  // ─── SHOW ─────────────────────────────────────────────────────────────────
  show() {
    const db = requireDb();
    const pid = projectId(process.cwd());
    const scope = flags.has('--all') ? null : pid;

    const { listEpisodes } = require('./memory/episodic.js');
    const { listRules }    = require('./memory/rules.js');
    const { listFacts }    = require('./memory/semantic.js');

    const episodes = listEpisodes(db, scope, 20);
    const rules    = listRules(db, 10);
    const facts    = listFacts(db, scope);
    const total    = db.prepare('SELECT COUNT(*) as n FROM episodes').get().n;

    console.log(`\nclaude-reforge  —  ${total} total episode(s)\n`);

    if (facts.length > 0) {
      console.log('Project Context');
      console.log(hr('─', 45));
      for (const f of facts.slice(0, 8)) {
        console.log(`  ${f.fact_key}: ${f.fact_value}`);
      }
      console.log();
    }

    if (rules.length > 0) {
      console.log('Learned Rules');
      console.log(hr('─', 45));
      for (const r of rules) {
        console.log(`  [×${r.hit_count}] ${r.condition}`);
        console.log(`         → ${r.action}`);
      }
      console.log();
    }

    if (episodes.length === 0) {
      console.log(scope
        ? 'No episodes for this project yet.'
        : 'No episodes saved yet.'
      );
      console.log('Episodes are saved automatically when you fix errors or complete complex tasks.\n');
      return;
    }

    const label = scope ? '(this project)' : '(all projects)';
    console.log(`Recent Episodes ${label}`);
    console.log(hr('─', 45));

    for (const ep of episodes) {
      const icon = ep.outcome === 'success' ? '✓' : '✗';
      console.log(`\n  #${ep.id}  ${icon}  ${timeAgo(ep.created_at)}  ${stars(ep.importance)}`);
      console.log(`  Task     : ${ep.task.slice(0, 100)}`);
      if (ep.error)    console.log(`  Error    : ${ep.error.slice(0, 100)}`);
      if (ep.solution) console.log(`  Solution : ${ep.solution.slice(0, 100)}`);
    }
    console.log();
  },

  // ─── FORGET ───────────────────────────────────────────────────────────────
  forget() {
    const db = requireDb();

    if (flags.has('--all')) {
      const { clearAll } = require('./memory/episodic.js');
      if (flags.has('--yes') || flags.has('-y')) {
        clearAll(db);
        console.log('All memories deleted.');
        return;
      }
      if (!process.stdin.isTTY) {
        console.error('Error: --all requires confirmation. Use --yes in non-interactive mode.');
        process.exit(1);
      }
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('Delete ALL memories? This cannot be undone. Type "yes" to confirm: ', answer => {
        rl.close();
        if (answer.trim().toLowerCase() === 'yes') {
          clearAll(db);
          console.log('All memories deleted.');
        } else {
          console.log('Cancelled.');
        }
      });
      return;
    }

    const id = parseInt(args[1], 10);
    if (!id || isNaN(id) || id <= 0) {
      console.error('Usage: claude-reforge forget <id>  |  claude-reforge forget --all');
      process.exit(1);
    }

    const { deleteEpisode } = require('./memory/episodic.js');
    if (deleteEpisode(db, id)) {
      console.log(`Episode #${id} deleted.`);
    } else {
      console.error(`Episode #${id} not found.`);
      process.exit(1);
    }
  },

  // ─── EXPLAIN ──────────────────────────────────────────────────────────────
  explain() {
    const db = requireDb();
    const pid = projectId(process.cwd());
    const { DATA_DIR } = require('./db.js');
    const { retrieveRelevant, formatMemoryContext } = require('./retrieval.js');
    const { listFacts } = require('./memory/semantic.js');
    const { listRules } = require('./memory/rules.js');

    const epCount   = db.prepare('SELECT COUNT(*) as n FROM episodes').get().n;
    const ruleCount = db.prepare('SELECT COUNT(*) as n FROM rules').get().n;

    console.log(`\nclaude-reforge explain`);
    console.log(hr('─', 45));
    console.log(`Directory : ${process.cwd()}`);
    console.log(`Episodes  : ${epCount}  |  Rules: ${ruleCount}`);
    console.log(`Database  : ${DATA_DIR}/memory.db\n`);

    // --- Phase 1: What gets injected at SessionStart
    const facts = listFacts(db, pid);
    const rules = listRules(db, 4);

    if (facts.length > 0 || rules.length > 0) {
      console.log('SessionStart injection:');
      console.log(hr('·', 45));
      if (facts.length > 0) {
        console.log('[project knowledge]');
        for (const f of facts.slice(0, 4)) console.log(`  ${f.fact_key}: ${f.fact_value}`);
      }
      if (rules.length > 0) {
        console.log('[learned rules]');
        for (const r of rules.slice(0, 3)) {
          console.log(`  • ${r.condition}`);
          console.log(`    → ${r.action}`);
        }
      }
      console.log();
    } else {
      console.log('SessionStart: nothing to inject yet (no project facts or rules)\n');
    }

    // --- Phase 2: What gets injected on first tool use
    const taskQuery = args.slice(1).filter(a => !a.startsWith('--')).join(' ') || 'fix error edit code debug';
    const result = retrieveRelevant(db, taskQuery, pid, 3);
    const ctx = formatMemoryContext(result);

    console.log(`PreToolUse injection for: "${taskQuery}"`);
    console.log(hr('·', 45));
    if (ctx) {
      console.log(ctx);
    } else {
      console.log('No relevant memories yet.');
      console.log('Memory builds up automatically as you work with Claude Code.');
    }
    console.log();
  },

  // ─── STATS ────────────────────────────────────────────────────────────────
  stats() {
    const db = requireDb();
    const pid = projectId(process.cwd());
    const { DATA_DIR, DB_PATH } = require('./db.js');

    const now     = Math.floor(Date.now() / 1000);
    const week    = now - 7  * 86400;
    const month   = now - 30 * 86400;

    // ── Core counts ──────────────────────────────────────────────────────────
    const totalEp   = db.prepare('SELECT COUNT(*) as n FROM episodes').get().n;
    const totalSucc = db.prepare("SELECT COUNT(*) as n FROM episodes WHERE outcome='success'").get().n;
    const totalFail = db.prepare("SELECT COUNT(*) as n FROM episodes WHERE outcome='failure'").get().n;
    const ruleCount = db.prepare('SELECT COUNT(*) as n FROM rules').get().n;

    // ── Impact stats (from injections table) ─────────────────────────────────
    const totalInj    = db.prepare('SELECT COUNT(*) as n FROM injections').get().n;
    const errAvoided  = db.prepare('SELECT COALESCE(SUM(errors_in_eps),0) as n FROM injections').get().n;
    const fixesReused = db.prepare('SELECT COALESCE(SUM(solutions_in_eps),0) as n FROM injections').get().n;

    // Week window
    const injWeek    = db.prepare('SELECT COUNT(*) as n FROM injections WHERE created_at > ?').get(week).n;
    const errWeek    = db.prepare('SELECT COALESCE(SUM(errors_in_eps),0) as n FROM injections WHERE created_at > ?').get(week).n;
    const fixWeek    = db.prepare('SELECT COALESCE(SUM(solutions_in_eps),0) as n FROM injections WHERE created_at > ?').get(week).n;
    const epWeek     = db.prepare('SELECT COUNT(*) as n FROM episodes WHERE created_at > ?').get(week).n;
    const epMonth    = db.prepare('SELECT COUNT(*) as n FROM episodes WHERE created_at > ?').get(month).n;

    // ── Learning rate (episodes/week over last 4 weeks) ───────────────────────
    const learningRate = (epMonth / 4).toFixed(1);

    // ── Most reused fix ───────────────────────────────────────────────────────
    const topEp = db.prepare(
      "SELECT task, solution, hit_count FROM episodes WHERE solution IS NOT NULL ORDER BY hit_count DESC LIMIT 1"
    ).get();

    // ── Most triggered rule ───────────────────────────────────────────────────
    const topRule = db.prepare(
      'SELECT condition, action, hit_count FROM rules ORDER BY hit_count DESC LIMIT 1'
    ).get();

    // ── Success rate ─────────────────────────────────────────────────────────
    const successRate = totalEp > 0 ? `${Math.round(totalSucc * 100 / totalEp)}%` : '—';

    const dbKB = fs.existsSync(DB_PATH) ? Math.round(fs.statSync(DB_PATH).size / 1024) : 0;

    // ── Render ────────────────────────────────────────────────────────────────
    console.log('\nclaude-reforge stats\n');

    console.log('Impact');
    console.log(hr('─', 45));
    console.log(`  Errors avoided     ${String(errAvoided).padStart(6)}   (${errWeek} this week)`);
    console.log(`  Fixes reused       ${String(fixesReused).padStart(6)}   (${fixWeek} this week)`);
    console.log(`  Sessions with memory ${String(totalInj).padStart(4)}   (${injWeek} this week)`);
    console.log();

    console.log('Learning');
    console.log(hr('─', 45));
    console.log(`  Episodes saved     ${String(totalEp).padStart(6)}   (${epWeek} this week)`);
    console.log(`  Success rate       ${String(successRate).padStart(6)}`);
    console.log(`  Rules extracted    ${String(ruleCount).padStart(6)}`);
    console.log(`  Learning rate      ${String(learningRate + ' ep/wk').padStart(9)}`);
    console.log();

    if (topEp && topEp.hit_count > 0) {
      console.log('Most Reused Fix');
      console.log(hr('─', 45));
      console.log(`  [×${topEp.hit_count}] ${topEp.task.slice(0, 60)}`);
      if (topEp.solution) console.log(`       ${topEp.solution.slice(0, 60)}`);
      console.log();
    }

    if (topRule && topRule.hit_count > 1) {
      console.log('Most Triggered Rule');
      console.log(hr('─', 45));
      console.log(`  [×${topRule.hit_count}] ${topRule.condition.slice(0, 55)}`);
      console.log(`         → ${topRule.action.slice(0, 55)}`);
      console.log();
    }

    console.log(hr('─', 45));
    console.log(`  Database  ${DATA_DIR}  (${dbKB} KB)`);
    console.log();
  }
};

// ─── HELP ─────────────────────────────────────────────────────────────────────
function showHelp() {
  console.log(`
claude-reforge — persistent memory and learning for Claude Code

USAGE
  claude-reforge <command> [options]

COMMANDS
  init                Install hooks and initialize the database
  show                Show saved episodes and rules  (--all for all projects)
  explain [task]      Preview what memory would be injected for a given task
  forget <id>         Delete episode by ID
  forget --all        Delete all memories (with confirmation)
  stats               Show memory statistics
  uninstall           Remove hooks from Claude Code settings

INSTALL
  npm install -g @ccplug/claude-reforge
  claude-reforge init

HOW IT WORKS
  claude-reforge runs silently via Claude Code hooks:
  • SessionStart  → injects project rules & facts
  • PreToolUse   → injects relevant past experiences (once per session)
  • PostToolUse  → captures errors, file changes, commands
  • Stop         → saves episodes, extracts rules

  Nothing is stored unless it's genuinely useful for future sessions.
  All data is local at ~/.claude-reforge/
`);
}

if (!command || command === '--help' || command === '-h' || command === 'help') {
  showHelp();
  process.exit(0);
}

const handler = commands[command];
if (!handler) {
  console.error(`Unknown command: ${command}`);
  console.error('Run claude-reforge --help for usage');
  process.exit(1);
}

handler();
