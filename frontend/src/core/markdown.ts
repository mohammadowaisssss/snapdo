/* =====================================================================
   MARKDOWN ENGINE: Full GitHub-Flavored Markdown (GFM) parser, inline
   formatter, @mention & task-key linker, and editor toolbar helper.
   ===================================================================== */

export interface MarkdownOptions {
  inline?: boolean;
  members?: Array<{ id?: string; name: string }>;
  tasks?: Array<{ id: string; key: string; title?: string }>;
}

const escapeHtml = (s: string): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);

/**
 * Normalizes legacy seeded HTML tags (e.g. <p>, <ul>, <li>, <code>, <h4>, <b>, <em>)
 * into Markdown so mixed HTML + Markdown descriptions render uniformly and safely.
 */
export function normalizeHtmlToMarkdown(raw: string): string {
  const s = String(raw ?? '');
  if (!/<(p|ul|ol|li|code|strong|b|em|i|h[1-6]|br|a|blockquote|pre|del)\b/i.test(s)) {
    return s;
  }
  return s
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl, inner) => `\n${'#'.repeat(Number(lvl))} ${inner.trim()}\n`)
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, inner) => `\n\`\`\`\n${inner}\n\`\`\`\n`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, '~~$1~~')
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) =>
      inner
        .trim()
        .split('\n')
        .map((l: string) => `> ${l}`)
        .join('\n'),
    )
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) =>
      '\n' +
      inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, item: string) => `- ${item.trim()}\n`) +
      '\n',
    )
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
      let idx = 1;
      return (
        '\n' +
        inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, item: string) => `${idx++}. ${item.trim()}\n`) +
        '\n'
      );
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/?p[^>]*>/gi, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

