/**
 * Feature Flags 存储 — 控制高风险重构的渐进式发布
 *
 * 使用方式：
 *   const flag = useFeatureFlagStore(s => s.flags.toolcall_flat);
 *   return flag ? <NewComponent /> : <OldComponent />;
 */
import { create } from "zustand";

/** 所有 Feature Flag 定义 */
export interface FeatureFlags {
  /** 工具调用扁平化（旧版 ToolCallBlock / 新版 ToolCallInline） */
  toolcall_flat: boolean;
  /** 消息排队（一问一答 / 队列模式） */
  message_queue: boolean;
  /** 虚拟化（全量渲染 / 虚拟列表） */
  virtual_list: boolean;
  /** 拆分后的 ChatInput（原版 / 拆分版） */
  new_chat_input: boolean;
}

interface FeatureFlagStore {
  /** Flag 开关 */
  flags: FeatureFlags;

  /** 批量设置 Flag */
  setFlags: (partial: Partial<FeatureFlags>) => void;

  /** 重置所有 Flag 到默认值（全部关闭） */
  resetAll: () => void;
}

const DEFAULT_FLAGS: FeatureFlags = {
  toolcall_flat: true,
  message_queue: true,
  virtual_list: false,
  new_chat_input: false,
};

export const useFeatureFlagStore = create<FeatureFlagStore>((set) => ({
  flags: { ...DEFAULT_FLAGS },

  setFlags: (partial: Partial<FeatureFlags>) => {
    set((state) => ({ flags: { ...state.flags, ...partial } }));
  },

  resetAll: () => {
    set({ flags: { ...DEFAULT_FLAGS } });
  },
}));