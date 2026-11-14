/**
 * 检查点存储的生命周期归属（多租户 P5）
 *
 * 背景：`DBTAORCheckpointStorage` 由 `TAORLoop` **每循环新建**，长期不关会在分区目录
 * 残留 `app.db` 文件句柄（Windows 上删租户目录 `blocked`）。
 *
 * 归属用 `WeakSet` 记录而不是在 `TAORLoop` 上加字段 —— 那个文件已在 R04-001 的
 * 2000 行上限边缘，生命周期细节放这里可避免继续长胖。
 *
 * 口径：
 *  - `createOwned()` 创建的 ⇒ **本循环负责收尾关闭**；
 *  - 调用方**注入**的 ⇒ 不进 WeakSet ⇒ `closeOwned()` 不动它（避免关掉共享存储）。
 */
import { DBTAORCheckpointStorage } from './DBTAORCheckpointStorage.js';
import type { TAORCheckpointStorage } from './types.js';

/** 由本模块创建 / 显式托管的存储（WeakSet：不阻止 GC） */
const owned = new WeakSet<TAORCheckpointStorage>();

/** 创建一个「循环自建、循环负责关闭」的 DB 检查点存储 */
export function createOwned(): TAORCheckpointStorage {
  const storage = new DBTAORCheckpointStorage();
  owned.add(storage);
  return storage;
}

/**
 * 收尾：仅当存储由本模块创建/托管时才 `close()`（幂等；文件/内存实现无 `close` 则跳过）
 */
export async function closeOwned(
  storage: TAORCheckpointStorage
): Promise<void> {
  if (!owned.has(storage)) return;
  owned.delete(storage);
  await storage.close?.();
}
