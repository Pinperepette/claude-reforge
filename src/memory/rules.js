'use strict';

function extractRules(db) {
  const episodes = db.prepare(`
    SELECT id, task, error, solution, outcome
    FROM episodes
    WHERE error    IS NOT NULL AND error    != ''
    AND   solution IS NOT NULL AND solution != ''
    AND   outcome  = 'success'
    ORDER BY created_at DESC
    LIMIT 100
  `).all();

  if (episodes.length < 2) return 0;

  // Group episodes by normalized error signature
  const groups = new Map();
  for (const ep of episodes) {
    const sig = ep.error
      .slice(0, 80)
      .toLowerCase()
      .replace(/\d{2,}/g, 'N')    // normalize numbers
      .replace(/['"/\\]/g, '')     // strip quotes/slashes
      .replace(/\s+/g, ' ')
      .trim();
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(ep);
  }

  let added = 0;
  for (const [, eps] of groups) {
    if (eps.length < 2) continue;

    const condition = `Error: ${eps[0].error.slice(0, 120)}`;
    const solution  = eps[0].solution;
    if (!solution) continue;

    const action     = `Solution: ${solution.slice(0, 150)}`;
    const lookupFrag = condition.slice(0, 40).replace(/[%_[\]]/g, '');
    const confidence = Math.min(0.95, 0.4 + eps.length * 0.1);

    const existing = db.prepare(
      'SELECT id FROM rules WHERE condition LIKE ? LIMIT 1'
    ).get(`%${lookupFrag}%`);

    if (existing) {
      db.prepare(`
        UPDATE rules
        SET hit_count  = hit_count + 1,
            confidence = MIN(0.95, confidence + 0.05)
        WHERE id = ?
      `).run(existing.id);
    } else {
      db.prepare(`
        INSERT INTO rules (condition, action, confidence, source_episodes)
        VALUES (?, ?, ?, ?)
      `).run(condition, action, confidence, JSON.stringify(eps.map(e => e.id)));
      added++;
    }
  }
  return added;
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
