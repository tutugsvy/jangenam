// ===== RENDER: all dashboard renderers =====
import { shorten, formatPrice, formatSupply, timeAgo, riskScore, riskLabel, riskColor, setRisk } from '../lib/utils.js';

// ---- RESULT PAGE ----
export function renderResult(d) {
  // Token header
  document.getElementById('tokenName').textContent = d.name || 'Unknown';
  document.getElementById('tokenSymbol').textContent = '$' + (d.symbol || '???');
  document.getElementById('tokenCa').textContent = shorten(d.ca);
  document.getElementById('tokenCa').dataset.ca = d.ca;
  document.getElementById('tokenChain').textContent = 'Robinhood';
  const vBadge = document.getElementById('tokenVerified');
  vBadge.style.display = d.verified ? 'inline-flex' : 'none';
  const logo = document.getElementById('tokenLogo');
  if (d.tokenIcon) {
    logo.innerHTML = '<img src="' + d.tokenIcon + '" alt="logo" onerror="this.parentElement.textContent=\'' + ((d.symbol || '?')[0] || '?') + '\'">';
  } else {
    logo.textContent = (d.symbol || '?')[0] || '?';
  }

  // Risk score
  const score = riskScore(d);
  const label = riskLabel(score);
  const color = riskColor(score);
  setRisk(document.getElementById('resultRiskCircle'), score, label, color);
  setRisk(document.getElementById('riskCircleDetail'), score, label, color);
  document.getElementById('trustScoreLabel').textContent = score + ' / 100';
  document.getElementById('trustScoreBar').style.width = score + '%';
  document.getElementById('trustScoreBar').className = 'bar-fill ' + (score >= 75 ? 'green' : score >= 45 ? 'yellow' : 'red');

  // Overview
  document.getElementById('ovName').textContent = d.name || '--';
  document.getElementById('ovSymbol').textContent = d.symbol || '--';
  const price = d.dex?.priceUsd ? parseFloat(d.dex.priceUsd) : null;
  document.getElementById('ovMcap').textContent = formatPrice(d.dex?.fdv);
  document.getElementById('ovLiq').textContent = formatPrice(d.dex?.liquidity);
  document.getElementById('ovLiq2').textContent = formatPrice(d.dex?.liquidity);
  document.getElementById('ovHolders').textContent = d.holderCount || '--';
  document.getElementById('ovHolders2').textContent = d.holderCount || '--';
  document.getElementById('ovSmart').textContent = d.smartWallets != null ? d.smartWallets : '--';
  document.getElementById('ovRenowned').textContent = d.renownedWallets != null ? d.renownedWallets : '--';
  document.getElementById('ovVol').textContent = formatPrice(d.dex?.volume24h);
  const chEl = document.getElementById('ovChange');
  if (d.dex?.priceChange24h != null) {
    const c = d.dex.priceChange24h;
    chEl.textContent = (c >= 0 ? '+' : '') + c.toFixed(2) + '%';
    chEl.className = 'card-value ' + (c >= 0 ? 'up' : 'down');
  } else { chEl.textContent = '--'; chEl.className = 'card-value'; }
  document.getElementById('ovSupply').textContent = formatSupply(d.totalSupply, d.decimals);
  document.getElementById('ovVerified2').textContent = d.verified ? '✓ Yes' : '✗ No';

  // Dev
  const devAddr = document.getElementById('ovDevAddr');
  devAddr.textContent = shorten(d.dev);
  devAddr.dataset.ca = d.dev;
  document.getElementById('ovDevEth').textContent = d.devEthBalance ? d.devEthBalance + ' ETH' : '--';
  document.getElementById('ovDevToken').textContent = d.devBalanceFormatted ? d.devBalanceFormatted + ' ' + (d.symbol || '') : '0 ' + (d.symbol || '');
  document.getElementById('ovDevWorth').textContent = d.devWorthUsd || '$0.00';
  const devStat = document.getElementById('ovDevStatus');
  if (d.devIsContract) { devStat.innerHTML = '<span class="badge badge-yellow">● Contract</span>'; }
  else { devStat.innerHTML = '<span class="badge badge-green">● EOA</span>'; }
  const sellEl = document.getElementById('ovDevSell');
  if (d.devActivity && d.devActivity.devSell) {
    sellEl.innerHTML = '<span class="badge badge-red">● Sold ' + d.devActivity.totalSellCount + 'x</span>';
  } else {
    sellEl.innerHTML = '<span class="badge badge-green">● No sells</span>';
  }

  // Socials
  const socials = document.getElementById('ovSocials');
  if (d.xHandles && d.xHandles.length) {
    socials.innerHTML = d.xHandles.map(h => '<span class="badge badge-outline" style="margin:0 4px 4px 0;display:inline-flex">🐦 @' + h + '</span>').join('');
  } else { socials.textContent = 'No social data'; }

  renderFundingTree(d);
  renderFundingTab(d);
  renderDevTab(d);
  renderHoldersTab(d);
  renderContractTab(d);
  renderSocialsTab(d);
}

