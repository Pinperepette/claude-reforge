'use strict';

function normalizeErrorSig(error) {
  return error
    .slice(0, 80)
    .toLowerCase()
    .replace(/\d{2,}/g, 'N')
    .replace(/['"/\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tryParse(json, fallback) {
  try { return JSON.parse(json || '[]') || fallback; } catch (_) { return fallback; }
}

function extractRules(db) {
  // Look at all episodes with errors — successes AND failures
  const allEps = db.prepare(`
    SELECT id, task, error, solution, outcome, tried_actions
    FROM episodes
    WHERE error IS NOT NULL AND error != ''
    ORDER BY created_at DESC
    LIMIT 200
  `).all();

  if (allEps.length < 2) return 0;

  // Group by normalized error signature
  const groups = new Map();
  for (const ep of allEps) {
    const sig = normalizeErrorSig(ep.error);
    if (!groups.has(sig)) groups.set(sig, { successes: [], failures: [] });
    const g = groups.get(sig);
    if (ep.outcome === 'success') g.successes.push(ep);
    else g.failures.push(ep);
  }

  let added = 0;
  for (const [, { successes, failures }] of groups) {
    const total = successes.length + failures.length;
    if (total < 2) continue;

    // --- Positive rule: error that has been resolved at least once ---
    if (successes.length >= 1 && successes[0].solution) {
      const ep         = successes[0];
      const condition  = `Error: ${ep.error.slice(0, 120)}`;
      const action     = `Solution: ${ep.solution.slice(0, 150)}`;
      // Real confidence = how often it succeeded vs total occurrences
      const confidence = Math.min(0.95, successes.length / total + 0.1);
      added           += upsertRule(db, condition, action, confidence, successes.map(e => e.id));
    }

    // --- Negative rule: error that was NEVER resolved ---
    if (failures.length >= 2 && successes.length === 0) {
      const allTried = failures.flatMap(f => tryParse(f.tried_actions, []));
      if (allTried.length === 0) continue;

      // Find approaches tried in at least 2 failure episodes
      const counts = {};
      for (const t of allTried) counts[t] = (counts[t] || 0) + 1;
      const common = Object.entries(counts)
        .filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => t)
        .slice(0, 3);

      if (common.length === 0) continue;

      const condition  = `Error: ${failures[0].error.slice(0, 120)}`;
      const action     = `Avoid: ${common.join(', ')} — these approaches failed ${failures.length} time(s) without resolving this error`;
      const confidence = Math.min(0.90, 0.4 + failures.length * 0.1);
      added           += upsertRule(db, condition, action, confidence, failures.map(e => e.id));
    }
  }
  return added;
}

function upsertRule(db, condition, action, confidence, sourceIds) {
  const lookupFrag = condition.slice(0, 40).replace(/[%_[\]]/g, '');
  const existing   = db.prepare('SELECT id, hit_count FROM rules WHERE condition LIKE ? LIMIT 1')
    .get(`%${lookupFrag}%`);

  if (existing) {
    db.prepare(`
      UPDATE rules
      SET hit_count  = hit_count + 1,
          confidence = MIN(0.95, ?)
      WHERE id = ?
    `).run(confidence, existing.id);
    return 0;
  }

  db.prepare(`
    INSERT INTO rules (condition, action, confidence, source_episodes)
    VALUES (?, ?, ?, ?)
  `).run(condition, action, confidence, JSON.stringify(sourceIds));
  return 1;
}

function listRules(db, limit = 20) {
  return db.prepare(
    'SELECT * FROM rules ORDER BY confidence DESC, hit_count DESC LIMIT ?'
  ).all(limit);
}

function updateRuleHit(db, ruleId) {
  db.prepare('UPDATE rules SET hit_count = hit_count + 1 WHERE id = ?').run(ruleId);
}

module.exports = { extractRules, listRules, updateRuleHit };
