/**
 * ToolRulesSection — 设置页治理字段消费（R3/R5，2026-11-17）
 *
 * 断言四件（全部对应后端已落地的契约，前端**不做推算/不编造**）：
 *   ① 空数据如实降级：`unknownCommandSuggestions=null` ⇒ 不渲染提示块；
 *      `approvalPause` 缺省 ⇒ 暂停开关禁用（不给假承诺）。
 *   ② 命中统计：`hitCount=3` ⇒ 「命中 3 次」；`hitCount=0` ⇒ 「尚未命中」。
 *   ③ 影响预演 409：`error.code='impact'` ⇒ 弹二次确认；确认后才以
 *      `confirmImpact=true` 重新提交（旧做法"先删后加"会留下半完成状态）。
 *   ④ 观察期未满：`ruleHits.observationComplete=false` ⇒ 只显示观察期进度，
 *      **不得**出现「未命中」结论。
 *
 * i18n：覆盖 `react-i18next` 为真实 i18n 实例（默认 zh）⇒ 同时是文案键存在性守卫。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import i18n from "../../../i18n";
import type { SharedToolVisibilityEntry } from "@shared/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      String(i18n.t(key, opts as never)),
    i18n: { changeLanguage: () => Promise.resolve(), language: "zh" },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const visibility = vi.fn();
vi.mock("../../../services/toolService", () => ({
  toolService: {
    visibility: (...a: unknown[]) => visibility(...a),
  },
}));

const listRules = vi.fn();
const addRule = vi.fn();
const updateRule = vi.fn();
const deleteRule = vi.fn();
const getRulesHealth = vi.fn();
const setApprovalPause = vi.fn();
const updateApprovalPause = vi.fn();
vi.mock("../../../services/permissionService", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../services/permissionService")
    >();
  return {
    ...actual,
    permissionService: {
      listRules: (...a: unknown[]) => listRules(...a),
      addRule: (...a: unknown[]) => addRule(...a),
      updateRule: (...a: unknown[]) => updateRule(...a),
      deleteRule: (...a: unknown[]) => deleteRule(...a),
      getRulesHealth: (...a: unknown[]) => getRulesHealth(...a),
      setApprovalPause: (...a: unknown[]) => setApprovalPause(...a),
      updateApprovalPause: (...a: unknown[]) => updateApprovalPause(...a),
    },
  };
});

import { HTTPClientError } from "../../../services/httpClient";
import { useRootStore } from "../../../stores/root-store";
import ToolRulesSection from "../ToolRulesSection";

const ENTRIES: SharedToolVisibilityEntry[] = [
  {
    name: "bash",
    category: "shell",
    registration: "registered",
    visibleByDefault: true,
    effective: "visible",
    reasons: [],
    risk: "high",
  },
];

const SUMMARY = { total: 0, allow: 0, deny: 0, ask: 0 };

/** 409 impact（后端未写任何状态）：与 `sendRuleImpactBlocked` 的响应体同形 */
function impactError(): HTTPClientError {
  const message =
    "该规则会把 1 条基准命令从 ask/allow 变为 deny；如确认请带 confirmImpact=true 重试";
  return new HTTPClientError(message, 409, {
    code: 409,
    message,
    payload: {
      error: {
        code: "impact",
        message,
        impact: {
          mode: "auto",
          cases: [
            {
              toolName: "bash",
              command: "git status",
              before: "ask",
              after: "deny",
              degraded: true,
            },
          ],
          degradedCommands: ["git status"],
          degraded: true,
          note: "口径说明",
        },
      },
    },
  });
}

