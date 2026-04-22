# Claude Reforge

<p align="center">
  <img src="./assets/banner.png" alt="Claude Reforge" width="100%" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@ccplug/claude-reforge"><img src="https://img.shields.io/npm/v/@ccplug/claude-reforge?color=7c3aed&style=flat-square&label=npm" alt="npm" /></a>
  <img src="https://img.shields.io/badge/license-MIT-2563eb?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-green?style=flat-square" alt="node" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="platform" />
  <img src="https://img.shields.io/badge/storage-local%20SQLite-orange?style=flat-square" alt="storage" />
</p>

<p align="center"><strong>Built specifically for Claude Code.</strong></p>

---

Claude Code is stateless.
Claude Reforge isn't.

---

Every session, Claude starts from zero.

It doesn't know that you spent 3 hours on that timeout bug last week.
It doesn't know that `webpack.config.js` needs the alias or the build breaks.
It doesn't know that in *your* project, the obvious solution is wrong.

So it makes the same mistakes. Again. And again.

Until now.

**Claude Reforge breaks that loop.**

---

This is not a prompt.
Not a config file.
Not documentation.

It's experience.

---

## Without vs With

| | Without Claude Reforge | With Claude Reforge |
|--|------------------------|---------------------|
| **Debugging** | Repeats the same paths | Reuses proven fixes instantly |
| **Known failures** | Tries fixes that already failed | Avoids known bad paths |
| **Project knowledge** | Resets every session | Knows your project's history |
| **Speed** | Same on day 1 and day 100 | Gets faster every session |

---

## Quick Start

```bash
npm install -g github:Pinperepette/claude-reforge
claude-reforge init
```

Restart Claude Code. That's it.

---

## The moment it clicks

You're debugging something. Before Claude starts, it already knows:

```
[claude-reforge: 2 relevant past experiences]

3 weeks ago — same error, this project:
  Error: error TS2345 — type 'string' not assignable to 'number'
  What worked: Number() cast at the call site
  What didn't: changing the function signature (broke 4 other things)

Learned rule: In this codebase, type mismatches in API handlers
              → fix the call site, never the function signature
```

Claude doesn't rediscover this.
It already knows what worked.

---

## It compounds

Every fix becomes future context.
Every session adds to what Claude knows about your project.
Every error resolved makes the next one faster.

The more you use it, the less Claude has to guess.

---

## How it works

Claude Reforge installs four hooks into Claude Code's lifecycle.
They run silently. You never interact with them directly.

### The hook pipeline

```
Session opens
    └─ SessionStart hook
         Queries the database for rules and facts learned in this project.
         If found, injects them into Claude's context before anything else.

Every tool use (Edit, Write, Bash, Task...)
    └─ PreToolUse hook
         On first real tool use: builds a query from the task context,
         retrieves the most relevant past episodes and injects them (once per session).

         On every tool use: runs prevention check — matches the current action
         against tried_actions of past failures. If the action was tried before
         and failed (bad_hit_count ≥ 2), injects a warning before execution:

         [claude-reforge: prevention warning — failed 3 times]
           Error: Cannot read properties of undefined (reading 'map')
           What failed: edited src/api/handler.js, ran: npm run build
           What worked instead: Modified utils/safeMap.js

During the session
    └─ PostToolUse hook (runs after every tool)
         Bash output  → scans for error patterns, captures the command
         Edit / Write → records which files were changed
         Errors are tracked with timestamps so order matters.

Session ends
    └─ Stop hook
         Reads the first user message from the transcript for the task name.
         Determines outcome: did errors get resolved? Were files changed after them?
         If the session is worth saving, writes an episode to the database.
         Runs rule extraction: if 2+ episodes share the same error signature,
         a rule is generated automatically.
```

### Memory types

| Type | What it stores | When it's used |
|------|---------------|----------------|
| **Episodic** | `task → error → solution → outcome` | Injected when task context matches |
| **Semantic** | Stable project facts (file types, stack) | Injected at session start |
| **Rules** | Patterns extracted from repeated errors | Injected at session start + on match |
| **Prevention** | Failed `tried_actions` with repeat bad outcomes | Injected before each tool call if match found |

### Retrieval

No embeddings. No API calls. No external dependencies.

Retrieval uses a **composite score**: BM25 keyword match × time decay × importance × outcome weight × reuse bonus × project affinity × folder affinity. Top 3 episodes + top 3 rules are injected.

