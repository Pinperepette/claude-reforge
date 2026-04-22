'use strict';

function scoreEpisode(session) {
  let score = 0.15;

  // Error that was resolved → highest value
  if (session.errors.length > 0 && session.outcome === 'success') score += 0.45;

  // Significant failure → also valuable (learn what NOT to do)
  if (session.outcome === 'failure') score += 0.20;

  // Task complexity via action count
  const n = session.actions.length;
  if (n >= 5)  score += 0.10;
  if (n >= 10) score += 0.05;

  // Multiple file changes = non-trivial work
  if (session.fileChanges.length >= 3) score += 0.10;

  // Specific error text (more info = more reusable)
  if (session.errors.join(' ').length > 100) score += 0.05;

  // Has a clear solution path
  if (session.solution) score += 0.10;

  return Math.min(1.0, score);
}

function shouldSaveEpisode(session) {
  // Always save: error that was resolved
  if (session.errors.length > 0 && session.outcome === 'success') return true;

  // Save: significant failure with real work done
  if (session.outcome === 'failure' && session.fileChanges.length >= 2) return true;

  // Save: complex successful task (3+ files changed, 5+ actions)
  if (session.fileChanges.length >= 3 && session.actions.length >= 5) return true;

  return false;
}

module.exports = { scoreEpisode, shouldSaveEpisode };
