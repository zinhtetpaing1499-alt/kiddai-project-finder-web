import { PanelLeftClose } from "lucide-react";
import { NavLink } from "react-router-dom";
import { workspaceRoutes } from "../constants/workspace";

type SidebarProps = {
  onNavigate?: () => void;
  onCollapse?: () => void;
};

export function Sidebar({ onNavigate, onCollapse }: SidebarProps) {
  return (
    <aside className="app-shell__sidebar">
      <div className="app-shell__sidebar-inner">
        <div className="sidebar-top">
          <div className="sidebar-header">
            <div className="brand">
              <img className="brand__logo" src="/kiddai-logo.jpg" alt="KIDDAI logo" />
              <div className="brand__text">
                <p className="brand__title">KIDDAI</p>
              </div>
            </div>
            <button
              className="sidebar-collapse-button"
              type="button"
              title="Close sidebar"
              aria-label="Close sidebar"
              onClick={() => onCollapse?.()}
            >
              <PanelLeftClose size={18} strokeWidth={2.2} />
            </button>
          </div>
        </div>

        <div className="sidebar-section">
          <nav className="sidebar-nav" aria-label="Primary">
            {workspaceRoutes.map(({ label, to, icon: Icon, tone }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => onNavigate?.()}
                className={({ isActive }) =>
                  [
                    "sidebar-nav__item",
                    tone ? `sidebar-nav__item--${tone}` : "",
                    isActive ? "sidebar-nav__item--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")
                }
              >
                <span className="sidebar-nav__icon">
                  <Icon size={20} strokeWidth={2.4} />
                </span>
                <span className="sidebar-nav__label">{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
    </aside>
  );
}
