import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { ArrowLeft, FileText, Image, Pin, Search, Send, Video, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import {
  CompanyApiError,
  fetchInbox,
  fetchThread,
  markGroupRead,
  pinMessage,
  sendMessage,
} from "./api";
import { CompanyShell } from "./CompanyApp";
import { useCompanySession } from "./session";
import { findSheetJob, useSheetJobs } from "./workflowJobs";
import type { ChatMessage, GroupThread, InboxGroup, InboxTab } from "./types";

const TABS: { id: InboxTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "mine", label: "My Projects" },
  { id: "install", label: "Install" },
];

const PIPELINE = ["Estimate", "Measure", "Selling", "Deposit", "Drawing", "Workshop", "Install"];

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatListTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return formatClock(value);
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
}

function formatDay(value: string | null | undefined) {
  if (!value) return "—";
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
}

function jobTitle(jobRef: string | null) {
  return jobRef ? `Job ${jobRef}` : "Job";
}

function projectTitle(group: InboxGroup) {
  if (group.jobRef && group.customerName) return `${group.jobRef} · ${group.customerName}`;
  return group.name;
}

function projectMeta(group: InboxGroup) {
  const when = group.installDate ? formatDay(group.installDate) : "";
  return [group.stage, when].filter(Boolean).join(" · ");
}

function serverTab(tab: InboxTab): InboxTab {
  if (tab === "mine" || tab === "install") return "all";
  return tab;
}

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : "The inbox could not be loaded.";
}

function stageIndex(stage: string | null | undefined) {
  if (!stage) return -1;
  return PIPELINE.findIndex((item) => item.toLowerCase() === stage.toLowerCase());
}

