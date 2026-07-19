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
export function useVideoTaskPolling(onTaskCompleted?: (taskId: string) => void) {
  const activeTasks = useMediaStore((s) => s.activeTasks);
  const updateTask = useMediaStore((s) => s.updateTask);
  const addTask = useMediaStore((s) => s.addTask);
  const setActiveTasks = useMediaStore((s) => s.setActiveTasks);

  const timers = useRef<Map<string, ReturnType<typeof setInterval>>>(
    new Map()
  );

  /** 恢复页面刷新前的活跃任务 */
  const restoreActiveTasks = useCallback(async () => {
    try {
      const response = await videoService.listVideoTasks({
        status: "active",
        limit: 20,
      });

      if (response.tasks && response.tasks.length > 0) {
        const mapped: VideoTaskItem[] = response.tasks.map((t: any) => ({
          taskId: t.taskId,
          status: t.status,
          mode: t.mode || "text-to-video",
          progress: t.progress || 0,
          sourceImageUrl: t.sourceImageUrl || null,
          resultVideoUrl: t.resultVideoUrl || null,
          prompt: t.prompt || "",
          error: t.error || null,
          createdAt: t.createdAt,
          completedAt: t.completedAt || null,
        }));
        setActiveTasks(mapped);
        logger.info("恢复活跃任务", { count: mapped.length });
      }
    } catch (e) {
      handleClientError(e, { module: 'hooks:useVideoTaskPolling', action: 'restoreActiveTasks' }, 'warn');
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

          // 完成或失败时停止轮询
          if (response.status === "completed" || response.status === "failed") {
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
    [updateTask, stopPolling, onTaskCompleted]
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
    [pollTask]
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
    [addTask, startPolling]
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

  return { activeTasks, submitTask, restoreActiveTasks };
}
