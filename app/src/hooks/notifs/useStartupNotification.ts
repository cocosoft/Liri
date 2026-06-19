import { useEffect, useRef } from 'react';
import { getLogger } from '@modules/monitoring';
import { appStateStore } from '../../system/state/AppStateStore';
import type { Notification } from '../../system/state/AppState';

const logger = getLogger('useStartupNotification');

type Result = Notification | Notification[] | null;

/**
 * 启动通知钩子
 * 在组件挂载时触发一次通知，封装了远程模式检查和一次会话保护
 * compute 函数仅在首次 effect 时执行一次，返回 null 跳过，返回 Notification 或数组触发通知
 */
export function useStartupNotification(
  compute: () => Result | Promise<Result>
): void {
  const hasRunRef = useRef(false);
  const computeRef = useRef(compute);
  computeRef.current = compute;

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    void Promise.resolve()
      .then(() => computeRef.current())
      .then((result) => {
        if (!result) return;
        for (const n of Array.isArray(result) ? result : [result]) {
          appStateStore.addNotification({
            type: n.type,
            title: n.title,
            message: n.message,
            priority: n.priority,
          });
        }
      })
      .catch((err) => {
        logger.error('[useStartupNotification]', { error: String(err) });
      });
  }, []);
}
