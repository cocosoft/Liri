/**
 * 自动更新 Hook
 * 提供客户端自动更新的状态管理与操作接口
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { checkForUpdate, downloadAndInstall } from "../services/updaterService";
import type { UpdateCheckResult } from "../services/updaterService";

export interface AutoUpdateState {
  checking: boolean;
  downloading: boolean;
  result: UpdateCheckResult | null;
  error: string | null;
}

export function useAutoUpdate() {
  const [state, setState] = useState<AutoUpdateState>({
    checking: false,
    downloading: false,
    result: null,
    error: null,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * 手动检查更新
   */
  const check = useCallback(async () => {
    setState((prev) => ({ ...prev, checking: true, error: null }));
    try {
      const result = await checkForUpdate();
      setState((prev) => ({ ...prev, checking: false, result }));
    } catch (e) {
      setState((prev) => ({
        ...prev,
        checking: false,
        error: e instanceof Error ? e.message : "检查更新失败",
      }));
    }
  }, []);

  /**
   * 下载并安装更新
   */
  const install = useCallback(async () => {
    setState((prev) => ({ ...prev, downloading: true, error: null }));
    try {
      await downloadAndInstall();
      setState((prev) => ({ ...prev, downloading: false }));
    } catch (e) {
      setState((prev) => ({
        ...prev,
        downloading: false,
        error: e instanceof Error ? e.message : "安装更新失败",
      }));
    }
  }, []);

  /**
   * 启动定时检查
   * @param intervalMs 检查间隔（毫秒）
   */
  const startPeriodicCheck = useCallback(
    (intervalMs: number = 86400000) => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      check().catch(() => {});
      intervalRef.current = setInterval(() => {
        check().catch(() => {});
      }, intervalMs);
    },
    [check],
  );

  /**
   * 停止定时检查
   */
  const stopPeriodicCheck = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    ...state,
    check,
    install,
    startPeriodicCheck,
    stopPeriodicCheck,
  };
}
