const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  projects: [],
  installers: [],
  selectedId: null,
};

let pollTimer = 0;
let polling = false;

function show(name) {
  $("#view-login").hidden = name !== "login";
  $("#view-admin").hidden = name !== "admin";
  $("#view-installer").hidden = name !== "installer";
  document.body.dataset.view = name;
}

function stopPoll() {
  clearInterval(pollTimer);
  pollTimer = 0;
}

function startPoll(fn) {
  stopPoll();
  pollTimer = setInterval(() => tick(fn), 2500);
}

async function tick(fn) {
  if (polling) return;
  polling = true;
  try {
    await fn();
  } catch {
    // The request helper already sends the user back to sign-in on 401.
  } finally {
    polling = false;
  }
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body && typeof body === "object" && !(body instanceof FormData)) {
    body = JSON.stringify(body);
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...options, body, headers, credentials: "same-origin" });
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }
  if (res.status === 401) {
    stopPoll();
    show("login");
    throw new Error(data.error || "Sign in required");
  }
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function messageKey(projectId, messages) {
  return `${projectId}|${messages
    .map((message) => `${message.id}:${message.authorName}:${message.body || ""}:${message.mediaUrl || ""}`)
    .join("|")}`;
}

function renderBubble(message, scroller) {
  const item = document.createElement("article");
  item.className = `bubble${message.mine ? " mine" : ""}`;

  const meta = document.createElement("div");
  meta.className = "meta";
  const who = document.createElement("span");
  who.textContent = message.authorName;
  const when = document.createElement("time");
  when.dateTime = message.createdAt;
  when.textContent = formatTime(message.createdAt);
  meta.append(who, when);
  item.append(meta);

  if (message.body) {
    const body = document.createElement("p");
    body.className = "body";
    body.textContent = message.body;
    item.append(body);
  }

  if (message.mediaUrl && message.mediaType === "image") {
    const img = document.createElement("img");
    img.src = message.mediaUrl;
    img.alt = message.mediaName || "Photo";
    img.addEventListener("load", () => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    item.append(img);
  } else if (message.mediaUrl && message.mediaType === "video") {
    const video = document.createElement("video");
    video.controls = true;
    video.preload = "metadata";
    video.src = message.mediaUrl;
    item.append(video);
  }

  return item;
}

function renderMessages(el, projectId, messages) {
  const key = messageKey(projectId, messages);
  if (el.dataset.key === key) return;
  el.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "muted empty-thread";
    empty.textContent = "No messages yet.";
    el.append(empty);
  } else {
    for (const message of messages) el.append(renderBubble(message, el));
  }
  el.dataset.key = key;
  el.scrollTop = el.scrollHeight;
}

function peopleBusy() {
  const active = document.activeElement;
  return Boolean(active && active.closest("#installer-list"));
}

