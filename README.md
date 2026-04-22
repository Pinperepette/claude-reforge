# Claude Reforge

![Claude Reforge](https://raw.githubusercontent.com/Pinperepette/claude-reforge/main/assets/banner.svg)

**Built specifically for Claude Code.**

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

| Without Claude Reforge | With Claude Reforge |
|------------------------|---------------------|
| Repeats the same debugging paths | Reuses proven fixes instantly |
| Tries fixes that already failed | Avoids known bad paths |
| No memory of what worked in your project | Knows your project's history |
| Same speed on day 1 and day 100 | Gets faster every session |

---

## Quick Start

```bash
npm install -g @ccplug/claude-reforge
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

First tool use (Edit, Write, Bash, Task...)
    └─ PreToolUse hook
         Builds a query from the current task context.
         Retrieves the most relevant past episodes using BM25 keyword search.
         Injects them as context — once per session, never repeated.

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

### Retrieval

No embeddings. No API calls. No external dependencies.

Retrieval is BM25 keyword search on episode text (task + error + solution).
Each result is weighted by importance score. Top 3 episodes + top 3 rules are injected.

The importance score factors in:
- Error resolved → high value
- Complex task (many actions, many files) → medium value
- Repeated failure → medium value

### Storage

Everything lives at `~/.claude-reforge/`:

```
~/.claude-reforge/
├── memory.db          SQLite database (episodes, rules, facts)
└── sessions/          Temporary session state (deleted after Stop hook)
    └── {session_id}.json
```

Database tables:

```sql
episodes       task, error, solution, outcome, importance, hit_count
semantic_facts project-scoped key/value facts
rules          condition → action, confidence, hit_count
injections     audit log of every memory injection (for stats)
```

---

## Installation

### Requirements

- Node.js ≥ 18
- Claude Code CLI
- macOS / Linux (Windows: untested)

> `better-sqlite3` requires native compilation. On macOS this works out of the box.
> On Linux, install build tools first: `apt-get install python3 make g++`

### From npm (recommended)

```bash
npm install -g @ccplug/claude-reforge
claude-reforge init
```

### From GitHub

```bash
npm install -g github:ccplug/claude-reforge
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
