//
import type { Command, CommandImplementation } from '@modules/commands';

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

      // 尝试多种方式获取命令对象
      let command: Command | undefined;

      // 1. 首先尝试默认导出
      if (module.default) {
        command = module.default;
      }
      // 2. 尝试命名导出（命令名称 + 'Command' 后缀）
      else if (module[`${this.name}Command`]) {
        command = module[`${this.name}Command`];
      }
      // 3. 尝试查找名称包含 'Command' 的导出
      else {
        const commandKeys = Object.keys(module).filter((key) =>
          key.includes('Command')
        );
        if (commandKeys.length > 0) {
          command = module[commandKeys[0]];
        }
      }

      // 如果还是找不到，使用模块本身（适用于某些特殊情况）
      if (!command) {
        command = module as unknown as Command;
      }

      // 如果 command 是类（有 constructor），创建实例
      let commandInstance: any = command;
      if (
        typeof command === 'function' &&
        (command as any).prototype &&
        typeof (command as any).prototype.execute === 'function'
      ) {
        commandInstance = new (command as any)();
      }

      this.loadedImpl = {
        getPromptForCommand:
          commandInstance.getPromptForCommand?.bind(commandInstance),
        execute: commandInstance.execute?.bind(commandInstance),
        call: commandInstance.call?.bind(commandInstance),
        validate: commandInstance.validate?.bind(commandInstance),
      };

      if (!commandInstance.execute && commandInstance.load) {
        const impl = await commandInstance.load();
        if (impl.execute) this.loadedImpl.execute = impl.execute.bind(impl);
        if (impl.call) this.loadedImpl.call = impl.call.bind(impl);
        if (impl.getPromptForCommand)
          this.loadedImpl.getPromptForCommand =
            impl.getPromptForCommand.bind(impl);
      }

      return this.loadedImpl;
    } catch (err) {
      this.loadError = err instanceof Error ? err : new Error(String(err));
      throw this.loadError;
    }
  }
}
