import { useLocation } from "react-router-dom";
import { workspaceRouteMeta } from "../constants/workspace";

export function Header() {
  const { pathname } = useLocation();
  const meta = workspaceRouteMeta[pathname] ?? workspaceRouteMeta["/deposit-customers"];

  return (
    <header className="app-shell__header">
      <div className="header__leading">
        <div className="header__title-wrap">
          <h1 className="header__title">{meta.title}</h1>
        </div>
      </div>
    </header>
  );
}