function renderProjects() {
  const list = $("#project-list");
  list.replaceChildren();
  for (const project of state.projects) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project${project.id === state.selectedId ? " active" : ""}`;
    if (project.id === state.selectedId) button.setAttribute("aria-current", "true");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = project.name;
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = project.installers.length ? project.installers.join(", ") : "No installer";
    button.append(name, who);
    button.addEventListener("click", () => {
      if (state.selectedId === project.id) return;
      state.selectedId = project.id;
      $("#admin-messages").dataset.key = "";
      $("#admin-error").textContent = "";
      renderProjects();
      renderThreadHead();
      refreshMessages();
      if (!peopleBusy()) renderInstallers();
    });
    list.append(button);
  }
}

function renderThreadHead() {
  const project = state.projects.find((item) => item.id === state.selectedId);
  $("#thread-title").textContent = project ? project.name : "Select a project";
  $("#thread-who").textContent = project
    ? project.installers.length
      ? `In this chat: ${project.installers.join(", ")}`
      : "In this chat: nobody yet"
    : "";
  $("#admin-composer").hidden = !project;
}

function moveLabel(person, projectId) {
  if (projectId === person.activeProjectId) return "Already here";
  if (projectId === state.selectedId) return "Move into this chat";
  return "Move";
}

function renderInstallers() {
  const root = $("#installer-list");
  root.replaceChildren();
  for (const person of state.installers) {
    const card = document.createElement("article");
    card.className = `person${person.activeProjectId === state.selectedId ? " here" : ""}`;

    const head = document.createElement("div");
    head.className = "person-head";
    const name = document.createElement("strong");
    name.textContent = person.displayName;
    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "ghost";
    renameBtn.textContent = "Rename";
    head.append(name, renameBtn);

    const login = document.createElement("p");
    login.className = "muted tiny";
    login.textContent = person.username;

    const now = document.createElement("p");
    now.className = "now";
    now.textContent = person.activeProjectName ? `Now in: ${person.activeProjectName}` : "Now in: —";

    const here = document.createElement("p");
    here.className = "pill";
    here.textContent = "In this chat";
    here.hidden = person.activeProjectId !== state.selectedId;

    const renameForm = document.createElement("form");
    renameForm.className = "rename";
    renameForm.hidden = true;
    const nameInput = document.createElement("input");
    nameInput.value = person.displayName;
    nameInput.maxLength = 40;
    nameInput.required = true;
    nameInput.autocomplete = "off";
    nameInput.setAttribute("aria-label", `New name for ${person.displayName}`);
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save";
    renameForm.append(nameInput, save);

    renameBtn.addEventListener("click", () => {
      renameForm.hidden = !renameForm.hidden;
      if (!renameForm.hidden) nameInput.focus();
    });
    renameForm.addEventListener("submit", (event) => {
      event.preventDefault();
      renameInstaller(person, nameInput.value);
    });

    const moveForm = document.createElement("form");
    moveForm.className = "move";
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Move ${person.displayName} to`);
    for (const project of state.projects) {
      const option = document.createElement("option");
      option.value = String(project.id);
      option.textContent = project.name;
      select.append(option);
    }
    if (state.selectedId && person.activeProjectId !== state.selectedId) {
      select.value = String(state.selectedId);
    } else {
      const other = state.projects.find((project) => project.id !== person.activeProjectId);
      if (other) select.value = String(other.id);
    }
    const moveBtn = document.createElement("button");
    moveBtn.type = "submit";
    const syncMoveBtn = () => {
      const projectId = Number(select.value);
      moveBtn.textContent = moveLabel(person, projectId);
      moveBtn.disabled = !projectId || projectId === person.activeProjectId;
    };
    select.addEventListener("change", syncMoveBtn);
    syncMoveBtn();
    moveForm.append(select, moveBtn);
    moveForm.addEventListener("submit", (event) => {
      event.preventDefault();
      moveInstaller(person, Number(select.value), moveBtn);
    });

    card.append(head, login, now, here, renameForm, moveForm);
    root.append(card);
  }
}

async function refreshMessages() {
  if (!state.selectedId) return;
  const data = await api(`/api/projects/${state.selectedId}/messages`);
  renderMessages($("#admin-messages"), state.selectedId, data.messages);
}

async function refreshAdmin({ forcePeople = false } = {}) {
  const [projects, installers] = await Promise.all([
    api("/api/projects"),
    api("/api/installers"),
  ]);
  state.projects = projects.projects;
  state.installers = installers.installers;
  if (!state.projects.some((project) => project.id === state.selectedId)) {
    state.selectedId = state.projects[0]?.id ?? null;
    $("#admin-messages").dataset.key = "";
  }
  renderProjects();
  renderThreadHead();
  if (state.selectedId) await refreshMessages();
  if (forcePeople || !peopleBusy()) renderInstallers();
}

async function refreshInstaller() {
  const data = await api("/api/chat");
  const project = data.project;
  $("#job-title").textContent = project ? project.name : "No job yet";
  document.title = project ? `${project.name} · Kiddai` : "Kiddai Install";
  $("#installer-empty").hidden = Boolean(project);
  $("#installer-messages").hidden = !project;
  $("#installer-composer").hidden = !project;
  if (!project) {
    $("#installer-messages").dataset.key = "";
    $("#installer-messages").replaceChildren();
    return;
  }
  renderMessages($("#installer-messages"), project.id, data.messages);
}

function setFileLabel(prefix, file) {
  $(`#${prefix}-file-name`).textContent = file ? file.name : "";
  $(`#${prefix}-file-clear`).hidden = !file;
}

function clearFile(prefix) {
  const input = $(`#${prefix}-file`);
  input.value = "";
  setFileLabel(prefix, null);
}

function bindFilePicker(prefix, modes) {
  const input = $(`#${prefix}-file`);
  input.addEventListener("change", () => setFileLabel(prefix, input.files[0] || null));
  $(`#${prefix}-file-clear`).addEventListener("click", () => clearFile(prefix));
  for (const [id, accept] of Object.entries(modes)) {
    $(id).addEventListener("click", () => {
      input.accept = accept;
      input.value = "";
      input.click();
    });
  }
}

