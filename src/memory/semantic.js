'use strict';

function saveFact(db, key, value, projectId) {
  db.prepare(`
    INSERT INTO semantic_facts (fact_key, fact_value, project_id, updated_at)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(fact_key, project_id) DO UPDATE
      SET fact_value = excluded.fact_value,
          updated_at = unixepoch()
  `).run(key, String(value), projectId || null);
}

function listFacts(db, projectId) {
  if (projectId) {
    return db.prepare(`
      SELECT * FROM semantic_facts
      WHERE project_id = ? OR project_id IS NULL
      ORDER BY updated_at DESC
    `).all(projectId);
  }
  return db.prepare(
    'SELECT * FROM semantic_facts ORDER BY updated_at DESC'
  ).all();
}

function getFact(db, key, projectId) {
  return db.prepare(
    'SELECT * FROM semantic_facts WHERE fact_key = ? AND (project_id = ? OR project_id IS NULL)'
  ).get(key, projectId || null);
}

module.exports = { saveFact, listFacts, getFact };
