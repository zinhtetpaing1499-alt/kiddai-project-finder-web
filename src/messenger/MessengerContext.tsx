import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { listPeople } from "./api";
import type { Person } from "./types";

const VIEWER_KEY = "kiddai-messenger-viewer";

type MessengerContextValue = {
  ready: boolean;
  error: string | null;
  viewer: Person | null;
  people: Person[];
  preferredInstallerId: string | null;
  setViewerId: (id: string) => void;
  reloadPeople: () => Promise<void>;
  retry: () => void;
};

const MessengerContext = createContext<MessengerContextValue | null>(null);

function readStoredViewer(): string | null {
  try {
    return window.localStorage.getItem(VIEWER_KEY);
  } catch {
    return null;
  }
}

function chooseViewerId(people: Person[], current: string | null): string | null {
  if (current && people.some((person) => person.id === current)) {
    return current;
  }
  return people.find((person) => person.role === "installer")?.id ?? people[0]?.id ?? null;
}

export function MessengerProvider({ children }: { children: ReactNode }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [viewerId, setViewerIdState] = useState<string | null>(readStoredViewer);
  const [preferredInstallerId, setPreferredInstallerId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listPeople()
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setPeople(payload.people);
        setViewerIdState((current) => chooseViewerId(payload.people, current));
        setError(null);
        setReady(true);
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Could not load the messenger.");
        setReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (!viewerId) {
      return;
    }
    try {
      window.localStorage.setItem(VIEWER_KEY, viewerId);
    } catch {
      /* Ignore private mode. */
    }
  }, [viewerId]);

  const reloadPeople = useCallback(async () => {
    const payload = await listPeople();
    setPeople(payload.people);
    setViewerIdState((current) => chooseViewerId(payload.people, current));
  }, []);

  const setViewerId = useCallback(
    (id: string) => {
      const person = people.find((item) => item.id === id);
      if (person?.role === "installer") {
        setPreferredInstallerId(id);
      }
      setViewerIdState(id);
    },
    [people],
  );

  const viewer = people.find((person) => person.id === viewerId) ?? null;

  const value = useMemo(
    () => ({
      ready,
      error,
      viewer,
      people,
      preferredInstallerId,
      setViewerId,
      reloadPeople,
      retry: () => setAttempt((current) => current + 1),
    }),
    [ready, error, viewer, people, preferredInstallerId, setViewerId, reloadPeople],
  );

  return <MessengerContext.Provider value={value}>{children}</MessengerContext.Provider>;
}

export function useMessenger() {
  const context = useContext(MessengerContext);
  if (!context) {
    throw new Error("useMessenger must be used within MessengerProvider.");
  }
  return context;
}
