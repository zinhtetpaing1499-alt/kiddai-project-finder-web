import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useGoogleConnection } from "../contexts/GoogleConnectionContext";
import { completeGoogleConnectFromCallback } from "../services/googleAuth";

export function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshGoogleConnection } = useGoogleConnection();
  const [message, setMessage] = useState("Finishing Google sign-in…");
  const startedRef = useRef(false);

  const error = searchParams.get("error");
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    async function finish() {
      if (error) {
        const text = `Google sign-in was cancelled or failed (${error}).`;
        setMessage(text);
        window.setTimeout(() => navigate("/settings", { replace: true, state: { googleError: text } }), 1600);
        return;
      }

      if (!code) {
        const text = "Missing Google authorization code. Try Connect again from Settings.";
        setMessage(text);
        window.setTimeout(() => navigate("/settings", { replace: true, state: { googleError: text } }), 1600);
        return;
      }

      try {
        await completeGoogleConnectFromCallback(code, state);
        await refreshGoogleConnection();
        setMessage("Google connected. Returning to Settings…");
        navigate("/settings", { replace: true });
      } catch (callbackError) {
        const text =
          callbackError instanceof Error
            ? callbackError.message
            : "Unable to complete Google sign-in.";
        setMessage(text);
        window.setTimeout(() => navigate("/settings", { replace: true, state: { googleError: text } }), 2200);
      }
    }

    void finish();
  }, [code, error, navigate, refreshGoogleConnection, state]);

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