export function InboxPage() {
  const session = useCompanySession();
  const sheet = useSheetJobs();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const tab: InboxTab =
    tabParam === "unread" || tabParam === "mine" || tabParam === "install" || tabParam === "groups" || tabParam === "communities"
      ? tabParam
      : "all";
  const isAdmin = session.user.roles.includes("admin") || session.user.role === "admin";
  const [groups, setGroups] = useState<InboxGroup[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [thread, setThread] = useState<GroupThread | null>(null);
  const [pane, setPane] = useState<"list" | "chat" | "job">("list");
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [workOrder, setWorkOrder] = useState(false);
  const [prepare, setPrepare] = useState("");
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<number | null>(null);
  const tabRef = useRef<InboxTab>(tab);
  const didAutoOpen = useRef(false);
  const expireRef = useRef(session.expire);
  selectedRef.current = selectedId;
  tabRef.current = tab;
  expireRef.current = session.expire;

  function selectTab(next: InboxTab) {
    const nextParams = new URLSearchParams(params);
    if (next === "all") nextParams.delete("tab");
    else nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  }

  useEffect(() => {
    let stopped = false;

    async function refresh() {
      try {
        const inbox = await fetchInbox(serverTab(tabRef.current));
        if (stopped) return;
        setGroups(inbox.groups);
        setUnreadTotal(inbox.unreadTotal);
        setListError("");
        const currentId = selectedRef.current;
        if (
          !didAutoOpen.current &&
          currentId == null &&
          inbox.groups[0] &&
          !window.matchMedia("(max-width: 899px)").matches
        ) {
          didAutoOpen.current = true;
          setSelectedId(inbox.groups[0].id);
          setPane("chat");
          return;
        }
        if (currentId == null) return;
        const nextThread = await fetchThread(currentId);
        if (stopped) return;
        setThread(nextThread);
        await markGroupRead(currentId);
        const again = await fetchInbox(serverTab(tabRef.current));
        if (stopped) return;
        setGroups(again.groups);
        setUnreadTotal(again.unreadTotal);
      } catch (reason) {
        if (stopped) return;
        if (reason instanceof CompanyApiError && reason.status === 401) {
          expireRef.current();
          return;
        }
        setListError(errorText(reason));
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [tab, selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length, selectedId]);

  function openGroup(groupId: number) {
    setSelectedId(groupId);
    setThread(null);
    setError("");
    setPane("chat");
  }

  function pickFile(kind: "image" | "video" | "file") {
    const input = fileRef.current;
    if (!input) return;
    input.accept =
      kind === "image"
        ? "image/jpeg,image/png,image/webp,image/gif"
        : kind === "video"
          ? "video/mp4,video/webm,video/quicktime"
          : "application/pdf";
    input.multiple = kind === "image";
    input.click();
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || sending) return;
    const body = text.trim();
    if (!body && files.length === 0 && !prepare.trim()) return;
    setSending(true);
    setError("");
    try {
      const nextThread = await sendMessage(selectedId, {
        body,
        files,
        kind: workOrder ? "work_order" : "message",
        prepare: workOrder ? prepare : "",
        replyTo: replyTo?.id,
      });
      setThread(nextThread);
      setText("");
      setFiles([]);
      setPrepare("");
      setReplyTo(null);
      setWorkOrder(false);
      if (fileRef.current) fileRef.current.value = "";
      const inbox = await fetchInbox(serverTab(tab));
      setGroups(inbox.groups);
      setUnreadTotal(inbox.unreadTotal);
    } catch (reason) {
      if (reason instanceof CompanyApiError && reason.status === 401) {
        session.expire();
        return;
      }
      setError(errorText(reason));
    } finally {
      setSending(false);
    }
  }

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups.filter((group) => {
      if (tab === "mine" && !group.member) return false;
      if (tab === "install" && group.stage?.toLowerCase() !== "install") return false;
      if (!needle) return true;
      const haystack = [group.name, group.customerName, group.jobRef, group.designerName, group.lastMessage?.preview, group.lastMessage?.senderName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [groups, query, tab]);

  const openThread = thread && thread.group.id === selectedId ? thread : null;
  const job = openThread?.group.job ?? null;
  const shownMessages = openThread?.messages ?? [];

  const list = (
    <div className="company-inbox" data-testid="company-inbox">
      <header className="company-inbox__head">
        <h1>Inbox</h1>
      </header>
      <div className="company-tabs" role="tablist" aria-label="Inbox">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "company-tab company-tab--on" : "company-tab"}
            onClick={() => selectTab(item.id)}
          >
            {item.label}
            {item.id === "unread" && unreadTotal > 0 ? <span className="company-count">{unreadTotal}</span> : null}
          </button>
        ))}
      </div>
      <label className="company-search">
        <Search size={16} />
        <span className="company-sr">Search conversations</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search queue, customer, or designer"
        />
      </label>
      {listError ? (
        <p className="company-error" role="alert">
          {listError}
        </p>
      ) : null}
      {visibleGroups.length === 0 ? (
        <p className="company-empty" data-testid="inbox-empty">
          {query
            ? "No conversations match."
            : tab === "communities"
              ? "No communities yet."
              : tab === "unread"
                ? "No unread messages."
                : "No groups yet. You only see groups you are in."}
        </p>
      ) : (
        <ul className="company-groups">
          {visibleGroups.map((group) => (
            <li key={group.id}>
              <button
                type="button"
                className={group.id === selectedId ? "company-row company-row--on" : "company-row"}
                onClick={() => openGroup(group.id)}
                data-testid={`group-${group.id}`}
                data-group-name={group.name}
              >
                <span className="company-thumb" aria-hidden="true">
                  {group.name.slice(0, 1)}
                </span>
                <span className="company-row__body">
                  <span className="company-row__top">
                    <span className={group.unreadCount > 0 ? "company-row__name company-row__name--unread" : "company-row__name"}>
                      {projectTitle(group)}
                    </span>
                    <span className="company-row__time">
                      {group.lastMessage ? formatListTime(group.lastMessage.createdAt) : ""}
                    </span>
                  </span>
                  <span className="company-row__sub">
                    {projectMeta(group)}
                    {group.designerName ? ` · ${group.designerName}` : ""}
                  </span>
                  <span className="company-row__preview">
                    {group.lastMessage
                      ? `${group.lastMessage.senderName}: ${group.lastMessage.preview}`
                      : "No messages yet"}
                  </span>
                </span>
                {group.unreadCount > 0 ? <span className="company-badge">{group.unreadCount}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const memberLine = openThread?.group.members.map((member) => member.displayName).join(", ") ?? "";
  const conversation = openThread ? (
    <div className="company-thread" data-testid="company-thread">
      <header className="company-thread__head">
        <button type="button" className="company-icon-button company-back" onClick={() => setPane("list")} aria-label="Back to inbox">
          <ArrowLeft size={18} />
        </button>
        <span className="company-thumb company-thumb--sm" aria-hidden="true">
          {openThread.group.name.slice(0, 1)}
        </span>
        <div className="company-thread__title">
          <h1>{job ? `${job.jobRef} · ${job.customerName}` : openThread.group.name}</h1>
          <p>
            {[job?.stage, job?.installDate ? formatDay(job.installDate) : "", job?.designerName ? `Designer ${job.designerName}` : ""]
              .filter(Boolean)
              .join(" · ") || memberLine || "Project chat"}
          </p>
        </div>
        <button type="button" className="company-text company-details" onClick={() => setPane("job")}>
          Details
        </button>
      </header>
      {job ? (
        <section className="company-context">
          <strong>Queue {job.jobRef}</strong>
          <span>{job.customerName}</span>
          <span>Designer {job.designerName || "—"}</span>
          <span>Install {formatDay(job.installDate)}</span>
          <span>{job.stage}</span>
          {job.notes ? <p>{job.notes}</p> : null}
        </section>
      ) : null}
      <MessageList
        messages={shownMessages}
        bottomRef={bottomRef}
        canPin={isAdmin}
        onReply={setReplyTo}
        onPin={(messageId) => {
          if (!selectedId) return;
          void pinMessage(selectedId, messageId)
            .then(setThread)
            .catch((reason) => setError(errorText(reason)));
        }}
      />
      <form className="company-composer" onSubmit={onSend}>
        {replyTo ? (
          <p className="company-file">
            Reply to {replyTo.sender.displayName}: {replyTo.body || "Attachment"}
            <button type="button" className="company-icon-button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
              <X size={14} />
            </button>
          </p>
        ) : null}
        {files.length > 0 ? (
          <p className="company-file">
            {files.length === 1 ? files[0].name : `${files.length} files`}
            <button
              type="button"
              className="company-icon-button"
              aria-label="Remove files"
              onClick={() => {
                setFiles([]);
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              <X size={14} />
            </button>
          </p>
        ) : null}
        {workOrder ? (
          <label className="company-prepare">
            Prepare, one item per line
            <textarea value={prepare} onChange={(event) => setPrepare(event.target.value)} rows={3} />
          </label>
        ) : null}
        <div className="company-composer__tools">
          <button type="button" onClick={() => pickFile("image")}>
            <Image size={16} /> Photo
          </button>
          <button type="button" onClick={() => pickFile("video")}>
            <Video size={16} /> Video
          </button>
          <button type="button" onClick={() => pickFile("file")}>
            <FileText size={16} /> File
          </button>
          {isAdmin ? (
            <button type="button" className={workOrder ? "company-tool--on" : ""} onClick={() => setWorkOrder((open) => !open)}>
              Work order
            </button>
          ) : null}
        </div>
        <div className="company-composer__bar">
          <label className="company-sr" htmlFor="company-message">
            Message
          </label>
          <textarea
            id="company-message"
            rows={1}
            maxLength={4000}
            placeholder={workOrder ? "Important notes for this job" : "Message this project"}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" className="company-send" disabled={sending || (!text.trim() && files.length === 0 && !prepare.trim())} aria-label="Send">
            <Send size={16} />
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 8))}
        />
        {error ? (
          <p className="company-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  ) : selectedId ? (
    <div className="company-page">
      <p>Loading…</p>
    </div>
  ) : (
    <div className="company-page">
      <header className="company-page__head">
        <h1>Inbox</h1>
      </header>
      <p>Select a conversation. Installers only see their own groups.</p>
    </div>
  );

  const sheetMatch = findSheetJob(sheet.jobs, job?.jobRef);
  const shownStage = sheetMatch?.stage ?? job?.stage ?? null;
  const activeStage = stageIndex(shownStage);
  const jobPanel = openThread ? (
    <div className="company-job__inner" data-testid="job-panel">
      <header className="company-job__head">
        <button type="button" className="company-icon-button company-back" onClick={() => setPane("chat")} aria-label="Back to chat">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2>{sheetMatch ? jobTitle(sheetMatch.jobRef) : job ? jobTitle(job.jobRef) : openThread.group.name}</h2>
          {shownStage ? <span className="company-pill">{shownStage}</span> : null}
        </div>
      </header>
      <div className="company-job__body">
        {job || sheetMatch ? (
          <dl className="company-facts">
            <div>
              <dt>Customer</dt>
              <dd>{sheetMatch?.customerName ?? job?.customerName}</dd>
            </div>
            <div>
              <dt>Designer</dt>
              <dd>{sheetMatch?.designer ?? job?.designerName ?? "—"}</dd>
            </div>
            <div>
              <dt>Queue</dt>
              <dd>{sheetMatch?.jobRef ?? job?.jobRef ?? "—"}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{sheetMatch?.amount || "—"}</dd>
            </div>
            <div>
              <dt>Install</dt>
              <dd>{formatDay(sheetMatch?.installDate || job?.installDate)}</dd>
            </div>
            <div>
              <dt>Deadline</dt>
              <dd>{formatDay(sheetMatch?.deadline || job?.deadline)}</dd>
            </div>
          </dl>
        ) : (
          <p className="company-empty">This chat is not linked to a sheet row.</p>
        )}
        <h3>Stage</h3>
        <ol className="company-pipeline">
          {PIPELINE.map((stage, index) => (
            <li key={stage} className={index <= activeStage ? "company-pipeline__step company-pipeline__step--on" : "company-pipeline__step"}>
              <span />
              {stage}
            </li>
          ))}
        </ol>
        <a className="company-outline" href="/company/jobs">
          Open the sheet
        </a>
        {sheet.error ? <p className="company-error">{sheet.error}</p> : null}
      </div>
    </div>
  ) : (
    <p className="company-empty">Job details appear when a conversation is open.</p>
  );

  return (
    <CompanyShell pane={pane} list={list} job={jobPanel}>
      {conversation}
    </CompanyShell>
  );
}

function MessageList({
  messages,
  bottomRef,
  canPin,
  onReply,
  onPin,
}: {
  messages: ChatMessage[];
  bottomRef: RefObject<HTMLDivElement | null>;
  canPin: boolean;
  onReply: (message: ChatMessage) => void;
  onPin: (messageId: number) => void;
}) {
  const pinned = messages.filter((message) => message.pinned);
  let previousDay = "";
  return (
    <div className="company-messages" data-testid="message-list">
      {pinned.length > 0 ? (
        <div className="company-pins">
          {pinned.map((message) => (
            <p key={message.id}>
              <Pin size={12} /> {message.body || "Pinned attachment"}
            </p>
          ))}
        </div>
      ) : null}
      {messages.map((message) => {
        const label = dayLabel(message.createdAt);
        const showDay = label !== previousDay;
        previousDay = label;
        const images = (message.attachments ?? []).filter((item) => item.kind === "image");
        const videos = (message.attachments ?? []).filter((item) => item.kind === "video");
        const files = (message.attachments ?? []).filter((item) => item.kind === "file");
        return (
          <div key={message.id}>
            {showDay ? <p className="company-day">{label}</p> : null}
            <article className={message.mine ? "company-msg company-msg--mine" : "company-msg"}>
              <span className="company-avatar company-avatar--sm">{message.sender.displayName.slice(0, 1)}</span>
              <div className={message.kind === "work_order" ? "company-msg__card company-msg__card--order" : "company-msg__card"}>
                <p className="company-msg__who">
                  <strong>{message.sender.displayName}</strong>
                  <time dateTime={message.createdAt}>{formatClock(message.createdAt)}</time>
                </p>
                {message.kind === "work_order" ? <span className="company-pill">Work order</span> : null}
                {message.reply ? (
                  <p className="company-reply">
                    {message.reply.senderName}: {message.reply.body || "Attachment"}
                  </p>
                ) : null}
                {message.prepare?.length ? (
                  <ul className="company-prepare-list">
                    {message.prepare.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
                {message.body ? <p className="company-msg__body">{message.body}</p> : null}
                {images.length > 0 ? (
                  <div className="company-gallery">
                    {images.map((item) => (
                      <img key={item.id} src={item.url} alt={item.fileName} />
                    ))}
                  </div>
                ) : null}
                {videos.map((item) => (
                  <video key={item.id} src={item.url} controls preload="metadata" />
                ))}
                {files.map((item) => (
                  <a key={item.id} className="company-file-link" href={item.url} target="_blank" rel="noreferrer">
                    {item.fileName}
                  </a>
                ))}
                <p className="company-msg__actions">
                  <button type="button" onClick={() => onReply(message)}>
                    Reply
                  </button>
                  {canPin ? (
                    <button type="button" onClick={() => onPin(message.id)}>
                      {message.pinned ? "Unpin" : "Pin"}
                    </button>
                  ) : null}
                </p>
              </div>
            </article>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