// ---- FUNDING TREE (overview card) ----
export function renderFundingTree(d) {
  const tree = document.getElementById('ovFundingTree');
  if (!d.dev) { tree.innerHTML = '<div style="font-size:13px;color:var(--text3)">No dev address found</div>'; return; }
  let html = '<div class="funding-node"><div class="dot"></div><span class="addr">' + shorten(d.dev) + '</span><span class="pct">Dev</span></div>';
  if (d.devFunding && d.devFunding.fundedBy) {
    html += '<div class="funding-node"><div class="dot"></div><span class="addr">' + shorten(d.devFunding.fundedBy) + '</span><span class="pct">' + (d.devFunding.fundedAtTime ? timeAgo(d.devFunding.fundedAtTime) : '') + '</span></div>';
  } else {
    html += '<div class="funding-node"><div class="dot"></div><span class="addr" style="color:var(--text3)">No funding source</span><span class="pct">--</span></div>';
  }
  tree.innerHTML = html;
}

// ---- FUNDING TAB ----
export function renderFundingTab(d) {
  const tree = document.getElementById('fundingTree');
  const details = document.getElementById('fundingDetails');
  if (!d.dev) { tree.innerHTML = '<div style="font-size:13px;color:var(--text3)">No dev address</div>'; details.innerHTML = '<div style="font-size:13px;color:var(--text3)">No dev address</div>'; return; }
  let html = '<div class="funding-node"><div class="dot"></div><span class="addr">' + shorten(d.dev) + '</span><span class="pct">Dev Wallet</span></div>';
  if (d.devFunding && d.devFunding.fundedBy) {
    html += '<div class="funding-node"><div class="dot"></div><span class="addr">' + shorten(d.devFunding.fundedBy) + '</span><span class="pct">' + (d.devFunding.fundedAtTime ? timeAgo(d.devFunding.fundedAtTime) : '') + '</span></div>';
    details.innerHTML =
      '<div class="info-row"><span class="label">First Funder</span><span class="value" style="font-size:12px">' + shorten(d.devFunding.fundedBy) + '</span></div>' +
      '<div class="info-row"><span class="label">Funded</span><span class="value">' + (d.devFunding.fundedAtTime ? timeAgo(d.devFunding.fundedAtTime) : '--') + '</span></div>' +
      (d.devFunding.fundedTx ? '<div class="info-row"><span class="label">Fund Tx</span><span class="addr" style="font-size:11px" onclick="copyText(\'' + d.devFunding.fundedTx + '\')">' + shorten(d.devFunding.fundedTx) + ' <span class="copy">📋</span></span></div>' : '') +
      '<div class="info-row"><span class="label">Source</span><span class="value" style="font-size:12px">' + (d.devFunding.source || 'rh-scan') + '</span></div>';
  } else {
    html += '<div class="funding-node"><div class="dot"></div><span class="addr" style="color:var(--text3)">No funding source found</span><span class="pct">--</span></div>';
    details.innerHTML = '<div style="font-size:13px;color:var(--text3)">No funding trace available</div>';
  }
  tree.innerHTML = html;
}

