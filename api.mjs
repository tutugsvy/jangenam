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

const client = createPublicClient({ transport: http(RH) });

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

  // 1. Token basics
  const [nameHex, symHex, decHex, supplyHex] = await Promise.all([
    call(ca, S.name), call(ca, S.symbol),
    call(ca, S.decimals), call(ca, S.totalSupply),
  ]);
  result.name = decodeString(nameHex);
  result.symbol = decodeString(symHex);
  result.decimals = decodeUint(decHex);
  result.totalSupply = decodeUint(supplyHex);

  // 2. Code size
  const code = await getCode(ca);
  result.codeSize = code ? (code.length - 2) / 2 : 0;
  result.hasCode = (result.codeSize || 0) > 0;

  // 3. Blockscout token info
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

  // 4. Smart contract verified
  result.verified = contract?.is_verified || false;
  result.implementation = contract?.implementation?.address || null;

  // 5. Deployer / Dev
  const creationInfo = creation;
  let dev = null;
  let devLabel = 'unknown';

  // Collect candidates: Pons v2 deployer, Blockscout creator, mint-log first minter
  const ponsDeployerAddr = await ponsDeployer(ca);
  const deployInfo = await findDeployBlock(ca, creationInfo);

  const candidates = [];
  if (ponsDeployerAddr) candidates.push({ addr: ponsDeployerAddr, label: 'pons-v2-deployer' });
  if (creationInfo?.contractCreator) {
    candidates.push({ addr: creationInfo.contractCreator, label: creationInfo.creatorImplementationHash ? 'factory' : 'eoa-creator' });
  }
  if (deployInfo?.firstMinter && !candidates.some(c => c.addr.toLowerCase() === deployInfo.firstMinter.toLowerCase())) {
    candidates.push({ addr: deployInfo.firstMinter, label: 'first-minter' });
  }

  // Pick the best candidate: prefer EOA with actual token balance, then any EOA, then first
  let best = null;
  for (const c of candidates) {
    const code = await getCode(c.addr);
    const isContract = code && code.length > 4;
    const balHex = await call(ca, S.balanceOf, c.addr);
    const bal = balHex ? decodeUint(balHex) : null;
    const balNum = bal ? BigInt(bal) : 0n;
    const score = (!isContract ? 100 : 0) + (balNum > 0n ? 50 : 0) + (balNum > 0n ? Math.min(50, Number(balNum) > 0 ? 20 : 0) : 0);
    if (!best || score > best.score) best = { ...c, score, isContract, bal };
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

  // Dev balance + ETH balance
  if (dev) {
    // Dev balance formatted (no precision loss)
    result.devBalanceFormatted = result.devBalance != null ? formatTokenAmount(result.devBalance, result.decimals) : null;
    // Dev ETH balance
    const ethBal = await client.request({ method: 'eth_getBalance', params: [dev, 'latest'] });
    result.devEthBalance = formatTokenAmount(ethBal, 18);
  }

  // 6. Top holders
  let holders = await bsHolders(ca);
  let holdersV1 = null;
  if (!holders) {
    holdersV1 = await bsHoldersV1(ca);
  }
  const holderList = holders || holdersV1 || [];
  if (holderList.length) {
    result.topHolders = holderList.slice(0, 10).map(h => ({
      address: h.address?.hash || h.address || h,
      value: h.value,
      percentage: result.totalSupply && h.value ?
        formatTokenAmount(BigInt(h.value) * 10000n / BigInt(result.totalSupply) * 100n, 4) + '%' : null,
    }));
    result.holderCount = holderList.length;
  }

  // 7. Pons fees
  const fee = await ponsFee(ca);
  result.ponsFee = fee;

  // 8. Uniswap V2 pair
  const pair = await v2Pair(ca);
  result.v2Pair = pair;

  // 9. DexScreener
  result.dex = await dexScreener(ca);

  // 10. X handle search
  result.xHandles = await searchX(ca, result.symbol);

  // 11. Token logo (from Pons launchpad > Blockscout > DexScreener)
  const ponsIcon = await ponsLogo(ca);
  result.tokenIcon = ponsIcon || result.blockscout?.iconUrl || null;

  // 12. Dev funding trace + dev sell detection + dev USD worth
  if (dev) {
    result.devFunding = await traceFunding(dev);
    const price = result.dex?.priceUsd ? parseFloat(result.dex.priceUsd) : null;
    // Dev USD worth
    if (result.devBalanceFormatted != null && price != null) {
      result.devWorthUsd = '$' + (Number(result.devBalanceFormatted) * price).toFixed(2);
    }
    result.devActivity = await traceDevActivity(ca, dev, Number(result.decimals || 18), price, result.symbol);
  }

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
      const usd = priceUsd ? Number(val) * Number(priceUsd) : null;
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

// Dev funding trace — check where the dev wallet got its first ETH
async function traceFunding(dev) {
  try {
    // Use Blockscout v1 txlist to find earliest incoming txs
    const res = await bsFetch(`${BLOCKSCOUT}?module=account&action=txlist&address=${dev}&sort=asc&limit=30`);
    const json = await res.json();
    if (json.status !== '1' || !Array.isArray(json.result)) return null;

    const txs = json.result;
    const incoming = txs.filter(t =>
      t.to && t.to.toLowerCase() === dev.toLowerCase() && t.isError === '0'
    ).slice(0, 10);

    if (!incoming.length) {
      // Try internal txs
      const intRes = await bsFetch(`${BLOCKSCOUT}?module=account&action=txlistinternal&address=${dev}&sort=asc&limit=20`);
      const intJson = await intRes.json();
      if (intJson.status === '1' && Array.isArray(intJson.result)) {
        return {
          fundedBy: 'internal-tx',
          totalIncomingTxs: intJson.result.filter(t => t.isError === '0').length,
          firstFrom: intJson.result[0]?.from || null,
          firstValue: intJson.result[0]?.value || null,
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
      // Classify the first funder
      firstFunder: incoming[0].from,
      firstFunderNote: 'first ETH inflow to dev wallet',
    };
  } catch { return null; }
}
const server = createServer(async (req, res) => {
  const { pathname, query } = parse(req.url, true);
  res.setHeader('Access-Control-Allow-Origin', '*');

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
    const file = join(__dirname_ish, 'public', 'index.html');
    if (existsSync(file)) {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(readFileSync(file));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ name: 'Ponscan API', usage: '/scan?ca=0x...', endpoints: ['/scan'] }));
  }

  if (req.method === 'GET' && pathname.startsWith('/public/')) {
    const file = join(__dirname_ish, 'public', pathname.slice(8));
    const ext = extname(file);
    if (existsSync(file) && MIME[ext]) {
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
      const result = await scan(getAddress(ca));
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