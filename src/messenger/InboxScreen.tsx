import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createGroup, inbox } from "./api";
import { formatListTime } from "./format";
import { GroupAvatar, MutedBellIcon } from "./icons";
import { useMessenger } from "./MessengerContext";
import type { InboxGroup } from "./types";

const TABS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "groups", label: "Groups" },
  { id: "communities", label: "Communities" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function InboxScreen() {
  const navigate = useNavigate();
  const { viewer } = useMessenger();
  const [tab, setTab] = useState<TabId>("groups");
  const [groups, setGroups] = useState<InboxGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!viewer) {
      return;
    }
    let ignore = false;
    const load = async () => {
      try {
        const payload = await inbox(viewer.id);
        if (ignore) {
          return;
        }
        setGroups(payload.groups);
        setLoaded(true);
        setError(null);
      } catch (loadError) {
        if (ignore) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Could not load groups.");
        setLoaded(true);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [viewer]);

  const visible = groups.filter((group) => {
    if (tab === "unread") {
      return group.unread;
    }
    if (tab === "communities") {
      return false;
    }
    return true;
  });

  const emptyLabel =
    tab === "communities" ? "No communities" : tab === "unread" ? "No unread messages" : "No groups yet";

  async function onCreateGroup() {
    if (!viewer || creating) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const payload = await createGroup(viewer.id);
      navigate(`/install/g/${payload.group.id}`, { state: { add: true } });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the group.");
      setCreating(false);
    }
  }

  return (
    <div className="inbox" data-testid="inbox">
      <h1 className="sr-only">Installation groups</h1>
      <div className="tabs" role="tablist" aria-label="Inbox">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            data-testid={`tab-${item.id}`}
            className={tab === item.id ? "tab tab--on" : "tab"}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {viewer?.role === "admin" ? (
        <div className="admin-bar">
          <button type="button" data-testid="create-group" onClick={() => void onCreateGroup()} disabled={creating}>
            {creating ? "Creating…" : "New group"}
          </button>
          <button type="button" data-testid="open-people" onClick={() => navigate("/install/people")}>
            People
          </button>
        </div>
      ) : null}

      {error ? <p className="banner">{error}</p> : null}

      <div className="rows" role="tabpanel">
        {!loaded ? <p className="empty">Loading…</p> : null}
        {loaded && visible.length === 0 ? <p className="empty">{emptyLabel}</p> : null}
        {visible.map((group) => (
          <button
            key={group.id}
            type="button"
            className="row"
            data-testid="group-row"
            data-group-id={group.id}
            data-group-name={group.name}
            data-unread={group.unread ? "true" : "false"}
            data-muted={group.muted ? "true" : "false"}
            onClick={() => navigate(`/install/g/${group.id}`)}
          >
            <GroupAvatar name={group.name} />
            <span className="row-copy">
              <span className="row-top">
                <span className="row-name">{group.name}</span>
                <span className={group.unread ? "row-time row-time--unread" : "row-time"}>
                  {formatListTime(group.lastActivityAt)}
                </span>
              </span>
              <span className="row-bottom">
                <span className="row-preview" data-testid="preview">
                  {group.preview}
                </span>
                <span className="row-flags">
                  {group.muted ? (
                    <span className="flag-bell" data-testid="muted-bell" title="Muted">
                      <MutedBellIcon />
                    </span>
                  ) : null}
                  {group.unread ? <span className="unread-dot" data-testid="unread-dot" /> : null}
                </span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
