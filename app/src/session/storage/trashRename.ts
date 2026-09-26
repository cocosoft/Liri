// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话目录软删除（rename 到 `.trash`）的共享助手。
 *
 * **为什么单独成文件**：新旧两条存储链（`FileSystemUnifiedStorage` / `FileSystemStorage`）
 * 的 `deleteSession` 都需要同一行为；放在任一实现文件里都会让两条链互相 import
 * （曾有过 barrel 回边导致 TDZ 的先例，见 `FileSystemStorage` 的 N-54 注释）。
 */

import { promises as fs } from 'fs';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('session:storage');

/**
 * P2-3（2026-09-26）：会话目录 rename 到 `.trash` 的**有界重试**（句柄竞争自愈）。
 *
 * **为什么需要**：删除"仍在流式运行"的会话时，`SessionLifecycleManager.deleteSession()`
 * 的 `abort()` 是**同步触发但不等待**（紧接就 `await` 存储层删除）⇒ 在飞流可能仍持有目录内
 * 文件句柄（`events.jsonl` 等），Windows 上 `rename` 抛 `EPERM` ⇒ 目录原地留存成
 * "列表无·磁盘有"的孤儿（实测 `2026-09-25T11:44:56.624Z`，DELETE 仍返 200）。
 * 流停下后句柄随即释放，故**短退避重试可自愈**。
 *
 * **为什么不用 `@modules/utils/withRetry`**：它对**每次**失败都调 `handleError()`
 * （ERROR 级日志 + ErrorTracker 记账）⇒ 一次自愈成功的重试会留下假错误统计。
 * 本函数只对**句柄竞争类**（`EPERM`/`EBUSY`）重试，中间失败以 `debug` 记录。
 *
 * `ENOENT` 等其它错误**立即上抛**，不做无意义等待（由调用方的既有分支处理）。
 */
export async function renameToTrashWithRetry(
  src: string,
  dest: string,
  attempts = 3,
  initialDelayMs = 80
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(src, dest);
      if (attempt > 1) {
        logger.info('deleteSession:软删除重试成功（句柄已释放）', {
          attempt,
          src,
        });
      }
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code !== 'EPERM' && code !== 'EBUSY') || attempt >= attempts) {
        throw err;
      }
      logger.debug('deleteSession:软删除重试（目录被占用）', {
        attempt,
        code,
        src,
      });
      await new Promise((resolve) =>
        setTimeout(resolve, initialDelayMs * attempt)
      );
    }
  }
}
