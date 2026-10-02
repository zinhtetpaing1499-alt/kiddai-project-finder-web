import type { CompanyUser } from "./types";
import { WORKFLOW_VIEWS } from "./workflowSheets";

export type PortalName = "owner" | "admin" | "designer" | "installer";

export type PortalLink = {
  id: string;
  label: string;
  to: string;
  detail: string;
};

const CHAT_LINK: PortalLink = {
  id: "chat",
  label: "Chat",
  to: "/company/inbox",
  detail: "One conversation for each job.",
};

function sheetLink(team: string, slug: string): PortalLink {
  const view = WORKFLOW_VIEWS.find((item) => item.slug === slug);
  return {
    id: slug,
    label: view?.label ?? slug,
    to: `/company/departments/${team}/${slug}`,
    detail: view?.sheetName ?? slug,
  };
}

export const OWNER_TEAMS = [
  {
    id: "designer",
    label: "Designer",
    detail: "Estimate, selling, deposit, confirm, and draftman.",
    sheets: ["estimate", "selling", "deposit", "confirm", "draftman"],
  },
  {
    id: "installer",
    label: "Installer",
    detail: "Site measure sheet.",
    sheets: ["measure"],
  },
  {
    id: "admin",
    label: "Admin",
    detail: "Admin worksheet.",
    sheets: ["admin"],
  },
  {
    id: "cnc",
    label: "CNC",
    detail: "CNC rows on the rework sheet.",
    sheets: ["cnc"],
  },
  {
    id: "purchasing",
    label: "Purchasing Team",
    detail: "Purchasing worksheet.",
    sheets: ["purchasing"],
  },
  {
    id: "factory",
    label: "Factory",
    detail: "Store, cutting, assembly, and rework.",
    sheets: ["store", "cutting", "assembly", "rework"],
  },
] satisfies readonly {
  id: string;
  label: string;
  detail: string;
  sheets: readonly string[];
}[];

export function sheetMenuLabel(slug: string) {
  const view = WORKFLOW_VIEWS.find((item) => item.slug === slug);
  if (!view) return slug;
  if (view.slug === "selling" || view.slug === "deposit") return view.sheetName;
  if (view.slug === "draftman") return "Draftman";
  return view.label;
}

export function teamById(id: string | undefined) {
  return OWNER_TEAMS.find((team) => team.id === id);
}

const LINKS: Record<PortalName, PortalLink[]> = {
  owner: OWNER_TEAMS.map((team) => ({
    id: team.id,
    label: team.label,
    to: `/company/departments/${team.id}`,
    detail: team.detail,
  })),
  designer: [CHAT_LINK, sheetLink("designer", "selling"), sheetLink("designer", "deposit"), sheetLink("designer", "draftman")],
  admin: [CHAT_LINK, sheetLink("admin", "admin")],
  installer: [CHAT_LINK],
};

export function portalName(user: CompanyUser): PortalName {
  if (user.roles.includes("owner")) return "owner";
  if (user.roles.includes("admin")) return "admin";
  if (user.roles.includes("designer")) return "designer";
  return "installer";
}

export function portalLabel(user: CompanyUser) {
  const name = portalName(user);
  if (name === "owner") return "Owner";
  if (name === "admin") return "Admin";
  if (name === "designer") return "Designer";
  return "Chat";
}

export function linksFor(user: CompanyUser) {
  if (user.roles.includes("owner")) return LINKS.owner;
  if (user.roles.includes("purchasing")) return [CHAT_LINK, sheetLink("purchasing", "purchasing")];
  if (user.roles.includes("cnc")) return [CHAT_LINK, sheetLink("cnc", "cnc")];
  return LINKS[portalName(user)];
}

export const DESIGNER_SCREENS = [
  { id: "deposit-customers", label: "Deposit Customers", to: "/company/departments/designer/deposit-customers" },
  { id: "selling-customers", label: "Selling Customers", to: "/company/departments/designer/selling-customers" },
  { id: "settings", label: "Settings", to: "/company/departments/designer/settings" },
] as const;

export function homePath(user: CompanyUser) {
  if (portalName(user) === "owner") return DESIGNER_SCREENS[0].to;
  return linksFor(user)[0]?.to ?? "/company/inbox";
}

export function canOpen(user: CompanyUser, pathname: string) {
  if (pathname === "/company" || pathname === "/company/home") return true;
  if (portalName(user) === "owner") return pathname.startsWith("/company");
  return linksFor(user).some((link) => pathname === link.to || pathname.startsWith(`${link.to}/`));
}
