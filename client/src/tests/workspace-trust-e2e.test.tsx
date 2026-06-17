import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TrustedWorkspacesPanel from "../components/settings/TrustedWorkspacesPanel";
import CustomRulesPanel from "../components/settings/CustomRulesPanel";

// Mock http module
const mockGet = vi.fn();
const mockPut = vi.fn();
vi.mock("../services/httpClient", () => ({
  http: {
    get: (...args: unknown[]) => mockGet(...args),
    put: (...args: unknown[]) => mockPut(...args),
  },
  httpLegacy: {
    get: (...args: unknown[]) => mockGet(...args),
    put: (...args: unknown[]) => mockPut(...args),
  },
}));

describe("P2.5 — 端到端测试：UI 配置 → 安全检查生效", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("TrustedWorkspacesPanel", () => {
    const defaultPermissionConfig = {
      key: "permission",
      value: {
        mode: "default" as const,
        trustedWorkspaces: [
          { path: "/home/user/proj-a", trustLevel: "development" as const, enabled: true },
          { path: "/home/user/proj-b", trustLevel: "work" as const, enabled: false },
        ],
      },
    };

    it("首次渲染时加载权限配置", async () => {
      mockGet.mockResolvedValue(defaultPermissionConfig);

      render(<TrustedWorkspacesPanel isDark={false} />);

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith("/v1/config/permission");
      });
    });

    it("渲染已配置的工作空间列表", async () => {
      mockGet.mockResolvedValue(defaultPermissionConfig);

      render(<TrustedWorkspacesPanel isDark={false} />);

      await waitFor(() => {
        expect(screen.getByText("/home/user/proj-a")).toBeTruthy();
        expect(screen.getByText("/home/user/proj-b")).toBeTruthy();
      });
    });

    it("显示信任级别标签", async () => {
      mockGet.mockResolvedValue(defaultPermissionConfig);

      render(<TrustedWorkspacesPanel isDark={false} />);

      await waitFor(() => {
        expect(screen.getByText("开发（完全）")).toBeTruthy();
      });
    });

    it("可以添加新的工作空间", async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue({ key: "permission", value: { mode: "default", trustedWorkspaces: [] } });
      mockPut.mockResolvedValue(undefined);

      render(<TrustedWorkspacesPanel isDark={false} />);

      // 等待加载完成
      await waitFor(() => {
        expect(mockGet).toHaveBeenCalled();
      });

      // 输入路径
      const input = screen.getByPlaceholderText("输入工作空间绝对路径");
      await user.type(input, "/home/user/proj-c");

      // 点击添加按钮
      const addBtn = screen.getByText("添加");
      await user.click(addBtn);

      // 路径出现在列表中
      expect(screen.getByText("/home/user/proj-c")).toBeTruthy();
    });

    it("可以删除工作空间", async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue(defaultPermissionConfig);

      render(<TrustedWorkspacesPanel isDark={false} />);

      await waitFor(() => {
        expect(screen.getByText("/home/user/proj-a")).toBeTruthy();
      });

      // 点击第一个工作空间的删除按钮
      const deleteBtns = screen.getAllByText("删除");
      await user.click(deleteBtns[0]);

      expect(screen.queryByText("/home/user/proj-a")).toBeNull();
    });

    it("添加空路径时不生效", async () => {
      mockGet.mockResolvedValue({ key: "permission", value: { mode: "default", trustedWorkspaces: [] } });

      render(<TrustedWorkspacesPanel isDark={false} />);

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalled();
      });

      // 添加按钮在空路径时 disabled
      const addBtn = screen.getByText("添加");
      expect(addBtn).toBeDisabled();
    });

    it("添加重复路径显示错误", async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue(defaultPermissionConfig);

      render(<TrustedWorkspacesPanel isDark={false} />);

      await waitFor(() => {
        expect(screen.getByText("/home/user/proj-a")).toBeTruthy();
      });

      // 输入已存在的路径
      const input = screen.getByPlaceholderText("输入工作空间绝对路径");
      await user.type(input, "/home/user/proj-a");

      const addBtn = screen.getByText("添加");
      await user.click(addBtn);

      expect(screen.getByText("该路径已存在")).toBeTruthy();
    });

    it("保存配置时调用 API", async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue(defaultPermissionConfig);
      mockPut.mockResolvedValue(undefined);

      render(<TrustedWorkspacesPanel isDark={false} />);

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalled();
      });

      const saveBtn = screen.getByText("保存配置");
      await user.click(saveBtn);

      await waitFor(() => {
        expect(mockPut).toHaveBeenCalledWith("/v1/config/permission", {
          value: defaultPermissionConfig.value,
        });
      });
    });

    it("保存成功后显示已保存提示", async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue(defaultPermissionConfig);
      mockPut.mockResolvedValue(undefined);

      render(<TrustedWorkspacesPanel isDark={false} />);

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalled();
      });

      const saveBtn = screen.getByText("保存配置");
      await user.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByText("已保存")).toBeTruthy();
      });
    });
  });

  describe("CustomRulesPanel", () => {
    const defaultCustomRulesConfig = {
      key: "permission",
      value: {
        customRules: {
          commandRules: {
            mode: "blacklist" as const,
            blacklist: [{ pattern: "rm -rf" }, { pattern: "dd if=" }],
            whitelist: [{ pattern: "ls" }],
          },
          directoryRules: {
            blacklist: [{ path: "/etc" }],
            whitelist: [{ path: "/home/user" }],
          },
        },
      },
    };

    it("首次渲染时加载自定义规则", async () => {
      mockGet.mockResolvedValue(defaultCustomRulesConfig);

      render(<CustomRulesPanel isDark={false} />);

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith("/v1/config/permission");
      });
    });

    it("渲染命令黑名单规则", async () => {
      mockGet.mockResolvedValue(defaultCustomRulesConfig);

      render(<CustomRulesPanel isDark={false} />);

      await waitFor(() => {
        expect(screen.getByText("rm -rf")).toBeTruthy();
        expect(screen.getByText("dd if=")).toBeTruthy();
      });
    });

    it("切换 Tab 显示白名单规则", async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue(defaultCustomRulesConfig);

      render(<CustomRulesPanel isDark={false} />);

      await waitFor(() => {
        expect(screen.getByText("rm -rf")).toBeTruthy();
      });

      // 点击命令白名单 Tab
      const whitelistTab = screen.getByText("命令白名单");
      await user.click(whitelistTab);

      expect(screen.getByText("ls")).toBeTruthy();
      expect(screen.queryByText("rm -rf")).toBeNull();
    });

    it("切换 Tab 显示目录黑名单规则", async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue(defaultCustomRulesConfig);

      render(<CustomRulesPanel isDark={false} />);

      await waitFor(() => {
        expect(screen.getByText("rm -rf")).toBeTruthy();
      });

      // 点击目录黑名单 Tab
      const dirBlacklistTab = screen.getByText("目录黑名单");
      await user.click(dirBlacklistTab);

      expect(screen.getByText("/etc")).toBeTruthy();
    });

    it("可以添加新的命令黑名单", async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue({ key: "permission", value: {} });
      mockPut.mockResolvedValue(undefined);

      render(<CustomRulesPanel isDark={false} />);

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalled();
      });

      const input = screen.getByPlaceholderText("输入命令模式（如 rm -rf, chmod）");
      await user.type(input, "chmod -R 777");

      const addBtn = screen.getByText("添加");
      await user.click(addBtn);

      expect(screen.getByText("chmod -R 777")).toBeTruthy();
    });

    it("可以删除命令黑名单规则", async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue(defaultCustomRulesConfig);

      render(<CustomRulesPanel isDark={false} />);

      await waitFor(() => {
        expect(screen.getByText("rm -rf")).toBeTruthy();
      });

      const deleteBtns = screen.getAllByText("删除");
      await user.click(deleteBtns[0]);

      expect(screen.queryByText("rm -rf")).toBeNull();
    });

    it("切换命令模式", async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue({ key: "permission", value: {} });

      render(<CustomRulesPanel isDark={false} />);

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalled();
      });

      // 修改模式为白名单
      const modeSelect = screen.getByText("黑名单模式（默认放行）");
      await user.click(modeSelect);

      const whitelistMode = screen.getByText("白名单模式（仅允许）");
      await user.click(whitelistMode);
    });

    it("保存配置时调用 API", async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue(defaultCustomRulesConfig);
      mockPut.mockResolvedValue(undefined);

      render(<CustomRulesPanel isDark={false} />);

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalled();
      });

      const saveBtn = screen.getByText("保存配置");
      await user.click(saveBtn);

      await waitFor(() => {
        expect(mockPut).toHaveBeenCalledWith("/v1/config/permission", {
          value: defaultCustomRulesConfig.value,
        });
      });
    });

    it("保存成功后显示已保存提示", async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue(defaultCustomRulesConfig);
      mockPut.mockResolvedValue(undefined);

      render(<CustomRulesPanel isDark={false} />);

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalled();
      });

      const saveBtn = screen.getByText("保存配置");
      await user.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByText("已保存")).toBeTruthy();
      });
    });
  });
});