// ---- DEVELOPER TAB ----
export function renderDevTab(d) {
  const info = document.getElementById('devInfo');
  const act = document.getElementById('devActivity');
  if (!d.dev) {
    info.innerHTML = '<div style="font-size:13px;color:var(--text3)">No developer address found</div>';
    act.innerHTML = '<div style="font-size:13px;color:var(--text3)">No developer address found</div>';
    return;
  }
  let html =
    '<div><div class="card-label">Wallet</div><div class="addr" onclick="copyText(\'' + d.dev + '\')">' + shorten(d.dev) + ' <span class="copy">📋</span></div></div>' +
    '<div><div class="card-label">Type</div><div class="card-value small">' + (d.devIsContract ? 'Contract' : 'EOA') + '</div></div>' +
    '<div><div class="card-label">Label</div><div class="card-value small">' + (d.devLabel || '--') + '</div></div>' +
    '<div><div class="card-label">Status</div><div class="card-value small">' + (d.creatorTokenStatus === 'creator_close' ? '<span class="badge badge-green">● Exited</span>' : d.creatorTokenStatus === 'creator_hold' ? '<span class="badge badge-yellow">● Still holding</span>' : '--') + '</div></div>' +
    (d.creatorOpenCount > 0 ? '<div><div class="card-label">Tokens Launched</div><div class="card-value small">' + d.creatorOpenCount + '</div></div>' : '') +
    (d.ctoFlag ? '<div><div class="card-label">Community Takeover</div><div class="card-value small"><span class="badge badge-yellow">⚠ CTO</span></div></div>' : '') +
    '<div><div class="card-label">ETH Balance</div><div class="card-value small">' + (d.devEthBalance || '0') + ' ETH</div></div>' +
    '<div><div class="card-label">Token Balance</div><div class="card-value small">' + (d.devBalanceFormatted ? d.devBalanceFormatted : '0') + ' ' + (d.symbol || '') + '</div></div>' +
    '<div><div class="card-label">Token Worth</div><div class="card-value small">' + (d.devWorthUsd || '$0.00') + '</div></div>';
  if (d.devHoldings && d.devHoldings.length) {
    html += '<div style="grid-column:1/-1"><div class="card-label" style="margin-bottom:8px">Top Holdings</div>' +
      d.devHoldings.slice(0, 5).map(h =>
        '<div class="info-row" style="padding:5px 0"><span class="label" style="font-size:11px">' + h.symbol + '</span><span class="value" style="font-size:11px">' + (h.balance ? Number(h.balance).toPrecision(4) : '0') + ' · ' + (h.worthUsd || '—') + '</span></div>'
      ).join('') + '</div>';
  }
  if (d.deployInfo) {
    html += '<div><div class="card-label">Deploy Block</div><div class="card-value small">#' + (d.deployInfo.deployBlock || '--') + '</div></div>';
  }
  info.innerHTML = html;
  if (d.devActivity && d.devActivity.sells && d.devActivity.sells.length) {
    let ahtml = '<div style="margin-bottom:8px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<span class="badge badge-red">● Sold ' + d.devActivity.totalSellCount + 'x</span>' +
      '<span class="badge badge-outline">Total: ' + d.devActivity.totalSellTokens + '</span>' +
      '<span class="badge badge-outline">' + d.devActivity.totalSellUsd + '</span></div>';
    d.devActivity.sells.forEach(s => {
      ahtml += '<div class="activity-item"><span class="type sell">SELL</span><span>' + s.value + '</span><span class="val">$' + s.usd + '</span></div>';
    });
    act.innerHTML = ahtml;
  } else if (d.devActivity && d.devActivity.activityCount) {
    act.innerHTML = '<div style="color:var(--green);font-size:13px">No sells detected. ' + d.devActivity.activityCount + ' non-sell transfers found.</div>';
  } else {
    act.innerHTML = '<div style="font-size:13px;color:var(--text3)">No recent activity</div>';
  }
}

