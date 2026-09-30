import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { MessengerProvider, useMessenger } from "../messenger/MessengerContext";
import "../messenger/messenger.css";

const DEPARTMENTS = [
  { id: "installation", label: "Installation", path: "/install" },
  { id: "designer", label: "Designer", path: "/install/designer" },
  { id: "purchasing", label: "Purchasing", path: "/install/purchasing" },
  { id: "cnc", label: "CNC", path: "/install/cnc" },
] as const;

type DepartmentId = (typeof DEPARTMENTS)[number]["id"];

function departmentFromPath(pathname: string): DepartmentId {
  if (pathname.startsWith("/install/designer")) {
    return "designer";
  }
  if (pathname.startsWith("/install/purchasing")) {
    return "purchasing";
  }
  if (pathname.startsWith("/install/cnc")) {
    return "cnc";
  }
  return "installation";
}

function DepartmentSwitch() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const current = departmentFromPath(pathname);

  return (
    <div className="dept-switch" data-testid="department-switch" role="tablist" aria-label="Department">
      {DEPARTMENTS.map((item) => {
        const selected = current === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`dept-${item.id}`}
            className={selected ? "dept-pill dept-pill--on" : "dept-pill"}
            onClick={() => {
              if (!selected) {
                navigate(item.path);
              }
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function RoleBar() {
  const { viewer, people, preferredInstallerId, setViewerId } = useMessenger();
  const admin = people.find((person) => person.role === "admin");
  const installers = people.filter((person) => person.role === "installer");
  const installerValue =
    viewer?.role === "installer"
      ? viewer.id
      : preferredInstallerId && installers.some((person) => person.id === preferredInstallerId)
        ? preferredInstallerId
        : (installers[0]?.id ?? "");

  if (!viewer) {
    return null;
  }

  return (
    <div className="role-bar">
      <span className="role-bar__label">View as</span>
      {admin ? (
        <button
          type="button"
          data-testid="view-admin"
          className={viewer.role === "admin" ? "role-pill role-pill--on" : "role-pill"}
          aria-pressed={viewer.role === "admin"}
          onClick={() => setViewerId(admin.id)}
        >
          Admin
        </button>
      ) : null}
      {installers.length > 0 ? (
        <label className={viewer.role === "installer" ? "role-pill role-pill--on role-pill--select" : "role-pill role-pill--select"}>
          <span className="sr-only">Installer</span>
          <select
            data-testid="installer-select"
            aria-label="Installer"
            value={installerValue}
            onChange={(event) => setViewerId(event.target.value)}
          >
            {installers.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function MessengerFrame() {
  const { ready, error, viewer, retry } = useMessenger();
  const { pathname } = useLocation();
  const department = departmentFromPath(pathname);

  useEffect(() => {
    const previous = document.title;
    const titles: Record<DepartmentId, string> = {
      installation: "KIDDAI Install",
      designer: "Designer",
      purchasing: "Purchasing",
      cnc: "CNC",
    };
    document.title = titles[department];
    return () => {
      document.title = previous;
    };
  }, [department]);

  return (
    <div className="install-app">
      <DepartmentSwitch />
      {department === "installation" ? <RoleBar /> : null}
      <div className="install-app__phone" data-testid="phone">
        {ready && viewer ? <Outlet /> : null}
        {!ready ? (
          <div className="inbox">
            <p className="empty">{error ?? "Loading…"}</p>
            {error ? (
              <button type="button" className="text-button retry" onClick={retry}>
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MessengerPage() {
  return (
    <MessengerProvider>
      <MessengerFrame />
    </MessengerProvider>
  );
}
