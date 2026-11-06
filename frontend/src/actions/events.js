/* =====================================================================
   EVENT WIRING
   ===================================================================== */
import { $$ } from '../core/utils.js';
import { D, S, task } from '../core/store.js';
import { toast } from '../ui/toast.js';
import { render } from '../shell/render.js';
import { A, BLUR, DBL, IN, curProjectId, handleFiles, insertFilesInlineInDescription, readFileToRecord, stageCommentFiles } from './actions.js';

document.addEventListener(
  'click',
  e => {
    if (S.ui.suppressClick) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const el = e.target.closest('[data-a]');
    const inPop = e.target.closest('[data-pop-root]');
    if (S.ui.pop && !inPop) {
      const trig = el && (el.dataset.a === 'pop' || el.dataset.a === 'ctxBtn' || el.dataset.a === 'addFilter');
      if (!trig) {
        S.ui.pop = null;
        if (!el) {
          render();
          return;
        }
      }
    }
    if (S.ui.mention && !e.target.closest('.cbox') && !(el && el.dataset.a === 'pickMention')) {
      S.ui.mention = null;
      if (!el) render();
    }
    if (!el) return;
    if (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && el.type === 'checkbox' && el.dataset.a)) e.preventDefault();
    const fn = A[el.dataset.a];
    if (fn) {
      e.stopPropagation();
      fn(el, e);
    }
  },
  false,
);
document.addEventListener('dblclick', e => {
  const el = e.target.closest('[data-dbl]');
  if (el && DBL[el.dataset.dbl]) DBL[el.dataset.dbl](el, e);
});
document.addEventListener('contextmenu', e => {
  const el = e.target.closest('[data-ctx]');
  if (!el || e.target.closest('input,textarea,[contenteditable]')) return;
  e.preventDefault();
  S.ui.pop = { type: 'ctx', ctx: el.dataset.ctx, id: el.dataset.id, key: el.dataset.key, vid: el.dataset.vid, x: e.clientX, y: e.clientY, top: e.clientY };
  if (el.dataset.ctx === 'column') S.ui.pop.key = el.dataset.key;
  render();
});
export const isChangeEl = el => el.matches('select, input[type=checkbox], input[type=radio], input[type=file], input[type=date]');
document.addEventListener('input', e => {
  const el = e.target;
  if (!el.dataset || !el.dataset.in || isChangeEl(el)) return;
  IN[el.dataset.in]?.(el, e);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (!el.dataset || !el.dataset.in || !isChangeEl(el)) return;
  IN[el.dataset.in]?.(el, e);
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const n = f.dataset.submit;
  if (n && A[n]) A[n](f, e);
});
document.addEventListener('focusout', e => {
  const el = e.target;
  if (el?.dataset?.blur && BLUR[el.dataset.blur]) BLUR[el.dataset.blur](el);
});
document.addEventListener('mouseover', e => {
  const el = e.target.closest?.('[data-hover-i]');
  if (!el || !S.ui.palette) return;
  const i = +el.dataset.hoverI;
  if (S.ui.palette.hl === i) return;
  S.ui.palette.hl = i;
  $$('.pi.hl').forEach(x => x.classList.remove('hl'));
  el.classList.add('hl');
});

/* Global Ctrl+V / Cmd+V clipboard attachment paste support */
document.addEventListener('paste', async e => {
  const cd = e.clipboardData;
  if (!cd) return;
  const pastedFiles = [];
  if (cd.files && cd.files.length) {
    pastedFiles.push(...cd.files);
  } else if (cd.items && cd.items.length) {
    for (const item of cd.items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) pastedFiles.push(f);
      }
    }
  }
  if (!pastedFiles.length) return;
  e.preventDefault();

  // 1. Inside a description editor (#f-desc, #d-desc, or [data-desc-box])
  const descBox = e.target?.closest?.('[data-desc-box]');
  if (descBox || e.target?.id === 'f-desc' || e.target?.id === 'd-desc') {
    const targetId = e.target?.id === 'f-desc' || descBox?.dataset?.descBox === '__form' ? 'f-desc' : 'd-desc';
    await insertFilesInlineInDescription(pastedFiles, targetId);
    return;
  }

  // 2. Explicitly inside a comment box ([data-comment-box], #d-cmt, or #inbox-reply)
  const cbox = e.target?.closest?.('[data-comment-box]');
  if (cbox || e.target?.id === 'd-cmt' || e.target?.id === 'inbox-reply') {
    const tid =
      e.target?.dataset?.id ||
      cbox?.dataset?.commentBox ||
      cbox?.querySelector('[data-id]')?.dataset?.id ||
      S.ui.drawer;
    if (tid) {
      await stageCommentFiles(pastedFiles, tid);
      return;
    }
  }

  // 3. Inside the New/Edit Task Modal (any focus inside the modal) -> inline images in description & attach
  const topModal = S.ui.modals?.[S.ui.modals.length - 1];
  if (topModal && topModal.type === 'task' && S.ui.form) {
    await insertFilesInlineInDescription(pastedFiles, 'f-desc');
    return;
  }

  // 4. When a Task Drawer is open (and not focused inside the comment box) -> inline images in task description!
  if (S.ui.drawer && task(S.ui.drawer)) {
    const hasImages = pastedFiles.some(f => f.type?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(f.name || ''));
    if (hasImages || S.ui.descEdit === S.ui.drawer) {
      await insertFilesInlineInDescription(pastedFiles, 'd-desc');
    } else {
      const t = task(S.ui.drawer);
      await handleFiles(pastedFiles, { project: t.project, task: t.id });
    }
    return;
  }

  // 4. When in Inbox with a selected notification
  if (S.ui.route === 'inbox' && S.ui.inboxSel) {
    const n = D().notifs.find(x => x.id === S.ui.inboxSel);
    if (n?.task && task(n.task)) {
      await stageCommentFiles(pastedFiles, n.task);
      return;
    }
  }

  // 5. Fallback: attach to current project or primary project files
  const pid = curProjectId() || D().projects?.[0]?.id || 'p1';
  await handleFiles(pastedFiles, { project: pid });
});

addEventListener('resize', () => {
  if (S.ui.pop) {
    S.ui.pop = null;
    render();
  }
});
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (S.prefs.theme === 'system') render();
  });
} catch {
  /* not supported here; safe to skip */
}
