# KIDDAI Workspace Web

Browser version of KIDDAI Workspace. Same main workflows as the Tauri desktop app, without local Finder/folder access.

## What works in the browser

- Deposit Customers and Selling Customers lists from the Workflow Google Sheet
- Google login (Sheets + Drive)
- Search project folders in Google Drive
- Open folders in Google Drive (browser tab)
- Create QC / Quotation / Presentation sheets in Drive
- Import CSV into QC via the browser file picker
- Create queue-number folders in Drive
- Open sticker and customer contact links

## What is different from the desktop app

| Desktop | Web |
|---|---|
| Open local Shared Drive / Finder | Opens Google Drive folder URLs |
| Browse local folder paths in Settings | Paste Drive folder URL / ID |
| CSV via native file dialog | Browser file picker |
| Manual DMG updates | Deploy once — users refresh |

## Setup

1. Make sure the desktop OAuth file exists (reused by the web app):

```text
src-tauri/secrets/google-oauth-client.json
```

2. Optional env override:

```bash
cd web
cp .env.example .env
```

3. Install and run from the **web** folder:

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:5173`.

4. In Settings, click **Connect Google**. The browser redirects to Google and returns to the app.

## First-time Settings (required for everything to work)

1. **Connect Google** with the same account that can open your team **Shared drives**
2. Confirm **Workflow Google Sheet** URL → Save → Test
3. **Shared Drives** (Deposit): click **Refresh Shared Drives**
   - The app lists drives like `[3] มัดจำแล้ว 2301 - 2600`
   - Project `2500` auto-opens that drive; no need to paste each drive
   - When you add a new Shared Drive for a new range, Refresh once (or wait a few minutes)
4. **Kiddai2 folder** (Selling): paste Kiddai2 Shared Drive folder URL → **Verify & Save Kiddai2**

Important:
- Always run `npm run dev` inside `web/`
- Deposit does **not** need one pasted Shared Drive link for all projects
- Use the Google account that is a member of those Shared drives

## Build for production

```bash
npm run build
```

Deploy the **`web/`** folder to Netlify (not the parent desktop app folder).

See [DEPLOY.md](./DEPLOY.md) for Netlify settings, env vars, and Google redirect URIs.

Note: Google Connect on Netlify uses Netlify Functions in `netlify/functions/`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Netlify environment variables.
