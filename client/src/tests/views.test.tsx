import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DashboardPage from "../components/views/DashboardPage";
import FileExplorerPage from "../components/views/FileExplorerPage";
import KnowledgePage from "../components/views/KnowledgePage";
import AgentPage from "../components/views/AgentPage";

vi.mock("../services/agentService", () => ({
  agentService: {
    listTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn(),
    executeTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    cancelTask: vi.fn(),
    getTaskProgress: vi.fn(),
    getTaskLogs: vi.fn(),
  },
}));

vi.mock("../services/knowledgeService", () => ({
  knowledgeService: {
    listBases: vi.fn().mockResolvedValue([]),
  },
}));

describe("DashboardPage", () => {
  it("renders title and refresh button", () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    // 组件始终渲染标题、副标题和操作按钮
    expect(screen.getByText("仪表盘")).toBeInTheDocument();
    expect(screen.getByText("系统概览")).toBeInTheDocument();
    expect(screen.getByText("开始聊天")).toBeInTheDocument();
  });
});

describe("FileExplorerPage", () => {
  it("renders title and workspace info", () => {
    render(<FileExplorerPage />);

    // 组件始终渲染标题和工作空间信息
    expect(screen.getByText("文件枢纽")).toBeInTheDocument();
    expect(screen.getByText("未选择工作空间")).toBeInTheDocument();
  });

  it("renders navigation buttons", () => {
    render(<FileExplorerPage />);

    expect(screen.getByText("上级目录")).toBeInTheDocument();
    expect(screen.getByText("返回聊天")).toBeInTheDocument();
  });
});

describe("KnowledgePage", () => {
  it("renders title", async () => {
    render(
      <MemoryRouter>
        <KnowledgePage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const titles = screen.getAllByText("知识库");
      expect(titles.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("AgentPage", () => {
  it("renders title and input", () => {
    render(<AgentPage />);

    expect(screen.getByText("Agent 任务")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("输入任务名称...")).toBeInTheDocument();
  });

  it("shows empty task state", async () => {
    render(<AgentPage />);

    await waitFor(() => {
      expect(screen.getByText("暂无任务")).toBeInTheDocument();
    });
  });

  it("renders action buttons", () => {
    render(<AgentPage />);

    expect(screen.getByText("执行")).toBeInTheDocument();
    expect(screen.getByText("刷新")).toBeInTheDocument();
    expect(screen.getByText("返回聊天")).toBeInTheDocument();
  });
});
