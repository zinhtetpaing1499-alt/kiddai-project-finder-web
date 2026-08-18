export function StatusBar() {
  return (
    <footer className="status-bar" aria-label="Application status">
      <div className="status-bar__item">
        <span className="status-bar__label">Workspace</span>
        <span className="status-bar__value">KIDDAI Workspace foundation active</span>
      </div>
      <div className="status-bar__item">
        <span className="status-bar__label">Mode</span>
        <span className="status-bar__value">Internal desktop environment</span>
      </div>
    </footer>
  );
}
