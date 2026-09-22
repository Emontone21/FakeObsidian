import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../api.js';
import { useTheme } from '../hooks.js';

const LINKS = [
  { to: '/', label: 'Notas', icon: '📄', end: true },
  { to: '/grafo', label: 'Grafo', icon: '🕸️' },
  { to: '/pendientes', label: 'Pendientes', icon: '☑️' }
];

const ADMIN = [
  { to: '/carpetas', label: 'Carpetas', icon: '📁' },
  { to: '/tags', label: 'Tags', icon: '🏷️' },
  { to: '/importar', label: 'Importar', icon: '📥' },
  { to: '/ajustes', label: 'Ajustes', icon: '⚙️' }
];

export function Layout({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const [theme, toggleTheme] = useTheme();

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-brand">
          <span className="dot" />
          Bitácora
        </div>

        {LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            <span aria-hidden>{link.icon}</span>
            {link.label}
          </NavLink>
        ))}

        <div className="nav-section">Administrar</div>
        {ADMIN.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            <span aria-hidden>{link.icon}</span>
            {link.label}
          </NavLink>
        ))}

        <div className="sidebar-footer">
          <button className="btn ghost sm" onClick={toggleTheme} title="Cambiar tema">
            {theme === 'dark' ? '☀️ Claro' : '🌙 Oscuro'}
          </button>
          <button
            className="btn ghost sm"
            onClick={() => {
              void api.logout().then(onLogout);
            }}
          >
            Salir
          </button>
        </div>
      </nav>
      {children}
    </div>
  );
}
