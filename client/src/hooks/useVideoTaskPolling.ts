/**
 * useVideoTaskPolling
 * 异步视频任务轮询 hook（Phase 1）
 *
 * - 提交任务后自动启动轮询
 * - 页面切后台暂停，切回前台恢复
 * - 刷新页面时自动恢复未完成任务
 * - 完成/失败后自动停止
 */

import { useEffect, useRef, useCallback } from "react";
import { useMediaStore } from "../stores/mediaStore";
import type { VideoTaskItem } from "../stores/mediaStore";
import { videoService } from "../services/videoService";
import { createLogger } from "../utils/logger";
import { handleClientError } from "@/utils/handleError";

const logger = createLogger("useVideoTaskPolling");

/** 轮询间隔（毫秒） */
const POLL_INTERVAL = 2000;

/** 活跃任务状态 */
const ACTIVE_STATUSES: VideoTaskItem["status"][] = [
  "pending",
  "queued",
  "running",
];

/**
 * 轮询 hook
 * 返回 addTask 用于提交新任务后开始轮询
 *
 * @param onTaskCompleted — 可选回调，单个任务完成时触发（用于刷新画廊等）
 */
export function useVideoTaskPolling(
  onTaskCompleted?: (taskId: string) => void,
) {
  const activeTasks = useMediaStore((s) => s.activeTasks);
  const updateTask = useMediaStore((s) => s.updateTask);
  const addTask = useMediaStore((s) => s.addTask);
  const removeTask = useMediaStore((s) => s.removeTask);
  const setActiveTasks = useMediaStore((s) => s.setActiveTasks);

  const timers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  /** 恢复页面刷新前的活跃任务 */
  const restoreActiveTasks = useCallback(async () => {
    try {
      const response = await videoService.listVideoTasks({
        status: "active",
        limit: 20,
      });

      if (response.tasks && response.tasks.length > 0) {
        const mapped: VideoTaskItem[] = response.tasks.map((t) => ({
          taskId: t.taskId,
          status: t.status as VideoTaskItem["status"],
          mode: (t.mode || "text-to-video") as VideoTaskItem["mode"],
          progress: t.progress || 0,
          sourceImageUrl: t.sourceImageUrl || null,
          resultVideoUrl: t.resultVideoUrl || null,
          prompt: t.prompt || "",
          error: t.error || null,
          createdAt: t.createdAt ?? "",
          completedAt: t.completedAt || null,
        }));
        setActiveTasks(mapped);

        // 次要项（2026-08-26）：刷新后恢复 generationTasks 展示条目。
        // 此前仅填 activeTasks（轮询内部态），任务栏展示源 generationTasks
        // 为空 → 恢复的视频任务 UI 不可见、完成回调落空
        const gen = useMediaStore.getState().generationTasks;
        for (const t of mapped) {
          if (!gen.some((g) => g.remoteTaskId === t.taskId)) {
            useMediaStore.getState().addGenerationTask({
              id: t.taskId,
              type: "video",
              status:
                t.status === "completed" || t.status === "failed"
                  ? t.status
                  : "running",
              progress: t.progress,
              prompt: t.prompt,
              sourceImageUrl: t.sourceImageUrl,
              resultUrl: t.resultVideoUrl,
              remoteTaskId: t.taskId,
              error: t.error,
              createdAt: Date.now(),
            });
          }
        }
        logger.info("恢复活跃任务", { count: mapped.length });
      }
    } catch (e) {
      handleClientError(
        e,
        { module: "hooks:useVideoTaskPolling", action: "restoreActiveTasks" },
        "warn",
      );
    }
  }, [setActiveTasks]);

  /** 停止轮询单个任务 */
  const stopPolling = useCallback((taskId: string) => {
    const timer = timers.current.get(taskId);
    if (timer) {
      clearInterval(timer);
      timers.current.delete(taskId);
    }
  }, []);

  /** 轮询单个任务 */
  const pollTask = useCallback(
    async (taskId: string) => {
      try {
        const response = await videoService.getVideoTask(taskId);

        if (response) {
          updateTask(taskId, {
            status: response.status,
            progress: response.progress || 0,
            resultVideoUrl: response.resultVideoUrl || null,
            error: response.error || null,
            completedAt: response.completedAt || null,
          });

          // BUG-A/B（2026-08-26）：同步写回 generationTasks（按 remoteTaskId 匹配）。
          // 此前 progress/resultVideoUrl 只进 activeTasks（轮询内部态），展示源
          // generationTasks 永远卡 30% / 完成无结果 / 失败不消失。
          const gt = useMediaStore
            .getState()
            .generationTasks.find((t) => t.remoteTaskId === taskId);
          if (gt) {
            const genStatus =
              response.status === "completed"
                ? "completed"
                : response.status === "failed"
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
            useMediaStore.getState().updateGenerationTask(gt.id, patch);
          }

          // 完成/失败/取消时停止轮询
          if (
            response.status === "completed" ||
            response.status === "failed" ||
            response.status === "cancelled"
          ) {
            stopPolling(taskId);
            // 通知外部（如刷新画廊）
            if (response.status === "completed" && onTaskCompleted) {
              onTaskCompleted(taskId);
            }
          }
        }
      } catch (e) {
        logger.warn("轮询任务失败", { taskId, error: String(e) });
      }
    },
    [updateTask, stopPolling, onTaskCompleted],
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

  /** 添加新任务并开始轮询 */
  const submitTask = useCallback(
    (taskId: string) => {
      addTask({
        taskId,
        status: "pending",
        mode: "text-to-video",
        progress: 0,
        sourceImageUrl: null,
        resultVideoUrl: null,
        prompt: "",
        error: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      });
      startPolling(taskId);
    },
    [addTask, startPolling],
  );

  /** 取消任务（P2，2026-08-26）：后端标记 cancelled + 本地同步 + 停止轮询 */
  const cancelTask = useCallback(
    async (taskId: string) => {
      stopPolling(taskId);
      updateTask(taskId, { status: "cancelled", error: "用户取消" });
      // 次要项（2026-08-26）：从 activeTasks 移除，避免任务栏空占位
      // （任务栏判定含 activeTasks.length，残留 cancelled 条目会导致底部空栏）
      removeTask(taskId);
      try {
        await videoService.cancelVideoTask(taskId);
      } catch (e) {
        logger.warn("取消任务请求失败", { taskId, error: String(e) });
      }
    },
    [stopPolling, updateTask, removeTask],
  );

  // ──── Effects ────

  // 启动时恢复活跃任务
  useEffect(() => {
    restoreActiveTasks();
  }, [restoreActiveTasks]);

  // 活跃任务变化时，自动为未轮询的任务启动轮询
  useEffect(() => {
    activeTasks
      .filter((t) => ACTIVE_STATUSES.includes(t.status))
      .forEach((t) => {
        if (!timers.current.has(t.taskId)) {
          startPolling(t.taskId);
        }
      });
  }, [activeTasks, startPolling]);

  // 页面可见性变化时控制轮询
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        // 暂停所有轮询
        timers.current.forEach((timer, taskId) => {
          clearInterval(timer);
          timers.current.delete(taskId);
        });
      } else {
        // 恢复活跃任务的轮询
        const store = useMediaStore.getState();
        store.activeTasks
          .filter((t) => ACTIVE_STATUSES.includes(t.status))
          .forEach((t) => {
            startPolling(t.taskId);
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

  return { activeTasks, submitTask, cancelTask, restoreActiveTasks };
}
