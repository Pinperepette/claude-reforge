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

function timeAgo(unixSeconds) {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

function retrieveRelevant(db, query, projectId, limit = 4) {
  const qKws = extractKeywords(query);
  if (qKws.length === 0) return { episodes: [], rules: [] };

  const episodes = db.prepare(`
    SELECT * FROM episodes
    WHERE (project_id = ? OR project_id IS NULL)
    AND outcome != 'unknown'
    ORDER BY importance DESC, created_at DESC
    LIMIT 200
  `).all(projectId);

  const scoredEps = episodes
    .map(ep => {
      const stored = JSON.parse(ep.keywords || '[]');
      const derived = extractKeywords(
        [ep.task, ep.error, ep.solution].filter(Boolean).join(' ')
      );
      const kws = [...new Set([...stored, ...derived])];
      return { ...ep, _score: bm25Score(kws, qKws) * ep.importance };
    })
    .filter(e => e._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);

  const allRules = db.prepare(
    'SELECT * FROM rules ORDER BY confidence DESC, hit_count DESC LIMIT 30'
  ).all();

  const scoredRules = allRules
    .map(r => ({
      ...r,
      _score: bm25Score(extractKeywords(r.condition + ' ' + r.action), qKws)
    }))
    .filter(r => r._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 3);

  return { episodes: scoredEps, rules: scoredRules };
}

function formatMemoryContext(result) {
  const { episodes, rules } = result;
  if (episodes.length === 0 && rules.length === 0) return null;

  const lines = [];

  if (episodes.length > 0) {
    lines.push(`[claude-reforge: ${episodes.length} relevant past experience(s)]`);
    lines.push('');
    for (const ep of episodes) {
      const outcome = ep.outcome === 'success' ? 'success' : 'failure';
      lines.push(`Past experience (${outcome}, ${timeAgo(ep.created_at)}):`);
      lines.push(`  Task: ${ep.task.slice(0, 120)}`);
      if (ep.error)    lines.push(`  Error: ${ep.error.slice(0, 150)}`);
      if (ep.solution) lines.push(`  Solution: ${ep.solution.slice(0, 150)}`);
      lines.push('');
    }
  }

  if (rules.length > 0) {
    lines.push(`[claude-reforge: ${rules.length} learned rule(s)]`);
    lines.push('');
    for (const r of rules) {
      lines.push(`  Rule: ${r.condition} → ${r.action}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

module.exports = { extractKeywords, bm25Score, retrieveRelevant, formatMemoryContext, timeAgo };
