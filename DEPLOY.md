# Deploy checklist (Netlify)

## Folder to drag into Netlify

After `npm run build`, drag this folder onto Netlify:

```text
kiddai-netlify-dist
```

That folder is a copy of `dist` (the built site).

**Important:** Drag-and-drop does **not** upload Google / LINE / Facebook Netlify Functions. If you drop only this folder onto the live site, **Connect Google can break**.

To update https://kiddai.netlify.app and keep Google Connect working, use one of these:

1. **Best:** merge this GitHub branch and let Netlify build from Git (keeps `netlify/functions`).
2. **CLI:** from the repo root, with the site already linked:

```bash
npx netlify deploy --prod --dir=dist --functions=netlify/functions
```

## Netlify settings (Git deploy)

This GitHub repo (`kiddai-project-finder-web`) deploys from the **repo root**. Leave Base directory empty.

If this code still lives as `kiddai-project-finder/web` inside the desktop app, use Base directory `web`.

## Netlify settings

- Base directory: `web` (if repo root is the parent project)  
  or leave empty if you upload only the `web` folder
- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`

`netlify.toml` already sets these.

## Environment variables (Site settings → Environment variables)

Add these 3 values, then **Trigger deploy** again:

| Name | Value |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | from `google-oauth-client.json` → `client_id` |
| `GOOGLE_CLIENT_ID` | same `client_id` |
| `GOOGLE_CLIENT_SECRET` | from `google-oauth-client.json` → `client_secret` |

File on your Mac:
`kiddai-project-finder/src-tauri/secrets/google-oauth-client.json`

Users never need a `.env` file. Only you set these once in Netlify.

## Google Cloud Console (required)

Create or use a **Web application** OAuth client and add Authorized redirect URIs:

```text
http://localhost:5173/auth/callback
https://YOUR-SITE.netlify.app/auth/callback
```

If you use a custom domain, add that too:

```text
https://your-domain.com/auth/callback
```

## Facebook Messenger notifications (optional)

Badge-only alerts when a customer messages the Page. No chat UI.

### Netlify env vars

| Name | Value |
|---|---|
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Page access token |
| `FACEBOOK_VERIFY_TOKEN` | Any secret string you invent |
| `FACEBOOK_APP_SECRET` | Meta app secret |

### Meta Developer Console

1. App → Messenger → Webhooks
2. Callback URL:

```text
https://kiddai.netlify.app/api/facebook/webhook
```

3. Verify token = same as `FACEBOOK_VERIFY_TOKEN`
4. Subscribe to **messages**
5. Subscribe your Facebook Page to the app
6. Redeploy after setting env vars

### After deploy

1. Open the Netlify URL
2. Settings → Connect Google
3. Confirm Deposit / Selling / QC / Quotation / Present still work
4. Put Sticker link in Workflow sheet tab `Link` cell `A4` if missing
5. Send a test Messenger message to the Page → customer row should show a red badge

## LINE Messaging notifications (optional)

Same badge-only pattern as Messenger. Matches LINE `displayName` ≈ sheet customer name. No chat UI.

### Netlify env vars

| Name | Value |
|---|---|
| `LINE_CHANNEL_SECRET` | Channel secret from LINE Developers Console |
| `LINE_CHANNEL_ACCESS_TOKEN` | Long-lived channel access token |
| `LINE_CHANNEL_ID` | (optional) Channel ID |
| `NETLIFY_AUTH_TOKEN` | Netlify personal access token — needed for Blobs if not auto-configured (same as Facebook) |

### LINE Developers Console

1. Messaging API channel → **Messaging API** tab
2. Enable **Use webhook**
3. Webhook URL:

```text
https://kiddai.netlify.app/api/line/webhook
```

4. Issue a **Channel access token** (long-lived) → paste into `LINE_CHANNEL_ACCESS_TOKEN`
5. Copy **Channel secret** → paste into `LINE_CHANNEL_SECRET`
6. Optionally turn off auto-reply / greeting if they conflict with your ops flow
7. Redeploy after setting env vars (or trigger a new deploy so functions pick up env)
8. In the console, use **Verify** on the webhook URL (should get 200)

### After deploy

1. Customer display name on LINE should approximately match the sheet customer name
2. Send a test LINE message to the OA → matched customer row should show the coral bell
3. Opening that customer's contact clears the LINE (and Facebook) badge for that name