// ---- HOLDERS TAB ----
export function renderHoldersTab(d) {
  const bar = document.getElementById('holderBar');
  const legend = document.getElementById('holderLegend');
  const list = document.getElementById('holderList');
  const summary = document.getElementById('holderSummary');
  const holders = d.topHolders || [];
  if (!holders.length) {
    bar.innerHTML = ''; legend.innerHTML = '<div style="font-size:13px;color:var(--text3)">No holder data</div>';
    list.innerHTML = ''; summary.innerHTML = '<div style="font-size:13px;color:var(--text3)">No holder data</div>';
    return;
  }
  const colors = ['var(--accent2)', 'var(--accent3)', 'var(--green)', 'var(--yellow)', 'var(--red)', 'var(--text3)'];
  let barHtml = '';
  holders.slice(0, 10).forEach((h, i) => {
    const pct = parseFloat(h.percentage) || 0;
    barHtml += '<div class="seg" style="width:' + pct + '%;background:' + (colors[i] || colors[5]) + '" title="' + h.percentage + '"></div>';
  });
  bar.innerHTML = barHtml;
  if (holders.length > 0) {
    const p = parseFloat(holders[0].percentage) || 0;
    legend.innerHTML = '<div class="item"><div class="swatch" style="background:' + colors[0] + '"></div>Top 1: ' + p.toFixed(1) + '%</div>' +
      '<div class="item"><div class="swatch" style="background:' + colors[5] + '"></div>Others: ' + (100 - p).toFixed(1) + '%</div>';
  }
  list.innerHTML = holders.slice(0, 20).map((h, i) => {
    const pct = parseFloat(h.percentage) || 0;
    const col = colors[i] || colors[5];
    return '<div class="info-row" style="padding:5px 0"><span class="addr" style="font-size:11px" onclick="copyText(\'' + h.address + '\')">' + shorten(h.address) + ' <span class="copy">📋</span></span><span class="value" style="font-size:12px;display:flex;align-items:center;gap:6px"><span style="display:inline-block;height:4px;border-radius:2px;background:' + col + ';width:' + Math.max(4, Math.min(40, pct)) + 'px"></span>' + h.percentage + '</span></div>';
  }).join('');
  const topPct = parseFloat(holders[0]?.percentage) || 0;
  summary.innerHTML =
    '<div class="info-row"><span class="label">Total Holders</span><span class="value">' + (d.holderCount || '--') + '</span></div>' +
    '<div class="info-row"><span class="label">Top 1 Holder</span><span class="value">' + topPct.toFixed(1) + '%</span></div>' +
    (d.smartWallets != null ? '<div class="info-row"><span class="label">Smart Money</span><span class="value">' + d.smartWallets + '</span></div>' : '') +
    (d.renownedWallets != null ? '<div class="info-row"><span class="label">KOL Wallets</span><span class="value">' + d.renownedWallets + '</span></div>' : '') +
    (d.sniperWallets != null && d.sniperWallets > 0 ? '<div class="info-row"><span class="label">Snipers</span><span class="value" style="color:var(--yellow)">' + d.sniperWallets + '</span></div>' : '') +
    (d.bundlerWallets != null && d.bundlerWallets > 0 ? '<div class="info-row"><span class="label">Bundlers</span><span class="value" style="color:var(--red)">' + d.bundlerWallets + '</span></div>' : '') +
    (topPct > 50 ? '<div class="info-row"><span class="label">Concentration Risk</span><span class="value" style="color:var(--yellow)">⚠ High</span></div>' : '<div class="info-row"><span class="label">Concentration Risk</span><span class="value" style="color:var(--green)">● Low</span></div>');
}

