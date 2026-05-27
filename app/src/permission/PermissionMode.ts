export const PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'bypass',
  'dontAsk',
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const PERMISSION_MODE_NAMES: Record<PermissionMode, string> = {
  default: '默认',
  acceptEdits: '接受编辑',
  plan: '计划模式',
  bypass: '绕过模式',
  dontAsk: '不询问',
};

export const PERMISSION_MODE_SYMBOLS: Record<PermissionMode, string> = {
  default: '',
  acceptEdits: '✎',
  plan: '⏸',
  bypass: '⚡',
  dontAsk: '🔇',
};

export function shouldAvoidPermissionPrompts(mode: PermissionMode): boolean {
  return mode === 'dontAsk';
}
