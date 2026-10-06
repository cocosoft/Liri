// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * llama-server 日志文件读写与实时推送（原 `LlamaCppServerManager` 的日志簇）
 *
 * 由 `LlamaCppServerManager.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §35）。
 *
 * ⚠️ **只搬不改**：逻辑逐字保留（含字段与方法名）；logger module 名保持 `ai:llama`
 * （与宿主一致）⇒ 日志输出不变。
 */

import { EventEmitter } from 'events';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  watch,
} from 'fs';
import { basename, dirname, join } from 'path';
import { getLogger } from '@modules/monitoring';
import { resolveLlamaDir } from '@modules/core/paths';

const logger = getLogger('ai:llama');

/**
 * 日志存储门面：文件初始化 / 读取 / 增量读取 / 订阅（fs.watch + 轮询兜底）/ 追加。
 *
 * 生命周期：构造后调用 `initLogFile()`；宿主的 4 个公开日志方法转发到本类。
 */
export class LlamaServerLogs {
  private logFilePath = '';
  private logEventEmitter = new EventEmitter();
  private logListeners = 0;
  private logWatcher: ReturnType<typeof watch> | null = null;

  /** 初始化日志文件路径，日志写入 ~/.pyapp/logs/llama-server.log */
  initLogFile(): void {
    try {
      const logDir = join(resolveLlamaDir(), '..', '..', '..', 'logs');
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }
      this.logFilePath = join(logDir, 'llama-server.log');
      // 写日志头
      const header = `\n===== llama-server 日志 ${new Date().toISOString()} =====\n`;
      appendFileSync(this.logFilePath, header);
      logger.info('llama-server 日志文件已初始化', { path: this.logFilePath });
    } catch (e) {
      logger.warn('llama-server 日志文件初始化失败', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** 获取日志文件内容（用于诊断） */
  getLogContent(maxLines = 200): string {
    try {
      if (!this.logFilePath || !existsSync(this.logFilePath)) {
        return '日志文件不存在';
      }
      const content = readFileSync(this.logFilePath, 'utf-8');
      const lines = content.split('\n');
      return lines.slice(-maxLines).join('\n');
    } catch (e) {
      return `读取日志失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /** 获取日志文件当前字节数（用于增量读取） */
  getLogSize(): number {
    try {
      if (!this.logFilePath || !existsSync(this.logFilePath)) {
        return 0;
      }
      return statSync(this.logFilePath).size;
    } catch {
      return 0;
    }
  }

  /** 从指定位置读取增量日志 */
  getLogSincePosition(fromPosition: number): string {
    try {
      if (!this.logFilePath || !existsSync(this.logFilePath)) {
        return '';
      }
      const content = readFileSync(this.logFilePath, 'utf-8');
      if (content.length <= fromPosition) {
        return '';
      }
      return content.slice(fromPosition);
    } catch {
      return '';
    }
  }

  /** 订阅日志实时推送 */
  subscribeLogs(callback: (newContent: string) => void): () => void {
    this.logListeners++;
    this.logEventEmitter.on('log', callback);

    // 启动文件监听（如果还没启动）
    this.ensureLogWatcher();

    // 返回取消订阅函数
    return () => {
      this.logEventEmitter.off('log', callback);
      this.logListeners--;
      if (this.logListeners <= 0) {
        this.stopLogWatcher();
      }
    };
  }

  /** 确保文件监听器正在运行 */
  private ensureLogWatcher(): void {
    if (this.logWatcher || !this.logFilePath) return;

    try {
      const dir = dirname(this.logFilePath);
      const targetName = basename(this.logFilePath);
      this.logWatcher = watch(
        dir,
        (eventType: string, filename: string | null) => {
          if (filename === targetName) {
            this.emitLogUpdate();
          }
        }
      );
      // Windows 上 fs.watch 对 appendFileSync 场景可能漏事件，叠加低频轮询兜底
      this.startLogPolling();
      logger.info('llama-server 日志文件监听器已启动');
    } catch (e) {
      logger.warn('llama-server 日志文件监听器启动失败', {
        error: e instanceof Error ? e.message : String(e),
      });
      // fs.watch 在某些平台不稳定，回退到轮询模式
      this.startLogPolling();
    }
  }

  /** 轮询模式（fs.watch 失败时的后备方案） */
  private logPollingTimer: ReturnType<typeof setInterval> | null = null;

  private startLogPolling(): void {
    if (this.logPollingTimer) return;
    let lastSize = this.getLogSize();
    this.logPollingTimer = setInterval(() => {
      try {
        const currentSize = this.getLogSize();
        if (currentSize > lastSize) {
          const newContent = this.getLogSincePosition(lastSize);
          if (newContent) {
            this.logEventEmitter.emit('log', newContent);
          }
          lastSize = currentSize;
        }
      } catch (pollErr) {
        // KB-R08-POLL（2026-08-29）：日志轮询异常记录（R08-002 后台循环必须有
        // fail 日志落盘——getLogSize 内部已兜底，此 catch 覆盖未来改动的异常路径）
        logger.warn('llama-server 日志轮询异常', {
          error: pollErr instanceof Error ? pollErr.message : String(pollErr),
        });
      }
    }, 300);
    logger.info('llama-server 日志轮询模式已启动（300ms 间隔）');
  }

  private stopLogPolling(): void {
    if (this.logPollingTimer) {
      clearInterval(this.logPollingTimer);
      this.logPollingTimer = null;
    }
  }

  /** 停止文件监听器 */
  private stopLogWatcher(): void {
    if (this.logWatcher) {
      this.logWatcher.close();
      this.logWatcher = null;
      logger.info('llama-server 日志文件监听器已停止');
    }
    this.stopLogPolling();
  }

  /** 触发日志更新事件 */
  private lastEmittedSize = 0;
  private emitLogUpdate(): void {
    const currentSize = this.getLogSize();
    if (currentSize > this.lastEmittedSize) {
      const newContent = this.getLogSincePosition(this.lastEmittedSize);
      if (newContent) {
        this.lastEmittedSize = currentSize;
        this.logEventEmitter.emit('log', newContent);
      }
    }
  }

  /** 追加日志到文件（带时间戳） */
  appendLog(stream: 'stdout' | 'stderr', data: string): void {
    if (!this.logFilePath) return;
    try {
      const timestamp = new Date().toISOString();
      const lines = data.split('\n').filter((l) => l.length > 0);
      for (const line of lines) {
        appendFileSync(
          this.logFilePath,
          `[${timestamp}] [${stream}] ${line}\n`
        );
      }
    } catch {
      // 日志写入失败静默处理
    }
  }
}