// ---- CONTRACT TAB ----
export function renderContractTab(d) {
  const details = document.getElementById('contractDetails');
  const fee = document.getElementById('ponsFee');
  const buyTax = d.buyTax != null ? Number(d.buyTax) : null;
  const sellTax = d.sellTax != null ? Number(d.sellTax) : null;
  details.innerHTML =
    '<div class="info-row" style="padding:6px 0"><span class="label">Verified</span><span class="value">' + (d.verified ? '<span class="badge badge-green">✓ Verified</span>' : '<span class="badge badge-yellow">✗ Unverified</span>') + '</span></div>' +
    '<div class="info-row" style="padding:6px 0"><span class="label">Ownership</span><span class="value">' + (d.renounced === true ? '<span class="badge badge-green">✓ Renounced</span>' : d.renounced === false ? '<span class="badge badge-red">✗ Active</span>' : '<span class="badge badge-outline">—</span>') + '</span></div>' +
    (d.isHoneypot != null ? '<div class="info-row" style="padding:6px 0"><span class="label">Honeypot</span><span class="value">' + (d.isHoneypot ? '<span class="badge badge-red">⚠ Detected</span>' : '<span class="badge badge-green">✓ Not detected</span>') + '</span></div>' : '') +
    (d.isBlacklist != null ? '<div class="info-row" style="padding:6px 0"><span class="label">Blacklist</span><span class="value">' + (d.isBlacklist ? '<span class="badge badge-red">⚠ Yes</span>' : '<span class="badge badge-green">✓ Not detected</span>') + '</span></div>' : '') +
    (d.isWashTrading ? '<div class="info-row" style="padding:6px 0"><span class="label">Wash Trading</span><span class="value"><span class="badge badge-red">⚠ Detected</span></span></div>' : '') +
    (d.rugRatio != null ? '<div class="info-row" style="padding:6px 0"><span class="label">Rug Risk</span><span class="value">' + (d.rugRatio > 0.3 ? '<span class="badge badge-red">⚠ High</span>' : d.rugRatio > 0.1 ? '<span class="badge badge-yellow">⚠ Medium</span>' : '<span class="badge badge-green">✓ Low</span>') + '</span></div>' : '') +
    '<div class="info-row" style="padding:6px 0"><span class="label">Code Size</span><span class="value">' + (d.codeSize ? d.codeSize + ' bytes' : '--') + '</span></div>' +
    '<div class="info-row" style="padding:6px 0"><span class="label">Implementation</span><span class="addr" style="font-size:11px">' + (d.implementation ? shorten(d.implementation) : 'None') + '</span></div>' +
    '<div class="info-row" style="padding:6px 0"><span class="label">Has Code</span><span class="value">' + (d.hasCode ? '<span class="badge badge-green">✓ Yes</span>' : '<span class="badge badge-red">✗ No</span>') + '</span></div>' +
    (d.deployInfo ? '<div class="info-row" style="padding:6px 0"><span class="label">Deploy Block</span><span class="value">#' + d.deployInfo.deployBlock + '</span></div>' : '') +
    (d.deployInfo && d.deployInfo.deployTx ? '<div class="info-row" style="padding:6px 0"><span class="label">Deploy Tx</span><span class="addr" style="font-size:11px" onclick="copyText(\'' + d.deployInfo.deployTx + '\')">' + shorten(d.deployInfo.deployTx) + ' <span class="copy">📋</span></span></div>' : '');
  fee.innerHTML =
    '<div class="info-row"><span class="label">Buy Tax</span><span class="value">' + (buyTax != null ? buyTax + '%' : '0%') + '</span></div>' +
    '<div class="info-row"><span class="label">Sell Tax</span><span class="value">' + (sellTax != null ? sellTax + '%' : '0%') + '</span></div>';
}

// ---- SOCIALS TAB ----
export function renderSocialsTab(d) {
  const x = document.getElementById('xHandles');
  const links = document.getElementById('linksSection');
  if (d.xHandles && d.xHandles.length) {
    x.innerHTML = d.xHandles.map(h =>
      '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">' +
      '<span style="font-size:18px">🐦</span>' +
      '<div><div style="font-weight:600;font-size:14px">@' + h + '</div>' +
      '<div style="font-size:12px;color:var(--text3)">X / Twitter</div></div></div>'
    ).join('');
  } else {
    x.innerHTML = '<div style="font-size:13px;color:var(--text3)">No X handles found</div>';
  }
  let html = '<div class="info-row"><span class="label">Pons Launchpad</span><span class="addr" style="font-size:11px" onclick="window.open(\'https://www.ponsfamily.com/launchpad/' + d.ca + '\',\'_blank\')">' + shorten(d.ca) + ' ↗</span></div>';
  if (d.dex && d.dex.dexUrl) html += '<div class="info-row"><span class="label">DexScreener</span><span class="addr" style="font-size:11px" onclick="window.open(\'' + d.dex.dexUrl + '\',\'_blank\')">View ↗</span></div>';
  if (d.dev) html += '<div class="info-row"><span class="label">Dev Address</span><span class="addr" style="font-size:11px" onclick="copyText(\'' + d.dev + '\')">' + shorten(d.dev) + ' <span class="copy">📋</span></span></div>';
  links.innerHTML = html;
}

