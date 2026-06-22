/**
 * 向后兼容 — 已合并到 appStore
 *
 * 原独立 Store 已合并到 appStore，此文件为薄封装层。
 * 新代码请直接使用 useAppStore。
 */
import { useAppStore } from "./appStore";
import type { ContentView, WorkItemStatus, WorkItem } from "./appStore";

export type { ContentView, WorkItemStatus, WorkItem };

/** Work 状态切片 */
interface WorkSlice {
  mode: "plan" | "do";
  activeWorkItem: WorkItem | null;
  contentView: ContentView;
  workTabs: string[] | undefined;
  setMode: (mode: "plan" | "do") => void;
  toggleMode: () => void;
  setActiveWorkItem: (item: WorkItem | null) => void;
  setContentView: (view: ContentView) => void;
  setWorkTabs: (tabs: string[] | undefined) => void;
}

function workSlice(state: {
  workMode: "plan" | "do"; activeWorkItem: WorkItem | null; contentView: ContentView; workTabs: string[] | undefined;
  setWorkMode: (mode: "plan" | "do") => void; toggleWorkMode: () => void; setActiveWorkItem: (item: WorkItem | null) => void;
  setContentView: (view: ContentView) => void; setWorkTabs: (tabs: string[] | undefined) => void;
}): WorkSlice {
  return {
    mode: state.workMode,
    activeWorkItem: state.activeWorkItem,
    contentView: state.contentView,
    workTabs: state.workTabs,
    setMode: state.setWorkMode,
    toggleMode: state.toggleWorkMode,
    setActiveWorkItem: state.setActiveWorkItem,
    setContentView: state.setContentView,
    setWorkTabs: state.setWorkTabs,
  };
}

export function useWorkStore(): WorkSlice;
export function useWorkStore<T>(selector: (slice: WorkSlice) => T): T;
export function useWorkStore(selector?: any): any {
  const mode = useAppStore((s) => s.workMode);
  const activeWorkItem = useAppStore((s) => s.activeWorkItem);
  const contentView = useAppStore((s) => s.contentView);
  const workTabs = useAppStore((s) => s.workTabs);
  const setMode = useAppStore((s) => s.setWorkMode);
  const toggleMode = useAppStore((s) => s.toggleWorkMode);
  const setActiveWorkItem = useAppStore((s) => s.setActiveWorkItem);
  const setContentView = useAppStore((s) => s.setContentView);
  const setWorkTabs = useAppStore((s) => s.setWorkTabs);
  const slice: WorkSlice = { mode, activeWorkItem, contentView, workTabs, setMode, toggleMode, setActiveWorkItem, setContentView, setWorkTabs };
  return selector ? selector(slice) : slice;
}

useWorkStore.getState = () => workSlice(useAppStore.getState());
useWorkStore.setState = (partial: Partial<WorkSlice>) => {
  useAppStore.setState({
    ...(partial.mode !== undefined && { workMode: partial.mode }),
    ...(partial.contentView !== undefined && { contentView: partial.contentView }),
    ...(partial.workTabs !== undefined && { workTabs: partial.workTabs }),
  } as any);
};
