// Las migraciones son .sql, asi que tsc no las copia: las llevamos a dist a mano.
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'src', 'db', 'migrations');
const to = path.join(root, 'dist', 'db', 'migrations');

mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`migraciones copiadas a ${path.relative(root, to)}`);
