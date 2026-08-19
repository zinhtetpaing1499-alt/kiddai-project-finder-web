import { Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { workspaceRouteMeta } from "../constants/workspace";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function getFullscreenElement() {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

async function enterFullscreen() {
  const root = document.documentElement as FullscreenElement;
  if (root.requestFullscreen) {
    await root.requestFullscreen();
    return;
  }
  if (root.webkitRequestFullscreen) {
    await root.webkitRequestFullscreen();
  }
}

async function exitFullscreen() {
  const doc = document as FullscreenDocument;
  if (doc.exitFullscreen) {
    await doc.exitFullscreen();
    return;
  }
  if (doc.webkitExitFullscreen) {
    await doc.webkitExitFullscreen();
  }
}

export function Header() {
  const { pathname } = useLocation();
  const meta = workspaceRouteMeta[pathname] ?? workspaceRouteMeta["/deposit-customers"];
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(getFullscreenElement()));
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    void (isFullscreen ? exitFullscreen() : enterFullscreen());
  }, [isFullscreen]);

  return (
    <header className="app-shell__header">
      <div className="header__leading">
        <div className="header__title-wrap">
          <h1 className="header__title">{meta.title}</h1>
        </div>
      </div>
      <button
        className="header__fullscreen-button"
        type="button"
        title={isFullscreen ? "Exit full screen" : "Full screen"}
        aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
        onClick={toggleFullscreen}
      >
        {isFullscreen ? <Minimize2 size={18} strokeWidth={2.2} /> : <Maximize2 size={18} strokeWidth={2.2} />}
      </button>
    </header>
  );
}
