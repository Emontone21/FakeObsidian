# Bitácora

Base de conocimiento personal para conversaciones de Claude. Corre en tu equipo, los
datos viven en una base SQLite en `./data/`, y cada nota se puede exportar como `.md`
válido para Obsidian.

Claude se conecta por **MCP** y guarda el chat con una plantilla fija: contexto,
decisiones, pendientes, referencias. Las notas se enlazan entre sí con `[[wikilinks]]`
y forman un grafo.

## Estado

| Fase | Qué incluye | Estado |
|---|---|---|
| 1 | Esquema, migraciones, servicios, parsers, MCP por stdio con 12 tools, tests | **Lista** |
| 2 | Interfaz web: listado, nota, pendientes, carpetas/tags, ajustes, grafo | **Lista** |
| 3 | Streamable HTTP + OAuth 2.1 + Cloudflare Tunnel (conector en claude.ai) | Pendiente |
| 4 | Importación del export de claude.ai | Pendiente |

Hoy ya podés conectar Claude Desktop o Claude Code y guardar, buscar, leer, actualizar
y enlazar notas, y abrir la web en `http://127.0.0.1:8787` para leerlas, editarlas y
ver el grafo. El acceso desde claude.ai (web y celular) llega en la fase 3.

## Requisitos (Windows)

