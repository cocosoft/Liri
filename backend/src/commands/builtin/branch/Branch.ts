//
/**
 * Branch命令实现
 * 分支管理：创建/切换/删除分支
 */
import type {
  CommandImplementation,
  CommandResult,
  CommandContext,
} from '@modules/commands/types';

/**
 * Branch命令实现类
 */
export class Branch implements CommandImplementation {
  /**
   * 执行branch命令
   * @param args 命令参数
   * @param context 命令上下文
   * @returns 命令执行结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    try {
      // 解析参数
      const params = this.parseArgs(args);

      // 根据参数执行不同的分支操作
      if (params.create) {
        return await this.createBranch(params.branchName, context);
      } else if (params.switch) {
        return await this.switchBranch(params.branchName, context);
      } else if (params.delete) {
        return await this.deleteBranch(params.branchName, context);
      } else if (params.list) {
        return await this.listBranches(context);
      } else {
        // 默认显示分支列表
        return await this.listBranches(context);
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to execute branch command: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 解析命令参数
   * @param args 命令参数
   * @returns 解析后的参数
   */
  private parseArgs(args: string): {
    create: boolean;
    switch: boolean;
    delete: boolean;
    list: boolean;
    branchName: string;
  } {
    const params = {
      create: false,
      switch: false,
      delete: false,
      list: false,
      branchName: '',
    };

    if (!args) {
      params.list = true;
      return params;
    }

    const argsList = args.split(' ').filter((arg) => arg.trim());

    for (let i = 0; i < argsList.length; i++) {
      const arg = argsList[i];
      switch (arg.toLowerCase()) {
        case 'create':
        case '-c':
        case '--create':
          params.create = true;
          params.branchName = argsList[i + 1] || '';
          break;
        case 'switch':
        case 'checkout':
        case '-s':
        case '--switch':
          params.switch = true;
          params.branchName = argsList[i + 1] || '';
          break;
        case 'delete':
        case 'remove':
        case '-d':
        case '--delete':
          params.delete = true;
          params.branchName = argsList[i + 1] || '';
          break;
        case 'list':
        case '-l':
        case '--list':
          params.list = true;
          break;
        default:
          // 如果没有指定操作，第一个参数可能是分支名
          if (
            i === 0 &&
            !params.create &&
            !params.switch &&
            !params.delete &&
            !params.list
          ) {
            params.switch = true;
            params.branchName = arg;
          }
          break;
      }
    }

    return params;
  }

  /**
   * 创建分支
   * @param branchName 分支名称
   * @param context 命令上下文
   * @returns 执行结果
   */
  private async createBranch(
    branchName: string,
    context: any
  ): Promise<CommandResult> {
    if (!branchName) {
      return {
        success: false,
        error: 'Branch name is required for create operation',
      };
    }

    try {
      const { exec } = await import('child_process');

      return new Promise((resolve) => {
        exec(
          `git checkout -b ${branchName}`,
          { cwd: context.cwd || process.cwd() },
          (error, stdout, stderr) => {
            if (error) {
              resolve({
                success: false,
                error: `Failed to create branch: ${error.message}`,
              });
              return;
            }

            if (stderr && !stderr.includes('Switched to a new branch')) {
              resolve({
                success: false,
                error: `Git error: ${stderr}`,
              });
              return;
            }

            resolve({
              success: true,
              message: `Branch '${branchName}' created successfully`,
            });
          }
        );
      });
    } catch (error) {
      return {
        success: false,
        error: `Failed to create branch: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 切换分支
   * @param branchName 分支名称
   * @param context 命令上下文
   * @returns 执行结果
   */
  private async switchBranch(
    branchName: string,
    context: any
  ): Promise<CommandResult> {
    if (!branchName) {
      return {
        success: false,
        error: 'Branch name is required for switch operation',
      };
    }

    try {
      const { exec } = await import('child_process');

      return new Promise((resolve) => {
        exec(
          `git checkout ${branchName}`,
          { cwd: context.cwd || process.cwd() },
          (error, stdout, stderr) => {
            if (error) {
              resolve({
                success: false,
                error: `Failed to switch branch: ${error.message}`,
              });
              return;
            }

            resolve({
              success: true,
              message: `Switched to branch '${branchName}'`,
            });
          }
        );
      });
    } catch (error) {
      return {
        success: false,
        error: `Failed to switch branch: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 删除分支
   * @param branchName 分支名称
   * @param context 命令上下文
   * @returns 执行结果
   */
  private async deleteBranch(
    branchName: string,
    context: any
  ): Promise<CommandResult> {
    if (!branchName) {
      return {
        success: false,
        error: 'Branch name is required for delete operation',
      };
    }

    try {
      const { exec } = await import('child_process');

      return new Promise((resolve) => {
        exec(
          `git branch -d ${branchName}`,
          { cwd: context.cwd || process.cwd() },
          (error, stdout, stderr) => {
            if (error) {
              // 尝试强制删除
              exec(
                `git branch -D ${branchName}`,
                { cwd: context.cwd || process.cwd() },
                (error2, stdout2, stderr2) => {
                  if (error2) {
                    resolve({
                      success: false,
                      error: `Failed to delete branch: ${error2.message}`,
                    });
                    return;
                  }

                  resolve({
                    success: true,
                    message: `Branch '${branchName}' deleted forcefully`,
                  });
                }
              );
              return;
            }

            resolve({
              success: true,
              message: `Branch '${branchName}' deleted successfully`,
            });
          }
        );
      });
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete branch: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 列出分支
   * @param context 命令上下文
   * @returns 执行结果
   */
  private async listBranches(context: any): Promise<CommandResult> {
    try {
      const { exec } = await import('child_process');

      return new Promise((resolve) => {
        exec(
          'git branch --list',
          { cwd: context.cwd || process.cwd() },
          (error, stdout, stderr) => {
            if (error) {
              resolve({
                success: false,
                error: `Failed to list branches: ${error.message}`,
              });
              return;
            }

            if (stderr) {
              resolve({
                success: false,
                error: `Git error: ${stderr}`,
              });
              return;
            }

            const branches = stdout
              .split('\n')
              .filter((line) => line.trim())
              .map((line) => {
                const isCurrent = line.startsWith('*');
                const branchName = line.replace('*', '').trim();
                return { isCurrent, branchName };
              });

            const currentBranch = branches.find((b) => b.isCurrent);
            const otherBranches = branches.filter((b) => !b.isCurrent);

            let message = `Current branch: ${currentBranch?.branchName || 'unknown'}\n\n`;

            if (otherBranches.length > 0) {
              message += 'Other branches:\n';
              otherBranches.forEach((branch) => {
                message += `  ${branch.branchName}\n`;
              });
            } else {
              message += 'No other branches found';
            }

            resolve({
              success: true,
              message,
            });
          }
        );
      });
    } catch (error) {
      return {
        success: false,
        error: `Failed to list branches: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 获取命令提示
   * @param args 命令参数
   * @param context 命令上下文
   * @returns 命令提示
   */
  getPromptForCommand(args: string, context?: any): string {
    return `Manage git branches: ${args || 'list branches'}`;
  }
}
