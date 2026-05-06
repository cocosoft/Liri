/**
 * Fast命令实现 - 快速模式切换
 * 根据 CC 源码实现
 */
import type { CommandImplementation } from '@modules/commands/types';

/**
 * Fast命令实现类
 */
export class Fast implements CommandImplementation {
  private fastModeEnabled = false;

  /**
   * 执行fast命令
   * @param args 命令参数
   * @param context 命令上下文
   * @returns 命令执行结果
   */
  async execute(args: string, context: any): Promise<any> {
    try {
      const arg = args?.trim().toLowerCase();
      
      // 如果提供了 on/off 参数，直接切换
      if (arg === 'on') {
        this.fastModeEnabled = true;
        return {
          success: true,
          message: '⚡ Fast mode ON',
        };
      } else if (arg === 'off') {
        this.fastModeEnabled = false;
        return {
          success: true,
          message: 'Fast mode OFF',
        };
      }

      // 默认显示切换提示
      return {
        success: true,
        message: this.getFastModeStatus(),
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to execute fast command: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 获取快速模式状态
   */
  private getFastModeStatus(): string {
    const status = this.fastModeEnabled ? 'ON' : 'OFF';
    
    return `Fast mode is currently ${status}

Use:
  /fast on    - Enable fast mode
  /fast off   - Disable fast mode
  /fast       - Show current status

High-speed mode for faster responses. Billed at a premium rate.`;
  }
}