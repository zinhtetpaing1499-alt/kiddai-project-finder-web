import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Bell,
  Briefcase,
  Home,
  Inbox,
  Layers,
  LogOut,
  Shield,
  X,
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import { fetchInbox, fetchSession, login, logout as logoutRequest } from "./api";
import "./company.css";
import { SheetBoard } from "./SheetBoard";
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
          <li>Admin — admin / kiddai-admin</li>
          <li>Installer in the group — installer1 / install-1</li>
          <li>Installer with no group — installer2 / install-2</li>
        </ul>
      </form>
    </main>
  );
}

function CompanySide({ user, onLogout, unread }: { user: CompanyUser; onLogout: () => void; unread: number }) {
  const initial = user.displayName.trim().charAt(0).toUpperCase() || "K";

  return (
    <aside className="company-side">
      <div className="company-brand">
        <img className="company-logo company-logo--light" src="/kiddai-logo.jpg" alt="KIDDAI" />
        <span className="company-brand__copy">
          <strong>KIDDAI</strong>
          <span>Company Portal</span>
        </span>
      </div>
      <nav className="company-side__nav" aria-label="Company">
        <NavLink to="/company/home" className={({ isActive }) => sideClass(isActive)} title="Home">
          <Home size={18} />
          <span className="company-side__label">Home</span>
        </NavLink>
        <NavLink to="/company/inbox" className={({ isActive }) => sideClass(isActive)} title="Inbox">
          <Inbox size={18} />
          <span className="company-side__label">Inbox</span>
          {unread > 0 ? <span className="company-side__badge">{unread}</span> : null}
        </NavLink>
        <NavLink to="/company/jobs" className={({ isActive }) => sideClass(isActive)} title="Jobs">
          <Briefcase size={18} />
          <span className="company-side__label">Jobs</span>
        </NavLink>
        <NavLink to="/company/departments" className={({ isActive }) => sideClass(isActive)} title="Departments">
          <Layers size={18} />
          <span className="company-side__label">Departments</span>
        </NavLink>
        <NavLink to="/company/admin" className={({ isActive }) => sideClass(isActive)} title="Admin">
          <Shield size={18} />
          <span className="company-side__label">Admin</span>
        </NavLink>
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

function sideClass(isActive: boolean) {
  return isActive ? "company-side__link company-side__link--on" : "company-side__link";
}

function MobileBar({ unread }: { unread: number }) {
  return (
    <header className="company-mobilebar">
      <span className="company-brand">
        <img className="company-logo company-logo--light" src="/kiddai-logo.jpg" alt="" />
        <strong>KIDDAI</strong>
      </span>
      <NavLink to="/company/inbox" className="company-icon-button" aria-label={unread > 0 ? `${unread} unread` : "Inbox"}>
        <Bell size={18} />
        {unread > 0 ? <span className="company-dot" /> : null}
      </NavLink>
    </header>
  );
}

function TabBar({ onMore }: { onMore: () => void }) {
  const location = useLocation();
  const inboxOn = location.pathname === "/company/inbox";

  return (
    <nav className="company-tabbar" aria-label="Company">
      <Link to="/company/inbox" className={inboxOn ? "company-tabbar__item company-tabbar__item--on" : "company-tabbar__item"} aria-current={inboxOn ? "page" : undefined}>
        <Inbox size={18} />
        <span>Inbox</span>
      </Link>
      <NavLink to="/company/jobs" className={({ isActive }) => (isActive ? "company-tabbar__item company-tabbar__item--on" : "company-tabbar__item")}>
        <Briefcase size={18} />
        <span>Jobs</span>
      </NavLink>
      <NavLink to="/company/departments" className={({ isActive }) => (isActive ? "company-tabbar__item company-tabbar__item--on" : "company-tabbar__item")}>
        <Layers size={18} />
        <span>Departments</span>
      </NavLink>
      <button type="button" className="company-tabbar__item" onClick={onMore}>
        <Layers size={18} />
        <span>More</span>
      </button>
    </nav>
  );
}

function MoreSheet({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  return (
    <div className="company-sheet" role="presentation">
      <button type="button" className="company-sheet__backdrop" aria-label="Close menu" onClick={onClose} />
      <div className="company-sheet__panel" role="dialog" aria-label="More">
        <header>
          <strong>More</strong>
          <button type="button" className="company-icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <NavLink to="/company/departments" onClick={onClose}>
          Departments
        </NavLink>
        <NavLink to="/company/admin" onClick={onClose}>
          Admin
        </NavLink>
        <a href="/deposit-customers">Designer workspace</a>
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
  const [unread, setUnread] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const mode = list ? "inbox" : "section";

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
    <div className={`company-shell company-shell--${mode} company-shell--${pane}`}>
      <MobileBar unread={unread} />
      <CompanySide user={session.user} unread={unread} onLogout={() => void session.logout()} />
      {list ? <div className="company-listcol">{list}</div> : null}
      <section className="company-center">{children}</section>
      {job ? <aside className="company-job">{job}</aside> : null}
      <TabBar onMore={() => setMoreOpen(true)} />
      {moreOpen ? <MoreSheet onClose={() => setMoreOpen(false)} onLogout={() => void session.logout()} /> : null}
    </div>
  );
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
        <Outlet />
      </div>
    </CompanySessionContext.Provider>
  );
}

export function CompanyHome() {
  return (
    <CompanyShell pane="section">
      <div className="company-page">
        <header className="company-page__head">
          <h1>Home</h1>
        </header>
        <p>Open the inbox to see the groups you belong to.</p>
        <NavLink to="/company/inbox" className="company-primary">
          Open inbox
        </NavLink>
      </div>
    </CompanyShell>
  );
}

export function DepartmentIndex() {
  return (
    <CompanyShell pane="section">
      <div className="company-page">
        <header className="company-page__head">
          <h1>Departments</h1>
        </header>
        <p>Open a worksheet. The inbox stays a project conversation.</p>
        <nav className="company-dept-list" aria-label="Department worksheets">
          {DEPARTMENT_STAGES.map((stage) => (
            <NavLink key={stage.slug} to={`/company/departments/${stage.slug}`}>
              {stage.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </CompanyShell>
  );
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

export function DepartmentStagePage() {
  const { stage } = useParams();
  const match = DEPARTMENT_STAGES.find((item) => item.slug === stage);

  return (
    <CompanyShell pane="section">
      <div className="company-page company-page--wide">
        <header className="company-page__head">
          <h1>{match?.label ?? "Department"}</h1>
        </header>
        <SheetBoard slug={stage} />
      </div>
    </CompanyShell>
  );
}
