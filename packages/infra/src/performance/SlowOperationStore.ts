/**
 * 慢操作记录存储（performance 域自有状态）
 *
 * 2026-10-01 D-160（`R00-001` 倒挂收口）：本存储原寄存在 `bootstrap/state.ts`
 * （**entry 层**）—— 于是 `performance`(infra) 必须反向依赖 entry 才能读写自己的观测数据，
 * 构成 `performance -> bootstrap` 倒挂（2 处：`SlowOperations` 写 / `PerformanceReporter` 读）。
 * 按"数据归属其域"做**物理归位**：存储随性能域下沉 infra，既消边又保持读写单一事实源。
 *
 * 边界（如实）：`clearSlowOperations()` 全仓零消费者，但属本存储的完整 API（重置/测试用），
 * 一并迁移以免留下"半截迁移"。
 */

/** 慢操作记录 */
export interface SlowOperation {
  description: string;
  duration: number;
  timestamp: number;
}

let slowOperations: SlowOperation[] = [];

/** 添加慢操作记录（上限 1000 条，超出丢最早） */
export function addSlowOperation(description: string, duration: number): void {
  slowOperations.push({
    description,
    duration,
    timestamp: Date.now(),
  });

  if (slowOperations.length > 1000) {
    slowOperations = slowOperations.slice(-1000);
  }
}

/** 获取慢操作记录（返回副本，调用方不可改动存储） */
export function getSlowOperations(): SlowOperation[] {
  return [...slowOperations];
}

/** 清除慢操作记录 */
export function clearSlowOperations(): void {
  slowOperations = [];
}
