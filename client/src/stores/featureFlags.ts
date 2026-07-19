/**
 * Feature Flags 存储 — 独立 Zustand Store
 *
 * 用于管理 Feature Flag 的读写与重置。
 * 通过独立的 Store 实现精细订阅，避免无关变更触发重渲染。
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

const DEFAULT_FLAGS: FeatureFlags = {
  toolcall_flat: true,
  message_queue: true,
  virtual_list: false,
  new_chat_input: false,
};

/** Feature Flag Store 接口 */
interface FeatureFlagStore {
  flags: FeatureFlags;
  setFlags: (partial: Partial<FeatureFlags>) => void;
  resetAll: () => void;
}

/**
 * Feature Flag 状态管理 Store
 *
 * 传选择器精细订阅：
 *   const flag = useFeatureFlagStore((s) => s.flags.toolcall_flat);
 *
 * 使用 getState() 在非组件代码中读取：
 *   const enabled = useFeatureFlagStore.getState().flags.message_queue;
 */
export const useFeatureFlagStore = create<FeatureFlagStore>((set) => ({

  flags: { ...DEFAULT_FLAGS },

  setFlags: (partial: Partial<FeatureFlags>) => {
    set((state) => ({ flags: { ...state.flags, ...partial } }));
  },

  resetAll: () => {
    set({ flags: { ...DEFAULT_FLAGS } });
  },

}));
