/**
 * `Liri pairing` 维护命令（2026-10-19）。
 *
 * 背景：`DmPolicyEngine` 的拒绝文案早已承诺该命令
 * （`需要配对。请管理员运行: Liri pairing approve <channel> <code>`），但此前**未实现**。
 * 本 handler 只做两件事：解析子命令 + 调用 `PairingStore` 的既有能力。
 */

import type { PairingStore } from '@modules/channels';
import { getPairingStore } from '@modules/channels';

export interface PairingHandler {
  /** @returns true = 已处理（退出码 0）；false = 用法错误/未识别（退出码 1） */
  handle(subcommand: string, args: string[]): Promise<boolean>;
  showHelp(): void;
}

const PAIRING_USAGE = [
  '用法:',
  '  Liri pairing approve <channel> <code>   批准一个待配对请求',
  '  Liri pairing list [channel]             查看已批准用户与待配对码',
].join('\n');

export function createPairingHandler(
  store: PairingStore = getPairingStore()
): PairingHandler {
  return {
    async handle(subcommand, args) {
      const sub = subcommand.toLowerCase();

      if (sub === 'approve') {
        const [channelId, code] = args;
        if (!channelId || !code) {
          console.error('缺少参数: approve 需要 <channel> 与 <code>');
          return false;
        }
        // 新进程（CLI）必须先等磁盘加载完成，否则会把有效码误判为无效
        await store.ready();
        const ok = await store.approveByCode(channelId, code);
        if (ok) {
          console.log(
            `已批准配对: ${channelId}（配对码 ${code}）；运行中的应用需重启后生效`
          );
        } else {
          console.error(`配对失败: 配对码无效或已过期（${code}）`);
        }
        return ok;
      }

      if (sub === 'list') {
        await store.ready();
        const channels = args[0] ? [args[0]] : store.listChannels();
        if (channels.length === 0) {
          console.log('（无配对记录）');
          return true;
        }
        for (const channelId of channels) {
          const approved = store.listApproved(channelId);
          const pending = store.listPending(channelId);
          console.log(`[${channelId}] 已批准 ${approved.length} 个用户`);
          for (const userId of approved) {
            console.log(`  - ${userId}`);
          }
          if (pending.length > 0) {
            console.log(`[${channelId}] 待配对 ${pending.length} 个`);
            for (const entry of pending) {
              console.log(
                `  - ${entry.code} → ${entry.userId}（到期 ${new Date(entry.expiresAt).toISOString()}）`
              );
            }
          }
        }
        return true;
      }

      return false;
    },

    showHelp() {
      console.log(PAIRING_USAGE);
    },
  };
}
