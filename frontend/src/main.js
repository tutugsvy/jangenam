// ===== MAIN ENTRY =====
import { doScan, showResultPage, loadPreview, scanData } from './lib/api.js';
import { renderExplorer, rescanHistory } from './lib/history.js';
import { renderPreview } from './components/render.js';
import { copyText } from './lib/utils.js';

// ===== ROUTER =====
const pages = { home: 'pageHome', explorer: 'pageExplorer', docs: 'pageDocs', about: 'pageAbout' };
function navigate() {
  const hash = location.hash.replace('#', '') || 'home';
  const pageId = pages[hash] || 'pageHome';
  Object.values(pages).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', id === pageId);
  });
  if (pageId !== 'pageHome' && scanData) {
    document.getElementById('resultPage').classList.remove('active');
  }
  document.querySelectorAll('#navLinks a').forEach(a => {
    a.classList.toggle('active', a.dataset.nav === hash);
  });
  if (hash === 'explorer') renderExplorer();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
window.addEventListener('hashchange', navigate);

// ===== TABS =====
document.getElementById('tabs').addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tab' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1)).classList.add('active');
});

// ===== SCAN TRIGGERS =====
document.getElementById('scanBtn').addEventListener('click', () => doScan(document.getElementById('scanInput').value));
document.getElementById('scanInput').addEventListener('keydown', e => { if (e.key === 'Enter') doScan(e.target.value); });

// ===== MOBILE MENU =====
document.getElementById('mobileMenu').addEventListener('click', () => {
  const links = document.getElementById('navLinks');
  links.style.display = links.style.display === 'flex' ? 'none' : 'flex';
  links.style.flexDirection = 'column';
  links.style.position = 'absolute';
  links.style.top = 'var(--nav-h)';
  links.style.left = '0';
  links.style.right = '0';
  links.style.background = 'var(--bg)';
  links.style.padding = '12px 24px';
  links.style.borderBottom = '1px solid var(--border)';
});

// ===== EXPOSE GLOBALS (used by inline onclick handlers) =====
window.copyText = copyText;
window.doScan = doScan;
window.rescanHistory = rescanHistory;

// ===== INIT =====
navigate();
// Auto-load real Pons token on landing (cached → instant after first)
renderPreview({
  name: 'Pons', symbol: 'PONS', ca: '0x39dBED3a2bd333467115dE45665cC57F813C4571', verified: true,
  dev: '0xb9f5f4ea1af1f5d3678470eb98e8fbdcadeb24b0', devIsContract: false,
  devEthBalance: '0.0806', devBalanceFormatted: '0', devWorthUsd: null,
  dex: { priceUsd: '0.2140', fdv: 151976742, liquidity: 2968896.98, volume24h: 26076422 },
  holderCount: 50,
  topHolders: [{ address: '0x000000000000000000000000000000000000dEaD', percentage: '29.01%' }],
  xHandles: ['ponsdotfamily'], ponsFee: null,
});
setTimeout(loadPreview, 100);