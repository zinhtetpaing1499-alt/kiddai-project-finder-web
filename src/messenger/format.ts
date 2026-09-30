import type { ChatMessage } from "./types";

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function formatListTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThatDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfThatDay) / 86_400_000);
  if (dayDiff === 0) {
    return formatClock(iso);
  }
  if (dayDiff > 0 && dayDiff < 7) {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()] ?? "";
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThatDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfThatDay) / 86_400_000);
  if (dayDiff === 0) {
    return "Today";
  }
  if (dayDiff === 1) {
    return "Yesterday";
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function messageBlocks(messages: ChatMessage[]): Array<{ day: string; messages: ChatMessage[] }> {
  const blocks: Array<{ day: string; messages: ChatMessage[] }> = [];
  for (const message of messages) {
    const day = dayLabel(message.createdAt);
    const last = blocks[blocks.length - 1];
    if (!last || last.day !== day) {
      blocks.push({ day, messages: [message] });
    } else {
      last.messages.push(message);
    }
  }
  return blocks;
}