beforeEach(() => {
  visibility.mockReset().mockResolvedValue(ENTRIES);
  listRules.mockReset().mockResolvedValue({ rules: [], summary: SUMMARY });
  addRule.mockReset().mockResolvedValue(undefined);
  updateRule.mockReset().mockResolvedValue(undefined);
  deleteRule.mockReset().mockResolvedValue(undefined);
  getRulesHealth.mockReset();
  setApprovalPause.mockReset().mockResolvedValue({
    enabled: true,
    configKey: "permission.approvalPause",
    message: "",
  });
  updateApprovalPause.mockReset().mockResolvedValue({
    enabled: false,
    global: true,
    sessions: [],
    configKey: "permission.pauseApprovalPersistence",
    message: "",
  });
  // F2：细粒度暂停依赖"当前会话 / 当前工作区"；每个用例从未绑定起跑
  useRootStore.setState({ currentSessionId: null, chatSessions: [] });
});

describe("ToolRulesSection — 空数据如实降级", () => {
  it("无未收录命令样本 ⇒ 不渲染提示块；无 approvalPause ⇒ 暂停开关禁用", async () => {
    render(<ToolRulesSection isDark={false} />);

    await waitFor(() => {
      expect(screen.getByText("bash")).toBeDefined();
    });
    // `unknownCommandSuggestions` 缺省（= null）⇒ 不出现提示块
    expect(screen.queryByText(/未收录命令/)).toBeNull();
    // `approvalPause` 缺省 ⇒ 不给"可暂停"的假承诺（全局 + 仅当前会话两个开关都禁用）
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => box.disabled)).toBe(true);
    // 审批分组为空 ⇒ 如实显示空态
    expect(screen.getByText("暂无审批生成的放行")).toBeDefined();
  });
});

describe("ToolRulesSection — 命中统计展示", () => {
  it("hitCount>0 ⇒ 次数；hitCount=0 ⇒ 尚未命中（不显示假 0）", async () => {
    listRules.mockResolvedValue({
      rules: [
        {
          id: "r1",
          behavior: "allow",
          toolName: "bash",
          contentPattern: "git status",
          source: "user",
          priority: 0,
          createdAt: null,
          updatedAt: null,
          origin: "approval",
          hitCount: 3,
          lastHitAt: new Date("2026-11-16T10:00:00Z").toISOString(),
        },
        {
          id: "r2",
          behavior: "allow",
          toolName: "bash",
          contentPattern: "ls",
          source: "user",
          priority: 0,
          createdAt: null,
          updatedAt: null,
          origin: "user",
          hitCount: 0,
          lastHitAt: null,
        },
      ],
      summary: { ...SUMMARY, total: 2, allow: 2 },
    });

    render(<ToolRulesSection isDark={false} />);

    await waitFor(() => {
      expect(screen.getByText("命中 3 次")).toBeDefined();
    });
    expect(screen.getByText("尚未命中")).toBeDefined();
  });
});

