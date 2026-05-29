/* Shared front-end helpers used by host / participant / presenter pages. */

// Toast notifications
let _toastTimer = null;
function toast(message, type) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.background =
    type === 'good' ? 'var(--good)' : type === 'info' ? 'var(--surface-2)' : 'var(--danger)';
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// Render a leaderboard into `el` from a ranked participant list.
// `mySocketId` (optional) highlights the current player's row.
function renderLeaderboard(el, list, mySocketId) {
  if (!el) return;
  if (!list || list.length === 0) {
    el.innerHTML = '<div class="empty">No players yet…</div>';
    return;
  }
  el.innerHTML = list
    .map((p) => {
      const me = mySocketId && p.socketId === mySocketId ? ' me' : '';
      const off = p.connected === false ? ' off' : '';
      const streak = p.streak > 1 ? ` <span class="muted">🔥${p.streak}</span>` : '';
      return `
        <div class="lb-row${me}${off}">
          <div class="rank">${p.rank}</div>
          <div class="name">${escapeHtml(p.nickname)}${streak}</div>
          <div class="pts">${p.score} pts</div>
        </div>`;
    })
    .join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Shape glyph + label for the four answer colors (Kahoot-style).
const SHAPES = ['▲', '◆', '●', '■'];
const SHAPE_NAMES = ['Triangle', 'Diamond', 'Circle', 'Square'];