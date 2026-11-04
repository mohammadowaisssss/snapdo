/* ---------- icons: inlined Lucide subset (src/00-icons.js), rendered to inline svg ---------- */
import { ICONS } from 'virtual:icons';
import { esc } from './utils.js';

export const _icCache = {};
export function ic(name, size = 16, cls = '') {
  const k = name + '|' + size + '|' + cls;
  if (_icCache[k]) return _icCache[k];
  const inner = ICONS[name] || '<rect x="5" y="5" width="14" height="14" rx="3"/>';
  return (_icCache[k] =
    `<svg class="i ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`);
}

/* Official Snapsec SVG Logo (https://suite.snapsec.co/media/logos/snapsec.svg) */
export const SNAPSEC_PATHS = `<path d="M20.422 14.6776C18.4382 14.6776 16.8301 13.0577 16.8301 11.0595C16.8301 9.06127 18.4382 7.44138 20.422 7.44138C22.4058 7.44138 24.0139 9.06127 24.0139 11.0595C24.0139 13.0577 22.4058 14.6776 20.422 14.6776Z" fill="url(#snapsec_grad)"/><path d="M22.1413 11.8485C22.1413 14.0541 21.492 16.2101 20.2756 18.044C19.0591 19.8778 17.3301 21.3071 15.3072 22.1511C13.2843 22.9952 11.0584 23.216 8.91088 22.7857C6.76339 22.3554 4.79078 21.2934 3.24253 19.7338C1.69427 18.1742 0.639889 16.1873 0.212725 14.0241C-0.214439 11.8609 0.00479648 9.61872 0.842708 7.58106C1.68062 5.5434 3.09957 3.80178 4.92013 2.57644C6.74069 1.35111 8.88109 0.697083 11.0707 0.697083V4.6138C9.65013 4.6138 8.2615 5.03811 7.08038 5.83307C5.89925 6.62804 4.97867 7.75795 4.43506 9.07993C3.89145 10.4019 3.74922 11.8566 4.02635 13.26C4.30348 14.6634 4.98753 15.9525 5.99199 16.9643C6.99646 17.9761 8.27623 18.6651 9.66946 18.9443C11.0627 19.2234 12.5068 19.0801 13.8192 18.5326C15.1316 17.985 16.2533 17.0577 17.0425 15.8679C17.8317 14.6782 18.253 13.2794 18.253 11.8485H22.1413Z" fill="url(#snapsec_grad)"/><path d="M11.578 8.32236C13.5618 8.32236 15.1699 9.94225 15.1699 11.9405C15.1699 13.9387 13.5618 15.5586 11.578 15.5586C9.59424 15.5586 7.98608 13.9387 7.98608 11.9405C7.98608 9.94225 9.59424 8.32236 11.578 8.32236Z" fill="url(#snapsec_grad)"/><path d="M9.85869 11.1515C9.85869 8.94591 10.508 6.78989 11.7244 4.95604C12.9409 3.1222 14.6699 1.69289 16.6928 0.848859C18.7157 0.00483197 20.9416 -0.216004 23.0891 0.214277C25.2366 0.644558 27.2092 1.70663 28.7575 3.26619C30.3057 4.82575 31.3601 6.81275 31.7873 8.97592C32.2144 11.1391 31.9952 13.3813 31.1573 15.4189C30.3194 17.4566 28.9004 19.1982 27.0799 20.4236C25.2593 21.6489 23.1189 22.3029 20.9293 22.3029V18.3862C22.3499 18.3862 23.7385 17.9619 24.9196 17.1669C26.1007 16.372 27.0213 15.2421 27.5649 13.9201C28.1086 12.5981 28.2508 11.1434 27.9737 9.74003C27.6965 8.33663 27.0125 7.04752 26.008 6.03573C25.0035 5.02393 23.7238 4.33489 22.3305 4.05574C20.9373 3.77658 19.4932 3.91985 18.1808 4.46743C16.8684 5.01501 15.7467 5.94231 14.9575 7.13206C14.1683 8.3218 13.747 9.72056 13.747 11.1515L9.85869 11.1515Z" fill="url(#snapsec_grad)"/><defs><linearGradient id="snapsec_grad" x1="16" y1="0" x2="16" y2="23" gradientUnits="userSpaceOnUse"><stop stop-color="#0FD3FE"/><stop offset="0.906" stop-color="#3561F6"/></linearGradient></defs>`;

export const LOGO = (h = 22) => {
  const w = Math.round(h * (32 / 23));
  return `<span class="logo" style="display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:${Math.round(h * 0.78)}px;letter-spacing:-0.02em;color:currentColor" role="img" aria-label="Snapsec"><svg width="${w}" height="${h}" viewBox="0 0 32 23" fill="none" aria-hidden="true">${SNAPSEC_PATHS}</svg><span>Snapsec</span></span>`;
};

export const MARK = (px = 22) => {
  const innerW = Math.round(px * 0.78);
  const innerH = Math.round(innerW * (23 / 32));
  return `<span style="width:${px}px;height:${px}px;display:inline-grid;place-items:center;background:#0F172A;border-radius:${Math.max(4, Math.round(px * 0.24))}px"><svg width="${innerW}" height="${innerH}" viewBox="0 0 32 23" fill="none" aria-hidden="true">${SNAPSEC_PATHS}</svg></span>`;
};

export function wsLogo(w, px = 22) {
  return w && w.brand
    ? `<span class="ws-logo brand" style="width:${px}px;height:${px}px;background:transparent">${MARK(px)}</span>`
    : `<span class="ws-logo" style="--c:${w.c};width:${px}px;height:${px}px;font-size:${Math.max(9, Math.round(px * 0.46))}px">${esc(w.name[0])}</span>`;
}