describe("ToolRulesSection — 影响预演 409 ⇒ 二次确认", () => {
  it("改成 deny 被 409 拦住 ⇒ 先展示变差清单，确认后才带 confirmImpact 重试", async () => {
    listRules.mockResolvedValue({
      rules: [
        {
          id: "r1",
          behavior: "allow",
          toolName: "bash",
          source: "user",
          priority: 0,
          createdAt: null,
          updatedAt: null,
          origin: "user",
          hitCount: 1,
          lastHitAt: null,
        },
      ],
      summary: { ...SUMMARY, total: 1, allow: 1 },
    });
    updateRule.mockRejectedValueOnce(impactError());

    render(<ToolRulesSection isDark={false} />);

    const select = await waitFor(() => {
      const found = screen.getByLabelText("bash 的权限行为");
      expect(found).toBeDefined();
      return found as HTMLSelectElement;
    });
    fireEvent.change(select, { target: { value: "deny" } });

    // 第一次提交不带 confirmImpact
    await waitFor(() => {
      expect(updateRule).toHaveBeenCalledWith("r1", { behavior: "deny" });
    });
    // 阻断时先展示清单，不静默重试
    await waitFor(() => {
      expect(screen.getByText(/基准命令从询问\/允许变为拒绝/)).toBeDefined();
    });
    expect(screen.getByText("git status")).toBeDefined();
    expect(updateRule).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("仍然保存"));

    await waitFor(() => {
      expect(updateRule).toHaveBeenLastCalledWith("r1", {
        behavior: "deny",
        confirmImpact: true,
      });
    });
  });

  it("新增规则（工具名不存在）被 409 拦住 ⇒ 重试带 confirmImpact", async () => {
    addRule.mockRejectedValueOnce(impactError());

    render(<ToolRulesSection isDark={false} />);

    const select = await waitFor(() => {
      const found = screen.getByLabelText("bash 的权限行为");
      expect(found).toBeDefined();
      return found as HTMLSelectElement;
    });
    fireEvent.change(select, { target: { value: "ask" } });

    await waitFor(() => {
      expect(addRule).toHaveBeenCalledWith("ask", "bash", undefined, undefined);
    });
    await waitFor(() => {
      expect(screen.getByText(/基准命令从询问\/允许变为拒绝/)).toBeDefined();
    });

    fireEvent.click(screen.getByText("仍然保存"));

    await waitFor(() => {
      expect(addRule).toHaveBeenLastCalledWith("ask", "bash", undefined, {
        confirmImpact: true,
      });
    });
  });
});

