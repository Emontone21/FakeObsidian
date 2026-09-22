-- Esquema inicial de Bitacora.
-- El body de la nota es la fuente de verdad; links y pendientes son indices
-- derivados que se recalculan en cada guardado.

CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE folders (
  name       TEXT PRIMARY KEY,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE notes (
  id         TEXT PRIMARY KEY,                    -- ULID
  title      TEXT NOT NULL,
  title_key  TEXT NOT NULL UNIQUE,                -- minusculas sin acentos: resuelve [[wikilinks]]
  folder     TEXT NOT NULL REFERENCES folders(name) ON UPDATE CASCADE,
  date       TEXT NOT NULL,                       -- YYYY-MM-DD
  time       TEXT NOT NULL,                       -- HH:MM
  source     TEXT NOT NULL DEFAULT 'claude' CHECK (source IN ('claude', 'import', 'manual')),
  source_conversation_id TEXT,
  source_url TEXT,
  status     TEXT NOT NULL DEFAULT 'archivado',
  summary    TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,                       -- markdown sin frontmatter ni H1
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX notes_folder_date ON notes (folder, date DESC);
CREATE INDEX notes_date ON notes (date DESC);
CREATE UNIQUE INDEX notes_conversation
  ON notes (source_conversation_id) WHERE source_conversation_id IS NOT NULL;

CREATE TABLE tags (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE                       -- ya normalizado
);

CREATE TABLE note_tags (
  note_id  TEXT    NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,            -- mantiene 'claude' primero
  PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX note_tags_tag ON note_tags (tag_id);

CREATE TABLE links (
  id           INTEGER PRIMARY KEY,
  from_note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  -- Al borrar una nota sus backlinks quedan sin resolver en vez de desaparecer.
  to_note_id   TEXT REFERENCES notes (id) ON DELETE SET NULL,
  target_title TEXT NOT NULL,                     -- texto literal dentro de [[...]]
  target_key   TEXT NOT NULL,                     -- normalizado: re-resuelve al crearse el destino
  UNIQUE (from_note_id, target_key)
);

CREATE INDEX links_to ON links (to_note_id);
CREATE INDEX links_target_key ON links (target_key);

CREATE TABLE pending_items (
  id         TEXT PRIMARY KEY,                    -- ULID estable entre reparseos
  note_id    TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,                    -- orden dentro de la nota
  line_no    INTEGER NOT NULL,                    -- linea del body: permite reescribir el checkbox
  raw_line   TEXT NOT NULL,
  action     TEXT NOT NULL,
  action_key TEXT NOT NULL,                       -- normalizado: reconcilia el id al reparsear
  owner      TEXT,
  due_date   TEXT,                                -- YYYY-MM-DD
  done       INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1))
);

CREATE INDEX pending_note ON pending_items (note_id);
CREATE INDEX pending_due ON pending_items (due_date) WHERE done = 0;
CREATE INDEX pending_owner ON pending_items (owner);

-- Busqueda de texto completo. remove_diacritics 2 hace que "desviacion"
-- encuentre "desviacion"; prefix habilita las busquedas con *.
CREATE VIRTUAL TABLE notes_fts USING fts5 (
  title,
  summary,
  body,
  content = 'notes',
  content_rowid = 'rowid',
  tokenize = "unicode61 remove_diacritics 2",
  prefix = '2 3'
);

CREATE TRIGGER notes_fts_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts (rowid, title, summary, body)
  VALUES (new.rowid, new.title, new.summary, new.body);
END;

CREATE TRIGGER notes_fts_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts (notes_fts, rowid, title, summary, body)
  VALUES ('delete', old.rowid, old.title, old.summary, old.body);
END;

CREATE TRIGGER notes_fts_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts (notes_fts, rowid, title, summary, body)
  VALUES ('delete', old.rowid, old.title, old.summary, old.body);
  INSERT INTO notes_fts (rowid, title, summary, body)
  VALUES (new.rowid, new.title, new.summary, new.body);
END;
