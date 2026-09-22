import type { ReactNode } from 'react';

interface PageProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Sin padding ni scroll: lo usa el grafo, que ocupa todo el alto. */
  flush?: boolean;
  narrow?: boolean;
}

export function Page({ title, actions, children, flush, narrow }: PageProps) {
  return (
    <div className="main">
      <header className="topbar">
        <h1>{title}</h1>
        <div className="spacer" />
        {actions}
      </header>
      <div className={flush ? 'content flush' : 'content'}>
        {narrow ? <div className="page-narrow">{children}</div> : children}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Loading() {
  return <div className="spinner">Cargando…</div>;
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="banner error">{message}</div>;
}
