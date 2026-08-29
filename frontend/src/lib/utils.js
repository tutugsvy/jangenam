// ===== UTILITY HELPERS =====

export const PONS_CA = '0x39dBED3a2bd333467115dE45665cC57F813C4571';
export const HISTORY_KEY = 'ponscan_history';

export function shorten(addr) {
  return addr ? addr.slice(0, 6) + '...' + addr.slice(-4) : '--';
}

export function copyText(t) {
  if (!t) return;
  navigator.clipboard.writeText(t).catch(() => {});
}

export function formatPrice(n) {
  if (n == null || isNaN(n)) return '--';
  if (n < 0.001) return '$' + n.toFixed(6);
  if (n < 1) return '$' + n.toFixed(4);
  if (n < 1000) return '$' + n.toFixed(2);
  if (n < 1e6) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + (n / 1e6).toFixed(2) + 'M';
}

export function formatSupply(n, dec) {
  if (n == null) return '--';
  const v = Number(n) / 10 ** Number(dec || 18);
  if (v > 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v > 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(2);
}

export function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export function riskScore(d) {
  let score = 55;
  // Contract security (GMGN)
  if (d.isHoneypot) score = Math.max(5, score - 40);
  if (d.verified) score += 15;
  if (d.renounced === true) score += 8;
  else if (d.renounced === false) score -= 10;
  if (d.isBlacklist) score -= 10;
  // Tax
  const buyTax = d.buyTax != null ? Number(d.buyTax) : 0;
  const sellTax = d.sellTax != null ? Number(d.sellTax) : 0;
  if (buyTax > 5 || sellTax > 5) score -= 15;
  else if (buyTax > 0 || sellTax > 0) score -= 5;
  // Rug ratio (0-1)
  if (d.rugRatio != null) {
    if (d.rugRatio > 0.3) score -= 25;
    else if (d.rugRatio > 0.1) score -= 10;
  }
  // Holder concentration
  if (d.top10HolderRate != null) {
    if (d.top10HolderRate > 0.5) score -= 20;
    else if (d.top10HolderRate > 0.2) score -= 8;
    else if (d.top10HolderRate > 0) score += 5;
  }
  // Wash trading
  if (d.isWashTrading) score -= 15;
  // Holders count
  if (d.holderCount && d.holderCount > 5000) score += 12;
  else if (d.holderCount && d.holderCount > 500) score += 10;
  else if (d.holderCount && d.holderCount > 20) score += 5;
  // Liquidity
  if (d.dex && d.dex.liquidity > 100000) score += 12;
  else if (d.dex && d.dex.liquidity > 5000) score += 8;
  else if (d.dex && d.dex.liquidity > 1000) score += 3;
  // Smart money
  if (d.smartWallets >= 3) score += 10;
  else if (d.smartWallets > 0) score += 4;
  if (d.renownedWallets > 0) score += 3;
  // Dev
  if (d.devIsContract === false) score += 5;
  if (d.creatorTokenStatus === 'creator_close') score += 10; // dev exited
  else if (d.creatorTokenStatus === 'creator_hold') score -= 10; // dev still holding
  if (d.creatorOpenCount > 5) score -= 15; // serial launcher
  else if (d.creatorOpenCount > 1) score -= 5;
  if (d.ctoFlag) score -= 5; // community takeover = dev abandoned
  if (d.devBalanceFormatted && Number(d.devBalanceFormatted) > 0) score = Math.max(10, score - 20);
  if (d.devActivity && d.devActivity.devSell) score = Math.max(10, score - 25);
  return Math.min(99, Math.max(5, Math.round(score)));
}

export function riskLabel(s) {
  if (s >= 75) return 'Low Risk';
  if (s >= 45) return 'Medium Risk';
  return 'High Risk';
}

export function riskColor(s) {
  if (s >= 75) return 'var(--green)';
  if (s >= 45) return 'var(--yellow)';
  return 'var(--red)';
}

export function setRisk(el, s, l, c) {
  el.querySelector('.num').textContent = s;
  el.querySelector('.label').textContent = l;
  el.querySelector('.label').style.color = c;
  el.style.background = 'conic-gradient(' + c + ' 0% ' + s + '%, var(--bg2) ' + s + '% 100%)';
}