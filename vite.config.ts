import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { icons as lucide } from 'lucide';

/* `virtual:icons` exports only the Lucide icons the source actually names, as inline SVG markup,
   so the bundle carries ~170 icons instead of the full set. Any quoted kebab-case token in src/
   that matches a Lucide icon name is included. */
function lucideSubset() {
  const id = 'virtual:icons';
  const resolved = '\0' + id;
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : /\.(js|ts)$/.test(e.name) ? [p] : [];
    });
  const pascal = (n: string) =>
    n
      .split('-')
      .map(p => (p[0] ? p[0].toUpperCase() + p.slice(1) : ''))
      .join('');
  return {
    name: 'lucide-subset',
    resolveId: (s: string) => (s === id ? resolved : null),
    load(s: string) {
      if (s !== resolved) return null;
      const text = walk(path.resolve('src'))
        .map(f => fs.readFileSync(f, 'utf8'))
        .join('\n');
      const lucideMap = lucide as Record<string, any>;
      const names = [
        ...new Set(
          [...text.matchAll(/['"`]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)['"`]/g)].map(m => m[1]),
        ),
      ]
        .filter(n => lucideMap[pascal(n)])
        .sort();
      const out: Record<string, string> = {};
      for (const n of names) {
        let node = lucideMap[pascal(n)];
        if (node[0] === 'svg') node = node[2];
        out[n] = (node as Array<[string, Record<string, any>]>)
          .map(
            ([t, a]) =>
              `<${t} ${Object.entries(a)
                .filter(([k]) => k !== 'key')
                .map(([k, v]) => `${k}="${v}"`)
                .join(' ')}/>`,
          )
          .join('');
      }
      return `export const ICONS = ${JSON.stringify(out)};`;
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [lucideSubset()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