export function renderMarkdown(rawInput: string, opts: MarkdownOptions = {}): string {
  if (!rawInput) return '';
  const normalized = normalizeHtmlToMarkdown(String(rawInput));
  if (!normalized.trim()) return '';

  const placeholders: string[] = [];
  const hold = (html: string): string => {
    const token = `\u0000MD${placeholders.length}\u0000`;
    placeholders.push(html);
    return token;
  };

  let text = normalized.replace(/\r\n/g, '\n');

  // 1. Extract fenced code blocks ```lang ... ```
  text = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const cleanCode = escapeHtml(String(code).replace(/\n$/, ''));
    if (opts.inline) {
      return hold(`<code class="md-code">${cleanCode}</code>`);
    }
    const langBadge = lang ? `<div class="md-code-h"><span>${escapeHtml(lang)}</span></div>` : '';
    return hold(`<div class="md-codeblock">${langBadge}<pre class="md-pre"><code>${cleanCode}</code></pre></div>`);
  });

  // 2. Extract inline code `...`
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    return hold(`<code class="md-code">${escapeHtml(code)}</code>`);
  });

  // Escape remaining HTML characters before inline & block formatting
  text = escapeHtml(text);

  // 3. Inline formatting helper
  const formatInline = (line: string): string => {
    let s = line;

    // Images ![alt](url) — strictly allow https://, http://, /, or safe raster base64 data:image/(png|jpeg|jpg|gif|webp)
    s = s.replace(
      /!\[([^\]]*)\]\(((?:https?:\/\/|\/(?!\/)|data:image\/(?:png|jpeg|jpg|gif|webp);base64,)[^\s)"'<>]+)\)/gi,
      (full, alt, url) => {
        if (/&(quot|#39|lt|gt);/i.test(url)) return full;
        return hold(`<img class="md-img" src="${url}" alt="${alt}" loading="lazy">`);
      },
    );

    // Links [label](url) — strictly allow https://, http://, mailto:, or relative /path (never javascript:, data:, vbscript:, or //)
    s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:|\/(?!\/))[^\s)"'<>]+)\)/gi, (full, label, url) => {
      if (/&(quot|#39|lt|gt);/i.test(url)) return full;
      const ext = /^https?:\/\//i.test(url);
      return hold(
        `<a class="md-link" href="${url}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`,
      );
    });

    // Bare URLs
    s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)"']+)/g, (full, pre, url) => {
      if (/&(quot|#39|lt|gt);/i.test(url)) return full;
      return `${pre}${hold(`<a class="md-link" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)}`;
    });

    // Bold + Italic ***text***
    s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    // Bold **text** or __text__
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    // Italic *text* or _text_
    s = s.replace(/(^|[^*])\*([^*\s][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[\s(])_([^_\s][^_\n]*?)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    // Strikethrough ~~text~~
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

    // @Mentions
    if (opts.members && opts.members.length) {
      opts.members.forEach(m => {
        if (!m?.name) return;
        const escapedName = escapeHtml(m.name);
        if (s.includes('@' + escapedName)) {
          s = s.split('@' + escapedName).join(hold(`<span class="mention">@${escapedName}</span>`));
        }
      });
    }

    // Generic @word mention fallback if not already matched
    s = s.replace(/(^|\s)@([A-Z][a-zA-Z0-9_-]+(?:\s[A-Z][a-zA-Z0-9_-]+)?)/g, (match, pre, name) => {
      if (!opts.members?.length || opts.members.some(m => m.name.toLowerCase() === name.toLowerCase())) {
        return `${pre}${hold(`<span class="mention">@${name}</span>`)}`;
      }
      return match;
    });

    // Task keys (e.g. WEB-101)
    if (opts.tasks && opts.tasks.length && !opts.inline) {
      s = s.replace(/\b([A-Z]{2,6}-\d{1,5})\b/g, (full, key) => {
        const found = opts.tasks?.find(t => t.key === key);
        if (!found) return full;
        return hold(
          `<button type="button" class="md-task-ref mono" data-a="openTask" data-id="${escapeHtml(found.id)}">${escapeHtml(key)}</button>`,
        );
      });
    }

    return s;
  };

  if (opts.inline) {
    let inlineOut = formatInline(text.replace(/\n+/g, ' ').replace(/^#{1,6}\s+/gm, ''));
    placeholders.forEach((html, idx) => {
      inlineOut = inlineOut.split(`\u0000MD${idx}\u0000`).join(html);
    });
    return inlineOut;
  }

  // 4. Block-level parsing
  const lines = text.split('\n');
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Standalone placeholder block (e.g. fenced code block)
    if (/^\u0000MD\d+\u0000$/.test(trimmed)) {
      blocks.push(trimmed);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push('<hr class="md-hr">');
      i++;
      continue;
    }

    // Heading # .. ######
    const hMatch = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      blocks.push(`<h${level} class="md-h md-h${level}">${formatInline(hMatch[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // GFM Table
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])
    ) {
      const parseRow = (r: string) =>
        r
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map(c => formatInline(c.trim()));
      const headers = parseRow(lines[i]);
      i += 2; // skip header & separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim() !== '') {
        rows.push(parseRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>`;
      const tbody = rows.length
        ? `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`
        : '';
      blocks.push(`<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`);
      continue;
    }

    // Blockquote (> ...)
    if (/^\s*&gt;\s?/.test(line)) {
      const qLines: string[] = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        qLines.push(formatInline(lines[i].replace(/^\s*&gt;\s?/, '')));
        i++;
      }
      blocks.push(`<blockquote class="md-quote">${qLines.join('<br>')}</blockquote>`);
      continue;
    }

    // Task Checklist (- [ ] or - [x])
    if (/^\s*[-*+]\s+\[([ xX])\]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+\[([ xX])\]\s+/.test(lines[i])) {
        const m = lines[i].match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/)!;
        const checked = m[1].toLowerCase() === 'x';
        items.push(
          `<li class="md-task-item md-check-item ${checked ? 'done' : ''}"><span class="md-cb md-box ${checked ? 'on' : ''}" aria-hidden="true">${checked ? '✓' : ''}</span><span class="${checked ? 'md-done-txt' : ''}">${formatInline(m[2])}</span></li>`,
        );
        i++;
      }
      blocks.push(`<ul class="md-checklist">${items.join('')}</ul>`);
      continue;
    }

    // Unordered list (- or * or +)
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]) && !/^\s*[-*+]\s+\[([ xX])\]\s+/.test(lines[i])) {
        items.push(`<li>${formatInline(lines[i].replace(/^\s*[-*+]\s+/, ''))}</li>`);
        i++;
      }
      blocks.push(`<ul class="md-ul">${items.join('')}</ul>`);
      continue;
    }

    // Ordered list (1. 2. ...)
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${formatInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`);
        i++;
      }
      blocks.push(`<ol class="md-ol">${items.join('')}</ol>`);
      continue;
    }

    // Standard Paragraph
    const pLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\u0000MD\d+\u0000$/.test(lines[i].trim()) &&
      !/^(?:-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim()) &&
      !/^\s*#{1,6}\s+/.test(lines[i]) &&
      !/^\s*&gt;\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      pLines.push(formatInline(lines[i]));
      i++;
    }
    blocks.push(`<p class="md-p">${pLines.join('<br>')}</p>`);
  }

  let out = blocks.join('');
  placeholders.forEach((html, idx) => {
    out = out.split(`\u0000MD${idx}\u0000`).join(html);
  });
  return out;
}