- **Node.js 20 o superior** (probado con 22). Instalador desde [nodejs.org](https://nodejs.org).
- **Git**, para clonar el repo.
- `better-sqlite3` trae binarios precompilados para Node 20, 22 y 24, así que
  normalmente **no** hace falta compilar nada. Si `npm install` falla compilando,
  instalá las [Build Tools de Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  con la carga de trabajo "Desarrollo para escritorio con C++" y volvé a intentar.

## Instalación

Abrí PowerShell y corré, uno por uno:

```powershell
cd C:\Users\<usuario>
git clone <url-del-repo> bitacora
cd bitacora
npm install
npm run build
npm run migrate
npm run seed
```

- `npm run migrate` crea `data\bitacora.db` con el esquema y las nueve carpetas
  iniciales (`I+D`, `Regulatorios`, `Calidad`, `Farmacovigilancia`, `Produccion`,
  `Comercial`, `Marketing`, `TI`, `General`).
- `npm run seed` carga 14 notas de ejemplo enlazadas entre sí, para ver el grafo con
  contenido. Es opcional y no pisa notas existentes.

Copiá `.env.example` a `.env` si querés cambiar algo. Todos los valores tienen un
default razonable, así que podés saltear este paso:

```powershell
Copy-Item .env.example .env
notepad .env
```

## Levantar la web

```powershell
npm start
```

Abrí `http://127.0.0.1:8787`. La primera vez te va a pedir que definas la contraseña
con la que vas a entrar; queda guardada hasheada en la base, y después la cambiás desde
Ajustes. Si preferís dejarla escrita de entrada, poné `BITACORA_PASSWORD` en el `.env`
antes del primer arranque.

El servidor **escucha solo en `127.0.0.1`** y rechaza cualquier request cuyo header
`Host` no sea el loopback, así que no queda expuesto en la red aunque tengas el firewall
abierto. Todo lo que no sea el login exige sesión.

### Qué tiene la web

| Pantalla | Qué hace |
|---|---|
| `/` | Notas en tarjetas, buscador de texto completo, filtros por carpeta, tags y fechas, orden por fecha, título o relevancia |
| `/nota/:id` | Markdown renderizado con `[[wikilinks]]` clickeables (los no resueltos en gris), frontmatter, backlinks, enlaces salientes, grafo local de 1 o 2 saltos, editor con vista previa y borrado con confirmación |
| `/grafo` | Grafo global: física de fuerzas, zoom, arrastre, resaltado de vecinos al pasar el mouse, buscador que resalta, tags como nodos, enlaces sin resolver, aristas por tag compartido, filtros y sliders de repulsión, distancia y fuerza central |
| `/pendientes` | Todos los pendientes, agrupables por responsable, nota o fecha; el checkbox reescribe la línea en la nota |
| `/carpetas` y `/tags` | Renombrar, fusionar y borrar; renombrar una carpeta mueve sus notas y fusionar tags no duplica notas |
| `/ajustes` | Exportar el vault como zip, bajar el backup de la base, cambiar contraseña, tema claro/oscuro y estado del vault |

Tema oscuro por defecto, claro opcional desde la barra lateral o Ajustes.

Los checkboxes son de verdad: tocar uno en la nota o en el tablero reescribe el
`- [ ]` como `- [x]` **en el cuerpo de la nota**. No hay un estado paralelo que se
pueda desincronizar.

### Dejarlo corriendo al iniciar Windows

La forma más simple, sin dependencias extra, es el Programador de tareas:

1. Abrí **Programador de tareas** → *Crear tarea…* (no "tarea básica").
2. **General**: nombre `Bitacora`, marcá *Ejecutar tanto si el usuario inició sesión
   como si no* solo si querés que corra sin tu sesión; para uso personal alcanza con
   *Ejecutar solo cuando el usuario haya iniciado sesión*.
3. **Desencadenadores**: nuevo → *Al iniciar sesión*.
4. **Acciones**: nuevo → *Iniciar un programa*.
   - Programa: `C:\Program Files\nodejs\node.exe`
   - Argumentos: `server\dist\index.js`
   - Iniciar en: `C:\Users\<usuario>\bitacora`
5. **Condiciones**: destildá *Iniciar la tarea solo si el equipo está conectado a la
   corriente alterna*, si es una notebook.

El "Iniciar en" es lo que más se olvida: sin eso el servidor no encuentra `data\`.

Si preferís pm2:

```powershell
npm install -g pm2 pm2-windows-startup
pm2-startup install
pm2 start server\dist\index.js --name bitacora
pm2 save
```

## Probar que anda

```powershell
npm test
```

143 tests: parsers de wikilinks, secciones y pendientes, render de la plantilla,
servicios, hash de contraseña y freno de fuerza bruta, la API REST completa, y los
tools MCP a través de un cliente MCP real.

### Con MCP Inspector

```powershell
npm run inspector
```

Abre el Inspector oficial en el navegador contra el servidor por stdio. Desde ahí podés
listar los tools, ver sus esquemas y ejecutarlos a mano.

También funciona sin navegador:

```powershell
npx -y @modelcontextprotocol/inspector --cli node server\dist\mcp\stdio.js --method tools/list
```

> **Ojo:** el Inspector **no** le pasa al servidor las variables de entorno de tu
> terminal (el SDK filtra el entorno al lanzar un proceso stdio). Si querés apuntarlo a
> otra base, poné el valor en el `.env` del repo, no con `set`/`$env:`.

## Conectar a Claude Desktop

Editá `%APPDATA%\Claude\claude_desktop_config.json` (si no existe, crealo):

```json
{
  "mcpServers": {
    "bitacora": {
      "command": "node",
      "args": ["C:\\Users\\<usuario>\\bitacora\\server\\dist\\mcp\\stdio.js"],
      "env": {
        "BITACORA_TZ": "America/Montevideo"
      }
    }
  }
}
```

Tres cosas que importan:

1. **Ruta absoluta** al `stdio.js` compilado, con **barras invertidas dobles**. Si no
   corriste `npm run build`, ese archivo no existe.
2. Si `node` no está en el PATH del usuario, poné la ruta completa en `command`
   (`"C:\\Program Files\\nodejs\\node.exe"`).
3. Las variables van en el bloque `env` del JSON: el cliente MCP **no** hereda las
   variables de tu terminal. Alternativamente, dejalas en el `.env` del repo, que el
   servidor lee solo.

Reiniciá Claude Desktop. Bitácora aparece en el menú de herramientas, y el prompt
**"guardar-conversacion"** queda disponible en el menú de prompts del conector: con eso
solo ya podés archivar un chat sin instalar nada más.

## Conectar a Claude Code

```powershell
claude mcp add bitacora -- node C:\Users\<usuario>\bitacora\server\dist\mcp\stdio.js
```

Verificá con `claude mcp list`.

## Instalar la skill

El repo trae `skills\guardar-en-bitacora\`, que le enseña a Claude cuándo y cómo
archivar una conversación (incluido cuándo ofrecerlo sin que se lo pidan).

Para **Claude Code**, copiala a tu carpeta de skills:

```powershell
Copy-Item -Recurse skills\guardar-en-bitacora "$env:USERPROFILE\.claude\skills\"
```

Para **Claude Desktop**, agregala desde la configuración de la aplicación, o usá
directamente el prompt `guardar-conversacion` que ya expone el conector: trae las
mismas instrucciones.

Después alcanza con decir *"guardá esto en Bitácora"*.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm start` | Levanta la web en `http://127.0.0.1:8787` |
| `npm run dev` | Backend y frontend en modo desarrollo, con recarga |
| `npm run build` | Compila `shared`, `server` y `web` |
| `npm run migrate` | Aplica las migraciones pendientes |
| `npm run seed` | Carga 14 notas de ejemplo enlazadas |
| `npm run export` | Exporta el vault como `.md` a `data\exports\<fecha>` |
| `npm run mcp:stdio` | Levanta el MCP por stdio (lo hace Claude solo) |
| `npm run mcp:stdio:dev` | Igual pero desde TypeScript, sin compilar |
| `npm run inspector` | Abre MCP Inspector contra el servidor |
| `npm test` | Corre todos los tests |
| `npm run typecheck` | Chequea tipos sin emitir |

## La plantilla

El cliente MCP manda campos estructurados; el markdown lo arma el servidor. Siempre
salen las seis secciones, con `—` cuando una viene vacía:

```markdown
---
fecha: 2026-03-04
hora: 10:15
fuente: Claude (conversación)
tags: [claude, calidad, oos]
estado: archivado
---

# Investigación OOS valoración lote AMX-2401

## Contexto
…

## Decisiones
- …

## Pendientes
- [ ] Redactar la CAPA — Calidad — 05/06/2026

## Referencias
- …

## Notas adicionales
…

## Relacionado
- [[Calificación del HPLC del laboratorio de control]]
```

`fecha` y `hora` las pone el servidor con la zona horaria de `BITACORA_TZ`. El tag
`claude` va siempre primero. Si la conversación fue análisis sin decisiones cerradas,
`tipo_seccion: "conclusiones"` renombra esa sección.

## Tools MCP

| Tool | Qué hace |
|---|---|
| `list_folders` | Carpetas con cantidad de notas |
| `list_tags` | Tags con cantidad de usos |
| `search_notes` | Búsqueda FTS5 + filtros por carpeta, tags y fechas |
| `get_note` | Nota completa en markdown + outlinks + backlinks + pendientes |
| `save_note` | Crea la nota desde campos estructurados |
| `update_note` | Reemplaza secciones o el cuerpo entero |
| `append_to_note` | Suma contenido a una sección sin pisar |
| `link_notes` | Agrega un `[[wikilink]]` en "Relacionado" |
| `list_pending` | Pendientes de todas las notas |
| `complete_pending` | Marca hecho y reescribe la línea en la nota |
| `get_graph_neighborhood` | Nodos y aristas alrededor de una nota |
| `list_recent_notes` | Últimas notas modificadas |

**Borrar notas no se expone por MCP**: eso queda para la interfaz web, con confirmación.

## Backups

Lo más cómodo es **Ajustes → Backup de la base**, que te baja el `.db` completo sin
cerrar nada. Lo que sigue es lo mismo desde la terminal.

Todo el estado vive en `data\bitacora.db`. La base está en modo WAL, así que hay dos
archivos auxiliares (`-wal` y `-shm`) que también hay que copiar, o hacer un checkpoint
primero.

La forma segura, con Claude Desktop cerrado:

```powershell
New-Item -ItemType Directory -Force data\backups | Out-Null
node -e "const D=require('better-sqlite3');const db=new D('data/bitacora.db');db.pragma('wal_checkpoint(TRUNCATE)');db.close()"
Copy-Item data\bitacora.db "data\backups\bitacora-$(Get-Date -Format yyyy-MM-dd).db"
```

Un backup en caliente, sin cerrar nada (SQLite lo hace de forma consistente):

```powershell
New-Item -ItemType Directory -Force data\backups | Out-Null
node -e "const D=require('better-sqlite3');const db=new D('data/bitacora.db');const f='data/backups/bitacora-'+new Date().toISOString().slice(0,10)+'.db';db.backup(f).then(()=>{console.log('backup en '+f);db.close()})"
```

## Exportar a Obsidian

Desde **Ajustes → Exportar vault (.zip)**, o por terminal:

```powershell
npm run export
```

Deja en `data\exports\<fecha>\` un `.md` por nota, con frontmatter YAML y nombre
`YYYY-MM-DD - Título.md`, dentro de una carpeta por cada carpeta del vault. Esa carpeta
se abre directamente como vault de Obsidian: los `[[wikilinks]]` y los tags funcionan
igual. Podés pasarle otra ruta: `npm run export -- C:\Users\<usuario>\Obsidian\Bitacora`.

Es el seguro contra quedar atado a esta app.

## Estructura

```
bitacora/
├─ shared/src/            Lógica pura, sin I/O. Es donde está el grueso de los tests.
│  ├─ normalize.ts        Tags, claves de título, fechas con zona horaria
│  ├─ template.ts         Render de la plantilla y del frontmatter
│  └─ parse/              Secciones, wikilinks, pendientes, bloques de código
├─ server/src/
│  ├─ db/                 Apertura en WAL, migraciones versionadas
│  ├─ services/           La única lógica de la app (la comparten MCP y la web)
│  ├─ mcp/                Servidor MCP: tools, esquemas, entrypoint stdio
│  ├─ http/               API REST, sesión y servido del frontend compilado
│  ├─ seed.ts             14 notas de ejemplo
│  └─ export-cli.ts       Exportación a .md
├─ web/src/
│  ├─ components/         Grafo (force-graph), markdown con wikilinks, layout
│  ├─ pages/              Notas, nota, grafo, pendientes, carpetas, tags, ajustes
│  └─ styles.css          Tema oscuro y claro en variables CSS
├─ skills/                Skill para Claude Code / Claude Desktop
└─ data/                  Base SQLite, backups y exports (fuera de git)
```

## Decisiones de diseño

Cosas que conviene saber si vas a tocar el código:

- **El body es la fuente de verdad.** Los enlaces y los pendientes son índices
  derivados que se recalculan en cada guardado. Marcar un pendiente como hecho reescribe
  el `- [ ]` en el cuerpo de la nota, no toca un estado paralelo.
- **El H1 y el frontmatter no están en el body**, se generan desde las columnas. Así
  renombrar una nota nunca desincroniza el título.
- **Los títulos son únicos en todo el vault**, para que `[[Título]]` nunca sea ambiguo.
  Si el título ya existe, el servidor agrega ` (2)` y lo informa.
- **Renombrar no rompe el grafo**: los `[[wikilinks]]` que apuntaban a la nota se
  reescriben solos.
- **Los enlaces a notas inexistentes se guardan igual**, como enlaces sin resolver, y se
  conectan solos cuando la nota se crea. Borrar una nota no borra sus backlinks: los
  deja sin resolver.
- **Los ids de los pendientes sobreviven a las ediciones**: al reindexar se reconcilian
  por el texto de la acción, así que un `pending_id` que Claude ya vio sigue sirviendo.
- **Los parsers ignoran los bloques de código**: un `## algo` o un `[[algo]]` dentro de
  un bloque ``` no cuenta como encabezado ni como enlace.
- **FTS5 con `remove_diacritics 2`**: "desviacion" encuentra "desviación".
- **WAL activo**, porque el proceso MCP por stdio y el servidor web de la fase 2 van a
  escribir sobre la misma base al mismo tiempo.
- El `score` de `search_notes` es relevancia **relativa** a esa búsqueda (100 = el mejor
  resultado). El bm25 crudo de SQLite son números del orden de 1e-6, inservibles sueltos.
- **El grafo asigna colores por posición de la carpeta**, no por hash del nombre: un
  hash hace que dos carpetas caigan en el mismo color y la leyenda deje de servir.
- **Las etiquetas del grafo se dibujan a tamaño constante en pantalla** y se ocultan por
  debajo de cierto zoom. Con pocas notas se ven siempre; con miles aparecen recién al
  acercarte, que es lo que evita que se pisen.
- **El encuadre automático espera a que la física se asiente** (`onEngineStop`), con un
  respaldo por tiempo. Encuadrar antes deja nodos fuera de pantalla.
- **La sesión web es una cookie httpOnly** contra una tabla `sessions`, así sobrevive a
  reiniciar el servidor. La contraseña se guarda con scrypt y sal por contraseña, y
  cambiarla corta todas las sesiones abiertas.

## Lo que viene

- **Fase 3** — Streamable HTTP en `/mcp` con OAuth 2.1 (PKCE, registro dinámico de
  clientes, rotación de refresh tokens) y Cloudflare Tunnel, para usarlo como conector
  personalizado desde claude.ai en web y celular.
- **Fase 4** — Importar el `conversations.json` del export de claude.ai.
