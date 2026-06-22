/**
 * Feature Flags 存储 — 已合并到 appStore
 *
 * 本文件为向后兼容的薄封装层，所有状态实际存储在 appStore 中。
 * 通过独立的 useSelector 调用实现精细订阅，避免无关变更触发重渲染。
 * 新代码请直接使用 useAppStore。
 */
import { useAppStore, type AppStore } from "./appStore";
export type { FeatureFlags } from "./appStore";

/** 从 appStore 中提取 FeatureFlag 相关状态 */
function flagsSlice(state: AppStore): Pick<AppStore, "flags" | "setFlags" | "resetAll"> {
  return {
    flags: state.flags,
    setFlags: state.setFlags,
    resetAll: state.resetAll,
  };
}

/**
 * 使用 Feature Flag 状态（兼容原 useFeatureFlagStore API）
 *
 * 传选择器精细订阅：
 *   const flag = useFeatureFlagStore((s) => s.flags.toolcall_flat);
 *
 * 使用 getState() 在非组件代码中读取：
 *   const enabled = useFeatureFlagStore.getState().flags.message_queue;
 */
function useFeatureFlagStore(): ReturnType<typeof flagsSlice>;
function useFeatureFlagStore<T>(
  selector: (slice: ReturnType<typeof flagsSlice>) => T,
): T;
function useFeatureFlagStore(selector?: any): any {
  // 三个独立订阅，仅当对应字段变化时触发重渲染
  const flags = useAppStore((s) => s.flags);
  const setFlags = useAppStore((s) => s.setFlags);
  const resetAll = useAppStore((s) => s.resetAll);

  const slice = { flags, setFlags, resetAll };
  return selector ? selector(slice) : slice;
}

/** 兼容 getState() 调用 */
useFeatureFlagStore.getState = () => flagsSlice(useAppStore.getState());

export { useFeatureFlagStore };
