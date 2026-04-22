'use strict';

const { extractKeywords } = require('../retrieval.js');

function tryParse(json, fallback) {
  try { return JSON.parse(json || '[]') || fallback; } catch (_) { return fallback; }
}

function normalizeErrorSig(error) {
  if (!error) return null;
  return error
    .slice(0, 80)
    .toLowerCase()
    .replace(/\d{2,}/g, 'N')
    .replace(/['"/\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function saveEpisode(db, ep) {
  const errorSig = normalizeErrorSig(ep.error);

  // Dedup: same error signature + same project → update instead of insert
  if (errorSig && ep.projectId) {
    const existing = db.prepare(`
      SELECT id, outcome, tried_actions, importance
      FROM episodes
      WHERE error_sig = ? AND project_id = ?
      ORDER BY importance DESC, created_at DESC
      LIMIT 1
    `).get(errorSig, ep.projectId);

    if (existing) {
      const mergedTried = [
        ...new Set([
          ...tryParse(existing.tried_actions, []),
          ...(ep.triedActions || [])
        ])
      ];

      // Upgrade to success if new outcome is better
      if (ep.outcome === 'success' && existing.outcome !== 'success') {
        db.prepare(`
          UPDATE episodes
          SET solution = ?, outcome = 'success',
              importance = MAX(importance, ?),
              tried_actions = ?,
              seen_count = seen_count + 1,
              created_at = unixepoch()
          WHERE id = ?
        `).run(ep.solution || null, ep.importance, JSON.stringify(mergedTried), existing.id);
      } else {
        db.prepare(`
          UPDATE episodes
          SET tried_actions = ?,
              importance = MAX(importance, ?),
              seen_count = seen_count + 1
          WHERE id = ?
        `).run(JSON.stringify(mergedTried), ep.importance, existing.id);
      }

      return existing.id;
    }
  }

  // New episode
  const keywords = extractKeywords(
    [ep.task, ep.error, ep.solution, ep.context].filter(Boolean).join(' ')
  );

  return db.prepare(`
    INSERT INTO episodes
      (task, context, actions, error, error_sig, solution, tried_actions,
       outcome, importance, keywords, project_id, file_types)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ep.task          || 'unknown task',
    ep.context       || null,
    JSON.stringify(ep.actions       || []),
    ep.error         || null,
    errorSig,
    ep.solution      || null,
    JSON.stringify(ep.triedActions  || []),
    ep.outcome       || 'unknown',
    ep.importance !== undefined ? ep.importance : 0.5,
    JSON.stringify(keywords),
    ep.projectId     || null,
    JSON.stringify(ep.fileTypes     || [])
  ).lastInsertRowid;
}

function getEpisode(db, id) {
  return db.prepare('SELECT * FROM episodes WHERE id = ?').get(id);
}

function listEpisodes(db, projectId, limit = 20) {
  if (projectId) {
    return db.prepare(
      'SELECT * FROM episodes WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(projectId, limit);
  }
  return db.prepare(
    'SELECT * FROM episodes ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

function deleteEpisode(db, id) {
  return db.prepare('DELETE FROM episodes WHERE id = ?').run(id).changes > 0;
}

function clearAll(db) {
  db.prepare('DELETE FROM episodes').run();
  db.prepare('DELETE FROM rules').run();
  db.prepare('DELETE FROM semantic_facts').run();
}

module.exports = { saveEpisode, getEpisode, listEpisodes, deleteEpisode, clearAll };
