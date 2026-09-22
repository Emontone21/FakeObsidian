import { Page } from '../components/Page.js';

export function ImportPage() {
  return (
    <Page title="Importar" narrow>
      <div className="panel">
        <h2>Importar el export de claude.ai</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          Esta pantalla llega en la fase 4. La idea: subís el <code>conversations.json</code> que descargás desde
          Ajustes de claude.ai y cada conversación se convierte en una nota en la carpeta <code>Importado</code>, con
          la transcripción completa en un bloque plegable dentro de «Notas adicionales».
        </p>
        <p className="hint">
          Si volvés a importar el mismo archivo no se duplica nada: cada nota queda atada al id de su conversación.
        </p>
      </div>
    </Page>
  );
}
