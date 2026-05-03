// @ts-nocheck
import type {
  ParsedBinding,
  KeybindingWarning,
  KeybindingContextName,
  KeybindingBlock,
} from './types.js'
import { KEYBINDING_CONTEXTS, KEYBINDING_ACTIONS } from './types.js'
import { parseChord, parseKeystroke } from './parser.js'
import { NON_REBINDABLE, TERMINAL_RESERVED } from './reservedShortcuts.js'

const ALL_ACTIONS = new Set(Object.values(KEYBINDING_ACTIONS))
const COMMAND_PREFIX = 'command:'
const COMMAND_PATTERN = /^command:[a-zA-Z0-9:\-_]+$/

export function validateKeystroke(input: string): KeybindingWarning | null {
  const parsed = parseKeystroke(input)
  if (!parsed) {
    return {
      type: 'parse_error',
      message: `Invalid keystroke: "${input}". Use format like "ctrl+shift+k" or "cmd+k".`,
    }
  }

  if (!parsed.key || parsed.key === '') {
    return {
      type: 'parse_error',
      message: `Keystroke "${input}" is missing a key.`,
    }
  }

  const normalized = input.toLowerCase()
  for (const reserved of NON_REBINDABLE) {
    if (normalized === reserved) {
      return {
        type: 'reserved',
        message: `Keystroke "${input}" is reserved and cannot be rebound (${reserved}).`,
      }
    }
  }

  for (const reserved of TERMINAL_RESERVED) {
    if (normalized === reserved) {
      return {
        type: 'reserved',
        message: `Keystroke "${input}" is reserved by the terminal and cannot be rebound.`,
      }
    }
  }

  return null
}

export function validateBinding(
  context: string,
  action: string,
  keystroke: string,
): KeybindingWarning | null {
  if (!KEYBINDING_CONTEXTS.includes(context as KeybindingContextName)) {
    return {
      type: 'invalid_context',
      message: `Unknown context: "${context}". Valid contexts: ${KEYBINDING_CONTEXTS.join(', ')}`,
    }
  }

  if (!action.startsWith(COMMAND_PREFIX) && !ALL_ACTIONS.has(action)) {
    return {
      type: 'invalid_action',
      message: `Unknown action: "${action}".`,
      action,
    }
  }

  if (action.startsWith(COMMAND_PREFIX) && !COMMAND_PATTERN.test(action)) {
    return {
      type: 'invalid_action',
      message: `Invalid command action format: "${action}". Use format "command:namespace:action".`,
      action,
    }
  }

  const keystrokeWarning = validateKeystroke(keystroke)
  if (keystrokeWarning) {
    return keystrokeWarning
  }

  return null
}

export function validateBindings(
  blocks: KeybindingBlock[],
): KeybindingWarning[] {
  const warnings: KeybindingWarning[] = []
  const seenBindings = new Set<string>()

  for (const block of blocks) {
    for (const [keystroke, action] of Object.entries(block.bindings)) {
      const warning = validateBinding(block.context, action, keystroke)
      if (warning) {
        warnings.push(warning)
        continue
      }

      const bindingKey = `${block.context}:${action}`
      if (seenBindings.has(bindingKey)) {
        warnings.push({
          type: 'duplicate',
          message: `Duplicate binding for ${action} in context ${block.context} (${keystroke}).`,
          action,
          keystroke,
        })
      }
      seenBindings.add(bindingKey)
    }
  }

  return warnings
}

export function validateCustomBindings(
  customBindings: ParsedBinding[],
  defaultBindings: ParsedBinding[],
): KeybindingWarning[] {
  const warnings: KeybindingWarning[] = []

  const customActionSet = new Set(customBindings.map(b => `${b.context}:${b.action}`))
  const defaultActionSet = new Set(defaultBindings.map(b => `${b.context}:${b.action}`))

  for (const custom of customBindings) {
    const key = `${custom.context}:${custom.action}`
    if (defaultActionSet.has(key) && custom.action !== 'command') continue

    if (custom.action !== 'command' && !ALL_ACTIONS.has(custom.action)) {
      warnings.push({
        type: 'invalid_action',
        message: `Custom binding references unknown action "${custom.action}" in context ${custom.context}.`,
        action: custom.action,
      })
    }
  }

  for (const def of defaultBindings) {
    const key = `${def.context}:${def.action}`
    if (!customActionSet.has(key)) {
      warnings.push({
        type: 'unused',
        message: `Default binding for "${def.action}" in context ${def.context} (${def.original}) is not customized.`,
        action: def.action,
        keystroke: def.original,
      })
    }
  }

  return warnings
}

export function validateBindingsFile(content: unknown): KeybindingWarning[] {
  if (!content || typeof content !== 'object') {
    return [{
      type: 'parse_error',
      message: 'Bindings file must be a valid JSON object.',
    }]
  }

  const obj = content as Record<string, unknown>
  if (!Array.isArray(obj.bindings)) {
    return [{
      type: 'parse_error',
      message: 'Bindings file must have a "bindings" array.',
    }]
  }

  return validateBindings(obj.bindings as KeybindingBlock[])
}
