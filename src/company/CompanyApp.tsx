import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Briefcase,
  Home,
  Inbox,
  Layers,
  LogOut,
  Menu,
  PanelLeft,
  PanelLeftClose,
  Shield,
  X,
} from "lucide-react";
import { NavLink, Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { Header } from "../components/Header";
import { workspaceRoutes } from "../constants/workspace";
import { CustomerWorkspacePage } from "../pages/CustomerWorkspacePage";
import { SettingsPage } from "../pages/SettingsPage";
import { canOpen, DESIGNER_SCREENS, homePath, linksFor, portalLabel, portalName, teamById } from "./portals";
import { fetchInbox, fetchSession, login, logout as logoutRequest } from "./api";
import "./company.css";
import { SheetBoard } from "./SheetBoard";
import { WORKFLOW_VIEWS } from "./workflowSheets";
import { CompanySessionContext, useCompanySession } from "./session";
import type { CompanyUser } from "./types";

export const DEPARTMENT_STAGES = [
  { slug: "estimate", label: "ประเมิน" },
  { slug: "measure", label: "วัด" },
  { slug: "selling", label: "Selling Stage" },
  { slug: "deposit", label: "Deposit Stage" },
  { slug: "draftman", label: "Draftman" },
  { slug: "confirm", label: "Confirm" },
  { slug: "purchasing", label: "จัดซื้อ" },
  { slug: "store", label: "สโตร์" },
  { slug: "cutting", label: "ตัดไม้" },
  { slug: "assembly", label: "ประกอบ" },
  { slug: "rework", label: "แก้" },
  { slug: "cnc", label: "CNC" },
] as const;

function roleLabel(role: string) {
  if (!role) return "Member";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: (user: CompanyUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await login(username, password);
      onLoggedIn(result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="company-gate">
      <form className="company-card" onSubmit={onSubmit} data-testid="company-login">
        <img className="company-logo" src="/kiddai-logo.jpg" alt="KIDDAI" />
        <h1>KIDDAI</h1>
        <p className="company-lede">Company portal</p>
        <label>
          Username
          <input
            name="username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error ? (
          <p className="company-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <ul className="company-demo">
          <li>Owner — owner / kiddai-owner</li>
          <li>Designer — han / kiddai-han</li>
          <li>Admin — admin / kiddai-admin</li>
        </ul>
      </form>
    </main>
  );
}

const COMPANY_SIDE_KEY = "kiddai-company-sidebar-collapsed";

function readCompanySideHidden() {
  try {
    return window.localStorage.getItem(COMPANY_SIDE_KEY) === "1";
  } catch {
    return false;
  }
}

function CompanySide({
  user,
  onLogout,
  onHide,
  unread,
}: {
  user: CompanyUser;
  onLogout: () => void;
  onHide: () => void;
  unread: number;
}) {
  const initial = user.displayName.trim().charAt(0).toUpperCase() || "K";
  const location = useLocation();
  const designerOpen = location.pathname.startsWith("/company/departments/designer");

  return (
    <aside className="company-side">
      <div className="company-brand">
        <img className="company-logo company-logo--light" src="/kiddai-logo.jpg" alt="KIDDAI" />
        <span className="company-brand__copy">
          <strong>KIDDAI</strong>
          <span>{portalLabel(user)}</span>
        </span>
        <button type="button" className="company-side-hide" onClick={onHide} aria-label="Hide sidebar" title="Hide sidebar">
          <PanelLeftClose size={18} strokeWidth={2.2} />
        </button>
      </div>
      <nav className="company-side__nav" aria-label={portalLabel(user)}>
        {linksFor(user).map((link) => {
          const Icon = iconFor(link.id);
          const designer = link.id === "designer";
          return (
            <div key={link.id}>
              <NavLink
                to={link.to}
                end={!designer}
                className={({ isActive }) => sideClass(isActive)}
                title={link.label}
              >
                <Icon size={18} />
                <span className="company-side__label">{link.label}</span>
                {link.id === "chat" && unread > 0 ? <span className="company-side__badge">{unread}</span> : null}
              </NavLink>
              {designer && designerOpen ? (
                <div className="company-side__tree">
                  {designerRoutes.map(({ label, to, icon: ScreenIcon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      className={({ isActive }) => (isActive ? "sidebar-nav__item sidebar-nav__item--active" : "sidebar-nav__item")}
                    >
                      <span className="sidebar-nav__icon">
                        <ScreenIcon size={16} strokeWidth={2} />
                      </span>
                      <span className="sidebar-nav__label">{label}</span>
                    </NavLink>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
      <div className="company-user">
        <span className="company-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="company-user__copy">
          <strong>{user.displayName}</strong>
          <span>{roleLabel(user.role)}</span>
        </span>
        <button type="button" className="company-icon-button" onClick={onLogout} aria-label="Log out" title="Log out">
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
}

function iconFor(id: string) {
  if (id === "designers" || id === "selling") return Home;
  if (id === "chat") return Inbox;
  if (id === "jobs") return Briefcase;
  if (id === "admin") return Shield;
  return Layers;
}

function sideClass(isActive: boolean) {
  return isActive ? "company-side__link company-side__link--on" : "company-side__link";
}

function MobileBar({ onOpen }: { onOpen: () => void }) {
  return (
    <header className="company-mobilebar">
      <button type="button" className="company-menu-button" onClick={onOpen} aria-label="Open sidebar" title="Open sidebar">
        <Menu size={20} strokeWidth={2.2} />
      </button>
      <span className="company-brand">
        <img className="company-logo company-logo--light" src="/kiddai-logo.jpg" alt="" />
        <strong>KIDDAI</strong>
      </span>
    </header>
  );
}

function TabBar({ onMore }: { onMore: () => void }) {
  const session = useCompanySession();
  const links = linksFor(session.user);
  const shown = links.length > 4 ? links.slice(0, 3) : links;
  const overflow = links.length > 4;

  return (
    <nav className="company-tabbar" aria-label={portalLabel(session.user)}>
      {shown.map((link) => {
        const Icon = iconFor(link.id);
        return (
          <NavLink key={link.id} to={link.to} end={link.id !== "designer"} className={({ isActive }) => (isActive ? "company-tabbar__item company-tabbar__item--on" : "company-tabbar__item")}>
            <Icon size={18} />
            <span>{link.label}</span>
          </NavLink>
        );
      })}
      {overflow ? (
        <button type="button" className="company-tabbar__item" onClick={onMore}>
          <Layers size={18} />
          <span>More</span>
        </button>
      ) : null}
    </nav>
  );
}

function MoreSheet({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  const session = useCompanySession();
  const extra = linksFor(session.user).slice(3);
  return (
    <div className="company-sheet" role="presentation">
      <button type="button" className="company-sheet__backdrop" aria-label="Close menu" onClick={onClose} />
      <div className="company-sheet__panel" role="dialog" aria-label="More">
        <header>
          <strong>{portalLabel(session.user)}</strong>
          <button type="button" className="company-icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        {extra.map((link) => (
          <NavLink key={link.id} to={link.to} onClick={onClose}>
            {link.label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => {
            onClose();
            onLogout();
          }}
        >
          Log out
        </button>
      </div>
    </div>
  );
}

export function CompanyShell({
  pane,
  list,
  job,
  children,
}: {
  pane: "list" | "chat" | "job" | "section";
  list?: ReactNode;
  job?: ReactNode;
  children: ReactNode;
}) {
  const session = useCompanySession();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sideHidden, setSideHidden] = useState(readCompanySideHidden);
  const mode = list ? "inbox" : "section";
  const onlyChat = linksFor(session.user).length < 2;

  function setSidebarHidden(hidden: boolean) {
    setSideHidden(hidden);
    try {
      window.localStorage.setItem(COMPANY_SIDE_KEY, hidden ? "1" : "0");
    } catch {
      /* ignore quota / private mode */
    }
  }

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const inbox = await fetchInbox("all");
        if (!stopped) setUnread(inbox.unreadTotal);
      } catch {
        if (!stopped) setUnread(0);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className={`company-shell company-shell--${mode} company-shell--${pane}${onlyChat ? " company-shell--solo" : ""}${sideHidden ? " company-shell--side-hidden" : ""}${menuOpen ? " company-shell--menu-open" : ""}`}>
      <MobileBar onOpen={() => setMenuOpen(true)} />
      {menuOpen ? (
        <button type="button" className="company-menu-backdrop" aria-label="Close sidebar" onClick={() => setMenuOpen(false)} />
      ) : null}
      {sideHidden ? (
        <button type="button" className="company-side-reopen" onClick={() => setSidebarHidden(false)} aria-label="Open sidebar" title="Open sidebar">
          <PanelLeft size={20} strokeWidth={2.2} />
        </button>
      ) : null}
      <CompanySide
        user={session.user}
        unread={unread}
        onHide={() => {
          setMenuOpen(false);
          setSidebarHidden(true);
        }}
        onLogout={() => void session.logout()}
      />
      {list ? <div className="company-listcol">{list}</div> : null}
      <section className="company-center">{children}</section>
      {job ? <aside className="company-job">{job}</aside> : null}
      {onlyChat ? null : <TabBar onMore={() => setMoreOpen(true)} />}
      {moreOpen && !onlyChat ? <MoreSheet onClose={() => setMoreOpen(false)} onLogout={() => void session.logout()} /> : null}
    </div>
  );
}

export function PortalHomeRedirect() {
  const session = useCompanySession();
  return <Navigate to={homePath(session.user)} replace />;
}

export function CompanyLayout() {
  const [user, setUser] = useState<CompanyUser | null | undefined>(undefined);

  useEffect(() => {
    const previous = document.title;
    document.title = "KIDDAI Company Portal";
    return () => {
      document.title = previous;
    };
  }, []);

  const expire = useCallback(() => setUser(null), []);
  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
  }, []);
  const session = useMemo(
    () => (user ? { user, logout, expire } : null),
    [user, logout, expire],
  );

  useEffect(() => {
    let cancel = false;
    fetchSession()
      .then((result) => {
        if (!cancel) setUser(result.user);
      })
      .catch(() => {
        if (!cancel) setUser(null);
      });
    return () => {
      cancel = true;
    };
  }, []);

  if (user === undefined) {
    return (
      <div className="company-app">
        <main className="company-gate">
          <p>Loading…</p>
        </main>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="company-app">
        <LoginScreen onLoggedIn={setUser} />
      </div>
    );
  }

  return (
    <CompanySessionContext.Provider value={session}>
      <div className="company-app">
        <PortalGate />
      </div>
    </CompanySessionContext.Provider>
  );
}

function PortalGate() {
  const session = useCompanySession();
  const location = useLocation();
  if (!canOpen(session.user, location.pathname)) {
    return <Navigate to={homePath(session.user)} replace />;
  }
  return <Outlet />;
}

export function CompanyHome() {
  const session = useCompanySession();
  const links = linksFor(session.user);
  return (
    <CompanyShell pane="section">
      <div className="company-page">
        <header className="company-page__head">
          <h1>{portalLabel(session.user)}</h1>
        </header>
        <p>Each login opens only its own work.</p>
        <nav className="company-dept-list" aria-label="Portals">
          {links.map((link) => (
            <NavLink key={link.id} to={link.to}>
              <strong>{link.label}</strong>
              <span>{link.detail}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </CompanyShell>
  );
}

const designerRoutes = workspaceRoutes.map((route) => {
  const screen = DESIGNER_SCREENS.find((item) => route.to.endsWith(item.id));
  return screen ? { ...route, to: screen.to } : route;
});

function DesignerWorkspace({ screen }: { screen: "deposit" | "selling" | "settings" }) {
  const title = screen === "selling" ? "Selling Customers" : screen === "settings" ? "Settings" : "Deposit Customers";

  return (
    <CompanyShell pane="section">
      <div className="app-shell app-shell--embedded app-shell--solo">
        <div className="app-shell__content">
          <div className="app-shell__frame">
            <nav className="company-designer-mobile" aria-label="Designer">
              {designerRoutes.map(({ label, to }) => (
                <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "sidebar-nav__item sidebar-nav__item--active" : "sidebar-nav__item")}>
                  <span className="sidebar-nav__label">{label}</span>
                </NavLink>
              ))}
            </nav>
            <Header title={title} />
            <main className="app-shell__main">
              {screen === "settings" ? <SettingsPage /> : <CustomerWorkspacePage mode={screen} />}
            </main>
          </div>
        </div>
      </div>
    </CompanyShell>
  );
}

export function DesignerPortal({ mode }: { mode: "deposit" | "selling" }) {
  return (
    <CompanyShell pane="section">
      <div className="company-page company-page--wide company-designer">
        <CustomerWorkspacePage mode={mode} />
      </div>
    </CompanyShell>
  );
}

export function DepartmentIndex() {
  return <Navigate to={DESIGNER_SCREENS[0].to} replace />;
}

export function CompanyLater({ title }: { title: string }) {
  return (
    <CompanyShell pane="section">
      <div className="company-page">
        <header className="company-page__head">
          <h1>{title}</h1>
        </header>
        <p>This section comes next. The inbox is ready.</p>
      </div>
    </CompanyShell>
  );
}

export function TeamPage() {
  const { team: teamId } = useParams();
  const team = teamById(teamId);
  if (!team) return <Navigate to="/company/departments" replace />;
  if (team.id === "designer") return <Navigate to={DESIGNER_SCREENS[0].to} replace />;
  return (
    <CompanyShell pane="section">
      <div className="company-page">
        <header className="company-page__head">
          <h1>{team.label}</h1>
        </header>
      </div>
    </CompanyShell>
  );
}

export function DepartmentStagePage() {
  const session = useCompanySession();
  const { team: teamId, stage } = useParams();
  const team = teamById(teamId);
  if (teamId === "designer" && stage === "deposit-customers") return <DesignerWorkspace screen="deposit" />;
  if (teamId === "designer" && stage === "selling-customers") return <DesignerWorkspace screen="selling" />;
  if (teamId === "designer" && stage === "settings") return <DesignerWorkspace screen="settings" />;
  const match = WORKFLOW_VIEWS.find((item) => item.slug === stage);
  const owner = portalName(session.user) === "owner";
  if (!team || !match || !team.sheets.includes(stage ?? "")) {
    return <Navigate to="/company/departments" replace />;
  }
  const tabs = WORKFLOW_VIEWS.filter((item) => team.sheets.includes(item.slug));

  return (
    <CompanyShell pane="section">
      <div className="company-page company-page--wide">
        <header className="company-page__head">
          <h1>{team.label}</h1>
          <p>{match.label}</p>
        </header>
        <SheetBoard slug={stage} tabs={owner && tabs.length > 1 ? tabs : undefined} teamId={team.id} />
      </div>
    </CompanyShell>
  );
}
