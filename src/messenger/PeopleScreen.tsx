import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { createPerson, renamePerson } from "./api";
import { ChevronLeftIcon } from "./icons";
import { useMessenger } from "./MessengerContext";

export function PeopleScreen() {
  const navigate = useNavigate();
  const { viewer, people, reloadPeople } = useMessenger();
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!viewer) {
    return null;
  }

  if (viewer.role !== "admin") {
    return <Navigate to="/install" replace />;
  }

  async function onAdd() {
    if (!viewer) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    setError(null);
    try {
      await createPerson(viewer.id, trimmed);
      setName("");
      await reloadPeople();
      setNotice(`Added ${trimmed}. Put them in a group from that group's Add button.`);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Could not add that person.");
    }
  }

  async function onRename(targetId: string) {
    if (!viewer) {
      return;
    }
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    setError(null);
    try {
      await renamePerson(viewer.id, targetId, trimmed);
      setEditingId(null);
      await reloadPeople();
      setNotice("Name saved.");
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Could not rename that person.");
    }
  }

  return (
    <div className="people" data-testid="people">
      <header className="chat-header">
        <button type="button" className="icon-button" aria-label="Back" onClick={() => navigate("/install")}>
          <ChevronLeftIcon />
        </button>
        <span className="chat-title">
          <strong>People</strong>
          <span>Placeholders are fine until names are known</span>
        </span>
      </header>

      <form
        className="member-form people-add"
        onSubmit={(event) => {
          event.preventDefault();
          void onAdd();
        }}
      >
        <input
          data-testid="people-name"
          value={name}
          placeholder="New installer name"
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" data-testid="add-person">
          Add
        </button>
      </form>
      {notice ? <p className="form-note">{notice}</p> : null}
      {error ? <p className="banner">{error}</p> : null}

      <ul className="people-list">
        {people.map((person) => {
          const editing = editingId === person.id;
          const groups = person.groupNames.length > 0 ? person.groupNames.join(", ") : "Not in a group yet";
          return (
            <li key={person.id} data-testid="person-row" data-person-name={person.name}>
              {editing ? (
                <form
                  className="rename-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onRename(person.id);
                  }}
                >
                  <input
                    data-testid="rename-input"
                    value={draft}
                    aria-label={`Name for ${person.name}`}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <button type="submit" data-testid="rename-save">
                    Save
                  </button>
                  <button type="button" className="link-button" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <span className="person-name">{person.name}</span>
                  <span className="person-meta">
                    {person.role === "admin" ? "Admin" : "Installer"} · {groups}
                  </span>
                  <button
                    type="button"
                    className="link-button"
                    data-testid="rename-person"
                    onClick={() => {
                      setEditingId(person.id);
                      setDraft(person.name);
                      setNotice(null);
                    }}
                  >
                    Rename
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