function selectedFile(prefix, errorId, imagesOnly) {
  const file = $(`#${prefix}-file`).files[0] || null;
  if (!file) return null;
  if (file.size > 80 * 1024 * 1024) {
    $(errorId).textContent = "File is too large (max 80 MB)";
    return false;
  }
  if (imagesOnly && !file.type.startsWith("image/")) {
    $(errorId).textContent = "Photos only";
    return false;
  }
  return file;
}

async function sendMessage(url, prefix, errorId, imagesOnly) {
  const text = $(`#${prefix}-text`).value.trim();
  const file = selectedFile(prefix, errorId, imagesOnly);
  if (file === false) return;
  if (!text && !file) {
    $(errorId).textContent = "Write a message or attach a file";
    return;
  }
  const form = new FormData();
  if (text) form.append("body", text);
  if (file) form.append("file", file);
  const button = $(`#${prefix}-composer button[type="submit"]`);
  button.disabled = true;
  $(errorId).textContent = "";
  try {
    await api(url, { method: "POST", body: form });
    $(`#${prefix}-text`).value = "";
    clearFile(prefix);
    if (prefix === "admin") await refreshAdmin();
    else await refreshInstaller();
  } catch (error) {
    $(errorId).textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function moveInstaller(person, projectId, button) {
  const status = $("#move-status");
  button.disabled = true;
  status.textContent = "Moving…";
  try {
    const data = await api(`/api/installers/${person.id}`, {
      method: "PATCH",
      body: { projectId },
    });
    const project = state.projects.find((item) => item.id === projectId);
    const place = project ? project.name : "that project";
    status.textContent = data.already
      ? `${data.installer.displayName} is already in ${place}.`
      : `Moved ${data.installer.displayName} to ${place}.`;
    await refreshAdmin({ forcePeople: true });
  } catch (error) {
    status.textContent = error.message;
  }
}

async function renameInstaller(person, displayName) {
  const status = $("#move-status");
  try {
    const data = await api(`/api/installers/${person.id}`, {
      method: "PATCH",
      body: { displayName },
    });
    status.textContent = `Renamed to ${data.installer.displayName}. Login stays ${data.installer.username}.`;
    $("#admin-messages").dataset.key = "";
    await refreshAdmin({ forcePeople: true });
  } catch (error) {
    status.textContent = error.message;
  }
}

async function logout() {
  stopPoll();
  await api("/api/logout", { method: "POST" }).catch(() => {});
  state.projects = [];
  state.installers = [];
  state.selectedId = null;
  $("#move-status").textContent = "";
  $("#login-error").textContent = "";
  $("#login-form").reset();
  document.title = "Kiddai Install";
  show("login");
  $("#login-form [name=username]").focus();
}

async function enter(user) {
  if (user.role === "admin") {
    show("admin");
    $("#admin-who").textContent = user.displayName;
    document.title = "Kiddai Install";
    await refreshAdmin({ forcePeople: true });
    startPoll(() => refreshAdmin());
    return;
  }
  show("installer");
  await refreshInstaller();
  startPoll(refreshInstaller);
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  $("#login-error").textContent = "";
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: {
        username: form.username.value,
        password: form.password.value,
      },
    });
    form.reset();
    await enter(data.user);
  } catch (error) {
    $("#login-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#new-project").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#new-project-name");
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const data = await api("/api/projects", {
      method: "POST",
      body: { name: input.value },
    });
    input.value = "";
    state.selectedId = data.project.id;
    $("#admin-messages").dataset.key = "";
    $("#move-status").textContent = `Added ${data.project.name}.`;
    await refreshAdmin({ forcePeople: true });
  } catch (error) {
    $("#move-status").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#admin-composer").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.selectedId) return;
  sendMessage(`/api/projects/${state.selectedId}/messages`, "admin", "#admin-error", false);
});

$("#admin-text").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    $("#admin-composer").requestSubmit();
  }
});

$("#installer-composer").addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage("/api/chat/messages", "installer", "#installer-error", true);
});

$("#admin-logout").addEventListener("click", logout);
$("#installer-logout").addEventListener("click", logout);

bindFilePicker("admin", {
  "#admin-photo": "image/jpeg,image/png,image/webp,image/gif",
  "#admin-video": "video/mp4,video/webm,video/quicktime",
});
bindFilePicker("installer", {
  "#installer-photo": "image/jpeg,image/png,image/webp,image/gif",
});

const me = await api("/api/me").catch(() => null);
if (me?.user) await enter(me.user);
else {
  show("login");
  $("#login-form [name=username]").focus();
}
