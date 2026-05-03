// @ts-nocheck
import type { Command, CommandImplementation } from '../types/index.js';

/**
 * 懒加载命令包装器
 * 将命令的模块导入延迟到首次调用 load() 时
 */
export class LazyCommand implements Command {
  readonly type: Command['type'];
  readonly name: string;
  readonly description: string;
  readonly aliases?: string[];
  readonly argumentHint?: string;
  readonly whenToUse?: string;
  readonly version?: string;
  readonly disableModelInvocation?: boolean;
  readonly userInvocable?: boolean;
  readonly loadedFrom?: string;
  readonly isHidden?: boolean;
  readonly getPromptForCommand?: Command['getPromptForCommand'];

  private modulePath: string;
  private loadedImpl: CommandImplementation | null = null;
  private loadError: Error | null = null;
  private loadAttempted: boolean = false;

  constructor(metadata: {
    type: Command['type'];
    name: string;
    description: string;
    modulePath: string;
    aliases?: string[];
    argumentHint?: string;
    whenToUse?: string;
    version?: string;
    disableModelInvocation?: boolean;
    userInvocable?: boolean;
    loadedFrom?: string;
    isHidden?: boolean;
    getPromptForCommand?: Command['getPromptForCommand'];
  }) {
    this.type = metadata.type;
    this.name = metadata.name;
    this.description = metadata.description;
    this.modulePath = metadata.modulePath;
    this.aliases = metadata.aliases;
    this.argumentHint = metadata.argumentHint;
    this.whenToUse = metadata.whenToUse;
    this.version = metadata.version;
    this.disableModelInvocation = metadata.disableModelInvocation;
    this.userInvocable = metadata.userInvocable;
    this.loadedFrom = metadata.loadedFrom;
    this.isHidden = metadata.isHidden;
    this.getPromptForCommand = metadata.getPromptForCommand;
  }

  async load(): Promise<CommandImplementation> {
    if (this.loadAttempted) {
      if (this.loadError) throw this.loadError;
      return this.loadedImpl!;
    }

    this.loadAttempted = true;

    try {
      const module = await import(this.modulePath);
      const command: Command = module.default || module;

      this.loadedImpl = {
        getPromptForCommand: command.getPromptForCommand,
        execute: command.execute,
        call: command.call,
        validate: command.validate,
      };

      if (!command.execute && command.load) {
        const impl = await command.load();
        if (impl.execute) this.loadedImpl.execute = impl.execute;
        if (impl.call) this.loadedImpl.call = impl.call;
        if (impl.getPromptForCommand) this.loadedImpl.getPromptForCommand = impl.getPromptForCommand;
      }

      return this.loadedImpl;
    } catch (err) {
      this.loadError = err instanceof Error ? err : new Error(String(err));
      throw this.loadError;
    }
  }
}
