import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { icons as lucide } from 'lucide';

function lucideSubset(rootDir: string) {
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
      const srcDir = path.resolve(rootDir, 'src');
      const text = (fs.existsSync(srcDir) ? walk(srcDir) : [])
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
  const rootDir = typeof import.meta.dirname === 'string' ? import.meta.dirname : path.resolve();
  const backendTarget = process.env.BACKEND_URL || 'http://localhost:5000';
  return {
    base: '/',
    plugins: [lucideSubset(rootDir)],
    resolve: {
      alias: {
        '@': rootDir,
      },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      chunkSizeWarningLimit: 1500,
    },
    server: {
      port: Number(process.env.PORT || 4000),
      host: '0.0.0.0',
      allowedHosts: true as const,
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: Number(process.env.PORT || 4000),
      host: '0.0.0.0',
      allowedHosts: true as const,
    },
  };
});
