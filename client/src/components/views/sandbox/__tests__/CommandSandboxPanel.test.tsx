/**
 * CommandSandboxPanel（S3，2026-11-17）
 *
 * 断言四件（全部对应后端已落地的契约，前端只渲染后端事实）：
 *   ① helper 明确不可执行（`runnable=false`）⇒ 开启 `bashEnabled` 需二次确认，
 *      且必须先勾选「我已知晓」才能确认（不给"点了就炸"的假交互）；
 *   ② 关闭危险开关（取消勾选）⇒ 直接保存，不弹确认；
 *   ③ 「恢复默认」⇒ 二次确认后提交四项默认值；
 *   ④ 探针事实如实渲染：`effective=plain` 与 `runnable=null`（未验证）都要出现。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import i18n from "../../../../i18n";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      String(i18n.t(key, opts as never)),
    i18n: { changeLanguage: () => Promise.resolve(), language: "zh" },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const getCommandSandboxProbe = vi.fn();
const updateLandlockConfig = vi.fn();
vi.mock("../../../../services/sandboxService", () => ({
  sandboxService: {
    getCommandSandboxProbe: (...args: unknown[]) =>
      getCommandSandboxProbe(...args),
    updateLandlockConfig: (...args: unknown[]) => updateLandlockConfig(...args),
  },
}));

import CommandSandboxPanel from "../CommandSandboxPanel";

/** 探针响应构造（默认：总开关开、bashEnabled 关、helper 文件在但不可执行） */
function makeProbe(overrides: Record<string, unknown> = {}) {
  const config = {
    enabled: true,
    bashEnabled: false,
    failClosed: false,
    bashExtraWritablePaths: [],
    ...((overrides.config as Record<string, unknown>) ?? {}),
  };
  return {
    generatedAt: "2026-11-17T10:00:00.000Z",
    platform: "win32",
    config,
    evalForced: false,
    gate: { mode: "windows-low-il", reason: "windows-switch-off" },
    effective: "plain",
    helper: {
      kind: "win-sandbox-run",
      required: false,
      present: true,
      runnable: false,
      reasonCode: "probe-unsupported",
    },
    coverage: { write: true, read: false, network: false },
    affectedTools: ["bash", "powershell", "code_run"],
    notes: ["Windows 用 Low IL + Job Object，且只隔离写；读与网络不受限。"],
    ...overrides,
  };
}

beforeEach(() => {
  getCommandSandboxProbe.mockReset().mockResolvedValue(makeProbe());
  updateLandlockConfig.mockReset().mockResolvedValue(undefined);
});

describe("CommandSandboxPanel — 探针事实如实渲染", () => {
  it("effective=plain 与 runnable=false 都按后端结论显示", async () => {
    render(<CommandSandboxPanel isDark={false} />);

    await waitFor(() => {
      expect(screen.getByText("未隔离（降级为普通执行）")).toBeDefined();
    });
    // runnable=false ⇒ 「否」（不是「未验证」）
    expect(screen.getByText("否")).toBeDefined();
    expect(screen.getByText("probe-unsupported")).toBeDefined();
  });

  it("runnable=null（Windows 无 --probe 契约）⇒ 显示「未验证」，不当成可用/不可用", async () => {
    getCommandSandboxProbe.mockResolvedValue(
      makeProbe({
        helper: {
          kind: "win-sandbox-run",
          required: false,
          present: true,
          runnable: null,
          reasonCode: "probe-unsupported",
        },
      }),
    );
    render(<CommandSandboxPanel isDark={false} />);

    await waitFor(() => {
      expect(screen.getByText("未验证")).toBeDefined();
    });
    // 无「不可执行」告警（不把未验证当成不可用）
    expect(screen.queryByText(/本机 helper 文件存在但无法执行/)).toBeNull();
  });
});

describe("CommandSandboxPanel — 危险开关二次确认", () => {
  it("helper 不可执行 ⇒ 开启 bashEnabled 需勾选知晓后才能确认", async () => {
    render(<CommandSandboxPanel isDark={false} />);

    const bashCheckbox = await waitFor(() => {
      const found = screen.getByLabelText(
        "让 bash / powershell / code_run 在沙箱内执行",
      );
      expect(found).toBeDefined();
      return found as HTMLInputElement;
    });
    fireEvent.click(bashCheckbox);

    // 第一步：只弹确认，不落任何写入
    await waitFor(() => {
      expect(screen.getByText("确认开启命令执行沙箱？")).toBeDefined();
    });
    expect(updateLandlockConfig).not.toHaveBeenCalled();

    const confirm = screen
      .getByText("仍要开启")
      .closest("button") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    // 第二步：勾选知晓 ⇒ 确认可用 ⇒ 提交 bashEnabled=true
    fireEvent.click(screen.getByLabelText("我已知晓，仍要开启"));
    await waitFor(() => {
      expect(confirm.disabled).toBe(false);
    });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(updateLandlockConfig).toHaveBeenCalledWith(
        { bashEnabled: true },
        {},
      );
    });
    // 保存后必须强制重测（refresh=true），否则回显探测器缓存的旧结论
    // 3s：macOS arm64 CI 跑器负载高时，默认 1s 会偶发超时（2026-11-18 #2116 实测）
    await waitFor(
      () => {
        expect(getCommandSandboxProbe).toHaveBeenLastCalledWith(true);
      },
      { timeout: 3000 },
    );
  });

  it("关闭 failClosed（取消勾选）⇒ 直接保存，不弹确认", async () => {
    getCommandSandboxProbe.mockResolvedValue(
      makeProbe({ config: { failClosed: true } }),
    );
    render(<CommandSandboxPanel isDark={false} />);

    const failClosed = await waitFor(() => {
      const found = screen.getByLabelText(
        "沙箱初始化失败时拒绝执行（failClosed）",
      );
      expect(found).toBeDefined();
      return found as HTMLInputElement;
    });
    fireEvent.click(failClosed);

    await waitFor(() => {
      expect(updateLandlockConfig).toHaveBeenCalledWith(
        { failClosed: false },
        {},
      );
    });
    expect(screen.queryByText("确认开启 failClosed？")).toBeNull();
  });
});

describe("CommandSandboxPanel — 恢复默认", () => {
  it("确认后提交四项默认值", async () => {
    getCommandSandboxProbe.mockResolvedValue(
      makeProbe({
        config: { bashEnabled: true, failClosed: true },
      }),
    );
    render(<CommandSandboxPanel isDark={false} />);

    fireEvent.click(
      await waitFor(() => {
        const found = screen.getByText("恢复默认");
        expect(found).toBeDefined();
        return found;
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("恢复沙箱默认配置？")).toBeDefined();
    });
    // 触发按钮与确认按钮同名 ⇒ 只在确认面板内取确认按钮
    const panel = screen.getByText("恢复沙箱默认配置？").closest("div");
    expect(panel).not.toBeNull();
    fireEvent.click(within(panel as HTMLElement).getByText("恢复默认"));

    await waitFor(() => {
      expect(updateLandlockConfig).toHaveBeenCalledWith(
        {
          enabled: true,
          bashEnabled: false,
          failClosed: false,
          bashExtraWritablePaths: [],
        },
        {},
      );
    });
  });
});