describe("ToolRulesSection — F2：暂停粒度（全局 / 会话 / 工作区）", () => {
  const PAUSE = (
    sessions: string[],
    global = false,
    workspaces: string[] = [],
  ) => ({
    enabled: global,
    global,
    sessions,
    workspaces,
    configKey: "permission.pauseApprovalPersistence",
  });

  it("勾选「仅对当前会话暂停」⇒ 以当前会话 id 写入 sessions", async () => {
    useRootStore.setState({ currentSessionId: "sess-1" });
    listRules.mockResolvedValue({
      rules: [],
      summary: SUMMARY,
      approvalPause: PAUSE([]),
    });

    render(<ToolRulesSection isDark={false} />);

    const boxes = await waitFor(() => {
      const found = screen.getAllByRole("checkbox") as HTMLInputElement[];
      expect(found).toHaveLength(3);
      return found;
    });
    const sessionBox = boxes[1];
    expect(sessionBox.disabled).toBe(false);
    expect(sessionBox.checked).toBe(false);

    fireEvent.click(sessionBox);

    await waitFor(() => {
      expect(updateApprovalPause).toHaveBeenCalledWith({
        sessions: ["sess-1"],
      });
    });
  });

  it("当前会话已在 sessions 中 ⇒ 取消勾选会移除该 id（其他会话保留）", async () => {
    useRootStore.setState({ currentSessionId: "sess-1" });
    listRules.mockResolvedValue({
      rules: [],
      summary: SUMMARY,
      approvalPause: PAUSE(["sess-1", "sess-2"]),
    });

    render(<ToolRulesSection isDark={false} />);

    const boxes = await waitFor(() => {
      const found = screen.getAllByRole("checkbox") as HTMLInputElement[];
      expect(found).toHaveLength(3);
      return found;
    });
    expect(boxes[1].checked).toBe(true);

    fireEvent.click(boxes[1]);

    await waitFor(() => {
      expect(updateApprovalPause).toHaveBeenCalledWith({
        sessions: ["sess-2"],
      });
    });
  });

  it("无活跃会话 ⇒ 会话开关禁用（不给点了没反应的假交互）", async () => {
    listRules.mockResolvedValue({
      rules: [],
      summary: SUMMARY,
      approvalPause: PAUSE([]),
    });

    render(<ToolRulesSection isDark={false} />);

    const boxes = await waitFor(() => {
      const found = screen.getAllByRole("checkbox") as HTMLInputElement[];
      expect(found).toHaveLength(3);
      return found;
    });
    expect(boxes[0].disabled).toBe(false); // 全局开关可用
    expect(boxes[1].disabled).toBe(true); // 会话开关禁用
    expect(screen.getByText("当前没有活跃会话")).toBeDefined();
  });

  it("全局开关 ⇒ 只写 global（旧语义不变）", async () => {
    listRules.mockResolvedValue({
      rules: [],
      summary: SUMMARY,
      approvalPause: PAUSE([], false),
    });

    render(<ToolRulesSection isDark={false} />);

    const boxes = await waitFor(() => {
      const found = screen.getAllByRole("checkbox") as HTMLInputElement[];
      expect(found).toHaveLength(3);
      return found;
    });

    fireEvent.click(boxes[0]);

    await waitFor(() => {
      expect(updateApprovalPause).toHaveBeenCalledWith({ global: true });
    });
  });

  it("勾选「仅对当前工作区暂停」⇒ 以当前会话绑定的路径写入 workspaces", async () => {
    useRootStore.setState({
      currentSessionId: "sess-1",
      chatSessions: [
        { id: "sess-1", title: "t", workspacePath: "E:\\Proj" },
      ] as never,
    });
    listRules.mockResolvedValue({
      rules: [],
      summary: SUMMARY,
      approvalPause: PAUSE([]),
    });

    render(<ToolRulesSection isDark={false} />);

    const boxes = await waitFor(() => {
      const found = screen.getAllByRole("checkbox") as HTMLInputElement[];
      expect(found).toHaveLength(3);
      return found;
    });
    const workspaceBox = boxes[2];
    expect(workspaceBox.disabled).toBe(false);
    expect(workspaceBox.checked).toBe(false);

    fireEvent.click(workspaceBox);

    await waitFor(() => {
      expect(updateApprovalPause).toHaveBeenCalledWith({
        workspaces: ["E:\\Proj"],
      });
    });
  });

  it("服务端归一化后的根与当前路径等价 ⇒ 勾选态为已暂停，点击后移除", async () => {
    useRootStore.setState({
      currentSessionId: "sess-1",
      chatSessions: [
        { id: "sess-1", title: "t", workspacePath: "E:\\Proj\\" },
      ] as never,
    });
    listRules.mockResolvedValue({
      rules: [],
      summary: SUMMARY,
      approvalPause: PAUSE([], false, ["e:/proj"]),
    });

    render(<ToolRulesSection isDark={false} />);

    const boxes = await waitFor(() => {
      const found = screen.getAllByRole("checkbox") as HTMLInputElement[];
      expect(found).toHaveLength(3);
      return found;
    });
    expect(boxes[2].checked).toBe(true);

    fireEvent.click(boxes[2]);

    await waitFor(() => {
      expect(updateApprovalPause).toHaveBeenCalledWith({ workspaces: [] });
    });
  });

  it("未绑定工作区 ⇒ 工作区开关禁用并如实提示；已暂停的根可在列表移除", async () => {
    listRules.mockResolvedValue({
      rules: [],
      summary: SUMMARY,
      approvalPause: PAUSE([], false, ["e:/a", "e:/b"]),
    });

    render(<ToolRulesSection isDark={false} />);

    const boxes = await waitFor(() => {
      const found = screen.getAllByRole("checkbox") as HTMLInputElement[];
      expect(found).toHaveLength(3);
      return found;
    });
    expect(boxes[2].disabled).toBe(true);
    expect(screen.getByText("当前会话未绑定文件夹")).toBeDefined();
    expect(screen.getByText("e:/a")).toBeDefined();
    expect(screen.getByText("e:/b")).toBeDefined();

    fireEvent.click(screen.getAllByText("删除")[0]);

    await waitFor(() => {
      expect(updateApprovalPause).toHaveBeenCalledWith({
        workspaces: ["e:/b"],
      });
    });
  });
});

