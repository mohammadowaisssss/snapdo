import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { icons as lucide } from 'lucide';

/* `virtual:icons` exports only the Lucide icons the source actually names, as inline SVG markup,
   so the bundle carries ~170 icons instead of the full set. Any quoted kebab-case token in frontend/src/
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
      const scanDir = fs.existsSync(path.resolve('frontend/src'))
        ? path.resolve('frontend/src')
        : fs.existsSync(path.resolve('src'))
          ? path.resolve('src')
          : null;
      const text = (scanDir && fs.existsSync(scanDir) ? walk(scanDir) : [])
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
  const frontendDir = path.resolve('frontend');
  return {
    root: frontendDir,
    base: '/',
    plugins: [lucideSubset()],
    resolve: {
      alias: {
        '@': frontendDir,
      },
    },
    build: {
      outDir: path.resolve('dist'),
      emptyOutDir: true,
      assetsDir: 'assets',
      chunkSizeWarningLimit: 1500,
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true as const,
    },
  };
});
