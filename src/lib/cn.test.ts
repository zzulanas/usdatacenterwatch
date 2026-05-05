import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn()', () => {
  it('returns a single class unchanged', () => {
    expect(cn('text-sm')).toBe('text-sm');
  });

  it('merges multiple classes', () => {
    expect(cn('px-2', 'py-4')).toBe('px-2 py-4');
  });

  it('resolves Tailwind conflicts (last wins)', () => {
    // tailwind-merge should keep the last conflicting utility
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('ignores falsy values', () => {
    expect(cn('text-sm', false, null, undefined, 'font-bold')).toBe('text-sm font-bold');
  });

  it('handles conditional object syntax', () => {
    expect(cn('base', { 'text-red-500': true, 'text-blue-500': false })).toBe('base text-red-500');
  });
});
