import { createPublicClient, http, getAddress, isAddress } from 'viem';
import { createServer } from 'http';
import { parse } from 'url';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname_ish = fileURLToPath(new URL('.', import.meta.url));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const RH = 'https://rpc.mainnet.chain.robinhood.com';
const BS = 'https://robinhoodchain.blockscout.com';
const BLOCKSCOUT = `${BS}/api`;
const BLOCKSCOUT_V2 = `${BS}/api/v2`;
const RHSCAN = 'https://rh-scan.com';

const client = createPublicClient({ transport: http(RH, { timeout: 10000 }) });

// Tiny timing helper
const timing = {};
function tic(k){ timing[k] = Date.now(); }
function toc(k){ if(timing[k]) timing[k + '_ms'] = (Date.now() - timing[k]); }

// In-memory scan cache (5 min TTL) — makes landing/auto-loads instant
const scanCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
async function cachedScan(ca) {
  const key = ca.toLowerCase();
  const hit = scanCache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.d;
  const d = await scan(getAddress(ca));
  scanCache.set(key, { d, t: Date.now() });
  return d;
}

function bsFetch(url) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
}

// 4-byte selectors
const S = {
  name: '0x06fdde03',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  totalSupply: '0x18160ddd',
  balanceOf: '0x70a08231',
  deployer: '0xd5f39488', // Pons v2 immutable deployer
  fee: '0xddca3f43', // Pons fee()
  pool: '0x16f0115b', // Pons pool()
  WETH: '0x4aa4a4fc',
  factory: '0xc45a0155',
  getPair: '0xe6a43905', // Uniswap V2 getPair
};

// Helper: decode eth_call hex string response
function decodeHex(resultHex) {
  if (!resultHex || resultHex === '0x') return null;
  return resultHex;
}

// Decode a string (name/symbol) from 0x... encoded response
function decodeString(hex) {
  if (!hex || hex === '0x') return null;
  try {
    const offset = parseInt(hex.slice(2, 66), 16) * 2 + 2;
    const len = parseInt(hex.slice(offset, offset + 64), 16) * 2;
    const raw = hex.slice(offset + 64, offset + 64 + len);
    return Buffer.from(raw, 'hex').toString('utf8').replace(/\0+$/, '');
  } catch { return null; }
}

// Decode uint
function decodeUint(hex) {
  if (!hex || hex === '0x' || hex.length < 66) return null;
  try { return BigInt(hex).toString(); } catch { return null; }
}

// Format a raw wei integer to a decimal string without losing precision
function formatTokenAmount(raw, decimals) {
  if (raw === null || raw === undefined) return null;
  const dec = Number(decimals || 0);
  const val = BigInt(raw);
  const negative = val < 0n;
  const abs = negative ? -val : val;
  if (dec === 0) return (negative ? '-' : '') + abs.toString();
  const pad = abs.toString().padStart(dec + 1, '0');
  const intPart = pad.slice(0, -dec);
  const fracPart = pad.slice(-dec).replace(/0+$/, '');
  const sign = negative ? '-' : '';
  return fracPart ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}

// eth_call
async function call(addr, selector, args = '') {
  const data = selector + args.slice(2).padStart(64, '0');
  try {
    const res = await client.request({ method: 'eth_call', params: [{ to: addr, data }, 'latest'] });
    return res;
  } catch { return null; }
}

// eth_getCode
async function getCode(addr) {
  try { return await client.request({ method: 'eth_getCode', params: [addr, 'latest'] }); }
  catch { return null; }
}

