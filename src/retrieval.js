'use strict';

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','must','shall',
  'to','of','in','for','on','with','at','by','from','as','into','through','during',
  'before','after','and','or','but','if','then','else','when','where','why','how',
  'all','both','each','few','more','most','other','some','such','no','not','only',
  'same','so','than','too','very','just','this','that','these','those',
  'i','me','my','we','our','you','your','it','its','he','she','they','them','their'
]);

function extractKeywords(text) {
  if (!text) return [];
  return [...new Set(
    text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w))
  )].slice(0, 60);
}

function bm25Score(docKws, queryKws, avgDocLen = 25) {
  const k1 = 1.5, b = 0.75;
  const freq = {};
  for (const kw of docKws) freq[kw] = (freq[kw] || 0) + 1;
  const docLen = docKws.length;
  let score = 0;
  for (const qw of queryKws) {
    const tf = freq[qw] || 0;
    if (tf > 0) {
      score += (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgDocLen));
    }
  }
  return score;
}

// Memories lose weight over time — old solutions may no longer apply
function timeDecay(createdAtUnix) {
  const ageDays = (Date.now() / 1000 - createdAtUnix) / 86400;
  if (ageDays < 7)   return 1.0;
  if (ageDays < 30)  return 0.85;
  if (ageDays < 90)  return 0.65;
  if (ageDays < 180) return 0.45;
  return 0.25;
}

function timeAgo(unixSeconds) {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 3600)    return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)   return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800)  return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

// Composite score: relevance × recency × importance × outcome × reuse × project affinity
function compositeScore(bm25Raw, ep, isSameProject) {
  const decay      = timeDecay(ep.created_at);
  const outcomeW   = ep.outcome === 'success' ? 1.2 : 0.75;  // failures still inject as negative examples
  const reuseBonus = ep.hit_count > 0 ? Math.min(1.3, 1 + ep.hit_count * 0.05) : 1.0;
  const projectW   = isSameProject ? 1.3 : 0.85;
  return bm25Raw * ep.importance * decay * outcomeW * reuseBonus * projectW;
}

function tryParse(json, fallback) {
  try { return JSON.parse(json || '[]') || fallback; } catch (_) { return fallback; }
}

function retrieveRelevant(db, query, projectId, limit = 4) {
  const qKws = extractKeywords(query);
  if (qKws.length === 0) return { episodes: [], rules: [] };

  const episodes = db.prepare(`
    SELECT * FROM episodes
    WHERE outcome != 'unknown'
    ORDER BY created_at DESC
    LIMIT 300
  `).all();

  const scoredEps = episodes
    .map(ep => {
      const stored  = JSON.parse(ep.keywords || '[]');
      const derived = extractKeywords([ep.task, ep.error, ep.solution].filter(Boolean).join(' '));
      const kws     = [...new Set([...stored, ...derived])];
      const bm25    = bm25Score(kws, qKws);
      if (bm25 === 0) return null;
      return { ...ep, _score: compositeScore(bm25, ep, ep.project_id === projectId) };
    })
    .filter(Boolean)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);

  // Rules: only inject if confidence >= 0.5
  const allRules = db.prepare(
    'SELECT * FROM rules WHERE confidence >= 0.5 ORDER BY confidence DESC, hit_count DESC LIMIT 30'
  ).all();

  const scoredRules = allRules
    .map(r => ({
      ...r,
      _score: bm25Score(extractKeywords(r.condition + ' ' + r.action), qKws) * r.confidence
    }))
    .filter(r => r._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 3);

  return { episodes: scoredEps, rules: scoredRules };
}

function formatMemoryContext(result) {
  const { episodes, rules } = result;
  if (episodes.length === 0 && rules.length === 0) return null;

  const successes = episodes.filter(e => e.outcome === 'success');
  const failures  = episodes.filter(e => e.outcome !== 'success');
  const lines = [];

  if (successes.length > 0) {
    lines.push(`[claude-reforge: ${successes.length} relevant past experience(s)]`);
    lines.push('');
    for (const ep of successes) {
      lines.push(`Past experience (${timeAgo(ep.created_at)}):`);
      lines.push(`  Task: ${ep.task.slice(0, 120)}`);
      if (ep.error)    lines.push(`  Error: ${ep.error.slice(0, 150)}`);
      if (ep.solution) lines.push(`  What worked: ${ep.solution.slice(0, 150)}`);
      lines.push('');
    }
  }

  if (failures.length > 0) {
    lines.push(`[claude-reforge: ${failures.length} known failure(s) — avoid these approaches]`);
    lines.push('');
    for (const ep of failures) {
      lines.push(`Known failure (${timeAgo(ep.created_at)}):`);
      lines.push(`  Task: ${ep.task.slice(0, 120)}`);
      if (ep.error) lines.push(`  Error: ${ep.error.slice(0, 150)}`);
      const tried = tryParse(ep.tried_actions, []);
      if (tried.length > 0) {
        lines.push(`  What didn't work: ${tried.slice(0, 3).join(', ').slice(0, 150)}`);
      }
      lines.push('');
    }
  }

  if (rules.length > 0) {
    lines.push(`[claude-reforge: ${rules.length} learned rule(s)]`);
    lines.push('');
    for (const r of rules) {
      const confLabel = r.confidence >= 0.8 ? 'high confidence'
                      : r.confidence >= 0.6 ? 'medium confidence'
                      : 'emerging pattern';
      lines.push(`  Rule (${confLabel}): ${r.condition} → ${r.action}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

module.exports = { extractKeywords, bm25Score, retrieveRelevant, formatMemoryContext, timeAgo };