/**
 * Applies a Markdown formatting command (bold, italic, strike, code, codeblock,
 * heading, quote, ul, ol, checklist, link) to a textarea value and selection range.
 */
export function applyMarkdownCommand(
  value: string,
  start: number,
  end: number,
  cmd: string,
): { text: string; value: string; selectionStart: number; selectionEnd: number } {
  const before = value.slice(0, start);
  const selected = value.slice(start, end);
  const after = value.slice(end);

  const wrap = (prefix: string, suffix: string, placeholder: string) => {
    const inner = selected || placeholder;
    const text = before + prefix + inner + suffix + after;
    const s0 = start + prefix.length;
    const s1 = s0 + inner.length;
    return { text, value: text, selectionStart: s0, selectionEnd: s1 };
  };

  const prefixLines = (prefix: string, placeholder: string) => {
    const inner = selected || placeholder;
    const needLeadingNewline = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
    const formatted = inner
      .split('\n')
      .map((l, idx) => (prefix === '1. ' ? `${idx + 1}. ${l}` : `${prefix}${l}`))
      .join('\n');
    const text = before + needLeadingNewline + formatted + after;
    const s0 = start + needLeadingNewline.length + prefix.length;
    const s1 = start + needLeadingNewline.length + formatted.length;
    return { text, value: text, selectionStart: s0, selectionEnd: s1 };
  };

  switch (cmd) {
    case 'bold':
      return wrap('**', '**', 'bold text');
    case 'italic':
      return wrap('*', '*', 'italic text');
    case 'strike':
      return wrap('~~', '~~', 'strikethrough');
    case 'code':
      return wrap('`', '`', 'code');
    case 'codeblock':
      return wrap('\n```\n', '\n```\n', 'const x = true;');
    case 'heading':
      return prefixLines('### ', 'Heading');
    case 'quote':
      return prefixLines('> ', 'Quoted text');
    case 'ul':
      return prefixLines('- ', 'List item');
    case 'ol':
      return prefixLines('1. ', 'List item');
    case 'checklist':
      return prefixLines('- [ ] ', 'Task item');
    case 'link': {
      const isUrl = /^https?:\/\//.test(selected);
      if (isUrl) {
        return wrap('[Link title](', ')', selected);
      }
      return wrap('[', '](https://snapsec.co)', selected || 'link text');
    }
    default:
      return { text: value, value, selectionStart: start, selectionEnd: end };
  }
}
