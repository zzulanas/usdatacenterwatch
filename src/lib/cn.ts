import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind classes, resolving conflicts via tailwind-merge.
 * Used throughout for conditional className construction.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
