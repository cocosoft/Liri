/**
 * G-10 P3：`ProactiveMessageCard` 展示契约。
 *
 * 锁定：优先级可辨、正文按文本渲染（无 HTML 注入）、动作/关闭回调原样透传。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ProactiveMessageCard from "../ProactiveMessageCard";

describe("ProactiveMessageCard", () => {
  it("渲染标题/正文与优先级", () => {
    render(
      <ProactiveMessageCard
        title="任务完成"
        body="后台任务已完成"
        priority="high"
      />
    );

    const card = screen.getByTestId("proactive-message-card");
    expect(card.getAttribute("data-priority")).toBe("high");
    expect(screen.getByText("任务完成")).toBeTruthy();
    expect(screen.getByText("后台任务已完成")).toBeTruthy();
  });

  it("动作按钮回调携带稳定 id", () => {
    const onAction = vi.fn();
    render(
      <ProactiveMessageCard
        title="提醒"
        body="查看详情"
        priority="normal"
        actions={[
          { id: "view:0", label: "查看" },
          { id: "dismiss:1", label: "忽略" },
        ]}
        onAction={onAction}
      />
    );

    fireEvent.click(screen.getByText("查看"));
    expect(onAction).toHaveBeenCalledWith("view:0");
  });

  it("关闭按钮触发 onDismiss", () => {
    const onDismiss = vi.fn();
    render(
      <ProactiveMessageCard
        title="提醒"
        body="正文"
        priority="low"
        onDismiss={onDismiss}
      />
    );

    fireEvent.click(screen.getByLabelText("删除"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("正文按纯文本渲染（HTML 不执行）", () => {
    const { container } = render(
      <ProactiveMessageCard
        title="安全"
        body={'<script>alert("x")</script>'}
        priority="critical"
      />
    );

    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText('<script>alert("x")</script>')).toBeTruthy();
  });
});
