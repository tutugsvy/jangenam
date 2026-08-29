// ===== HISTORY (localStorage) =====
import { HISTORY_KEY, shorten, formatPrice, riskScore } from './utils.js';

export function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

export function saveHistory(d) {
  const h = getHistory().filter(x => x.ca.toLowerCase() !== (d.ca || '').toLowerCase());
  h.unshift({
    ca: d.ca, name: d.name || 'Unknown', symbol: d.symbol || '???',
    icon: d.tokenIcon || null, score: riskScore(d),
    holders: d.holderCount || null, liq: d.dex?.liquidity || null,
    ts: Date.now(),
  });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 20)));
}

export function renderExplorer() {
  const list = document.getElementById('explorerList');
  const h = getHistory();
  if (!h.length) {
    list.innerHTML = '<div class="explorer-empty"><div class="big">🔍</div><div>No scans yet.</div><div style="font-size:13px;margin-top:8px">Scan a token from the <a href="#home" style="color:var(--accent2)">Scanner</a> to see it here.</div></div>';
    return;
  }
  list.innerHTML = h.map(x => {
    const col = x.score >= 75 ? 'var(--green)' : x.score >= 45 ? 'var(--yellow)' : 'var(--red)';
    return '<div class="explorer-item" onclick="rescanHistory(\'' + x.ca + '\')">' +
      '<div class="tlogo">' + (x.icon ? '<img src="' + x.icon + '" onerror="this.parentElement.textContent=\'' + (x.symbol[0] || '?') + '\'">' : (x.symbol[0] || '?')) + '</div>' +
      '<div class="tinfo"><div class="tname">' + x.name + ' <span style="color:var(--text3);font-weight:500">$' + x.symbol + '</span></div>' +
      '<div class="tmeta">' + shorten(x.ca) + ' · ' + (x.holders || '?') + ' holders · ' + (x.liq ? formatPrice(x.liq) + ' liq' : '') + '</div></div>' +
      '<div class="tscore" style="color:' + col + '">' + x.score + '/99</div>' +
      '<div class="tchev">→</div></div>';
  }).join('');
}

export function rescanHistory(ca) {
  document.getElementById('scanInput').value = ca;
  // doScan is provided by api.js via global; avoid circular import by using window
  window.doScan(ca);
}
