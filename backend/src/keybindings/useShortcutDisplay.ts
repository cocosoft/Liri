// @ts-nocheck
import { useMemo } from 'react'

import type { ParsedBinding } from './types.js'
import { chordToDisplayString } from './parser.js'
import { getBindingDisplayText } from './resolver.js'

export function useShortcutDisplay(
  action: string,
  bindings: ParsedBinding[],
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  return useMemo(() => {
    const binding = bindings.find(b => b.action === action)
    if (!binding) return undefined

    return chordToDisplayString(binding.chord, platform)
  }, [action, bindings, platform])
}

export function getShortcutText(
  action: string,
  bindings: ParsedBinding[],
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const binding = bindings.find(b => b.action === action)
  if (!binding) return undefined

  return chordToDisplayString(binding.chord, platform)
}

export function getShortcutOriginal(
  action: string,
  bindings: ParsedBinding[],
): string | undefined {
  return getBindingDisplayText(action, bindings)
}
