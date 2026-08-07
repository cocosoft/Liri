// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 测试 NotificationPanel 收件箱化 UI（§五 前端 UI 验收）
 *
 * 验证：
 * - 分类 Tab 收敛为 全部/系统/日历（无审批/待办）
 * - 通知卡片不再渲染 actions 按钮（批准/拒绝），仅"已读/删除"
 * - 存量 approval/todo 数据即使带 actions 也渲染为无按钮普通卡片
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import NotificationPanel from "../components/views/NotificationPanel";
import { useNotificationStore } from "../stores/notificationStore";
import type { NotificationItem } from "../types/notification";

const now = Math.floor(Date.now() / 1000);

function makeItem(partial: Partial<NotificationItem>): NotificationItem {
  return {
    id: "n1",
    user_id: "default",
    category: "notice",
    priority: "normal",
    title: "通知",
    content: "",
    status: "unread",
    source: "cron",
    source_ref: "",
    actions: [],
    link_to: null,
    created_at: now,
    updated_at: now,
    read_at: null,
    resolved_at: null,
    expires_at: null,
    action_token: null,
    ...partial,
  };
}

describe("NotificationPanel 收件箱化（§五 前端 UI）", () => {
  beforeEach(() => {
    useNotificationStore.setState({
      panelOpen: true,
      activeCategory: "all",
      items: [
        makeItem({ id: "n1", category: "notice", title: "日历提醒" }),
        // 存量决策类数据：即使带 actions 也不渲染按钮
        makeItem({
          id: "n2",
          category: "approval",
          title: "存量审批",
          actions: [{ label: "批准", action: "approve" }],
          status: "dismissed",
        }),
      ],
      counts: {
        total: 0,
        approval: 0,
        todo: 0,
        system: 0,
        notice: 0,
        mention: 0,
      },
      isLoading: false,
      hasMore: false,
      readingAll: false,
    });
  });

  it("分类 Tab 收敛为 全部/系统/日历，无审批/待办", () => {
    render(<NotificationPanel />);
    expect(screen.getByRole("button", { name: "全部" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "系统" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "日历" })).toBeInTheDocument();
    // 无审批/待办 Tab
    expect(
      screen.queryByRole("button", { name: "审批" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "待办" }),
    ).not.toBeInTheDocument();
  });

  it("通知卡片不渲染 actions 按钮（无批准/拒绝），仅删除", () => {
    render(<NotificationPanel />);
    // 卡片标题正常渲染
    expect(screen.getByText("日历提醒")).toBeInTheDocument();
    expect(screen.getByText("存量审批")).toBeInTheDocument();
    // 即使存量数据带 actions 也不出现"批准/拒绝"按钮
    expect(
      screen.queryByRole("button", { name: "批准" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "拒绝" }),
    ).not.toBeInTheDocument();
    // 删除按钮存在（title=删除）
    expect(screen.getAllByTitle("删除").length).toBe(2);
  });

  it("面板头部仅有 全部已读，无决策操作入口", () => {
    render(<NotificationPanel />);
    expect(screen.getByText("全部已读")).toBeInTheDocument();
    expect(screen.getByText("消息中心")).toBeInTheDocument();
    expect(screen.queryByText("批准")).not.toBeInTheDocument();
    expect(screen.queryByText("拒绝")).not.toBeInTheDocument();
  });
});
