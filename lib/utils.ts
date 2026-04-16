import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeDate(date: string | Date) {
  const now = new Date();
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(date);
}

export function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const SEVERITY_CONFIG = {
  low: { label: 'Low', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  medium: { label: 'Medium', color: 'bg-amber-100 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  high: { label: 'High', color: 'bg-orange-100 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  critical: { label: 'Critical', color: 'bg-red-100 text-red-700 border-red-200', dot: 'bg-red-500' },
} as const;

export const STATUS_CONFIG = {
  open: { label: 'Open', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  acknowledged: { label: 'Acknowledged', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  'in-progress': { label: 'In Progress', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  resolved: { label: 'Resolved', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  closed: { label: 'Closed', color: 'bg-slate-100 text-slate-600 border-slate-200' },
} as const;

export type Severity = keyof typeof SEVERITY_CONFIG;
export type Status = keyof typeof STATUS_CONFIG;
