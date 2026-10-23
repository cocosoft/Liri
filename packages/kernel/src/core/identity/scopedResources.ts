/**
 * ScopedResources — 按身份登记的**可关闭资源**（多租户 P1 / P5）
 *
 * 背景（台账第十七批暴露的既有缺口）：`DELETE /v1/tenants/:tenantId` 在删除分区目录
 * （`<data>/tenants/<t>/users/<u>/…`）时会因 **sqlite 文件句柄未释放**而 `blocked`
 * （实测 Windows 上 `rmSync` 失败）。各个按身份缓存 SQLite 实例的模块（CostRecordRepository、
 * ExecutionStore、QueryLogStore、ProviderManager、LLMTracker …）**各自持有 Map**，
 * `purgeTenant` 没有统一入口把它们关掉 —— 只有 `InboxManager` 自己实现了
 * `closeScopesForTenant`（第二套机制）。
 *
 * 本模块提供**唯一登记口**：按身份开缓存实例的模块在创建实例时登记一个 closer，
 * 删租户/退出时按 `<tenantId>:` 前缀统一关闭。
 *
 * 三条约定（调用方必须遵守）：
 *   1. **closer 必须同时把实例从自己的 Map 里删掉** —— 否则下次访问会拿到已关闭实例；
 *   2. 关闭失败**保留登记**（可重跑），并如实计入 `failed`，不静默吞掉（CS03-002）；
 *   3. 本模块**只做记账，不做 IO** —— 不解析路径、不打开连接、不认识 `Database` 类型。
 */

/** 释放一个已登记资源（同步或异步） */
export type ScopedResourceCloser = () => void | Promise<void>;

/** 单个关闭失败（可重跑：登记被保留） */
export interface ScopedCloseFailure {
  /** 归属键 `<tenantId>:<userId>` */
  ownerKey: string;
  error: string;
}

/** 一轮关闭的结果 */
export interface ScopedCloseResult {
  /** 成功关闭并摘除登记的条数 */
  closed: number;
  /** 关闭失败（登记保留，便于重跑） */
  failed: ScopedCloseFailure[];
}

interface ScopedResourceEntry {
  ownerKey: string;
  closer: ScopedResourceCloser;
}

const entries = new Map<string, ScopedResourceEntry>();
let nextEntryId = 0;

/**
 * 登记一个按身份持有的可关闭资源。
 *
 * @param ownerKey 归属键 `<tenantId>:<userId>`（`principalKeyOf()` 的产物）
 * @param closer 释放函数；**必须**同时清理调用方自己的实例缓存
 * @returns `dispose()` —— 从登记表摘除（幂等；**不调用** closer，实例销毁由调用方负责）
 */
export function registerScopedResource(
  ownerKey: string,
  closer: ScopedResourceCloser
): () => void {
  const idx = ownerKey.indexOf(':');
  if (idx <= 0 || idx === ownerKey.length - 1) {
    // 开发期错误而非运行时输入错误：静默接受会让"删租户时关不掉"变成隐性问题
    throw new TypeError(
      `registerScopedResource: 归属键必须是 <tenantId>:<userId>，实际收到 "${ownerKey}"`
    );
  }
  const id = `r${++nextEntryId}`;
  entries.set(id, { ownerKey, closer });
  return () => {
    entries.delete(id);
  };
}

/** 按谓词关闭；成功的摘除登记、失败的保留（可重跑） */
async function closeMatching(
  predicate: (ownerKey: string) => boolean
): Promise<ScopedCloseResult> {
  const failed: ScopedCloseFailure[] = [];
  let closed = 0;

  for (const [id, entry] of [...entries]) {
    if (!predicate(entry.ownerKey)) continue;
    try {
      await entry.closer();
      entries.delete(id);
      closed += 1;
    } catch (error) {
      failed.push({
        ownerKey: entry.ownerKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { closed, failed };
}

/**
 * 关闭某租户下**全部**已登记资源（删除租户前调用）。
 *
 * 只匹配 `<tenantId>:` 前缀 ⇒ 其他租户与本地身份（`local:*`）不受影响。
 */
export function closeScopedResourcesForTenant(
  tenantId: string
): Promise<ScopedCloseResult> {
  const prefix = `${tenantId}:`;
  return closeMatching((ownerKey) => ownerKey.startsWith(prefix));
}

/** 关闭**全部**已登记资源（优雅退出 / 测试复位用） */
export function closeAllScopedResources(): Promise<ScopedCloseResult> {
  return closeMatching(() => true);
}

/** 当前登记条数（诊断 / 测试断言用） */
export function scopedResourceCount(): number {
  return entries.size;
}

/** 仅测试：清空登记表（**不调用** closer，避免用例间互相关闭） */
export function resetScopedResourcesForTest(): void {
  entries.clear();
  nextEntryId = 0;
}
