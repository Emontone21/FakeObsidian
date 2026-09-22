-- Autenticacion de la interfaz web: una sola contrasena y cookie de sesion.
-- El hash vive en settings (clave 'password_hash'); aca solo las sesiones activas.

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,          -- 32 bytes aleatorios en hex
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE INDEX sessions_expires ON sessions (expires_at);