// ---- LANDING PREVIEW ----
export function renderPreview(d) {
  const dash = document.getElementById('previewDashboard');
  const price = d.dex?.priceUsd ? parseFloat(d.dex.priceUsd) : null;
  const liq = d.dex?.liquidity || null;
  const score = riskScore(d);
  const label = riskLabel(score);
  const color = riskColor(score);
  const holders = d.topHolders || [];
  const topPct = holders.length ? (parseFloat(holders[0].percentage) || 0) : 0;
  const devSell = d.devActivity && d.devActivity.devSell;

  let barHtml = '';
  const hcolors = ['var(--accent2)', 'var(--accent3)', 'var(--green)', 'var(--yellow)', 'var(--red)', 'var(--text3)'];
  holders.slice(0, 10).forEach((h, i) => {
    const p = parseFloat(h.percentage) || 0;
    barHtml += '<div class="seg" style="width:' + p + '%;background:' + (hcolors[i] || hcolors[5]) + '" title="' + h.percentage + '"></div>';
  });
  const holderRows = holders.slice(0, 5).map(h =>
    '<div class="info-row" style="padding:4px 0"><span class="addr" style="font-size:11px">' + shorten(h.address) + '</span><span class="value" style="font-size:12px">' + h.percentage + '</span></div>'
  ).join('');

  const socialHtml = (d.xHandles || []).slice(0, 3).map(h => '<span class="badge badge-outline" style="margin:0 4px 4px 0;display:inline-flex">🐦 @' + h + '</span>').join('') || '<div style="font-size:13px;color:var(--text3)">No social data</div>';

  let fundHtml = '<div class="funding-node"><div class="dot"></div><span class="addr">' + shorten(d.dev) + '</span><span class="pct">Dev</span></div>';
  if (d.devFunding && d.devFunding.fundedBy) {
    fundHtml += '<div class="funding-node"><div class="dot"></div><span class="addr">' + shorten(d.devFunding.fundedBy) + '</span><span class="pct">' + (d.devFunding.fundedAtTime ? timeAgo(d.devFunding.fundedAtTime) : '') + '</span></div>';
  } else {
    fundHtml += '<div class="funding-node"><div class="dot"></div><span class="addr" style="color:var(--text3)">No funding source</span><span class="pct">--</span></div>';
  }

  dash.innerHTML =
    '<div class="grid-dashboard">' +
    '<div>' +
    '<div class="card" style="margin-bottom:16px"><div class="card-title">Token Overview</div><div class="grid-2" style="gap:12px">' +
    '<div><div class="card-label">Name</div><div class="card-value">' + d.name + '</div></div>' +
    '<div><div class="card-label">Symbol</div><div class="card-value">' + d.symbol + '</div></div>' +
    '<div><div class="card-label">Market Cap</div><div class="card-value">' + formatPrice(d.dex?.fdv) + '</div></div>' +
    '<div><div class="card-label">Liquidity</div><div class="card-value">' + formatPrice(liq) + '</div></div>' +
    '<div><div class="card-label">Holders</div><div class="card-value">' + (d.holderCount || '--') + '</div></div>' +
    '<div><div class="card-label">24h Volume</div><div class="card-value">' + formatPrice(d.dex?.volume24h) + '</div></div>' +
    '</div></div>' +
    '<div class="card" style="margin-bottom:16px"><div class="card-title">Risk Summary</div>' +
    '<div style="display:flex;align-items:center;gap:20px;margin-bottom:16px">' +
    '<div class="risk-circle" style="background:conic-gradient(' + color + ' 0% ' + score + '%, var(--bg2) ' + score + '% 100%)"><div class="num">' + score + '</div><div class="label" style="color:' + color + '">' + label + '</div></div>' +
    '<div style="flex:1"><div class="bar-label"><span>Trust Score</span><span>' + score + ' / 99</span></div>' +
    '<div class="bar-track"><div class="bar-fill ' + (score >= 75 ? 'green' : score >= 45 ? 'yellow' : 'red') + '" style="width:' + score + '%"></div></div>' +
    '<div style="display:flex;gap:16px;margin-top:12px;flex-wrap:wrap">' +
    '<div><div class="card-label">Liquidity</div><div class="card-value small">' + formatPrice(liq) + '</div></div>' +
    '<div><div class="card-label">Holders</div><div class="card-value small">' + (d.holderCount || '--') + '</div></div>' +
    '<div><div class="card-label">Verified</div><div class="card-value small">' + (d.verified ? '✓ Yes' : '✗ No') + '</div></div>' +
    '</div></div></div></div>' +
    '<div class="card" style="margin-bottom:16px"><div class="card-title">Developer</div><div class="grid-2" style="gap:12px">' +
    '<div><div class="card-label">Wallet</div><div class="addr" onclick="copyText(\'' + d.dev + '\')">' + shorten(d.dev) + ' <span class="copy">📋</span></div></div>' +
    '<div><div class="card-label">Status</div><div>' + (d.devIsContract ? '<span class="badge badge-yellow">● Contract</span>' : '<span class="badge badge-green">● EOA</span>') + '</div></div>' +
    '<div><div class="card-label">ETH Balance</div><div class="card-value small">' + (d.devEthBalance ? Number(d.devEthBalance).toPrecision(4) + ' ETH' : '--') + '</div></div>' +
    '<div><div class="card-label">Token Balance</div><div class="card-value small">' + (d.devBalanceFormatted ? Number(d.devBalanceFormatted).toPrecision(4) : '0') + ' ' + d.symbol + '</div></div>' +
    '<div><div class="card-label">Token Worth</div><div class="card-value small">' + (d.devWorthUsd || '$0.00') + '</div></div>' +
    '<div><div class="card-label">Dev Sell</div><div class="card-value small">' + (devSell ? '<span class="badge badge-red">● Sold ' + d.devActivity.totalSellCount + 'x</span>' : '<span class="badge badge-green">● No sells</span>') + '</div></div>' +
    '</div></div>' +
    '<div class="card" style="margin-bottom:16px"><div class="card-title">Contract Analysis</div><div class="grid-2" style="gap:10px">' +
    '<div class="info-row" style="padding:6px 0"><span class="label">Status</span><span class="value">' + (d.verified ? '<span class="badge badge-green">✓ Verified</span>' : '<span class="badge badge-yellow">✗ Unverified</span>') + '</span></div>' +
    '<div class="info-row" style="padding:6px 0"><span class="label">Code Size</span><span class="value">' + (d.codeSize ? d.codeSize + ' B' : '--') + '</span></div>' +
    '<div class="info-row" style="padding:6px 0"><span class="label">Buy Fee</span><span class="value">' + (d.ponsFee?.buy ? d.ponsFee.buy + '%' : '0%') + '</span></div>' +
    '<div class="info-row" style="padding:6px 0"><span class="label">Sell Fee</span><span class="value">' + (d.ponsFee?.sell ? d.ponsFee.sell + '%' : '0%') + '</span></div>' +
    '</div></div>' +
    '</div>' +
    '<div>' +
    '<div class="card" style="margin-bottom:16px;padding:16px"><div class="card-title" style="margin-bottom:12px">Quick Scan</div>' +
    '<div style="display:flex;gap:8px"><input type="text" placeholder="Token address..." style="flex:1;padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;font-size:13px;color:var(--text);font-family:inherit" id="quickScanInput">' +
    '<button style="padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;background:var(--accent);color:#0b0e12;white-space:nowrap;cursor:pointer" onclick="window.doScan(document.getElementById(\'quickScanInput\').value)">Analyze</button></div></div>' +
    '<div class="card" style="margin-bottom:16px"><div class="card-title">Holder Analysis</div><div class="holder-bar">' + (barHtml || '') + '</div>' +
    '<div class="holder-legend"><div class="item"><div class="swatch" style="background:var(--accent2)"></div>Top 1: ' + topPct.toFixed(1) + '%</div>' +
    '<div class="item"><div class="swatch" style="background:var(--text3)"></div>Others: ' + (100 - topPct).toFixed(1) + '%</div></div>' +
    '<div style="margin-top:12px;display:flex;flex-direction:column;gap:4px;max-height:150px;overflow-y:auto">' + (holderRows || '') + '</div></div>' +
    '<div class="card" style="margin-bottom:16px"><div class="card-title">Social</div><div>' + socialHtml + '</div></div>' +
    '<div class="card"><div class="card-title">Funding Sources</div><div class="funding-tree">' + fundHtml + '</div></div>' +
    '</div></div>';
}