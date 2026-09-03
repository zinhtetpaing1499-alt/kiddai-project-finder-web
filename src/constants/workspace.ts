import type { LucideIcon } from "lucide-react";
import { BadgeDollarSign, CircleDollarSign, Settings } from "lucide-react";

export type WorkspaceRoute = {
  label: string;
  to: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
};

export const workspaceRoutes: WorkspaceRoute[] = [
  {
    label: "Deposit Customers",
    to: "/deposit-customers",
    icon: CircleDollarSign,
    title: "Deposit Customers",
    subtitle: "Choose a designer, review deposit and clearing progress, and create project files.",
  },
  {
    label: "Selling Customers",
    to: "/selling-customers",
    icon: BadgeDollarSign,
    title: "Selling Customers",
    subtitle: "Choose a designer, review the live selling list, and create quotation files.",
  },
  {
    label: "Settings",
    to: "/settings",
    icon: Settings,
    title: "Settings",
    subtitle: "",
  },
];

export const workspaceRouteMeta: Record<string, { title: string; subtitle: string }> = {
  "/deposit-customers": workspaceRoutes[0],
  "/selling-customers": workspaceRoutes[1],
  "/settings": workspaceRoutes[2],
};