// eth_getLogs — chunked
async function getLogs(fromBlock, toBlock, addr, topics = []) {
  const params = { address: addr, fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}` };
  if (topics.length) params.topics = topics;
  try {
    const res = await client.request({ method: 'eth_getLogs', params: [params] });
    return res || [];
  } catch { return []; }
}

// DexScreener
async function dexScreener(ca) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`);
    const json = await res.json();
    if (!json.pairs || !json.pairs.length) return null;
    const pairs = json.pairs.filter(p => p.chainId === 'robinhood');
    if (!pairs.length) return null;
    const byLiq = [...pairs].sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    const best = byLiq[0];
    return {
      priceUsd: best.priceUsd || null,
      liquidity: best.liquidity?.usd || null,
      fdv: best.fdv || null,
      volume24h: pairs.reduce((s, p) => s + (Number(p.volume?.h24) || 0), 0),
      logoUrl: best.info?.imageUrl || best.info?.logo || null,
      priceChange24h: best.priceChange?.h24 || null,
      priceChange5m: best.priceChange?.m5 || null,
      pair: best.baseToken?.symbol + '/' + best.quoteToken?.symbol,
      dexUrl: best.url || null,
      pairCount: pairs.length,
    };
  } catch { return null; }
}

// Blockscout v2 — single address
async function bsAddr(ca) {
  try {
    const res = await bsFetch(`${BLOCKSCOUT_V2}/addresses/${ca}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Blockscout v2 — token info
async function bsToken(ca) {
  try {
    const res = await bsFetch(`${BLOCKSCOUT_V2}/tokens/${ca}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Blockscout v1 — token info fallback
async function bsTokenV1(ca) {
  try {
    const res = await bsFetch(`${BLOCKSCOUT}?module=token&action=getToken&contractaddress=${ca}`);
    const json = await res.json();
    if (json.status === '1' && json.result) return json.result;
    return null;
  } catch { return null; }
}

// Blockscout v1 — holders fallback (raw, no pagination limits)
async function bsHoldersV1(ca) {
  try {
    const res = await bsFetch(`${BLOCKSCOUT}?module=token&action=getTokenHolders&contractaddress=${ca}`);
    const json = await res.json();
    if (json.status === '1' && Array.isArray(json.result)) return json.result;
    return null;
  } catch { return null; }
}

// Blockscout v2 — holders
async function bsHolders(ca) {
  try {
    const res = await bsFetch(`${BLOCKSCOUT_V2}/tokens/${ca}/holders`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.items || [];
  } catch { return null; }
}

// Blockscout v2 — smart contract source
async function bsContract(ca) {
  try {
    const res = await bsFetch(`${BLOCKSCOUT_V2}/smart-contracts/${ca}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Blockscout v1 — contract creation
async function bsCreation(ca) {
  try {
    const res = await bsFetch(`${BLOCKSCOUT}?module=contract&action=getcontractcreation&contractaddresses=${ca}`);
    const json = await res.json();
    if (json.status === '1' && json.result?.length) return json.result[0];
    return null;
  } catch { return null; }
}

// DuckDuckGo search for X handle
async function searchX(ca, symbol) {
  const queries = [ca, symbol ? `${symbol} robinhood` : null].filter(Boolean);
  const xHandles = new Set();
  for (const q of queries) {
    try {
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q + ' x.com robinhood chain')}`);
      const body = await res.text();
      const matches = body.match(/x\.com\/([a-zA-Z0-9_]+)/g) || [];
      matches.forEach(m => xHandles.add(m.replace('x.com/', '').split('/')[0]));
    } catch { continue; }
  }
  return xHandles.size ? [...xHandles].slice(0, 3) : null;
}

// Pons v2 deployer (immutable getter)
async function ponsDeployer(ca) {
  const hex = await call(ca, S.deployer);
  if (!hex || hex === '0x' || parseInt(hex.slice(2, 66), 16) === 0) return null;
  try {
    return '0x' + hex.slice(hex.length - 40);
  } catch { return null; }
}

// Pons fee
async function ponsFee(ca) {
  const hex = await call(ca, S.fee);
  if (!hex) return null;
  try { return decodeUint(hex); } catch { return null; }
}

// Uniswap V2 pair address
async function v2Pair(token, weth = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73') {
  try {
    const factory = '0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f';
    const data = S.getPair + token.slice(2).toLowerCase().padStart(64, '0') + weth.slice(2).toLowerCase().padStart(64, '0');
    const res = await client.request({ method: 'eth_call', params: [{ to: factory, data }, 'latest'] });
    if (!res || res === '0x' || res === '0x0000000000000000000000000000000000000000000000000000000000000000') return null;
    const pair = '0x' + res.slice(res.length - 40);
    const code = await getCode(pair);
    if (code && code.length > 4) return pair;
    return null;
  } catch { return null; }
}

// Try to find deploy block — via creation tx lookup (fast, exact)
async function findDeployBlock(ca, creationInfo) {
  // Check if contract exists
  const code = await getCode(ca);
  if (!code || code.length < 5) return null;

  // Prefer Blockscout creation tx: get tx hash → RPC tx lookup → block + sender
  const creationTx = creationInfo?.txHash || creationInfo?.transactionHash || null;
  if (creationTx) {
    try {
      const tx = await client.request({ method: 'eth_getTransactionByHash', params: [creationTx] });
      if (tx) {
        return {
          deployBlock: parseInt(tx.blockNumber, 16),
          deployTx: creationTx,
          firstMinter: tx.from || null,
          method: 'creation-tx-lookup',
        };
      }
    } catch { /* fall through to log scan */ }
  }

  // Fallback: find the FIRST mint (Transfer from 0x0) via backward-chunked walk
  // from the latest block. Not binary-searchable: tokens minted only at deploy
  // have few mint events, so windows after deploy also return 0 logs (non-monotonic).
  const current = await client.request({ method: 'eth_blockNumber', params: [] });
  const toBlock = parseInt(current, 16);
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const zeroTopic = '0x0000000000000000000000000000000000000000000000000000000000000000';
  const CHUNK = 2000;
  let hi = toBlock;
  let found = null;
  let guard = 0;
  while (hi > CHUNK && guard++ < 40) {
    const lo = Math.max(1, hi - CHUNK);
    const logs = await getLogs(lo, hi, ca, [transferTopic, zeroTopic]);
    if (logs.length) {
      found = logs[0];
      break;
    }
    hi = lo;
  }
  if (!found) return null;
  return {
    deployBlock: parseInt(found.blockNumber, 16),
    deployTx: found.transactionHash,
    firstMinter: found.topics[2]?.length > 40 ? '0x' + found.topics[2].slice(26) : null,
    method: 'mint-log-scan',
  };
}

// ====== MAIN SCAN ======
async function scan(ca) {
  const result = { ca, timestamp: Date.now() };
  tic('total');

  // 1. Token basics
  tic('basics');
  const [nameHex, symHex, decHex, supplyHex] = await Promise.all([
    call(ca, S.name), call(ca, S.symbol),
    call(ca, S.decimals), call(ca, S.totalSupply),
  ]);
  result.name = decodeString(nameHex);
  result.symbol = decodeString(symHex);
  result.decimals = decodeUint(decHex);
  result.totalSupply = decodeUint(supplyHex);
  toc('basics');

  // 2. Code size
  tic('code');
  const code = await getCode(ca);
  result.codeSize = code ? (code.length - 2) / 2 : 0;
  result.hasCode = (result.codeSize || 0) > 0;
  toc('code');

  // 3. Blockscout token info
  tic('blockscout');
  const [bs, bsV1, contract, creation] = await Promise.all([
    bsToken(ca), bsTokenV1(ca), bsContract(ca), bsCreation(ca)
  ]);
  const bsData = bs || bsV1;
  result.blockscout = bsData ? {
    verified: bs?.is_verified || bsV1?.verified || false,
    holderCount: bs?.holders_count || bs?.holders || bsV1?.holders || null,
    transferCount: bs?.transfers_count || null,
    totalSupplyOffChain: bs?.total_supply || bsV1?.total_supply || null,
    iconUrl: bs?.icon_url || null,
  } : null;
  result.verified = contract?.is_verified || false;
  result.implementation = contract?.implementation?.address || null;
  toc('blockscout');

  // 4. Deployer / Dev
  tic('dev');
  const creationInfo = creation;
  let dev = null;
  let devLabel = 'unknown';

  // Collect candidates: Pons v2 deployer, Blockscout creator, mint-log first minter
  const [ponsDeployerAddr, deployInfo] = await Promise.all([
    ponsDeployer(ca),
    findDeployBlock(ca, creationInfo),
  ]);

  const candidates = [];
  if (ponsDeployerAddr) candidates.push({ addr: ponsDeployerAddr, label: 'pons-v2-deployer' });
  if (creationInfo?.contractCreator) {
    candidates.push({ addr: creationInfo.contractCreator, label: creationInfo.creatorImplementationHash ? 'factory' : 'eoa-creator' });
  }
  if (deployInfo?.firstMinter && !candidates.some(c => c.addr.toLowerCase() === deployInfo.firstMinter.toLowerCase())) {
    candidates.push({ addr: deployInfo.firstMinter, label: 'first-minter' });
  }

  // Pick the best candidate: parallel checks
  let best = null;
  const scored = await Promise.all(candidates.map(async c => {
    const code = await getCode(c.addr);
    const isContract = code && code.length > 4;
    const balHex = await call(ca, S.balanceOf, c.addr);
    const bal = balHex ? decodeUint(balHex) : null;
    const balNum = bal ? BigInt(bal) : 0n;
    const score = (!isContract ? 100 : 0) + (balNum > 0n ? 50 : 0);
    return { ...c, score, isContract, bal };
  }));
  for (const s of scored) {
    if (!best || s.score > best.score) best = s;
  }

  if (best) {
    dev = best.addr;
    devLabel = best.label;
    result.devIsContract = best.isContract;
    result.devBalance = best.bal;
  }

  result.dev = dev;
  result.devLabel = devLabel;
  result.deployInfo = deployInfo;
  toc('dev');

  // Dev balance + ETH balance
  tic('devBal');
  if (dev) {
    result.devBalanceFormatted = result.devBalance != null ? formatTokenAmount(result.devBalance, result.decimals) : null;
    const ethBal = await client.request({ method: 'eth_getBalance', params: [dev, 'latest'] });
    result.devEthBalance = formatTokenAmount(ethBal, 18);
  }
  toc('devBal');

  // 6-14: Everything else in parallel
  tic('rest');
  const [holders, fee, pair, dex, xHandles, ponsIcon, devProfileData, devActivity] = await Promise.all([
    (async () => {
      let h = await bsHolders(ca);
      if (!h) h = await bsHoldersV1(ca);
      return h || [];
    })(),
    ponsFee(ca),
    v2Pair(ca),
    dexScreener(ca),
    searchX(ca, result.symbol),
    ponsLogo(ca),
    dev ? devProfile(dev) : Promise.resolve(null),
    dev ? traceDevActivity(ca, dev, Number(result.decimals || 18), null, result.symbol) : Promise.resolve(null),
  ]);
  toc('rest');

  // Process holders
  if (holders.length) {
    result.topHolders = holders.slice(0, 10).map(h => ({
      address: h.address?.hash || h.address || h,
      value: h.value,
      percentage: result.totalSupply && h.value ?
        formatTokenAmount(BigInt(h.value) * 10000n / BigInt(result.totalSupply) * 100n, 4) + '%' : null,
    }));
    result.holderCount = holders.length;
  }
  result.ponsFee = fee;
  result.v2Pair = pair;
  result.dex = dex;
  result.xHandles = xHandles;
  result.tokenIcon = ponsIcon || result.blockscout?.iconUrl || null;

  // Dev profile: funding, holdings, eth balance via rh-scan
  if (devProfileData) {
    // Funding from rh-scan moreinfo
    const mi = devProfileData.moreinfo;
    result.devFunding = (mi?.fundedBy?.address) ? {
      fundedBy: mi.fundedBy.address,
      fundedTx: mi.fundedBy.hash || null,
      fundedAtTime: mi.fundedBy.timestamp || null,
      source: 'rh-scan',
      txSent: mi.txSent || null,
    } : null;

    // ETH balance from rh-scan core (skip RPC call)
    if (devProfileData.core?.ethBalance) {
      result.devEthBalance = formatTokenAmount(devProfileData.core.ethBalance, 18);
    }

    // Dev holdings — list of tokens with balance + worth
    if (devProfileData.holdings?.holdings?.length) {
      const allHoldings = devProfileData.holdings.holdings;
      // Find the scanned token in holdings
      const scannedHolding = allHoldings.find(h => h.token.toLowerCase() === ca.toLowerCase());
      if (scannedHolding) {
        result.devBalanceFormatted = formatTokenAmount(scannedHolding.balance, scannedHolding.decimals);
        result.devBalance = scannedHolding.balance;
      }

      // Price for top holdings (up to 10, via DexScreener batch)
      const price = dex?.priceUsd ? parseFloat(dex.priceUsd) : null;
      const topByBal = allHoldings
        .sort((a,b) => BigInt(b.balance) - BigInt(a.balance))
        .slice(0, 10);

      // Get prices for all holding tokens in one batch call
      const holdCAs = topByBal.map(h => h.token).join(',');
      let dexPrices = {};
      try {
        const dp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${holdCAs}`, { headers: { 'User-Agent': UA } });
        const dpJson = await dp.json();
        if (dpJson.pairs) {
          // Group by token address, take highest liquidity pair price
          for (const pair of dpJson.pairs) {
            const tAddr = pair.baseToken?.address?.toLowerCase() || pair.quoteToken?.address?.toLowerCase();
            if (tAddr) {
              if (!dexPrices[tAddr] || (pair.liquidity?.usd || 0) > (dexPrices[tAddr].liq || 0)) {
                dexPrices[tAddr] = { price: parseFloat(pair.priceUsd || 0), liq: pair.liquidity?.usd || 0, pairUrl: pair.url };
              }
            }
          }
        }
      } catch {}

      let totalWorth = 0;
      result.devHoldings = topByBal.map(h => {
        const bal = formatTokenAmount(h.balance, h.decimals);
        const p = dexPrices[h.token.toLowerCase()]?.price || 0;
        const w = p && bal ? Number(bal) * p : 0;
        totalWorth += w;
        return {
          token: h.token,
          symbol: h.symbol,
          name: h.name,
          balance: bal,
          priceUsd: p || null,
          worthUsd: w > 0 ? '$' + w.toFixed(2) : null,
        };
      });
      // Calculate scanned token worth separately
      if (result.devBalanceFormatted != null && price != null) {
        totalWorth += Number(result.devBalanceFormatted) * price;
      }
      result.devTotalWorthUsd = totalWorth > 0 ? '$' + totalWorth.toFixed(2) : null;
    }
  }

  // Dev USD worth + activity (needs price from dex)
  if (dev && devActivity) {
    const price = dex?.priceUsd ? parseFloat(dex.priceUsd) : null;
    if (result.devBalanceFormatted != null && price != null) {
      result.devWorthUsd = '$' + (Number(result.devBalanceFormatted) * price).toFixed(2);
    }
    // Reclassify sells with actual price
    if (price && devActivity.sells) {
      devActivity.sells = devActivity.sells.map(s => ({
        ...s,
        usd: (Number(s.value) * price).toFixed(4),
      }));
      devActivity.totalSellUsd = devActivity.sells.reduce((s,a) => s + Number(a.usd), 0);
      devActivity.totalSellUsd = devActivity.totalSellUsd ? '$' + devActivity.totalSellUsd.toFixed(2) : null;
    }
    result.devActivity = devActivity;
  }

  toc('total');
  result.timing = { ...timing };
  // Clear for next scan
  Object.keys(timing).forEach(k => delete timing[k]);

  return result;
}

// Pons launchpad page — extract token logo (og:image / IPFS)
async function ponsLogo(ca) {
  try {
    const res = await fetch(`https://www.ponsfamily.com/launchpad/${ca}`, {
      headers: { 'User-Agent': UA }
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return m ? m[1] : null;
  } catch { return null; }
}

// Dev sell/activity trace — check token Transfer logs from dev wallet
async function traceDevActivity(ca, dev, decimals, priceUsd, symbol) {
  if (!dev) return null;
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const fromTopic = '0x000000000000000000000000' + dev.slice(2).toLowerCase();
  try {
    // If no price provided, fetch it so sell detection works
    let price = priceUsd;
    if (price == null) {
      try {
        const d = await dexScreener(ca);
        price = d?.priceUsd ? parseFloat(d.priceUsd) : null;
      } catch {}
    }
    // Latest block
    const current = await client.request({ method: 'eth_blockNumber', params: [] });
    const toBlock = parseInt(current, 16);
    const fromBlock = Math.max(1, toBlock - 100000); // ~recent window (adjustable)
    const logs = await getLogs(fromBlock, toBlock, ca, [transferTopic, fromTopic]);
    if (!logs.length) return null;

    // Classify transfers: to 0x0 = burn, to router/pair = sell, else transfer
    const activities = logs.slice(0, 20).map(l => {
      const to = '0x' + (l.topics[3] || '').slice(26);
      const val = formatTokenAmount(BigInt(l.data), decimals);
      const usd = price ? Number(val) * Number(price) : null;
      let type = 'transfer';
      if (to === '0x0000000000000000000000000000000000000000') type = 'burn';
      else if (usd != null && usd > 1) type = 'sell'; // heuristic: >$1 outbound = sell
      return {
        type, to, value: val, usd: usd != null ? usd.toFixed(4) : null,
        tx: l.transactionHash, block: parseInt(l.blockNumber, 16),
      };
    });

    const sells = activities.filter(a => a.type === 'sell');
    const totalSellTokens = sells.reduce((s, a) => s + (Number(a.value) || 0), 0);
    const totalSellUsd = sells.reduce((s, a) => s + (Number(a.usd) || 0), 0);

    return {
      devSell: sells.length > 0,
      sells: sells.slice(0, 5),
      totalSellCount: sells.length,
      totalSellTokens: formatTokenAmount(BigInt(Math.floor(totalSellTokens * 10**18)), 18),
      totalSellUsd: totalSellUsd ? '$' + totalSellUsd.toFixed(2) : null,
      latestActivity: activities[0] || null,
      activityCount: activities.length,
    };
  } catch { return null; }
}

// Dev funding trace — via rh-scan API (fast, authoritative). Fallback: Blockscout.
async function traceFunding(dev) {
  try {
    const res = await rhFetch(`${RHSCAN}/api/address/${dev}/moreinfo`);
    if (res) {
      const fb = res.fundedBy;
      if (fb && fb.address) {
        return {
          fundedBy: fb.address,
          fundedTx: fb.hash || null,
          fundedAtTime: fb.timestamp || null,
          fundedByUnavailable: !!res.fundedByUnavailable,
          source: 'rh-scan',
          txSent: res.txSent || null,
        };
      }
    }
  } catch { /* fall through to Blockscout */ }

  // Fallback: Blockscout v1 txlist — earliest incoming ETH txs
  try {
    const bsRes = await bsFetch(`${BLOCKSCOUT}?module=account&action=txlist&address=${dev}&sort=asc&limit=30`);
    const json = await bsRes.json();
    if (json.status !== '1' || !Array.isArray(json.result)) return null;

    const txs = json.result;
    const incoming = txs.filter(t =>
      t.to && t.to.toLowerCase() === dev.toLowerCase() && t.isError === '0'
    ).slice(0, 10);

    if (!incoming.length) {
      const intRes = await bsFetch(`${BLOCKSCOUT}?module=account&action=txlistinternal&address=${dev}&sort=asc&limit=20`);
      const intJson = await intRes.json();
      if (intJson.status === '1' && Array.isArray(intJson.result)) {
        return {
          fundedBy: 'internal-tx',
          totalIncomingTxs: intJson.result.filter(t => t.isError === '0').length,
          firstFrom: intJson.result[0]?.from || null,
          firstValue: intJson.result[0]?.value || null,
          source: 'blockscout-internal',
        };
      }
      return { fundedBy: 'unknown', note: 'no incoming tx found in top 50' };
    }

    return {
      fundedBy: incoming[0].from,
      fundedValue: incoming[0].value,
      fundedValueEth: formatTokenAmount(incoming[0].value, 18),
      fundedTx: incoming[0].hash,
      fundedAtBlock: incoming[0].blockNumber,
      totalIncomingTxs: incoming.length,
      firstFunder: incoming[0].from,
      firstFunderNote: 'first ETH inflow to dev wallet',
      source: 'blockscout',
    };
  } catch { return null; }
}

// rh-scan fetch helper — returns parsed JSON or null
async function rhFetch(path) {
  try {
    const res = await fetch(`${RHSCAN}${path}`, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Dev full on-chain profile via rh-scan: holdings, core (eth), moreinfo (fundedBy)
async function devProfile(dev) {
  try {
    const [core, holdings, moreinfo] = await Promise.all([
      rhFetch(`${RHSCAN}/api/address/${dev}/core`),
      rhFetch(`${RHSCAN}/api/address/${dev}/holdings`),
      rhFetch(`${RHSCAN}/api/address/${dev}/moreinfo`),
    ]);
    return { core, holdings, moreinfo };
  } catch { return null; }
}
const server = createServer(async (req, res) => {
  const { pathname, query } = parse(req.url, true);
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Serve static: frontend/dist first (Vite build), then public/ (legacy)
  function serveStatic(p) {
    const rel = p.startsWith('/public/') ? p.slice(8) : p.slice(1);
    const distPath = join(__dirname_ish, 'frontend', 'dist', rel);
    if (existsSync(distPath)) return distPath;
    const publicPath = join(__dirname_ish, 'public', rel);
    if (existsSync(publicPath)) return publicPath;
    return null;
  }

  // Static frontend
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  };

  if (req.method === 'GET' && pathname === '/') {
    // Prefer built Vite dist, fallback to public/ (legacy)
    const distFile = join(__dirname_ish, 'frontend', 'dist', 'index.html');
    const publicFile = join(__dirname_ish, 'public', 'index.html');
    const file = existsSync(distFile) ? distFile : publicFile;
    if (existsSync(file)) {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(readFileSync(file));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ name: 'Ponscan API', usage: '/scan?ca=0x...', endpoints: ['/scan'] }));
  }

  // Static files: serve from frontend/dist/ first, then public/
  const file = serveStatic(pathname);
  if (file) {
    const ext = extname(file);
    if (MIME[ext]) {
      res.writeHead(200, { 'Content-Type': MIME[ext] });
      return res.end(readFileSync(file));
    }
  }

  if (req.method === 'GET' && pathname === '/scan') {
    const ca = query.ca;
    if (!ca || !isAddress(ca)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid or missing CA. Usage: /scan?ca=0x...' }));
    }
    try {
      const result = await cachedScan(ca);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result, null, 2));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = process.env.PORT || 4200;
server.listen(PORT, () => console.log(`Ponscan API running on :${PORT}`));