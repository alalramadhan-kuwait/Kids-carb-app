import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pkg from './package.json';

/* A phone that added the app to its home screen keeps the page it first loaded. Each build gets an
   id, written into the bundle and into dist/version.json; the running app compares the two and
   offers a reload when they differ. */
const BUILD_ID = `${pkg.version}-${Date.now().toString(36)}`;

function versionFile(): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    writeBundle(options) {
      writeFileSync(resolve(options.dir ?? 'dist', 'version.json'), JSON.stringify({ version: pkg.version, build: BUILD_ID }));
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFile()],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_ID__: JSON.stringify(BUILD_ID) },
});