describe("ToolRulesSection — allow 预算与 B 体系只读视图", () => {
  it("达到 allow 预算上限 ⇒ 高亮并提示提高配置", async () => {
    listRules.mockResolvedValue({
      rules: [],
      summary: SUMMARY,
      allowBudget: { limit: 2, used: 2 },
    });

    render(<ToolRulesSection isDark={false} />);

    await waitFor(() => {
      expect(screen.getByText("用户手建 allow 规则 2/2")).toBeDefined();
    });
    // 超限提示给出配置项（这是后端 409 的同一口径，提前说清楚）
    expect(screen.getByText(/permission.userRuleAllowBudget/)).toBeDefined();
    // 未配置 B 体系命令策略 ⇒ 不渲染只读块
    expect(screen.queryByText(/B 体系命令策略/)).toBeNull();
  });

  it("B 体系命令规则 ⇒ 只读展示模式与黑/白名单", async () => {
    listRules.mockResolvedValue({
      rules: [],
      summary: SUMMARY,
      commandRules: {
        readOnly: true,
        source: "commandRules",
        mode: "whitelist",
        blacklist: [{ pattern: "rm -rf" }],
        whitelist: [{ pattern: "git" }],
        note: "",
      },
    });

    render(<ToolRulesSection isDark={false} />);

    await waitFor(() => {
      expect(screen.getByText(/B 体系命令策略（白名单模式）/)).toBeDefined();
    });
    expect(screen.getByText("命令黑名单")).toBeDefined();
    expect(screen.getByText("rm -rf")).toBeDefined();
    expect(screen.getByText("命令白名单")).toBeDefined();
    expect(screen.getByText("git")).toBeDefined();
  });
});

describe("ToolRulesSection — 规则健康：观察期未满不出「未命中」结论", () => {
  it("observationComplete=false ⇒ 只显示观察期进度", async () => {
    getRulesHealth.mockResolvedValue({
      generatedAt: Date.now(),
      path: "tool_rules.json",
      exists: true,
      sizeBytes: 10,
      lastModified: null,
      fileHash: "a",
      loadedHash: "a",
      externalChangeDetected: false,
      parseError: null,
      fileRuleCount: 0,
      memoryRuleCount: 0,
      duplicateCount: 0,
      conflicts: [],
      ruleHits: {
        staleDays: 90,
        countingSince: Date.now() - 86_400_000,
        observationDays: 1,
        observationComplete: false,
        staleRules: [],
      },
    });

    render(<ToolRulesSection isDark={false} />);
    await waitFor(() => {
      expect(screen.getByText("bash")).toBeDefined();
    });

    fireEvent.click(screen.getByText("检查规则健康"));

    await waitFor(() => {
      expect(screen.getByText(/命中统计观察期 1\/90 天/)).toBeDefined();
    });
    expect(screen.queryByText(/没有长期未命中的规则/)).toBeNull();
  });

  it("observationComplete=true 且无未命中规则 ⇒ 显示「没有长期未命中」", async () => {
    getRulesHealth.mockResolvedValue({
      generatedAt: Date.now(),
      path: "tool_rules.json",
      exists: true,
      sizeBytes: 10,
      lastModified: null,
      fileHash: "a",
      loadedHash: "a",
      externalChangeDetected: false,
      parseError: null,
      fileRuleCount: 0,
      memoryRuleCount: 0,
      duplicateCount: 0,
      conflicts: [],
      ruleHits: {
        staleDays: 90,
        countingSince: Date.now() - 200 * 86_400_000,
        observationDays: 200,
        observationComplete: true,
        staleRules: [],
      },
    });

    render(<ToolRulesSection isDark={false} />);
    await waitFor(() => {
      expect(screen.getByText("bash")).toBeDefined();
    });

    fireEvent.click(screen.getByText("检查规则健康"));

    await waitFor(() => {
      expect(screen.getByText("近 90 天没有长期未命中的规则")).toBeDefined();
    });
  });
});
