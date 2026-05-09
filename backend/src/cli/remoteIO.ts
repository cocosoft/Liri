//
/**
 * 远程IO模块
 * 处理Bridge模式下的远程输入输出
 */

/**
 * Bridge接口定义
 */
interface Bridge {
  requestInput(options: {
    prompt: string;
    type: string;
  }): Promise<{ value: string }>;
}

/**
 * 远程IO管理器
 */
export class RemoteIO {
  private bridge: Bridge | null = null;
  private isRemoteMode = false;

  /**
   * 初始化远程IO
   * @param bridge Bridge实例
   */
  initialize(bridge: Bridge): void {
    this.bridge = bridge;
    this.isRemoteMode = true;
  }

  /**
   * 检查是否为远程模式
   */
  isRemote(): boolean {
    return this.isRemoteMode && this.bridge !== null;
  }

  /**
   * 读取远程输入
   * @param prompt 提示信息
   * @returns 用户输入
   */
  async read(prompt: string): Promise<string> {
    if (!this.isRemote()) {
      return this.readLocal(prompt);
    }

    try {
      const response = await this.bridge!.requestInput({
        prompt,
        type: 'text',
      });
      return response.value || '';
    } catch (error) {
      console.warn(`远程输入失败，回退到本地输入: ${error}`);
      return this.readLocal(prompt);
    }
  }

  /**
   * 读取秘密输入（密码等）
   * @param prompt 提示信息
   * @returns 秘密输入
   */
  async readSecret(prompt: string): Promise<string> {
    if (!this.isRemote()) {
      return this.readSecretLocal(prompt);
    }

    try {
      const response = await this.bridge!.requestInput({
        prompt,
        type: 'password',
      });
      return response.value || '';
    } catch (error) {
      console.warn(`远程秘密输入失败，回退到本地输入: ${error}`);
      return this.readSecretLocal(prompt);
    }
  }

  /**
   * 显示输出
   * @param message 消息内容
   * @param type 消息类型
   */
  write(
    message: string,
    type: 'info' | 'error' | 'success' | 'warning' = 'info'
  ): void {
    if (!this.isRemote()) {
      this.writeLocal(message, type);
      return;
    }

    try {
      (this.bridge as any).sendOutput({
        message,
        type,
      });
    } catch (error) {
      console.warn(`远程输出失败，回退到本地输出: ${error}`);
      this.writeLocal(message, type);
    }
  }

  /**
   * 显示进度
   * @param progress 进度百分比
   * @param message 进度消息
   */
  progress(progress: number, message: string): void {
    if (!this.isRemote()) {
      this.progressLocal(progress, message);
      return;
    }

    try {
      (this.bridge as any).sendProgress({
        progress,
        message,
      });
    } catch (error) {
      console.warn(`远程进度更新失败，回退到本地显示: ${error}`);
      this.progressLocal(progress, message);
    }
  }

  /**
   * 本地读取输入
   */
  private readLocal(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      readline.question(`${prompt}: `, (answer: string) => {
        readline.close();
        resolve(answer);
      });
    });
  }

  /**
   * 本地读取秘密输入
   */
  private readSecretLocal(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      readline.question(`${prompt}: `, (answer: string) => {
        readline.close();
        resolve(answer);
      });
    });
  }

  /**
   * 本地输出
   */
  private writeLocal(
    message: string,
    type: 'info' | 'error' | 'success' | 'warning'
  ): void {
    const chalk = require('chalk');
    switch (type) {
      case 'error':
        console.error(chalk.red(message));
        break;
      case 'success':
        console.log(chalk.green(message));
        break;
      case 'warning':
        console.warn(chalk.yellow(message));
        break;
      default:
        console.log(message);
    }
  }

  /**
   * 本地进度显示
   */
  private progressLocal(progress: number, message: string): void {
    const chalk = require('chalk');
    const percent = Math.round(progress);
    const barLength = 40;
    const filledLength = Math.round((percent / 100) * barLength);
    const bar = '█'.repeat(filledLength) + ' '.repeat(barLength - filledLength);
    process.stdout.write(`\r${chalk.blue(`[${bar}] ${percent}%`)} ${message}`);
  }
}

/**
 * 创建远程IO实例
 */
export function createRemoteIO(): RemoteIO {
  return new RemoteIO();
}
