/**
 * useVideoTaskPolling
 * 异步视频任务轮询 hook（Phase 1）
 *
 * - 提交任务后自动启动轮询
 * - 页面切后台暂停，切回前台恢复
 * - 刷新页面时自动恢复未完成任务
 * - 完成/失败后自动停止
 *
 * MD-2（2026-10-06，`.pyapp/output/媒体页排查报告.md`）：**状态源收敛为单一事实源**。
 * 原实现维护 `activeTasks`（`VideoTaskItem`，轮询内部态）+ `generationTasks`（展示态）
 * 两套状态，靠"轮询双写 + `remoteTaskId` 匹配"同步 —— 结构性易漂移（历史上即出现过
 * "展示态永远卡 30% / 完成无结果 / 失败不消失"的 BUG-A/B）。现轮询**直接读写
 * `generationTasks`**（按 `remoteTaskId` 匹配），`activeTasks` 已从 store 删除。
 */

import { useEffect, useRef, useCallback, useMemo } from "react";
import { useMediaStore } from "../stores/mediaStore";
import { videoService } from "../services/videoService";
import { createLogger } from "../utils/logger";
import { handleClientError } from "@/utils/handleError";

const logger = createLogger("useVideoTaskPolling");

/** 轮询间隔（毫秒） */
const POLL_INTERVAL = 2000;

/**
 * 轮询 hook
 * 返回 submitTask 用于提交新任务后开始轮询
 *
 * @param onTaskCompleted — 可选回调，单个任务完成时触发（用于刷新画廊等）
 */
