// ===== API: scan + state =====
import { riskScore } from './utils.js';
import { saveHistory } from './history.js';
import { renderResult, renderPreview } from '../components/render.js';

let scanData = null;
export { scanData };

export async function doScan(ca, { silent = false } = {}) {
  ca = (ca || '').trim();
  if (!ca || !ca.startsWith('0x')) { alert('Enter a valid contract address starting with 0x'); return; }
  const overlay = document.getElementById('loadingOverlay');
  if (!silent) overlay.classList.add('active');
  try {
    const res = await fetch('/scan?ca=' + encodeURIComponent(ca));
    if (!res.ok) { const t = await res.text(); throw new Error('API error: ' + (t || res.status)); }
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    scanData = data;
    saveHistory(data);
    renderResult(data);
    showResultPage();
  } catch (e) {
    if (!silent) alert('Scan failed: ' + e.message);
    else console.error('auto-scan failed:', e.message);
  } finally {
    overlay.classList.remove('active');
  }
}

export function showResultPage() {
  document.getElementById('pageHome').classList.add('active');
  document.getElementById('resultPage').classList.add('active');
  document.getElementById('pageExplorer').classList.remove('active');
  document.getElementById('pageDocs').classList.remove('active');
  document.getElementById('pageAbout').classList.remove('active');
  document.querySelectorAll('#navLinks a').forEach(a => a.classList.remove('active'));
  // Scroll straight to the result (token header) so the user sees it immediately
  const target = document.getElementById('tokenHeader');
  setTimeout(() => {
    if (target) {
      const y = target.getBoundingClientRect().top + window.scrollY - 84;
      window.scrollTo({ top: y, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, 50);
  history.replaceState(null, '', '#home');
}

export async function loadPreview() {
  try {
    const res = await fetch('/scan?ca=' + encodeURIComponent('0x39dBED3a2bd333467115dE45665cC57F813C4571'));
    if (!res.ok) return;
    const d = await res.json();
    if (!d.error && d.name) renderPreview(d);
  } catch { /* fallback preview already shown */ }
}