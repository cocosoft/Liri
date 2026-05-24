import type { AcpRuntimeControl } from './runtime/types.js';

export interface AcpCommandDefinition {
  control: AcpRuntimeControl;
  description: string;
  params?: string[];
}

const SUPPORTED_COMMANDS: AcpCommandDefinition[] = [
  {
    control: 'session/set_mode',
    description: 'Set session mode',
    params: ['mode'],
  },
  {
    control: 'session/set_config_option',
    description: 'Set config option',
    params: ['key', 'value'],
  },
  { control: 'session/status', description: 'Get session status' },
];

export function getSupportedCommands(): AcpCommandDefinition[] {
  return SUPPORTED_COMMANDS.map((c) => ({ ...c }));
}

export function findCommandDefinition(
  control: string
): AcpCommandDefinition | undefined {
  return SUPPORTED_COMMANDS.find((c) => c.control === control);
}

export function isSupportedControl(control: string): boolean {
  return SUPPORTED_COMMANDS.some((c) => c.control === control);
}
