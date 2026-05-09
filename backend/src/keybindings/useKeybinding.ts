//
import { useCallback, useMemo, useRef } from 'react'
import { useInput } from '../ink/ink/hooks/use-input.js'
import type { Key } from '../ink/ink/events/input-event.js'

import type { ParsedKeystroke, ParsedBinding, KeybindingContextName, ChordResolveResult } from './types.js'
import { resolveKeyWithChordState } from './resolver.js'
import { keyToParsedKeystroke } from './match.js'

export type KeybindingHandler = () => void | Promise<void>

export type UseKeybindingOptions = {
  context?: string
  enabled?: boolean
}

function usePendingChordState(): {
  pendingChord: ParsedKeystroke | null
  setPendingChord: (chord: ParsedKeystroke | null) => void
} {
  const pendingRef = useRef<ParsedKeystroke | null>(null)

  return {
    get pendingChord(): ParsedKeystroke | null {
      return pendingRef.current
    },
    setPendingChord: (chord: ParsedKeystroke | null) => {
      pendingRef.current = chord
    },
  }
}

export function useKeybinding(
  action: string,
  handler: KeybindingHandler,
  bindings: ParsedBinding[],
  activeContexts: string[],
  options: UseKeybindingOptions = {},
): void {
  const { context, enabled = true } = options
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  const chordState = usePendingChordState()

  const contextsToCheck = useMemo(() => {
    const contexts = new Set(activeContexts)
    contexts.add('Global')
    if (context) contexts.add(context)
    return Array.from(contexts)
  }, [activeContexts, context])

  const filteredBindings = useMemo(() => {
    return bindings.filter(b => {
      if (b.action !== action) return false
      return contextsToCheck.includes(b.context)
    })
  }, [bindings, action, contextsToCheck])

  const handleInput = useCallback(
    (_input: string, key: Key) => {
      if (!enabled || filteredBindings.length === 0) return

      const keystroke = keyToParsedKeystroke(key)
      if (!keystroke) return

      const pendingChordArray = chordState.pendingChord ? [chordState.pendingChord] : null
      const result = resolveKeyWithChordState(
        _input,
        keystroke.key,
        contextsToCheck as KeybindingContextName[],
        filteredBindings,
        pendingChordArray,
      )

      if (result.action !== null) {
        chordState.setPendingChord(null)
        handlerRef.current()
      } else if (result.pendingChord) {
        chordState.setPendingChord(result.pendingChord[result.pendingChord.length - 1])
      } else {
        chordState.setPendingChord(null)
      }
    },
    [enabled, filteredBindings, contextsToCheck, chordState],
  )

  useInput(handleInput, { isActive: enabled && filteredBindings.length > 0 })
}

export function useKeybindings(
  bindingsMap: Record<string, KeybindingHandler>,
  bindings: ParsedBinding[],
  activeContexts: string[],
  options: UseKeybindingOptions = {},
): void {
  const { context, enabled = true } = options
  const handlersRef = useRef(bindingsMap)
  handlersRef.current = bindingsMap
  const chordState = usePendingChordState()

  const contextsToCheck = useMemo(() => {
    const contexts = new Set(activeContexts)
    contexts.add('Global')
    if (context) contexts.add(context)
    return Array.from(contexts)
  }, [activeContexts, context])

  const actions = new Set(Object.keys(bindingsMap))
  const filteredBindings = useMemo(() => {
    return bindings.filter(b => {
      if (!actions.has(b.action)) return false
      return contextsToCheck.includes(b.context)
    })
  }, [bindings, contextsToCheck])

  const handleInput = useCallback(
    (_input: string, key: Key) => {
      if (!enabled || filteredBindings.length === 0) return

      const keystroke = keyToParsedKeystroke(key)
      if (!keystroke) return

      const pendingChordArray = chordState.pendingChord ? [chordState.pendingChord] : null
      const result = resolveKeyWithChordState(
        _input,
        keystroke.key,
        contextsToCheck as KeybindingContextName[],
        filteredBindings,
        pendingChordArray,
      )

      if (result.action !== null) {
        const matchingBinding = filteredBindings.find(b => {
          if (b.chord.chords.length === 0) return false
          return (
            b.chord.chords[0].key === keystroke.key &&
            b.chord.chords[0].ctrl === keystroke.ctrl &&
            (b.chord.chords[0].alt || b.chord.chords[0].meta) === (keystroke.alt || keystroke.meta) &&
            b.chord.chords[0].shift === keystroke.shift
          )
        })

        if (matchingBinding) {
          const handler = handlersRef.current[matchingBinding.action]
          if (handler) handler()
        }
      }
    },
    [enabled, filteredBindings, contextsToCheck, chordState],
  )

  useInput(handleInput, { isActive: enabled && filteredBindings.length > 0 })
}
