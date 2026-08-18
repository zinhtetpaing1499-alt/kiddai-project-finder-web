import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useGoogleConnection } from "../contexts/GoogleConnectionContext";
import { completeGoogleConnectFromCallback } from "../services/googleAuth";

export function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshGoogleConnection } = useGoogleConnection();
  const [message, setMessage] = useState("Finishing Google sign-in…");

  useEffect(() => {
    let cancelled = false;

    async function finish() {
      const error = searchParams.get("error");
      const code = searchParams.get("code");
      const state = searchParams.get("state");

      if (error) {
        setMessage(`Google sign-in was cancelled or failed (${error}).`);
        window.setTimeout(() => navigate("/settings", { replace: true }), 1600);
        return;
      }

      if (!code) {
        setMessage("Missing Google authorization code.");
        window.setTimeout(() => navigate("/settings", { replace: true }), 1600);
        return;
      }

      try {
        await completeGoogleConnectFromCallback(code, state);
        if (cancelled) {
          return;
        }
        await refreshGoogleConnection();
        setMessage("Google connected. Returning to Settings…");
        navigate("/settings", { replace: true });
      } catch (callbackError) {
        if (cancelled) {
          return;
        }
        setMessage(
          callbackError instanceof Error
            ? callbackError.message
            : "Unable to complete Google sign-in.",
        );
        window.setTimeout(() => navigate("/settings", { replace: true }), 2200);
      }
    }

    void finish();

    return () => {
      cancelled = true;
    };
  }, [navigate, refreshGoogleConnection, searchParams]);

  return (
    <div className="page" style={{ padding: "48px 24px" }}>
      <section className="search-card search-card--empty">
        <p className="panel__label">Google Connection</p>
        <h3 className="panel__title">Connecting account</h3>
        <p className="panel__text">{message}</p>
      </section>
    </div>
  );
}
