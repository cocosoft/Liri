//
import { useMemo } from 'react';

import type { ParsedBinding, KeybindingContextName } from './types.js';
import { chordToDisplayString } from './parser.js';
import { getBindingDisplayText } from './resolver.js';

export function useShortcutDisplay(
  action: string,
  bindings: ParsedBinding[],
  platform: NodeJS.Platform = process.platform
): string | undefined {
  return useMemo(() => {
    const binding = bindings.find((b) => b.action === action);
    if (!binding) return undefined;

    return chordToDisplayString(binding.chord.chords);
  }, [action, bindings]);
}

export function getShortcutText(
  action: string,
  bindings: ParsedBinding[],
  platform: NodeJS.Platform = process.platform
): string | undefined {
  const binding = bindings.find((b) => b.action === action);
  if (!binding) return undefined;

  return chordToDisplayString(binding.chord.chords);
}

export function getShortcutOriginal(
  action: string,
  bindings: ParsedBinding[]
): string | undefined {
  const binding = bindings.find((b) => b.action === action);
  return binding?.chord.displayText;
}
