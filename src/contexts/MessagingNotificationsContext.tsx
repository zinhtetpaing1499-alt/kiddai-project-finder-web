import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  fetchFacebookNotifications,
  type FacebookNotification,
} from "../services/facebookNotifications";
import {
  fetchLineNotifications,
  type LineNotification,
} from "../services/lineNotifications";
import {
  CUSTOMER_LISTS_CHANGED_EVENT,
  countDepositWorkspaceUnread,
  countSellingWorkspaceUnread,
  mergeMessagingNotifications,
  type MessagingNotification,
} from "../utils/workspaceUnread";

const MESSAGING_NOTI_POLL_MS = 12_000;

type MessagingNotificationsContextValue = {
  facebookNotifications: FacebookNotification[];
  lineNotifications: LineNotification[];
  setFacebookNotifications: Dispatch<SetStateAction<FacebookNotification[]>>;
  setLineNotifications: Dispatch<SetStateAction<LineNotification[]>>;
  messagingNotifications: MessagingNotification[];
  sellingUnreadCount: number;
  depositUnreadCount: number;
};

const MessagingNotificationsContext = createContext<MessagingNotificationsContextValue | null>(
  null,
);

export function MessagingNotificationsProvider({ children }: { children: ReactNode }) {
  const [facebookNotifications, setFacebookNotifications] = useState<FacebookNotification[]>([]);
  const [lineNotifications, setLineNotifications] = useState<LineNotification[]>([]);
  const [listsRevision, setListsRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function refreshMessagingNotifications() {
      const [facebookResult, lineResult] = await Promise.all([
        fetchFacebookNotifications(),
        fetchLineNotifications(),
      ]);
      if (!cancelled) {
        setFacebookNotifications(facebookResult.notifications);
        setLineNotifications(lineResult.notifications);
      }
    }

    void refreshMessagingNotifications();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshMessagingNotifications();
      }
    }, MESSAGING_NOTI_POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshMessagingNotifications();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  const bumpLists = useCallback(() => {
    setListsRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    window.addEventListener(CUSTOMER_LISTS_CHANGED_EVENT, bumpLists);
    window.addEventListener("storage", bumpLists);
    return () => {
      window.removeEventListener(CUSTOMER_LISTS_CHANGED_EVENT, bumpLists);
      window.removeEventListener("storage", bumpLists);
    };
  }, [bumpLists]);

  const messagingNotifications = useMemo(
    () => mergeMessagingNotifications(facebookNotifications, lineNotifications),
    [facebookNotifications, lineNotifications],
  );

  const sellingUnreadCount = useMemo(() => {
    void listsRevision;
    return countSellingWorkspaceUnread(messagingNotifications);
  }, [listsRevision, messagingNotifications]);

  const depositUnreadCount = useMemo(() => {
    void listsRevision;
    return countDepositWorkspaceUnread(messagingNotifications);
  }, [listsRevision, messagingNotifications]);

  const value = useMemo(
    () => ({
      facebookNotifications,
      lineNotifications,
      setFacebookNotifications,
      setLineNotifications,
      messagingNotifications,
      sellingUnreadCount,
      depositUnreadCount,
    }),
    [
      facebookNotifications,
      lineNotifications,
      messagingNotifications,
      sellingUnreadCount,
      depositUnreadCount,
    ],
  );

  return (
    <MessagingNotificationsContext.Provider value={value}>
      {children}
    </MessagingNotificationsContext.Provider>
  );
}

export function useMessagingNotifications() {
  const value = useContext(MessagingNotificationsContext);
  if (!value) {
    throw new Error("useMessagingNotifications must be used within MessagingNotificationsProvider.");
  }
  return value;
}
