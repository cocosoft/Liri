/**
 * 驾驶舱数据装配（P39-b-1，2026-11-02）
 *
 * 把 P34 的两份事实（`workitems` 行 + `ticket_assignments`）装配成
 * `CockpitItem[]`，供 `buildCockpitSnapshot()` 分组。**只做映射，不做判定**：
 * stage 由 `deriveTicketStage()` 派生，本模块不写任何状态词（状态判定由调用方注入）。
 *
 * 为什么依赖注入：
 * - 便于单测（无需真库）；
 * - "什么算已结束"复用 `TaskStatus` 的既有事实源，不在本模块复制第二份状态清单（CS01/CS02）。
 *
 * 诚实边界：
 * - `succeeded` / `attention` / `deliveryPending` 暂不从现有行推断（缺结构化来源）
 *   ⇒ 留空，面板指标按"无样本 ⇒ undefined"处理，不臆造；
 * - 无 `id` 的行跳过（无法勾稽，不计数）。
 */
import type { TicketAssignmentRecord } from '../ticketAssignmentStore';
import type { TicketFacts } from '../ticketStage';
import type { CockpitItem } from './cockpitSnapshot';

export interface CockpitSourceDeps {
  /** 读取工作项行（`listPdcaWorkItems()` 的返回值） */
  listWorkItems: () => Promise<ReadonlyArray<Record<string, unknown>>>;
  /** 读取某工作项的派工记录（时间正序；末条即最新） */
  listAssignments: (
    workItemId: string
  ) => Promise<readonly TicketAssignmentRecord[]>;
  /** 该状态是否"已结束"（由调用方复用 `TaskStatus` 事实源；本模块不写状态清单） */
  isEndedStatus: (status: string) => boolean;
}

/** 装配（纯映射；失败由调用方处理，本函数不吞异常） */
export async function loadCockpitItems(
  deps: CockpitSourceDeps
): Promise<CockpitItem[]> {
  const rows = await deps.listWorkItems();
  const items: CockpitItem[] = [];

  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id) continue; // 无法勾稽 ⇒ 不计数

    const assignments = await deps.listAssignments(id);
    const latest = assignments.at(-1);

    const facts: TicketFacts = {
      ...(deps.isEndedStatus(String(row.status ?? '')) ? { ended: true } : {}),
      ...(latest
        ? {
            latestAssignment: {
              state: latest.state,
              ...(latest.reportState ? { report: latest.reportState } : {}),
            },
          }
        : {}),
    };

    items.push({
      id,
      ...(typeof row.title === 'string' ? { title: row.title } : {}),
      facts,
      ...(typeof row.costTokens === 'number'
        ? { costTokens: row.costTokens }
        : {}),
      ...(typeof row.lastAction === 'string'
        ? { lastAction: row.lastAction }
        : {}),
    });
  }

  return items;
}
