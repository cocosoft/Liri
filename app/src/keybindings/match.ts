import type { Key } from '@modules/ink';
import type { ParsedKeystroke, ParsedBinding } from './types.js';

export type { Key as InkKey } from '@modules/ink';

const KEY_NAME_MAP: Record<string, string | undefined> = {
  return: 'enter',
  ' ': 'space',
};

export function keyToParsedKeystroke(key: Key): ParsedKeystroke | null {
  let keyName: string | undefined;

  if (key.escape) keyName = 'escape';
  else if (key.return) keyName = 'enter';
  else if (key.tab) keyName = 'tab';
  else if (key.backspace) keyName = 'backspace';
  else if (key.delete) keyName = 'delete';
  else if (key.upArrow) keyName = 'up';
  else if (key.downArrow) keyName = 'down';
  else if (key.leftArrow) keyName = 'left';
  else if (key.rightArrow) keyName = 'right';
  else if (key.pageUp) keyName = 'pageup';
  else if (key.pageDown) keyName = 'pagedown';
  else if (key.home) keyName = 'home';
  else if (key.end) keyName = 'end';

  if (!keyName) return null;

  return {
    key: KEY_NAME_MAP[keyName] || keyName,
    ctrl: key.ctrl,
    alt: key.meta || key.super,
    meta: key.super,
    shift: key.shift,
  };
}

export function modifiersMatch(key: Key, keystroke: ParsedKeystroke): boolean {
  const hasCtrl = key.ctrl;
  const hasAlt = key.meta || key.super;
  const hasShift = key.shift;

  return (
    hasCtrl === keystroke.ctrl &&
    hasAlt === (keystroke.alt || keystroke.meta) &&
    hasShift === keystroke.shift
  );
}

export function matchesKeystroke(
  key: Key,
  keystroke: ParsedKeystroke
): boolean {
  const parsed = keyToParsedKeystroke(key);
  if (!parsed) return false;

  const targetKey = keystroke.key.toLowerCase();
  if (parsed.key !== targetKey) return false;

  return modifiersMatch(key, keystroke);
}

export function matchesBinding(key: Key, binding: ParsedBinding): boolean {
  if (binding.chord.chords.length !== 1) return false;
  return matchesKeystroke(key, binding.chord.chords[0]);
}

export function findMatchingBindings(
  key: Key,
  bindings: ParsedBinding[],
  activeContexts: string[]
): ParsedBinding[] {
  const matches: ParsedBinding[] = [];

  for (const binding of bindings) {
    if (!activeContexts.includes(binding.context)) continue;

    if (matchesBinding(key, binding)) {
      matches.push(binding);
    }
  }

  return matches;
}
