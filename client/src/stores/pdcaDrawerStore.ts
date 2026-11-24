/**
 * PDCA Drawer Store — Zustand
 *
 * 批次 14 P2-A（2026-11-24）：PDCA 编排抽屉的开合状态。
 *
 * 抽屉本体在 `ChatArea`，入口有两处（浮动栏徽标 / 消息内 `PdcaWorkflowCard`
 * 的「查看详情」）—— 二者不在同一父子链上，故把开合提升为单例 store，
 * 避免为同一个 UI 态再穿一条 props 链路（CS01）。
 * 纯 UI 状态，不持久化。
 */

import { create } from "zustand";

interface PdcaDrawerState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  close: () => void;
}

export const usePdcaDrawerStore = create<PdcaDrawerState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));