export function useVideoTaskPolling(
  onTaskCompleted?: (taskId: string) => void,
) {
  const generationTasks = useMediaStore((s) => s.generationTasks);
  const addGenerationTask = useMediaStore((s) => s.addGenerationTask);
  const updateGenerationTask = useMediaStore((s) => s.updateGenerationTask);

  const timers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  /**
   * 待轮询的视频任务（MD-2：**派生**自单一事实源，不再是独立存储的影子副本）。
   * 判定：视频类型 + 已关联后端 `remoteTaskId` + 仍在 running。
   */
  const activeVideoTasks = useMemo(
    () =>
      generationTasks.filter(
        (t) => t.type === "video" && !!t.remoteTaskId && t.status === "running",
      ),
    [generationTasks],
  );

  /** 恢复页面刷新前的活跃任务（MD-2：仅补写 `generationTasks`） */
  const restoreActiveTasks = useCallback(async () => {
    try {
      const response = await videoService.listVideoTasks({
        status: "active",
        limit: 20,
      });

      if (response.tasks && response.tasks.length > 0) {
        const gen = useMediaStore.getState().generationTasks;
        let added = 0;
        for (const t of response.tasks) {
          if (gen.some((g) => g.remoteTaskId === t.taskId)) continue;
          addGenerationTask({
            id: t.taskId,
            type: "video",
            status:
              t.status === "completed" || t.status === "failed"
                ? t.status
                : "running",
            progress: t.progress || 0,
            prompt: t.prompt || "",
            sourceImageUrl: t.sourceImageUrl || null,
            resultUrl: t.resultVideoUrl || null,
            remoteTaskId: t.taskId,
            error: t.error || null,
            createdAt: Date.now(),
          });
          added++;
        }
        if (added > 0) logger.info("恢复活跃视频任务", { count: added });
      }
    } catch (e) {
      handleClientError(
        e,
        { module: "hooks:useVideoTaskPolling", action: "restoreActiveTasks" },
        "warn",
      );
    }
  }, [addGenerationTask]);

  /** 停止轮询单个任务 */
  const stopPolling = useCallback((taskId: string) => {
    const timer = timers.current.get(taskId);
    if (timer) {
      clearInterval(timer);
      timers.current.delete(taskId);
    }
  }, []);

  /** 轮询单个任务（MD-2：结果**只写唯一事实源** generationTasks） */
  const pollTask = useCallback(
    async (remoteTaskId: string) => {
      try {
        const response = await videoService.getVideoTask(remoteTaskId);

        if (response) {
          const gt = useMediaStore
            .getState()
            .generationTasks.find((t) => t.remoteTaskId === remoteTaskId);
          if (gt) {
            const genStatus =
              response.status === "completed"
                ? "completed"
                : response.status === "failed" ||
                    response.status === "cancelled"
                  ? "failed"
                  : "running";
            const patch: {
              status: "running" | "completed" | "failed";
              progress: number;
              resultUrl?: string;
              error?: string;
            } = { status: genStatus, progress: response.progress || 0 };
            if (response.resultVideoUrl)
              patch.resultUrl = response.resultVideoUrl;
            if (response.error) patch.error = response.error;
            // 后端 cancelled 时 `error` 可能为空 ⇒ 补一句明确的本地说明
            if (response.status === "cancelled" && !patch.error) {
              patch.error = "任务已取消";
            }
            updateGenerationTask(gt.id, patch);
          }

          // 完成/失败/取消时停止轮询
          if (
            response.status === "completed" ||
            response.status === "failed" ||
            response.status === "cancelled"
          ) {
            stopPolling(remoteTaskId);
            // 通知外部（如刷新画廊）
            if (response.status === "completed" && onTaskCompleted) {
              onTaskCompleted(remoteTaskId);
            }
          }
        }
      } catch (e) {
        logger.warn("轮询任务失败", { taskId: remoteTaskId, error: String(e) });
      }
    },
    [updateGenerationTask, stopPolling, onTaskCompleted],
  );

  /** 开始轮询单个任务 */
  const startPolling = useCallback(
    (taskId: string) => {
      if (timers.current.has(taskId)) return;

      const timer = setInterval(() => {
        pollTask(taskId);
      }, POLL_INTERVAL);

      timers.current.set(taskId, timer);
    },
    [pollTask],
  );

  /**
   * 新任务提交后开始轮询。
   *
   * MD-2：调用方（`MediaPage`）已在提交前写入 `generationTasks`（含 `remoteTaskId`）
   * ⇒ 此处不再补写占位条目（原先 `addTask` 写入的影子条目正是双轨来源）。
   */
  const submitTask = useCallback(
    (remoteTaskId: string) => {
      startPolling(remoteTaskId);
    },
    [startPolling],
  );

  /** 取消任务（P2，2026-08-26）：停止轮询 + 请求后端标记 cancelled */
  const cancelTask = useCallback(
    async (remoteTaskId: string) => {
      stopPolling(remoteTaskId);
      try {
        await videoService.cancelVideoTask(remoteTaskId);
      } catch (e) {
        logger.warn("取消任务请求失败", {
          taskId: remoteTaskId,
          error: String(e),
        });
      }
    },
    [stopPolling],
  );

  // ──── Effects ────

  // 启动时恢复活跃任务
  useEffect(() => {
    restoreActiveTasks();
  }, [restoreActiveTasks]);

  // 活跃任务变化时，自动为未轮询的任务启动轮询
  useEffect(() => {
    activeVideoTasks.forEach((t) => {
      if (t.remoteTaskId && !timers.current.has(t.remoteTaskId)) {
        startPolling(t.remoteTaskId);
      }
    });
  }, [activeVideoTasks, startPolling]);

  // 页面可见性变化时控制轮询
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        // 暂停所有轮询
        timers.current.forEach((timer) => clearInterval(timer));
        timers.current.clear();
      } else {
        // 恢复活跃任务的轮询（从 store 取快照，仍是同一事实源）
        useMediaStore
          .getState()
          .generationTasks.filter(
            (t) =>
              t.type === "video" && !!t.remoteTaskId && t.status === "running",
          )
          .forEach((t) => {
            if (t.remoteTaskId) startPolling(t.remoteTaskId);
          });
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // 清理所有计时器
      timers.current.forEach((timer) => clearInterval(timer));
      timers.current.clear();
    };
  }, [startPolling]);

  return { submitTask, cancelTask, restoreActiveTasks };
}
