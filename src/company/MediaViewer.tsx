import { useEffect, useState } from "react";
import { Minus, Plus, X } from "lucide-react";

export type ViewableMedia = {
  url: string;
  name: string;
  kind: "image" | "video";
};

export function MediaViewer({ item, onClose }: { item: ViewableMedia | null; onClose: () => void }) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setScale(1);
  }, [item?.url]);

  useEffect(() => {
    if (!item) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose]);

  if (!item) return null;

  return (
    <div className="company-viewer" role="dialog" aria-label={item.name}>
      <button type="button" className="company-viewer__backdrop" aria-label="Close" onClick={onClose} />
      <div className="company-viewer__bar">
        <strong>{item.name}</strong>
        {item.kind === "image" ? (
          <span>
            <button type="button" aria-label="Zoom out" onClick={() => setScale((value) => Math.max(1, value - 0.25))}>
              <Minus size={16} />
            </button>
            <button type="button" aria-label="Zoom in" onClick={() => setScale((value) => Math.min(4, value + 0.25))}>
              <Plus size={16} />
            </button>
          </span>
        ) : null}
        <button type="button" aria-label="Close viewer" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div
        className="company-viewer__stage"
        onWheel={(event) => {
          if (item.kind !== "image") return;
          event.preventDefault();
          setScale((value) => Math.min(4, Math.max(1, value + (event.deltaY < 0 ? 0.15 : -0.15))));
        }}
      >
        {item.kind === "image" ? (
          <img src={item.url} alt={item.name} style={{ transform: `scale(${scale})` }} />
        ) : (
          <video src={item.url} controls autoPlay />
        )}
      </div>
    </div>
  );
}
