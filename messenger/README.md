# Kiddai Install

In-house messenger for installation jobs. The company writes what the installer needs in a project chat. The installer sees that one chat and can reply with text and photos.

This app does not read or write the company spreadsheet. Installers never open that sheet. There is no company-wide room and no Line or Slack connection.

## Demo logins

One admin. Three placeholder installers. Admin can rename them on screen. The login stays the same.

| Who | Name on screen | Username | Password |
| --- | --- | --- | --- |
| Admin | Admin | `admin` | `kiddai-admin` |
| Installer | Installer 1 | `installer1` | `install-1` |
| Installer | Installer 2 | `installer2` | `install-2` |
| Installer | Installer 3 | `installer3` | `install-3` |

Sample chats, so a move is visible right away:

- **Bangna kitchen** — Installer 1 is in this chat
- **Chiang Mai wardrobe** — Installer 2 is in this chat
- Installer 3 is waiting. Admin moves them in.

Passwords above are for the first run only. Set `ADMIN_PASSWORD`, `INSTALLER1_PASSWORD`, `INSTALLER2_PASSWORD`, and `INSTALLER3_PASSWORD` before the first start if you want different ones. To load the sample again, stop the server and delete the `data` folder.

## Run it here

Node.js 22 or newer.

```bash
cd messenger
npm install
npm start
```

Open `http://localhost:8787`.

## Run it on our own server

Same three commands on the machine that will keep the chats. The app is one process: the site, the API, and SQLite. Nothing else has to be running.

```bash
cd messenger
npm install
PORT=8787 npm start
```

`PORT` defaults to `8787`. `HOST` defaults to `0.0.0.0`. Put the process behind your own firewall. Sign-in is the only door; there is no public signup.

Optional environment variables:

| Name | Purpose |
| --- | --- |
| `PORT` | Listen port. Default `8787`. |
| `HOST` | Listen address. Default `0.0.0.0`. |
| `DATA_DIR` | Folder for the database and media. Default `messenger/data`. |
| `ADMIN_PASSWORD` | Admin password, used only when the database is created. |
| `INSTALLER1_PASSWORD` | Installer 1 password, first run only. |
| `INSTALLER2_PASSWORD` | Installer 2 password, first run only. |
| `INSTALLER3_PASSWORD` | Installer 3 password, first run only. |

A process manager such as systemd can keep `npm start` up after reboot. Keep the working directory as `messenger/` so the default `data` folder stays next to the app, or set `DATA_DIR` to a permanent path.

## Media stays on disk

Photos and videos are files on this server, not in the database and not in Google Drive.

```text
messenger/data/kiddai.sqlite    accounts, projects, messages
messenger/data/media/           photos and videos
```

Back up the whole `data` folder. If that folder is deleted, the chats and the files are gone.

Photos: JPG, PNG, WEBP, or GIF. Video: MP4, WEBM, or MOV. Limit 80 MB. Installers can send photos. Admin can send photos and video.

## What each person sees

- **Admin** sees every project, the message thread, and a control to move an installer into the open chat or to another project. Admin can also rename an installer and add a project.
- **Installer** sees one phone-sized chat: the project they were moved into. They do not get a list of groups. Moving them switches that same box. The old conversation stays on the old project.
- One installer is in one project at a time. Several installers can be in the same project chat.
