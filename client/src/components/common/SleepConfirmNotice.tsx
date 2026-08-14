import { useEffect, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { useSleepNoticeStore } from "../../stores/sleepNoticeStore";
import { systemService } from "../../services/systemService";

/** 格式化滞后时长：分钟（<1 分钟显示秒） */
function formatLag(lagMs: number): string {
  const minutes = Math.round(lagMs / 60000);
  if (minutes < 1) return `${Math.round(lagMs / 1000)} 秒`;
  return `${minutes} 分钟`;
}

/**
 * SleepConfirmNotice — 系统休眠检测提示
 *
 * 后端检测到 Windows 休眠/睡眠（定时器整体滞后）后通过 SSE 推送
 * system:sleep_detected 事件，此处弹出确认框，由用户决策是否继续执行
 * 休眠期间积压的定时任务：
 * - "继续执行"：补跑积压任务（resolve(true)）
 * - "跳过"：跳过积压任务（resolve(false)）
 */
function SleepConfirmNotice() {
  const notice = useSleepNoticeStore((s) => s.notice);
  const clearNotice = useSleepNoticeStore((s) => s.clearNotice);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (notice) setOpen(true);
  }, [notice]);

  if (!notice) return null;

  const handleConfirm = (runMissed: boolean) => {
    setOpen(false);
    clearNotice();
    systemService.resolveSleep(runMissed).catch(() => {
      /* 决策上报失败：后端仍处于暂停状态，下轮不会补跑，用户可重试 */
    });
  };

  return (
    <ConfirmDialog
      open={open}
      title="检测到系统休眠"
      message={`系统休眠了约 ${formatLag(notice.lagMs)}，期间有 ${notice.pendingCount} 个定时任务未执行。是否继续执行？`}
      confirmText="继续执行"
      cancelText="跳过"
      onConfirm={() => handleConfirm(true)}
      onCancel={() => handleConfirm(false)}
    />
  );
}

export default SleepConfirmNotice;
