/**
 * 结构化 Attention（P37，2026-11-02）—— **薄 re-export**
 *
 * 实现已下沉至 `packages/infra/src/attention/index.ts`：`runtime/InboxManager`
 * （service 层）需要写同一份 `inbox_items.metadata` 键，而 service 不得 import app。
 * 本文件保留原路径，既有调用方（`ProactiveNotificationGate` / `types.ts` / 测试）零改动。
 */
export * from '@openliri/infra/attention';
