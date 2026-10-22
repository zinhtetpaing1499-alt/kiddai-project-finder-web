import { GOOGLE_TOKEN_STORAGE_KEY } from "../constants/storage";
import { getValidAccessToken } from "./googleAuth";

const SKETCHUP_HELPER_URL = "http://127.0.0.1:17341";

export class SketchupHelperOfflineError extends Error {
  constructor() {
    super("The SketchUp helper is not running on this computer.");
    this.name = "SketchupHelperOfflineError";
  }
}

export async function sketchupHelperIsRunning() {
  try {
    const response = await fetch(`${SKETCHUP_HELPER_URL}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function openSketchupWithHelper(file: { fileId: string; fileName: string }) {
  const accessToken = await getValidAccessToken();
  let refreshToken = "";
  try {
    const stored = JSON.parse(window.localStorage.getItem(GOOGLE_TOKEN_STORAGE_KEY) ?? "") as {
      refreshToken?: string;
    };
    refreshToken = stored.refreshToken?.trim() ?? "";
  } catch {
    refreshToken = "";
  }
  let response: Response;
  try {
    response = await fetch(`${SKETCHUP_HELPER_URL}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileId: file.fileId,
        fileName: file.fileName,
        accessToken,
        refreshToken,
        refreshUrl: `${window.location.origin}/api/google/refresh`,
      }),
      signal: AbortSignal.timeout(180000),
    });
  } catch {
    throw new SketchupHelperOfflineError();
  }

  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; openedWith?: string };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Could not open this SketchUp file.");
  }
  return payload.openedWith?.trim() || "SketchUp";
}
