/*
 * Speed-based scoring (Kahoot-style).
 *
 * - A correct answer is always worth at least 50% of base points.
 * - The remaining 50% scales linearly with how fast the answer came in.
 * - A streak (consecutive correct answers) adds a flat bonus per step.
 *
 * timeTaken / timeLimit are in milliseconds.
 */
function computePoints({ timeTaken = 0, timeLimit = 20000, streak = 0 }) {
  const basePoints = 1000;

  const limit = Number(timeLimit) > 0 ? Number(timeLimit) : 20000;
  const t = Math.min(Math.max(0, Number(timeTaken) || 0), limit);

  const speedRatio = 1 - t / limit; // 1 = instant, 0 = used full time
  const speedPoints = Math.round(basePoints * (0.5 + 0.5 * speedRatio));

  const streakBonus = Math.max(0, Number(streak) || 0) * 50;

  return speedPoints + streakBonus;
}

module.exports = { computePoints };