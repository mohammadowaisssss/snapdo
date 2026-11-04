/* ---------- small render helpers ---------- */
import { TODAY, diffD, esc, parse, relDate } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { LB, PR, PSTAT, ST } from '../core/constants.js';
import { D, mem, pColor } from '../core/store.js';

export function av(id, cls = '', tip = true) {
  const m = mem(id);
  if (!m) return `<span class="av empty ${cls}" ${tip ? 'data-tip="Unassigned"' : ''}>${ic('user', 11)}</span>`;
  const ini = m.name
    .split(' ')
    .map(x => x[0])
    .join('')
    .slice(0, 2);
  if (m.photoURL) {
    return `<span class="av ${cls}" style="--c:${m.c};overflow:hidden;padding:0" ${tip ? `data-tip="${esc(m.name)}"` : ''} aria-label="${esc(m.name)}"><img src="${esc(m.photoURL)}" alt="${esc(m.name)}" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block" onerror="this.replaceWith(document.createTextNode('${esc(ini)}'))"></span>`;
  }
  return `<span class="av ${cls}" style="--c:${m.c}" ${tip ? `data-tip="${esc(m.name)}"` : ''} aria-label="${esc(m.name)}">${ini}</span>`;
}
export function avStack(ids, max = 4, cls = 'sm') {
  const v = ids.slice(0, max);
  return `<span class="avs">${v.map(i => av(i, cls)).join('')}${ids.length > max ? `<span class="av ${cls} more" style="--c:var(--gray)">+${ids.length - max}</span>` : ''}</span>`;
}
export function stIcon(st, s = 14) {
  const c = `var(--st-${st})`;
  const r = 5.4;
  let inner = '';
  if (st === 'backlog') inner = `<circle cx="7" cy="7" r="${r}" fill="none" stroke="${c}" stroke-width="1.5" stroke-dasharray="1.9 2.1"/>`;
  else if (st === 'todo') inner = `<circle cx="7" cy="7" r="${r}" fill="none" stroke="${c}" stroke-width="1.5"/>`;
  else if (st === 'progress')
    inner = `<circle cx="7" cy="7" r="${r}" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M7 3.4A3.6 3.6 0 0 1 7 10.6Z" fill="${c}"/>`;
  else if (st === 'review')
    inner = `<circle cx="7" cy="7" r="${r}" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M7 3.4A3.6 3.6 0 1 1 3.4 7L7 7Z" fill="${c}"/>`;
  else
    inner = `<circle cx="7" cy="7" r="6.2" fill="${c}"/><path d="M4.4 7.2 6.2 9 9.7 5.3" fill="none" stroke="var(--surface)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg width="${s}" height="${s}" viewBox="0 0 14 14" aria-hidden="true" style="flex-shrink:0">${inner}</svg>`;
}
export function prIcon(p, s = 14) {
  if (p === 'urgent')
    return `<svg width="${s}" height="${s}" viewBox="0 0 14 14" aria-hidden="true" style="flex-shrink:0"><rect x="1" y="1" width="12" height="12" rx="3" fill="var(--red)"/><path d="M7 3.8v4" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="7" cy="10.1" r=".95" fill="#fff"/></svg>`;
  if (!p || p === 'none')
    return `<svg width="${s}" height="${s}" viewBox="0 0 14 14" aria-hidden="true" style="flex-shrink:0"><path d="M2.5 7h2M6 7h2M9.5 7h2" stroke="var(--text-3)" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const w = PR[p].w;
  const bar = (x, h, on) => `<rect x="${x}" y="${12 - h}" width="2.6" height="${h}" rx="1" fill="${on ? 'var(--text-2)' : 'var(--border-strong)'}"/>`;
  return `<svg width="${s}" height="${s}" viewBox="0 0 14 14" aria-hidden="true" style="flex-shrink:0">${bar(1.8, 4.5, w >= 1)}${bar(5.7, 7.5, w >= 2)}${bar(9.6, 10.5, w >= 3)}</svg>`;
}
export const stPill = st => `${stIcon(st)}<span>${ST[st].name}</span>`;
export const prPill = p => `${prIcon(p)}<span>${PR[p || 'none'].name}</span>`;
export const lbl = id => (LB[id] ? `<span class="lbl" style="--c:${LB[id].c}"><i></i>${LB[id].name}</span>` : '');
export const pIcon = (p, cls = '', s = 15) => `<span class="picon ${cls}" style="--c:${pColor(p)}">${ic(p.icon, s)}</span>`;
export const pStatus = s => `<span class="pstatus" style="--c:${PSTAT[s].c}"><i></i>${PSTAT[s].name}</span>`;
export function dueHtml(t, withIcon = true) {
  if (!t.due) return '';
  const n = diffD(parse(t.due), TODAY);
  const cls = t.status === 'done' ? '' : n < 0 ? 'over' : n <= 1 ? 'soon' : '';
  return `<span class="due ${cls}">${withIcon ? ic('calendar', 12) : ''}${relDate(t.due)}</span>`;
}
export function progBar(v, cls = '') {
  return `<span class="prog ${cls}" role="progressbar" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100"><i style="--p:${v / 100}"></i></span>`;
}
export function empty(icon, title, text, btn = '', cls = '', level = 2) {
  return `<div class="empty-state ${cls}"><div class="glyph">${ic(icon, 20)}</div><h${level} class="es-h">${esc(title)}</h${level}><p>${esc(text)}</p>${btn}</div>`;
}
export function hl(text, q) {
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}
export function fmtComment(txt) {
  let h = esc(txt);
  D().members.forEach(m => {
    h = h.split('@' + esc(m.name)).join(`<span class="mention">@${esc(m.name)}</span>`);
  });
  return h;
}
export const FT = {
  fig: { c: '#8662C9', i: 'pen-tool', n: 'Figma' },
  pdf: { c: '#C4473A', i: 'file-text', n: 'PDF' },
  zip: { c: '#6B7280', i: 'folder-archive', n: 'Archive' },
  img: { c: '#23918A', i: 'image', n: 'Image' },
  sheet: { c: '#3D8E5F', i: 'file-spreadsheet', n: 'Spreadsheet' },
  doc: { c: '#3B82C4', i: 'file-text', n: 'Document' },
  code: { c: '#C48A1E', i: 'file-code', n: 'Code' },
  other: { c: '#6B7280', i: 'file', n: 'File' },
};
export function fileType(name) {
  const e = (name.split('.').pop() || '').toLowerCase();
  if (e === 'fig') return 'fig';
  if (e === 'pdf') return 'pdf';
  if (['zip', 'rar', '7z'].includes(e)) return 'zip';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(e)) return 'img';
  if (['xlsx', 'xls', 'csv', 'numbers'].includes(e)) return 'sheet';
  if (['doc', 'docx', 'txt', 'md', 'pages', 'rtf'].includes(e)) return 'doc';
  if (['js', 'ts', 'json', 'html', 'css', 'py'].includes(e)) return 'code';
  return 'other';
}
export function fsize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return Math.round(b / 1024) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
export function filePrev(f) {
  const t = FT[f.type] || FT.other;
  let art;
  if (f.dataUrl && (f.type === 'img' || String(f.dataUrl).startsWith('data:image/'))) {
    art = `<div class="art" style="padding:0;overflow:hidden;background:var(--surface-2)"><img src="${esc(f.dataUrl)}" alt="${esc(f.name)}" style="width:100%;height:100%;object-fit:cover;display:block"></div>`;
  } else if (f.type === 'img')
    art = `<div class="art" style="padding:0;overflow:hidden;background:linear-gradient(135deg,color-mix(in srgb,${t.c} 35%,var(--surface)),color-mix(in srgb,${t.c} 10%,var(--surface)))"><svg viewBox="0 0 100 60" preserveAspectRatio="none" style="width:100%;height:100%"><path d="M0 60 L30 28 L52 46 L70 32 L100 58 L100 60Z" fill="color-mix(in srgb,${t.c} 45%,var(--surface))"/><circle cx="76" cy="16" r="7" fill="color-mix(in srgb,${t.c} 30%,var(--surface))"/></svg></div>`;
  else if (f.type === 'sheet') art = `<div class="art" style="display:grid;grid-template-columns:repeat(4,1fr);gap:3px">${'<i></i>'.repeat(20)}</div>`;
  else if (f.type === 'fig')
    art = `<div class="art" style="flex-direction:row;gap:6px"><div style="flex:1;display:flex;flex-direction:column;gap:5px"><i class="h"></i><i></i><i style="width:70%"></i><i style="height:18px;background:color-mix(in srgb,${t.c} 20%,var(--surface))"></i></div><div style="width:34%;border-radius:3px;background:color-mix(in srgb,${t.c} 14%,var(--surface))"></div></div>`;
  else if (f.type === 'zip') art = `<div style="color:${t.c}">${ic('folder-archive', 30)}</div>`;
  else art = `<div class="art"><i class="h"></i><i></i><i></i><i style="width:80%"></i><i></i><i style="width:60%"></i></div>`;
  const ext = (f.name.split('.').pop() || '').slice(0, 4);
  return `<div class="fprev">${art}<span class="ext" style="--c:${t.c}">${esc(ext)}</span></div>`;
}

