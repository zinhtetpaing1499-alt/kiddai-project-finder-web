import { Menu, PanelLeft, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";

const SIDEBAR_COLLAPSED_KEY = "kiddai-sidebar-collapsed";

function readDesktopCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(readDesktopCollapsed);

  const persistDesktopCollapsed = (collapsed: boolean) => {
    setDesktopCollapsed(collapsed);
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore quota / private mode */
    }
  };

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 900) {
        setMobileOpen(false);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("sidebar-open", mobileOpen);
    return () => document.body.classList.remove("sidebar-open");
  }, [mobileOpen]);

  const shellClass = [
    "app-shell",
    mobileOpen ? "app-shell--sidebar-open" : "",
    desktopCollapsed ? "app-shell--sidebar-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
      <button
        className="sidebar-menu-button"
        type="button"
        aria-label={mobileOpen ? "Close menu" : "Open menu"}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((open) => !open)}
      >
        {mobileOpen ? <X size={20} strokeWidth={2.2} /> : <Menu size={20} strokeWidth={2.2} />}
      </button>

      <button
        className="sidebar-reopen-button"
        type="button"
        title="Open sidebar"
        aria-label="Open sidebar"
        onClick={() => persistDesktopCollapsed(false)}
      >
        <PanelLeft size={20} strokeWidth={2.2} />
      </button>

      {mobileOpen ? (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <Sidebar
        onNavigate={() => setMobileOpen(false)}
        onCollapse={() => persistDesktopCollapsed(true)}
      />
      <div className="app-shell__content">
        <div className="app-shell__frame">
          <Header />
          <main className="app-shell__main">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
