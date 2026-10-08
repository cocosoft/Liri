// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * VFS 挂载管理前端面测试（Spec `ai-vfs-user-mountable.md` §8.2/§8.3）
 *
 * 覆盖两层：
 * - `vfsService`：请求路径/方法与 body 形状（mock httpClient）
 * - `VfsMountsPanel`：加载中/失败/空态 · 启停 · 选择 server · 保存 ·
 *   400 校验失败原位展示逐条原因 · 成功明示"需重启生效"
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vfsService } from "../services/vfsService";
import VfsMountsPanel from "../components/settings/VfsMountsPanel";
import type { VfsMountsResponse } from "../types/vfs";

const { mockGet, mockPut } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPut: vi.fn(),
}));

vi.mock("../services/httpClient", () => ({
  http: {
    get: mockGet,
    put: mockPut,
  },
  httpLegacy: {
    get: mockGet,
    put: mockPut,
  },
}));

const MOUNTS_RESPONSE: VfsMountsResponse = {
  mounts: [
    { scheme: "dev_docs", enabled: true, registered: true, readOnly: true },
    {
      scheme: "mcp",
      server: "srv-a",
      enabled: true,
      registered: false,
      readOnly: true,
    },
  ],
  availableSchemes: ["dev_docs", "mcp"],
  mcpServers: [
    { name: "srv-a", connected: true },
    { name: "srv-b", connected: false },
  ],
  requiresRestart: true,
};

describe("vfsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listMounts 走 GET /v1/vfs/mounts 并解包 ApiResponse", async () => {
    mockGet.mockResolvedValue({ ok: true, data: MOUNTS_RESPONSE });

    const res = await vfsService.listMounts();

    expect(mockGet).toHaveBeenCalledWith("/v1/vfs/mounts");
    expect(res.ok).toBe(true);
    expect(res.data?.mounts).toHaveLength(2);
    expect(res.data?.mcpServers[0]).toEqual({ name: "srv-a", connected: true });
  });

  it("saveMounts 走 PUT /v1/vfs/mounts 且 body 形如 { mounts }", async () => {
    mockPut.mockResolvedValue({
      ok: true,
      data: { success: true, warnings: [], requiresRestart: true },
    });

    const mounts = [
      { scheme: "dev_docs" as const, enabled: true },
      { scheme: "mcp" as const, server: "srv-a", enabled: false },
    ];
    const res = await vfsService.saveMounts(mounts);

    expect(mockPut).toHaveBeenCalledWith("/v1/vfs/mounts", { mounts });
    expect(res.data?.requiresRestart).toBe(true);
  });
});

describe("VfsMountsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("加载中显示加载态", () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    render(<VfsMountsPanel isDark={false} />);
    expect(screen.getByText("加载挂载配置…")).toBeTruthy();
  });

  it("加载失败显示错误与重试，点击重试后恢复", async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce({
      ok: false,
      error: { code: 500, message: "boom" },
    });
    mockGet.mockResolvedValueOnce({ ok: true, data: MOUNTS_RESPONSE });

    render(<VfsMountsPanel isDark={false} />);

    await waitFor(() => {
      expect(screen.getByText("加载挂载配置失败")).toBeTruthy();
    });

    await user.click(screen.getByText("重试"));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(screen.getByText("dev_docs（项目文档）")).toBeTruthy();
    });
  });

  it("空态显示空提示", async () => {
    mockGet.mockResolvedValue({
      ok: true,
      data: { ...MOUNTS_RESPONSE, mounts: [] },
    });

    render(<VfsMountsPanel isDark={false} />);

    await waitFor(() => {
      expect(screen.getByText("当前没有可管理的挂载点")).toBeTruthy();
    });
  });

  it("渲染挂载列表（生效状态/只读/服务器选项）", async () => {
    mockGet.mockResolvedValue({ ok: true, data: MOUNTS_RESPONSE });

    render(<VfsMountsPanel isDark={false} />);

    await waitFor(() => {
      expect(screen.getByText("dev_docs（项目文档）")).toBeTruthy();
    });
    expect(screen.getByText("mcp（MCP 服务器）")).toBeTruthy();
    expect(screen.getByText("已生效")).toBeTruthy();
    expect(screen.getByText("未生效")).toBeTruthy();
    expect(screen.getAllByText("只读")).toHaveLength(2);
    expect(screen.getByText("srv-a（已连接）")).toBeTruthy();
    expect(screen.getByText("srv-b（未连接）")).toBeTruthy();
  });

  it("启停与选择 server 后保存，提交正确的 mounts 载荷", async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({ ok: true, data: MOUNTS_RESPONSE });
    mockPut.mockResolvedValue({
      ok: true,
      data: { success: true, warnings: [], requiresRestart: true },
    });

    render(<VfsMountsPanel isDark={false} />);

    await waitFor(() => {
      expect(screen.getByText("dev_docs（项目文档）")).toBeTruthy();
    });

    // 关闭 dev_docs（首个 Toggle）
    await user.click(screen.getAllByRole("button")[0]);
    // 切换 mcp server 为 srv-b
    await user.selectOptions(screen.getByRole("combobox"), "srv-b");
    // 保存
    await user.click(screen.getByText("保存"));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith("/v1/vfs/mounts", {
        mounts: [
          { scheme: "dev_docs", enabled: false },
          { scheme: "mcp", enabled: true, server: "srv-b" },
        ],
      });
    });
  });

  it("保存成功且需重启时明示重启提示", async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({ ok: true, data: MOUNTS_RESPONSE });
    mockPut.mockResolvedValue({
      ok: true,
      data: { success: true, warnings: [], requiresRestart: true },
    });

    render(<VfsMountsPanel isDark={false} />);

    await waitFor(() => {
      expect(screen.getByText("保存")).toBeTruthy();
    });
    await user.click(screen.getByText("保存"));

    await waitFor(() => {
      expect(screen.getByText("配置已保存，需重启应用后生效")).toBeTruthy();
    });
  });

  it("校验失败（400）原位展示后端逐条原因", async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({ ok: true, data: MOUNTS_RESPONSE });
    mockPut.mockResolvedValue({
      ok: false,
      error: {
        code: 400,
        message: "第 2 项：mcp 条目 server 必填非空",
      },
    });

    render(<VfsMountsPanel isDark={false} />);

    await waitFor(() => {
      expect(screen.getByText("保存")).toBeTruthy();
    });
    await user.click(screen.getByText("保存"));

    await waitFor(() => {
      expect(screen.getByText("保存失败")).toBeTruthy();
      expect(
        screen.getByText("第 2 项：mcp 条目 server 必填非空"),
      ).toBeTruthy();
    });
  });
});