Score factors:
- **BM25** — keyword relevance between query and episode text
- **Time decay** — `< 1w → 1.0` / `< 1mo → 0.85` / `< 3mo → 0.65` / `< 6mo → 0.45` / older → `0.25`
- **Outcome** — resolved errors score `1.2×`, known failures `0.75×` (still injected as negative examples)
- **Feedback loop** — every time a memory is shown and the session succeeds, `hit_count` increases and the episode scores higher on reuse; if the session fails after injection, `bad_hit_count` increases and the episode is penalized up to `0.3×` — the system learns what actually helps
- **Project affinity** — same-project episodes score `1.3×`, cross-project `0.85×`
- **Language affinity** — cross-language episodes score `0.3×` (e.g. a Python episode in a TypeScript project)
- **Folder affinity** — episodes from the same directory tree score `1.1×`, cross-folder `0.7×`
- **Confidence** — rules are scored as `success_rate × occurrence_count`; below `0.5` they are never injected; shown as `high confidence` (≥ 0.8) / `medium confidence` (≥ 0.6) / `emerging pattern` (< 0.6)

### Storage

Everything lives at `~/.claude-reforge/`:

```
~/.claude-reforge/
├── memory.db          SQLite database (Node.js built-in, no compilation)
└── sessions/          Temporary session state (deleted after Stop hook)
    └── {session_id}.json
```

Database tables:

```sql
episodes       task, error, tried_actions, solution, outcome, importance, hit_count, file_types, folders
semantic_facts project-scoped key/value facts (primary_file_types, primary_folders, ...)
rules          condition → action, confidence, hit_count
injections     audit log of every memory injection (for stats)
```

---

## Installation

### Requirements

- Node.js ≥ 22.5
- Claude Code CLI
- macOS / Linux / Windows

No native compilation. No build tools. No dependencies.
Uses the SQLite engine built into Node.js itself.

### From GitHub

```bash
npm install -g github:Pinperepette/claude-reforge
claude-reforge init
```

### From npm

```bash
npm install -g @ccplug/claude-reforge
claude-reforge init
```

### What `init` does

1. Creates `~/.claude-reforge/` and initializes the SQLite database
2. Adds 4 hooks to `~/.claude/settings.json`:

```json
"hooks": {
  "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"/path/to/session-start.js\"" }] }],
  "PreToolUse":   [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node \"/path/to/pre-tool.js\"" }] }],
  "PostToolUse":  [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node \"/path/to/post-tool.js\"" }] }],
  "Stop":         [{ "hooks": [{ "type": "command", "command": "node \"/path/to/stop.js\"" }] }]
}
```

Existing hooks are preserved. Running `init` twice is safe.

---

## CLI Reference

### `claude-reforge show`

Shows what has been learned: episodes, rules, project facts.

```bash
claude-reforge show          # this project only
claude-reforge show --all    # all projects
```

```
claude-reforge  —  12 total episode(s)

Learned Rules
─────────────────────────────────────────────
  [×5] Error: error TS2345 string not assignable to number
         → Solution: Number() cast at call site

Recent Episodes (this project)
─────────────────────────────────────────────

  #7  ✓  3w ago  ★★★★☆
  Task     : Fix TypeScript error in auth handler
  Error    : error TS2345: Argument of type string...
  Solution : Number() cast at call site
```

### `claude-reforge stats`

Impact metrics: errors avoided, fixes reused, learning rate.

```
claude-reforge stats

Impact
─────────────────────────────────────────────
  Errors avoided        18   (3 this week)
  Fixes reused          11   (2 this week)
  Sessions with memory  24   (4 this week)

Learning
─────────────────────────────────────────────
  Episodes saved        31   (4 this week)
  Success rate          87%
  Rules extracted        5
  Learning rate      2.8 ep/wk

Most Reused Fix
─────────────────────────────────────────────
  [×7] Fix TS2345 type mismatch in auth handler
       Number() cast at call site
```

### `claude-reforge explain [task]`

Preview exactly what would be injected into Claude's context right now.

```bash
claude-reforge explain
claude-reforge explain "fix webpack module not found"
```

### `claude-reforge forget`

```bash
claude-reforge forget 12      # delete episode #12
claude-reforge forget --all   # clear everything (asks for confirmation)
```

### `claude-reforge uninstall`

Removes all hooks from `~/.claude/settings.json`.
Memory data at `~/.claude-reforge/` is kept unless you also run `forget --all`.

---

## Privacy

- All data is stored locally at `~/.claude-reforge/memory.db`
- No conversations are saved — only tool calls, errors, and outcomes
- No network requests, no cloud, no telemetry
- Delete everything: `claude-reforge forget --all`

---

## License

MIT
