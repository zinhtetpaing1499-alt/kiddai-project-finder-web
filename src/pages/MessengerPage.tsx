import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { MessengerProvider, useMessenger } from "../messenger/MessengerContext";
import "../messenger/messenger.css";

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

  useEffect(() => {
    const previous = document.title;
    document.title = "KIDDAI Install";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="install-app">
      <RoleBar />
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
