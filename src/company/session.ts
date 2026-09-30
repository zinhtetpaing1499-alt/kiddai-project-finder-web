import { createContext, useContext } from "react";
import type { CompanyUser } from "./types";

export type CompanySession = {
  user: CompanyUser;
  logout: () => Promise<void>;
  expire: () => void;
};

export const CompanySessionContext = createContext<CompanySession | null>(null);

export function useCompanySession() {
  const session = useContext(CompanySessionContext);
  if (!session) {
    throw new Error("Company session is missing.");
  }
  return session;
}
