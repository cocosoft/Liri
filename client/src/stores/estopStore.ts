import { create } from "zustand";
import { systemService, type EstopStateDto } from "../services/systemService";

/**
 * estopStore — 全局暂停（ESTOP）状态
 *
 * 数据源：后端 /v1/system/estop（启动时 load 拉取）+ SSE system:estop_changed
 * （运行中实时同步：设置页/外部变更 → 聊天区横幅即时显示）。
 */
interface EstopState {
  /** 是否已启用全局暂停 */
  engaged: boolean;
  /** 暂停详情（reason/engagedAt），未启用为 null */
  state: EstopStateDto | null;
  /** 是否已尝试过初始化加载 */
  loaded: boolean;
  /** SSE 事件 / API 响应同步状态 */
  setStatus: (engaged: boolean, state: EstopStateDto | null) => void;
  /** 启动时拉取一次后端状态 */
  load: () => Promise<void>;
}

export const useEstopStore = create<EstopState>((set, get) => ({
  engaged: false,
  state: null,
  loaded: false,

  setStatus: (engaged, state) => {
    if (get().engaged === engaged && get().state === state) return; // 幂等
    set({ engaged, state, loaded: true });
  },

  load: async () => {
    if (get().loaded) return; // 只拉一次（后续靠 SSE 同步）
    try {
      const res = await systemService.getEstopStatus();
      if (res.ok && res.data) {
        set({ engaged: res.data.engaged, state: res.data.state, loaded: true });
      }
    } catch {
      // 后端未就绪/网络失败：保持默认，SSE 重连后会补拉
    }
  },
}));
