import { StickyNote } from "lucide-react";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  addCustomerTaskNote,
  completeCustomerTaskNote,
  readOpenCustomerTaskNotes,
} from "../utils/customerTaskNotes";

export function CustomerTaskNotes({
  notesKey,
  customerName,
  projectNumber,
  colSpan,
  onNotesChange,
}: {
  notesKey: string;
  customerName: string;
  projectNumber: string;
  colSpan: number;
  onNotesChange?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState(() => readOpenCustomerTaskNotes(notesKey));
  const remainingLabel = useMemo(() => {
    if (notes.length === 1) {
      return "1 reminder";
    }
    return `${notes.length} reminders`;
  }, [notes.length]);

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    setNotes(addCustomerTaskNote(notesKey, draft));
    setDraft("");
    onNotesChange?.();
  }

  function handleComplete(noteId: string) {
    setNotes(completeCustomerTaskNote(notesKey, noteId));
    onNotesChange?.();
  }

  return (
    <tr className="customer-notes-row">
      <td colSpan={colSpan}>
        <div className="customer-task-notes">
          <div className="customer-task-notes__header">
            <span className="customer-task-notes__title">
              <StickyNote size={14} />
              Reminders for {projectNumber} · {customerName}
            </span>
            <span className="customer-task-notes__count">{remainingLabel}</span>
          </div>
          {notes.length === 0 ? (
            <p className="customer-task-notes__empty">
              Nothing to do yet. Add a reminder for this customer, then tick it when it is done.
            </p>
          ) : (
            <ul className="customer-task-notes__list">
              {notes.map((note) => (
                <li key={note.id}>
                  <label className="customer-task-notes__item">
                    <input type="checkbox" onChange={() => handleComplete(note.id)} />
                    <span>{note.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <form className="customer-task-notes__form" onSubmit={handleAdd}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Remind myself to…"
              aria-label={`Add reminder for ${customerName}`}
            />
            <button type="submit" disabled={!draft.trim()}>
              Add
            </button>
          </form>
        </div>
      </td>
    </tr>
  );
}
