'use strict';

const { extractKeywords } = require('../retrieval.js');

function saveEpisode(db, ep) {
  const keywords = extractKeywords(
    [ep.task, ep.error, ep.solution, ep.context].filter(Boolean).join(' ')
  );

  return db.prepare(`
    INSERT INTO episodes
      (task, context, actions, error, solution, outcome, importance, keywords, project_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ep.task     || 'unknown task',
    ep.context  || null,
    JSON.stringify(ep.actions || []),
    ep.error    || null,
    ep.solution || null,
    ep.outcome  || 'unknown',
    ep.importance !== undefined ? ep.importance : 0.5,
    JSON.stringify(keywords),
    ep.projectId || null
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
