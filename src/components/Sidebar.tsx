import { PanelLeftClose } from "lucide-react";
import { NavLink } from "react-router-dom";
import { workspaceRoutes } from "../constants/workspace";
import { useMessagingNotifications } from "../contexts/MessagingNotificationsContext";
import { formatNotiCount } from "../utils/workspaceUnread";

type SidebarProps = {
  onNavigate?: () => void;
  onCollapse?: () => void;
};

function unreadForRoute(path: string, sellingUnreadCount: number, depositUnreadCount: number) {
  if (path === "/deposit-customers") {
    return depositUnreadCount;
  }
  if (path === "/selling-customers") {
    return sellingUnreadCount;
  }
  return 0;
}

export function Sidebar({ onNavigate, onCollapse }: SidebarProps) {
  const { sellingUnreadCount, depositUnreadCount } = useMessagingNotifications();

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
            {workspaceRoutes.map(({ label, to, icon: Icon }) => {
              const unread = unreadForRoute(to, sellingUnreadCount, depositUnreadCount);
              return (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => onNavigate?.()}
                  className={({ isActive }) =>
                    `sidebar-nav__item${isActive ? " sidebar-nav__item--active" : ""}`
                  }
                >
                  <span className="sidebar-nav__icon">
                    <Icon size={16} strokeWidth={2} />
                  </span>
                  <span className="sidebar-nav__label">
                    {label}
                    {unread > 0 ? (
                      <span className="sidebar-nav__noti">{formatNotiCount(unread)}</span>
                    ) : null}
                  </span>
                </NavLink>
              );
            })}
          </nav>
        </div>
      </div>
    </aside>
  );
}
