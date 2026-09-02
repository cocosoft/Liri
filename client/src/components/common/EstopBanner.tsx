import { useEffect } from "react";
import { useEstopStore } from "../../stores/estopStore";
import { systemService } from "../../services/systemService";
import { toastWarning, toastInfo } from "../../stores/toastStore";

/**
 * EstopBanner — 全局暂停（ESTOP）醒目横幅（2026-09-02，P3-4 前端 SSE 落地）
 *
 * 数据源：启动时 GET /v1/system/estop 拉取 + SSE system:estop_changed 实时同步。
 * 已暂停时在应用顶部显示红色横幅（原因 + 解除按钮）；解除后自动消失。
 */
export default function EstopBanner() {
  const engaged = useEstopStore((s) => s.engaged);
  const state = useEstopStore((s) => s.state);
  const load = useEstopStore((s) => s.load);

  // 应用启动即拉取一次状态（SSE 事件可能早于订阅或已丢失）
  useEffect(() => {
    void load();
  }, [load]);

  if (!engaged) return null;

  async function handleDisengage(): Promise<void> {
    const res = await systemService.disengageEstop();
    if (res.ok) {
      useEstopStore.getState().setStatus(false, null);
      toastInfo("已解除全局暂停，新工作恢复执行");
    } else {
      toastWarning(res.error?.message ?? "解除全局暂停失败");
    }
  }

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 px-4 py-2 bg-red-600 text-white text-sm shadow-md"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-semibold shrink-0">⏸ 系统已全局暂停</span>
        {state?.reason && (
          <span className="truncate opacity-95">原因：{state.reason}</span>
        )}
        <span className="hidden md:inline opacity-80 truncate">
          新消息与定时任务已暂停，进行中的任务不受影响。
        </span>
      </div>
      <button
        onClick={handleDisengage}
        className="shrink-0 px-3 py-1 rounded-lg bg-white text-red-700 text-xs font-medium hover:bg-red-50 transition-colors"
      >
        解除暂停
      </button>
    </div>
  );
}
