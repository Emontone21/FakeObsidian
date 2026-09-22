/**
 * Exporta el vault completo como .md validos para Obsidian.
 * Uso: npm run export [-- carpeta-destino]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createApp } from './bootstrap.js';

function main(): void {
  const app = createApp();
  const target = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.join(app.config.dataDir, 'exports', new Date().toISOString().slice(0, 10));

  const files = app.services.exportVault();
  for (const file of files) {
    const full = path.join(target, file.path);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, file.content, 'utf8');
  }

  console.log(`Exportadas ${files.length} notas a ${target}`);
  console.log('Podes abrir esa carpeta directamente como vault de Obsidian.');
  app.close();
}

main();