export function fileFullPreview(f) {
  if (!f) return '';
  const t = FT[f.type] || FT.other;

  // 1. Uploaded image with dataUrl
  if (f.dataUrl && (f.type === 'img' || String(f.dataUrl).startsWith('data:image/'))) {
    return `<div style="background:var(--surface-2);display:flex;align-items:center;justify-content:center;min-height:280px;max-height:460px;overflow:auto;padding:16px">
      <img src="${esc(f.dataUrl)}" alt="${esc(f.name)}" style="max-width:100%;max-height:420px;object-fit:contain;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.08)">
    </div>`;
  }

  // 2. Uploaded PDF with dataUrl
  if (f.dataUrl && (f.type === 'pdf' || String(f.dataUrl).startsWith('data:application/pdf'))) {
    return `<div style="background:var(--surface-2);height:420px">
      <iframe src="${esc(f.dataUrl)}" title="${esc(f.name)}" style="width:100%;height:100%;border:none"></iframe>
    </div>`;
  }

  // 3. Uploaded text / code / markdown / CSV / JSON file with textContent
  if (f.textContent) {
    return `<div style="background:var(--surface-2);max-height:420px;overflow:auto">
      <div class="row" style="padding:8px 14px;border-bottom:1px solid var(--border);font-size:11.5px;color:var(--text-3)"><span class="mono">${esc(f.name)}</span><span class="sp"></span><span>${esc(f.size || '')}</span></div>
      <pre style="margin:0;padding:16px;font-family:var(--mono);font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;color:var(--text)"><code>${esc(f.textContent)}</code></pre>
    </div>`;
  }

  // 4. Rich interactive previews for seeded or binary workspace files
  if (f.type === 'img') {
    return `<div style="background:linear-gradient(135deg,color-mix(in srgb,${t.c} 22%,var(--surface-2)),var(--surface));padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px">
      <svg viewBox="0 0 640 360" style="width:100%;max-width:560px;border-radius:10px;border:1px solid var(--border);background:var(--surface);box-shadow:0 8px 24px rgba(0,0,0,.08)">
        <defs>
          <linearGradient id="imgg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${t.c}" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="#5A67D8" stop-opacity="0.12"/>
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill="url(#imgg)"/>
        <rect x="44" y="36" width="552" height="288" rx="12" fill="var(--surface)" stroke="var(--border)"/>
        <circle cx="72" cy="60" r="6" fill="#E5534B"/><circle cx="90" cy="60" r="6" fill="#D99B26"/><circle cx="108" cy="60" r="6" fill="#2E9E6B"/>
        <rect x="72" y="92" width="240" height="22" rx="5" fill="${t.c}" opacity="0.75"/>
        <rect x="72" y="126" width="320" height="12" rx="4" fill="var(--text-3)" opacity="0.35"/>
        <rect x="72" y="146" width="270" height="12" rx="4" fill="var(--text-3)" opacity="0.25"/>
        <rect x="72" y="182" width="110" height="32" rx="7" fill="#5A67D8"/>
        <rect x="194" y="182" width="110" height="32" rx="7" fill="var(--surface-3)"/>
        <path d="M380 280 L445 170 L500 230 L540 185 L580 280 Z" fill="${t.c}" opacity="0.35"/>
        <circle cx="520" cy="135" r="22" fill="${t.c}" opacity="0.45"/>
      </svg>
      <div class="faint" style="font-size:12px;margin-top:10px">${esc(f.name)} · High-resolution visual asset preview</div>
    </div>`;
  }

  if (f.type === 'code') {
    const sampleCode = `{\n  "file": "${f.name}",\n  "workspace": "Snapsec",\n  "tokens": {\n    "color.brand.primary": "#5A67D8",\n    "color.surface.canvas": "#FAF9F6",\n    "color.status.complete": "#2E9E6B",\n    "radius.md": "8px",\n    "font.sans": "Inter, system-ui, sans-serif"\n  }\n}`;
    return `<div style="background:var(--surface-2);max-height:420px;overflow:auto">
      <div class="row" style="padding:8px 14px;border-bottom:1px solid var(--border);font-size:11.5px;color:var(--text-3)"><span class="mono">${esc(f.name)}</span><span class="sp"></span><span>JSON / Source</span></div>
      <pre style="margin:0;padding:16px;font-family:var(--mono);font-size:12.5px;line-height:1.55;color:var(--text)"><code>${esc(sampleCode)}</code></pre>
    </div>`;
  }

  if (f.type === 'sheet') {
    return `<div style="background:var(--surface);padding:16px;overflow-x:auto">
      <div class="row" style="margin-bottom:10px;font-size:12px;color:var(--text-2)"><b>${esc(f.name)}</b><span class="sp"></span><span class="faint">Sheet 1 · 5 rows</span></div>
      <table class="perm-t" style="border:1px solid var(--border);font-size:12.5px">
        <thead><tr><th style="text-align:left;padding:8px 12px">Metric / Item</th><th style="text-align:left">Owner</th><th>Target</th><th>Actual</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td style="padding:8px 12px;font-weight:500">Enterprise conversion rate</td><td>Mohammad Owais</td><td class="num">4.8%</td><td class="num">5.2%</td><td><span class="badge green">On track</span></td></tr>
          <tr><td style="padding:8px 12px;font-weight:500">Onboarding completion</td><td>Sarah Chen</td><td class="num">82%</td><td class="num">86%</td><td><span class="badge green">On track</span></td></tr>
          <tr><td style="padding:8px 12px;font-weight:500">API p95 latency</td><td>Noah Patel</td><td class="num">&lt;120ms</td><td class="num">94ms</td><td><span class="badge green">Verified</span></td></tr>
          <tr><td style="padding:8px 12px;font-weight:500">SOC2 control coverage</td><td>Marcus Vance</td><td class="num">100%</td><td class="num">98%</td><td><span class="badge amber">In review</span></td></tr>
        </tbody>
      </table>
    </div>`;
  }

  if (f.type === 'fig') {
    return `<div style="background:var(--surface-2);padding:20px;display:flex;flex-direction:column;gap:12px;min-height:280px">
      <div class="row" style="font-size:12px;color:var(--text-2)"><span class="ftype" style="--c:${t.c};width:22px;height:22px">${ic('pen-tool', 12)}</span><b>${esc(f.name)}</b><span class="sp"></span><span class="badge">Figma Canvas · 4 Frames</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
        ${['01 · Hero & Navigation', '02 · Pricing Comparison', '03 · Mobile Breakpoints'].map(frame => `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px"><div class="faint mono" style="font-size:11px;margin-bottom:8px">${frame}</div><div style="height:110px;border-radius:6px;background:linear-gradient(180deg,color-mix(in srgb,${t.c} 15%,var(--surface-2)),var(--surface-2));display:flex;flex-direction:column;gap:6px;padding:10px"><div style="width:65%;height:10px;border-radius:3px;background:${t.c};opacity:.5"></div><div style="width:90%;height:7px;border-radius:3px;background:var(--border-strong)"></div><div style="width:50%;height:7px;border-radius:3px;background:var(--border-strong)"></div><div style="margin-top:auto;width:45%;height:18px;border-radius:4px;background:${t.c};opacity:.75"></div></div></div>`).join('')}
      </div>
    </div>`;
  }

  // Default rich document / PDF / archive preview
  return `<div style="background:var(--surface-2);padding:22px;max-height:420px;overflow:auto">
    <div style="max-width:580px;margin:0 auto;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:24px;box-shadow:0 2px 10px rgba(0,0,0,.04)">
      <div class="row" style="gap:10px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--divider)">
        <span class="ftype" style="--c:${t.c};width:30px;height:30px">${ic(t.i, 15)}</span>
        <div><div style="font-weight:600;font-size:14px">${esc(f.name)}</div><div class="faint" style="font-size:12px">${t.n} · ${esc(f.size || '')} · Snapsec Workspace Document</div></div>
      </div>
      <div style="font-size:13px;line-height:1.65;color:var(--text-2)">
        <p style="margin:0 0 10px"><b>Executive Summary</b> — This document is attached to the Snapsec workspace and synced across project tasks and team reviews.</p>
        <p style="margin:0 0 10px"><b>Key Highlights &amp; Deliverables:</b></p>
        <ul style="margin:0 0 10px;padding-left:18px">
          <li>Verified architecture requirements, security controls, and implementation milestones.</li>
          <li>Reviewed by project stakeholders with inline task traceability.</li>
          <li>Ready for download or external sharing via the action bar below.</li>
        </ul>
      </div>
    </div>
  </div>`;
}
