import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { addMember, groupDetail, markRead, readPhotoFile, removeMember, sendPhoto, sendText, setMuted, setQueue } from "./api";
import { formatClock, messageBlocks } from "./format";
import { BellIcon, ChevronLeftIcon, GroupAvatar, MutedBellIcon, PlusIcon, SendIcon } from "./icons";
import { useMessenger } from "./MessengerContext";
import type { GroupDetail } from "./types";

export function ChatScreen() {
  const { groupId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { viewer, reloadPeople } = useMessenger();
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [memberName, setMemberName] = useState("");
  const [queueDraft, setQueueDraft] = useState("");
  const openAddPanel = Boolean((location.state as { add?: boolean } | null)?.add);
  const [panelOpen, setPanelOpen] = useState(openAddPanel);
  const [revision, setRevision] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDetail(null);
    setText("");
    setNotice(null);
    setFormError(null);
    setLoadError(null);
    setMemberName("");
    setPanelOpen(openAddPanel);
  }, [groupId, viewer?.id, openAddPanel]);

  useEffect(() => {
    if (!viewer || !groupId) {
      return;
    }
    let ignore = false;
    let timer = 0;
    const load = async () => {
      try {
        const next = await groupDetail(groupId, viewer.id);
        if (ignore) {
          return;
        }
        setDetail(next);
        setLoadError(null);
        const hasOther = next.messages.some((message) => message.senderId !== viewer.id);
        if (hasOther || next.group.unread) {
          await markRead(groupId, viewer.id);
        }
      } catch (error) {
        if (ignore) {
          return;
        }
        const message = error instanceof Error ? error.message : "Could not open this group.";
        setLoadError(message);
        if (message.includes("not in this group") || message.includes("not found") || message.includes("Choose a person")) {
          window.clearInterval(timer);
        }
      }
    };
    void load();
    timer = window.setInterval(() => void load(), 2000);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [viewer, groupId, revision]);

  useEffect(() => {
    setQueueDraft(detail?.group.queueNumber ?? "");
  }, [detail?.group.id, detail?.group.queueNumber]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [detail?.messages.length]);

  async function onSendText() {
    if (!viewer || !groupId || sending) {
      return;
    }
    const draft = text.trim();
    if (!draft) {
      return;
    }
    setSending(true);
    setFormError(null);
    try {
      await sendText(groupId, viewer.id, draft);
      setText("");
      setRevision((current) => current + 1);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not send that message.");
    } finally {
      setSending(false);
    }
  }

  async function onPhoto(file: File | undefined) {
    if (!viewer || !groupId || !file || sending) {
      return;
    }
    setSending(true);
    setFormError(null);
    try {
      const dataUrl = await readPhotoFile(file);
      await sendPhoto(groupId, viewer.id, dataUrl);
      setRevision((current) => current + 1);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not send that photo.");
    } finally {
      setSending(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  }

  async function onAddMember() {
    if (!viewer || !groupId) {
      return;
    }
    const name = memberName.trim();
    if (!name) {
      return;
    }
    setFormError(null);
    try {
      const result = await addMember(groupId, viewer.id, name);
      setMemberName("");
      setDetail((current) =>
        current
          ? {
              ...current,
              members: result.members,
              group: { ...current.group, memberCount: result.members.length },
            }
          : current,
      );
      await reloadPeople();
      setNotice(result.alreadyMember ? `${name} is already in this group.` : `Added ${name}.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not add that person.");
    }
  }

  async function onRemove(memberId: string) {
    if (!viewer || !groupId) {
      return;
    }
    setFormError(null);
    try {
      const result = await removeMember(groupId, viewer.id, memberId);
      setDetail((current) =>
        current
          ? {
              ...current,
              members: result.members,
              group: { ...current.group, memberCount: result.members.length },
            }
          : current,
      );
      await reloadPeople();
      setNotice("Removed from this group.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not remove that person.");
    }
  }

  async function onSaveQueue() {
    if (!viewer || !detail) {
      return;
    }
    setFormError(null);
    try {
      const result = await setQueue(detail.group.id, viewer.id, queueDraft);
      setDetail((current) => (current ? { ...current, group: result.group } : current));
      setNotice(result.group.queueNumber ? `Queue set to ${result.group.queueNumber}.` : "Queue cleared.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save that queue number.");
    }
  }

  async function onToggleMute() {
    if (!viewer || !detail) {
      return;
    }
    try {
      await setMuted(detail.group.id, viewer.id, !detail.group.muted);
      setRevision((current) => current + 1);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not change mute.");
    }
  }

  if (!viewer) {
    return null;
  }

  if (!detail) {
    return (
      <div className="chat" data-testid="chat">
        <header className="chat-header">
          <button type="button" className="icon-button" aria-label="Back" onClick={() => navigate("/install")}>
            <ChevronLeftIcon />
          </button>
        </header>
        <p className="empty" data-testid="chat-error">
          {loadError ?? "Loading…"}
        </p>
      </div>
    );
  }

  const blocks = messageBlocks(detail.messages);
  const memberLabel = detail.group.memberCount === 1 ? "1 member" : `${detail.group.memberCount} members`;
  const queueLabel = detail.group.queueNumber ? `Queue ${detail.group.queueNumber}` : "";

  return (
    <div className="chat" data-testid="chat">
      <header className="chat-header">
        <button type="button" className="icon-button" aria-label="Back" data-testid="chat-back" onClick={() => navigate("/install")}>
          <ChevronLeftIcon />
        </button>
        <GroupAvatar name={detail.group.name} size={40} />
        <span className="chat-title">
          <strong>{detail.group.name}</strong>
          <span>{queueLabel ? `${queueLabel} · ${memberLabel}` : memberLabel}</span>
        </span>
        <button
          type="button"
          className={detail.group.muted ? "icon-button icon-button--muted" : "icon-button"}
          aria-label={detail.group.muted ? "Unmute" : "Mute"}
          aria-pressed={detail.group.muted}
          data-testid="toggle-mute"
          onClick={() => void onToggleMute()}
        >
          {detail.group.muted ? <MutedBellIcon /> : <BellIcon />}
        </button>
        {viewer.role === "admin" ? (
          <button type="button" className="text-button" data-testid="open-members" onClick={() => setPanelOpen((open) => !open)}>
            Add
          </button>
        ) : null}
      </header>

      {detail.group.queueNumber ? (
        <div className="job-bar" data-testid="chat-queue">
          Queue {detail.group.queueNumber}
        </div>
      ) : null}

      {panelOpen && viewer.role === "admin" ? (
        <section className="member-panel">
          <p className="member-help">Queue number is the job id after deposit. The messages in this chat are for that job.</p>
          <form
            className="member-form"
            onSubmit={(event) => {
              event.preventDefault();
              void onSaveQueue();
            }}
          >
            <input
              data-testid="queue-input"
              inputMode="numeric"
              value={queueDraft}
              placeholder="Queue number"
              onChange={(event) => setQueueDraft(event.target.value)}
            />
            <button type="submit" data-testid="save-queue">
              Save
            </button>
          </form>
          <p className="member-help">Type a name to add someone. Remove them to move them out.</p>
          <form
            className="member-form"
            onSubmit={(event) => {
              event.preventDefault();
              void onAddMember();
            }}
          >
            <input
              data-testid="member-name"
              value={memberName}
              placeholder="Type a name"
              onChange={(event) => setMemberName(event.target.value)}
            />
            <button type="submit" data-testid="add-member">
              Add
            </button>
          </form>
          {notice ? <p className="form-note">{notice}</p> : null}
          <ul className="member-list">
            {detail.members.map((member) => (
              <li key={member.id} data-testid="member-row" data-member-name={member.name}>
                <span>{member.name}</span>
                <span className="member-role">{member.role === "admin" ? "Admin" : "Installer"}</span>
                {member.role === "installer" ? (
                  <button type="button" className="link-danger" data-testid="remove-member" onClick={() => void onRemove(member.id)}>
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="chat-log">
        {blocks.map((block) => (
          <div key={block.day}>
            <div className="day-chip">{block.day}</div>
            {block.messages.map((message, index) => {
              const mine = message.senderId === viewer.id;
              const previous = block.messages[index - 1];
              const showName = !mine && (!previous || previous.senderId !== message.senderId);
              return (
                <div key={message.id} className={mine ? "msg msg--out" : "msg"} data-testid="message">
                  {showName ? <div className="msg-name">{message.senderName}</div> : null}
                  <div className="msg-line">
                    {message.kind === "photo" && message.photoUrl ? (
                      <div className="bubble bubble--photo">
                        <img src={message.photoUrl} alt="Photo" data-testid="chat-photo" />
                      </div>
                    ) : (
                      <div className="bubble" data-testid="chat-text">
                        {message.text}
                      </div>
                    )}
                    <span className="msg-time">{formatClock(message.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {formError ? <p className="banner">{formError}</p> : null}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void onSendText();
        }}
      >
        <button type="button" className="icon-button" aria-label="Send a photo" onClick={() => fileRef.current?.click()}>
          <PlusIcon />
        </button>
        <input
          ref={fileRef}
          data-testid="photo-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(event) => void onPhoto(event.target.files?.[0])}
        />
        <textarea
          data-testid="message-input"
          rows={1}
          value={text}
          placeholder="Message"
          maxLength={2000}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void onSendText();
            }
          }}
        />
        <button className="send" type="submit" data-testid="send-message" aria-label="Send" disabled={!text.trim() || sending}>
          <SendIcon />
        </button>
      </form>
    </div>
  );
}
