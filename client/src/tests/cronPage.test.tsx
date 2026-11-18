/**
 * CronPage 冒烟（拆子组件前的行为基线）
 *
 * 目的：CronPage 为 1400+ 行单组件（spec `file-size-debt-partition-plan.md` §48 判定 A 类可拆）。
 * 拆分**不得改变行为**，故先钉住四类可观察行为，再动结构：
 * ① 调度器状态栏三态（加载中 / 运行中 / 已停止）；
 * ② 统计卡按 status 计数；
 * ③ 搜索过滤任务列表；
 * ④ 快速模板点击 ⇒ 打开新建弹窗。
 *
 * i18n 用 key 直返（`t(key)=>key`），断言不依赖具体文案。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const storeState = {
  tasks: [] as Array<Record<string, unknown>>,
  isLoading: false,
  saving: false,
  schedulerStatus: null as null | {
    running: boolean;
    activeJobs: number;
    totalJobs: number;
    uptimeMs: number;
  },
  statusLoading: false,
  loadTasks: vi.fn(),
  loadStatus: vi.fn(),
  toggleTask: vi.fn(),
  deleteTask: vi.fn(),
  runTaskNow: vi.fn(),
  createTask: vi.fn(),
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));
vi.mock("../stores/cronStore", () => ({
  useCronStore: () => storeState,
}));
vi.mock("../components/RunningTasksCard", () => ({
  default: () => <div data-testid="running-tasks" />,
}));
vi.mock("../components/Cron/CronExecutionHistory", () => ({
  default: () => <div data-testid="history" />,
}));
vi.mock("../components/Cron/CronRetryConfig", () => ({
  default: () => <div data-testid="retry" />,
}));
vi.mock("../components/common/Skeleton", () => ({
  SkeletonCard: () => <div data-testid="skeleton" />,
}));

import CronPage from "../components/views/CronPage";

function task(id: string, name: string, status: string) {
  return {
    id,
    name,
    status,
    enabled: true,
    expression: "0 8 * * *",
    silent: false,
  };
}

beforeEach(() => {
  storeState.tasks = [];
  storeState.schedulerStatus = null;
  storeState.statusLoading = false;
  storeState.isLoading = false;
});

describe("CronPage 冒烟", () => {
  it("调度器状态：null ⇒ 加载中文案；running ⇒ 运行中文案", () => {
    storeState.schedulerStatus = null;
    const { rerender } = render(<CronPage />);
    expect(screen.getByText("cron.schedulerStatusLoading")).toBeInTheDocument();

    storeState.schedulerStatus = {
      running: true,
      activeJobs: 2,
      totalJobs: 3,
      uptimeMs: 90_000,
    };
    rerender(<CronPage />);
    expect(screen.getByText("cron.schedulerRunning")).toBeInTheDocument();
  });

  it("统计卡按 status 计数（running / idle / error）", () => {
    storeState.tasks = [
      task("a", "alpha", "running"),
      task("b", "beta", "idle"),
      task("c", "gamma", "error"),
      task("d", "delta", "error"),
    ];
    render(<CronPage />);
    // 两张 error 卡 ⇒ 计数为 2；总数 4
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("搜索框按名称过滤列表", () => {
    storeState.tasks = [task("a", "alpha", "idle"), task("b", "beta", "idle")];
    render(<CronPage />);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("cron.searchPlaceholder"), {
      target: { value: "alp" },
    });
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).toBeNull();
  });

  it("点击快速模板 ⇒ 打开新建任务弹窗", () => {
    render(<CronPage />);
    expect(screen.queryByText(/cron\.promptLabel/)).toBeNull();

    fireEvent.click(screen.getByText("cron.quickTemplate30min"));
    expect(screen.getByText(/cron\.promptLabel/)).toBeInTheDocument();
  });
});
