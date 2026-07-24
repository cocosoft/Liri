import { useState, useEffect } from "react";
import { memoryService } from "../../services/memoryService";

/**
 * 获取已被梦境处理过的会话 ID 集合
 * 用于在会话列表中显示"已凝练"状态圆点
 */
export function useDreamSessionIds(): Set<string> {
  const [processedIds, setProcessedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        // 获取最近 200 条梦境周期记录，聚合所有已处理的会话 ID
        const result = await memoryService.getDreamCycles({
          pageSize: 200,
          sortOrder: "desc",
        });
        if (cancelled) return;

        const ids = new Set<string>();
        for (const cycle of result.cycles) {
          for (const sid of cycle.processedSessionIds || []) {
            ids.add(sid);
          }
        }
        setProcessedIds(ids);
      } catch {
        // 梦境周期数据不可用时静默忽略
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return processedIds;
}
