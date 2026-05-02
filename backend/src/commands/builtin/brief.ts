/**
 * Brief命令
 * 用于切换brief-only模式
 */

import type { Command, CommandContext, CommandResult } from '../types/index.js';
import { logger } from '../../utils/log.js';

let isBriefOnly = false;

export function getBriefOnly(): boolean {
  return isBriefOnly;
}

export function setBriefOnly(value: boolean): void {
  isBriefOnly = value;
  logger.info(`Brief-only mode ${value ? 'enabled' : 'disabled'}`);
}

const briefCommand: Command = {
  type: 'action',
  name: 'brief',
  description: 'Toggle brief-only mode',
  aliases: ['b'],
  argumentHint: '[on|off|toggle]',
  whenToUse: 'Use this command to enable or disable brief-only mode. In brief-only mode, all output must use the Brief tool.',
  userInvocable: true,
  isHidden: false,

  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const trimmedArgs = args.trim().toLowerCase();

    if (trimmedArgs === 'on') {
      setBriefOnly(true);
      return {
        type: 'system',
        value: 'Brief-only mode enabled',
        success: true,
        message: 'Brief-only mode is now enabled. Use the Brief tool for all user-facing output.',
      };
    }

    if (trimmedArgs === 'off') {
      setBriefOnly(false);
      return {
        type: 'system',
        value: 'Brief-only mode disabled',
        success: true,
        message: 'Brief-only mode is now disabled. You can now reply with plain text.',
      };
    }

    if (trimmedArgs === 'toggle' || trimmedArgs === '') {
      const newState = !isBriefOnly;
      setBriefOnly(newState);
      return {
        type: 'system',
        value: newState ? 'Brief-only mode enabled' : 'Brief-only mode disabled',
        success: true,
        message: newState
          ? 'Brief-only mode is now enabled. Use the Brief tool for all user-facing output.'
          : 'Brief-only mode is now disabled. You can now reply with plain text.',
      };
    }

    return {
      type: 'error',
      value: 'Invalid argument',
      success: false,
      error: `Invalid argument: ${args}. Use 'on', 'off', or 'toggle'.`,
    };
  },

  load(): Promise<CommandImplementation> {
    return Promise.resolve({
      execute: this.execute,
    });
  },
};

interface CommandImplementation {
  execute?: (args: string, context: CommandContext) => Promise<CommandResult>;
}

/**
 * Brief命令实现
 */
const briefCommandImpl: CommandImplementation = {
  async execute(args: string, _context: CommandContext): Promise<CommandResult> {
    const trimmedArgs = args.trim().toLowerCase();

    if (trimmedArgs === 'on') {
      setBriefOnly(true);
      return {
        type: 'system',
        value: 'Brief-only mode enabled',
        success: true,
        message: 'Brief-only mode is now enabled. Use the Brief tool for all user-facing output.',
      };
    }

    if (trimmedArgs === 'off') {
      setBriefOnly(false);
      return {
        type: 'system',
        value: 'Brief-only mode disabled',
        success: true,
        message: 'Brief-only mode is now disabled. You can now reply with plain text.',
      };
    }

    if (trimmedArgs === 'toggle' || trimmedArgs === '') {
      const newState = !isBriefOnly;
      setBriefOnly(newState);
      return {
        type: 'system',
        value: newState ? 'Brief-only mode enabled' : 'Brief-only mode disabled',
        success: true,
        message: newState
          ? 'Brief-only mode is now enabled. Use the Brief tool for all user-facing output.'
          : 'Brief-only mode is now disabled. You can now reply with plain text.',
      };
    }

    return {
      type: 'error',
      value: 'Invalid argument',
      success: false,
      error: `Invalid argument: ${args}. Use 'on', 'off', or 'toggle'.`,
    };
  },
};

export default {
  ...briefCommand,
  load(): Promise<CommandImplementation> {
    return Promise.resolve(briefCommandImpl);
  },
} satisfies Command;
