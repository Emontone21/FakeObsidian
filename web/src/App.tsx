import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api, UNAUTHORIZED_EVENT } from './api.js';
import { Layout } from './components/Layout.js';
import { Loading } from './components/Page.js';
import { FoldersPage } from './pages/FoldersPage.js';
import { GraphPage } from './pages/GraphPage.js';
import { ImportPage } from './pages/ImportPage.js';
import { Login } from './pages/Login.js';
import { NotePage } from './pages/NotePage.js';
import { NotesPage } from './pages/NotesPage.js';
import { PendingPage } from './pages/PendingPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { TagsPage } from './pages/TagsPage.js';

interface Session {
  authenticated: boolean;
  needsSetup: boolean;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);

  const refresh = useCallback(() => {
    api
      .session()
      .then(setSession)
      .catch(() => setSession({ authenticated: false, needsSetup: false }));
  }, []);

  useEffect(refresh, [refresh]);

  // Si el backend responde 401 volvemos al login sin recargar la pagina.
  useEffect(() => {
    const onUnauthorized = () => setSession((s) => (s ? { ...s, authenticated: false } : s));
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (!session) return <Loading />;
  if (!session.authenticated) return <Login needsSetup={session.needsSetup} onDone={refresh} />;

  return (
    <Layout onLogout={refresh}>
      <Routes>
        <Route path="/" element={<NotesPage />} />
        <Route path="/nota/:id" element={<NotePage />} />
        <Route path="/grafo" element={<GraphPage />} />
        <Route path="/pendientes" element={<PendingPage />} />
        <Route path="/carpetas" element={<FoldersPage />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/importar" element={<ImportPage />} />
        <Route path="/ajustes" element={<SettingsPage onLoggedOut={refresh} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
