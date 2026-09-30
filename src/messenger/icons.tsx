const PALETTES = [
  { bg: "#4c6fff", deep: "#2446c8", fg: "#ffffff", accent: "#d9e3ff" },
  { bg: "#ef6a3c", deep: "#c2410c", fg: "#ffffff", accent: "#ffd3c2" },
  { bg: "#14915f", deep: "#0f6b46", fg: "#ffffff", accent: "#d7ffee" },
  { bg: "#7a4fd3", deep: "#5b2eab", fg: "#ffffff", accent: "#eadfff" },
  { bg: "#d4a017", deep: "#946e08", fg: "#ffffff", accent: "#fff1c4" },
];

function paletteFor(name: string) {
  const match = /(\d+)/.exec(name);
  const index = match ? Math.max(0, Number(match[1]) - 1) : 0;
  return PALETTES[index % PALETTES.length];
}

export function GroupAvatar({ name, size = 52 }: { name: string; size?: number }) {
  const palette = paletteFor(name);
  const gradientId = `avatar-${name.replace(/[^a-zA-Z0-9]/g, "")}-${size}`;
  const dot = Math.max(10, Math.round(size * 0.23));

  return (
    <span className="avatar" style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="10" y1="4" x2="54" y2="62" gradientUnits="userSpaceOnUse">
            <stop stopColor={palette.bg} />
            <stop offset="1" stopColor={palette.deep} />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="32" fill={`url(#${gradientId})`} />
        <circle cx="24" cy="27" r="8" fill={palette.fg} />
        <circle cx="41" cy="29" r="6.5" fill={palette.accent} />
        <path d="M8 56c3.2-12 10-17 16.5-17 6.2 0 12 4.2 15.5 12.5" fill={palette.fg} />
        <path d="M30 56c2.2-9 8-13.5 14-13.5 5.8 0 10.6 3.6 13.5 10.8" fill={palette.accent} />
      </svg>
      <span className="presence" style={{ width: dot, height: dot }} />
    </span>
  );
}

export function BellIcon() {
  return (
    <svg className="bell" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M6.2 9.2a5.8 5.8 0 0 1 11.6 0c0 4.2 1.6 5.5 1.6 5.5H4.6s1.6-1.3 1.6-5.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M10 18.2a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function MutedBellIcon() {
  return (
    <svg className="bell" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M6.2 9.2a5.8 5.8 0 0 1 11.6 0c0 4.2 1.6 5.5 1.6 5.5H4.6s1.6-1.3 1.6-5.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M10 18.2a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M5 19.2 19 5.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4.5 12h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12.5 6.5 18.5 12l-6 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
