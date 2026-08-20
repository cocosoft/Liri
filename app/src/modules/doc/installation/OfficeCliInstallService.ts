/**
 * OfficeCliInstallService
 * OfficeCLI 安装管理：detect → install → re-detect
 * 安装走官方脚本（Windows install.ps1 / macOS/Linux install.sh），
 * 安装结果为异步后台任务，进度事件按 R08-002 记录（start/fail/complete）
 */

import { spawn } from 'child_process';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import {
  detectOfficeCLI,
  getVersionConstraint,
} from '../detection/OfficeCLIDetector';
import type { OfficeCLIInfo, OfficeCLIVersionConstraint } from '../types';

const logger = getLogger('doc:installation');

/** 安装状态 */
export type OfficeCliInstallState =
  | 'idle' // 未安装 / 已安装但未在安装中
  | 'running' // 安装进行中
  | 'completed' // 上次安装完成
  | 'failed'; // 上次安装失败

/** 安装进度快照（GET /v1/officecli/status 数据源） */
export interface OfficeCliInstallStatus {
  state: OfficeCliInstallState;
  info: OfficeCLIInfo;
  constraint: OfficeCLIVersionConstraint;
  /** 安装进程已启动的时间戳（running/completed/failed 时非空） */
  startedAt: number | null;
  /** 安装结束时间戳（completed/failed 时非空） */
  finishedAt: number | null;
  /** 最近一次安装的错误信息（failed 时非空） */
  error?: string;
}

/** 安装命令构建（按平台选择官方脚本） */
function buildInstallCommand(): { cmd: string; args: string[] } {
  if (process.platform === 'win32') {
    // Windows：官方 install.ps1（安装到 %LOCALAPPDATA%\OfficeCli 并注册用户 PATH）
    return {
      cmd: 'powershell',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'irm https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/main/install.ps1 | iex',
      ],
    };
  }
  // macOS / Linux：官方 install.sh
  return {
    cmd: 'bash',
    args: [
      '-c',
      'curl -fsSL https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/main/install.sh | bash',
    ],
  };
}

/**
 * OfficeCLI 安装管理服务（单例）
 */
class OfficeCliInstallServiceImpl {
  private state: OfficeCliInstallState = 'idle';
  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  private error: string | undefined = undefined;

  /**
   * 获取当前安装状态（含实时检测结果）
   */
  getStatus(): OfficeCliInstallStatus {
    return {
      state: this.state,
      info: detectOfficeCLI(),
      constraint: getVersionConstraint(),
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      error: this.error,
    };
  }

  /**
   * 触发 OfficeCLI 安装（异步后台执行）
   * 幂等：已在安装中时返回当前状态，不重复启动
   */
  async install(): Promise<OfficeCliInstallStatus> {
    if (this.state === 'running') {
      logger.info('OfficeCLI 安装已在进行中，跳过重复触发');
      return this.getStatus();
    }

    // 已安装且兼容则无需重装（R08-002 skip 事件）
    const info = detectOfficeCLI();
    if (info.installed && !info.incompatible) {
      logger.info('OfficeCLI 已安装且版本兼容，跳过安装', {
        version: info.version,
      });
      this.state = 'idle';
      this.error = undefined;
      return this.getStatus();
    }

    const { cmd, args } = buildInstallCommand();
    this.state = 'running';
    this.startedAt = Date.now();
    this.finishedAt = null;
    this.error = undefined;
    logger.info('OfficeCLI 安装开始（R08 start）', { cmd, args });

    // 异步后台执行，不阻塞 HTTP 响应
    void this.runInstall(cmd, args);
    return this.getStatus();
  }

  /**
   * 后台执行安装脚本，完成后 re-detect 并记录完成/失败事件
   */
  private async runInstall(cmd: string, args: string[]): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(cmd, args, {
          windowsHide: true,
          stdio: 'pipe',
          shell: false,
        });

        let stderr = '';
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        child.on('error', (err) => reject(err));
        child.on('close', (code) => {
          if (code === 0) resolve();
          else
            reject(
              new Error(
                `安装脚本退出码 ${code}${stderr ? `：${stderr.trim().slice(0, 500)}` : ''}`
              )
            );
        });
      });

      // re-detect：安装成功后立即检测（新安装的二进制已落盘）
      const recheck = detectOfficeCLI();
      if (recheck.installed && !recheck.incompatible) {
        this.state = 'completed';
        this.finishedAt = Date.now();
        logger.info('OfficeCLI 安装完成（R08 complete）', {
          version: recheck.version,
          elapsedMs: Date.now() - (this.startedAt ?? Date.now()),
        });
      } else {
        throw new Error(
          `安装完成但检测失败${recheck.version ? `（版本 ${recheck.version}）` : ''}`
        );
      }
    } catch (err) {
      this.state = 'failed';
      this.finishedAt = Date.now();
      this.error = err instanceof Error ? err.message : String(err);
      logger.error('OfficeCLI 安装失败（R08 fail）', { error: this.error });
      await handleError(err, {
        module: 'doc:installation',
        action: 'install',
      });
    }
  }
}

/** 单例导出 */
export const officeCliInstallService = new OfficeCliInstallServiceImpl();
