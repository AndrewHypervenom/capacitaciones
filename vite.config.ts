import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Identificador único de esta compilación. Se inyecta en el bundle y se
// escribe también en dist/version.json para poder detectar despliegues nuevos.
const buildId = Date.now().toString();

// Escribe dist/version.json al terminar el build, con el mismo buildId que
// quedó embebido en el código (__BUILD_ID__).
function versionFilePlugin(): Plugin {
  return {
    name: 'write-version-file',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, 'version.json'),
        JSON.stringify({ version: buildId }),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFilePlugin()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
  },
});
