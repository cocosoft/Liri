export const NON_REBINDABLE: string[] = [
  'ctrl+c',
  'ctrl+d',
  'ctrl+m',
  'ctrl+z',
  'ctrl+\\',
]

export const TERMINAL_RESERVED: string[] = [
  'ctrl+z',
  'ctrl+\\',
]

export const MACOS_RESERVED: string[] = [
  'cmd+c',
  'cmd+v',
  'cmd+x',
  'cmd+q',
  'cmd+w',
  'cmd+tab',
  'cmd+space',
]

export function normalizeKeyForComparison(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/control/g, 'ctrl')
    .replace(/option/g, 'alt')
    .replace(/opt/g, 'alt')
    .replace(/command/g, 'meta')
    .replace(/cmd/g, 'meta')
    .replace(/super/g, 'meta')
    .replace(/win/g, 'meta')
    .replace(/windows/g, 'meta')
}

export function isReservedShortcut(
  keystroke: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normalized = normalizeKeyForComparison(keystroke)

  if (NON_REBINDABLE.some(r => normalizeKeyForComparison(r) === normalized)) {
    return true
  }

  if (TERMINAL_RESERVED.some(r => normalizeKeyForComparison(r) === normalized)) {
    return true
  }

  if (platform === 'darwin' && MACOS_RESERVED.some(r => normalizeKeyForComparison(r) === normalized)) {
    return true
  }

  return false
}
