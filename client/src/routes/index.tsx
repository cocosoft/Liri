import { lazy, useEffect } from "react";
import {
  Navigate,
  useNavigate,
  useParams,
  useLocation,
} from "react-router-dom";
import type { RouteObject } from "react-router-dom";
import AuthGuard from "../components/common/AuthGuard";
import ChatPageLayout from "../components/layout/ChatPageLayout";

/** /workspace/:id → /projects/:id 重定向 */
function WorkspaceRedirect() {
  const { workspaceId, sessionId } = useParams<{
    workspaceId: string;
    sessionId?: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const target = `/projects/${workspaceId}${sessionId ? `/${sessionId}` : ""}${location.search}`;
    navigate(target, { replace: true });
  }, []);
  return null;
}

/**
 * D5 日历并入办公：/office/calendar 与 /calendar 均重定向到 canonical URL
 * /office?view=calendar，并保留 search（含 date= 参数，供消息中心「查看日历」定位日期）。
 * P0-5 防环：唯一权威 URL 为 /office?view=calendar，旧路由不再互相指向。
 */
function NavigateWithSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const query = new URLSearchParams(location.search).toString();
    navigate(`/office?view=calendar${query ? `&${query}` : ""}`, {
      replace: true,
    });
  }, [location.search, navigate]);
  return null;
}

// 页面组件懒加载（减少首屏体积）
const HomePage = lazy(() => import("../components/views/HomePage"));
const DashboardPage = lazy(() => import("../components/views/DashboardPage"));
const FileExplorerPage = lazy(
  () => import("../components/views/FileExplorerPage"),
);
const UsageCenterPage = lazy(
  () => import("../components/views/UsageCenterPage"),
);
const KnowledgePage = lazy(() => import("../components/views/KnowledgePage"));
const MemoryPage = lazy(() => import("../components/views/MemoryPage"));
const SkillPage = lazy(() => import("../components/views/SkillPage"));
const AgentPage = lazy(() => import("../components/views/AgentPage"));
const AgentAdvancedPage = lazy(
  () => import("../components/views/AgentAdvancedPage"),
);
const CouncilAgentRolesPage = lazy(
  () => import("../components/views/CouncilAgentRolesPage"),
);
const CronPage = lazy(() => import("../components/views/CronPage"));
const DreamPage = lazy(() => import("../components/views/DreamPage"));
const LiriPage = lazy(() => import("../components/views/LiriPage"));
const LoopPanel = lazy(() => import("../components/views/LoopPanel"));
const BackgroundStatusPage = lazy(
  () => import("../components/views/BackgroundStatusPage"),
);

const ProjectsPage = lazy(() => import("../components/views/ProjectsPage"));
const TasksPage = lazy(() => import("../components/views/TasksPage"));
const ProjectOutputPage = lazy(
  () => import("../components/views/ProjectOutputPage"),
);
const ChannelsPage = lazy(() => import("../components/views/ChannelsPage"));
const SettingsPage = lazy(() => import("../components/views/SettingsPage"));
const PermissionPage = lazy(() => import("../components/views/PermissionPage"));
const SecurityDashboard = lazy(
  () => import("../components/views/SecurityDashboard"),
);
const UserPage = lazy(() => import("../components/views/UserPage"));
const HelpPage = lazy(() => import("../components/views/HelpPage"));
const BuddyPage = lazy(() => import("../components/views/BuddyPage"));
const MCPMarketPage = lazy(() => import("../components/views/MCPMarketPage"));
const PluginMarketPage = lazy(
  () => import("../components/views/PluginMarketPage"),
);
const ModelPage = lazy(() => import("../components/views/ModelPage"));
const TTSPage = lazy(() => import("../components/views/TTSPage"));
const ImagePage = lazy(() => import("../components/views/ImagePage"));
const MediaPage = lazy(() => import("../components/views/MediaPage"));
const TerminalPage = lazy(() => import("../components/views/TerminalPage"));
const LogViewerPage = lazy(() => import("../components/views/LogViewerPage"));
const SandboxPage = lazy(() => import("../components/views/SandboxPage"));
const AutoReplyPage = lazy(() => import("../components/views/AutoReplyPage"));
const STTTestPage = lazy(() => import("../components/views/STTTestPage"));
// D7：翻译并入聊天，/translate 改为重定向；TranslatePage 组件保留供聊天内嵌复用（S6）。
const OfficePage = lazy(() => import("../components/views/office/OfficePage"));
const OfficeDocPage = lazy(
  () => import("../components/views/office/OfficeDocPage"),
);
const OfficeMailPage = lazy(
  () => import("../components/views/office/OfficeMailPage"),
);
// D5：日历页改由 OfficePage（?view=calendar）内部承载，不再作为独立顶级路由挂载。
// routes/index.tsx 原有保留路由
// M2：/apikeys 归一为 ApiKeyContent 唯一实现（方案 §5.4，替代 ApiKeyPage 重复实现）
const ApiKeyPage = lazy(() => import("../components/settings/ApiKeyContent"));
const OAuthPage = lazy(() => import("../components/views/OAuthPage"));
const LoginPage = lazy(() => import("../components/views/LoginPage"));

/** 完整路由表——App.tsx（33 条）与 routes/index.tsx 原路由取并集，同名路由 App.tsx 优先（含 AuthGuard） */
export const routes: RouteObject[] = [
  // W7：登录页（供 AuthGuard requiredRole/requiredTrustLevel 校验失败时跳转）
  { path: "/login", element: <LoginPage /> },

  // 首页
  {
    path: "/",
    element: (
      <AuthGuard>
        <HomePage />
      </AuthGuard>
    ),
  },

  // 项目列表
  { path: "/projects", element: <ProjectsPage /> },
  { path: "/projects/:projectId", element: <ProjectsPage /> },
  // 项目输出子页（摘要/播客/学习指南/测验/闪卡，outputType URL 通用参数）
  {
    path: "/projects/:projectId/output/:outputType",
    element: (
      <AuthGuard>
        <ProjectOutputPage />
      </AuthGuard>
    ),
  },

  // 旧工作空间路由 → 重定向到新项目路由
  {
    path: "/workspace/:workspaceId/:sessionId",
    element: <WorkspaceRedirect />,
  },
  {
    path: "/workspace/:workspaceId",
    element: <WorkspaceRedirect />,
  },

  // 聊天（无 AuthGuard，含内联布局）
  { path: "/chat", element: <ChatPageLayout /> },

  // 仪表盘
  {
    path: "/dashboard",
    element: (
      <AuthGuard>
        <DashboardPage />
      </AuthGuard>
    ),
  },

  // 文件浏览器
  {
    path: "/files",
    element: (
      <AuthGuard>
        <FileExplorerPage />
      </AuthGuard>
    ),
  },

  // 费用管理 (301 → /usage?tab=cost)
  {
    path: "/cost",
    element: <Navigate to="/usage?tab=cost" replace />,
  },

  // 知识库
  {
    path: "/knowledge",
    element: (
      <AuthGuard>
        <KnowledgePage />
      </AuthGuard>
    ),
  },

  // FAQ / 知识图谱 / RAG 配置 / 数据源 — P1-1 已页内化为 KnowledgePage Tab，独立路由重定向保留旧入口
  {
    path: "/knowledge/faq",
    element: <Navigate to="/knowledge?tab=faq" replace />,
  },

  // 知识图谱
  {
    path: "/knowledge/graph",
    element: <Navigate to="/knowledge?tab=graph" replace />,
  },

  // RAG 配置
  {
    path: "/knowledge/config",
    element: <Navigate to="/knowledge?tab=config" replace />,
  },

  // 外部数据源
  {
    path: "/knowledge/datasources",
    element: <Navigate to="/knowledge?tab=datasources" replace />,
  },

  // TTS 语音合成
  {
    path: "/tts",
    element: (
      <AuthGuard>
        <TTSPage />
      </AuthGuard>
    ),
  },

  // 图像处理
  {
    path: "/image",
    element: (
      <AuthGuard>
        <ImagePage />
      </AuthGuard>
    ),
  },

  // 翻译（D7：能力并入聊天斜杠命令，旧 URL 重定向保留）
  {
    path: "/translate",
    element: <Navigate to="/chat" replace />,
  },

  // 办公模块
  {
    path: "/office",
    element: (
      <AuthGuard>
        <OfficePage />
      </AuthGuard>
    ),
  },
  {
    path: "/office/doc",
    element: (
      <AuthGuard>
        <OfficeDocPage />
      </AuthGuard>
    ),
  },
  {
    path: "/office/mail",
    element: (
      <AuthGuard>
        <OfficeMailPage />
      </AuthGuard>
    ),
  },
  // D-12 修复：带 date 查询参数的通知跳转保留 query（原 <Navigate to="/calendar"> 丢弃 search，无法定位日期）
  {
    path: "/office/calendar",
    element: <NavigateWithSearch />,
  },

  // D5：日历独立顶级路由已废止，统一重定向到办公日历子视图（canonical /office?view=calendar）
  {
    path: "/calendar",
    element: <NavigateWithSearch />,
  },

  // 开发者工具（DevPage 已废弃：7 个子页均有独立路由，其中 5 项已有工作台/高区入口，
  // 孤岛 /autoreply 归入工作台「自主任务」组，/voice-stt 已下沉聊天输入）

  // 记忆系统
  {
    path: "/memory",
    element: (
      <AuthGuard>
        <MemoryPage />
      </AuthGuard>
    ),
  },

  // 技能管理
  {
    path: "/skills",
    element: (
      <AuthGuard>
        <SkillPage />
      </AuthGuard>
    ),
  },

  // Agent 管理
  {
    path: "/agent",
    element: (
      <AuthGuard>
        <AgentPage />
      </AuthGuard>
    ),
  },
  {
    path: "/agent/advanced",
    element: (
      <AuthGuard>
        <AgentAdvancedPage />
      </AuthGuard>
    ),
  },
  {
    path: "/agent/roles",
    element: (
      <AuthGuard>
        <CouncilAgentRolesPage />
      </AuthGuard>
    ),
  },

  // 定时任务
  {
    path: "/cron",
    element: (
      <AuthGuard>
        <CronPage />
      </AuthGuard>
    ),
  },

  // 梦境模块 — 已合并到 Liri 页面，保留重定向
  {
    path: "/dream",
    element: (
      <AuthGuard>
        <DreamPage />
      </AuthGuard>
    ),
  },

  // Liri 统一人格页（替代独立的 /dream 和 /buddy）
  {
    path: "/liri",
    element: (
      <AuthGuard>
        <LiriPage />
      </AuthGuard>
    ),
  },

  // Loop 管理中心
  {
    path: "/loops",
    element: (
      <AuthGuard>
        <LoopPanel />
      </AuthGuard>
    ),
  },

  // 后台任务运行状况（Dream 记忆整理 + Buddy 成长）
  {
    path: "/background-status",
    element: (
      <AuthGuard>
        <BackgroundStatusPage />
      </AuthGuard>
    ),
  },

  // 用量中心 (统一入口)
  {
    path: "/usage",
    element: (
      <AuthGuard>
        <UsageCenterPage />
      </AuthGuard>
    ),
  },

  // Inbox 路由已删除（2026-09-10 复查）：能力现由聊天内 InboxBlock 卡片承载（走 /v1/inbox API），
  // 通知中心为弹窗（notificationStore.openPanel），/inbox 页面零驱动方。

  // 任务聚合收件箱（D3：/tasks 由死重定向改为跨项目聚合页）
  {
    path: "/tasks",
    element: (
      <AuthGuard>
        <TasksPage />
      </AuthGuard>
    ),
  },

  // 频道管理
  {
    path: "/channels",
    element: (
      <AuthGuard>
        <ChannelsPage />
      </AuthGuard>
    ),
  },

  // 设置
  {
    path: "/settings",
    element: (
      <AuthGuard>
        <SettingsPage />
      </AuthGuard>
    ),
  },

  // 权限管理
  {
    path: "/permissions",
    element: (
      <AuthGuard>
        <PermissionPage />
      </AuthGuard>
    ),
  },

  // 安全仪表盘
  {
    path: "/security",
    element: (
      <AuthGuard>
        <SecurityDashboard />
      </AuthGuard>
    ),
  },

  // 用户管理
  {
    path: "/user",
    element: (
      <AuthGuard>
        <UserPage />
      </AuthGuard>
    ),
  },

  // 帮助
  {
    path: "/help",
    element: (
      <AuthGuard>
        <HelpPage />
      </AuthGuard>
    ),
  },

  // 伙伴系统
  {
    path: "/buddy",
    element: (
      <AuthGuard>
        <BuddyPage />
      </AuthGuard>
    ),
  },

  // 市场（/market/skills 已删除：同一页面由 SkillPage 内 SkillMarketModal 弹窗承载，路由零调用方）
  {
    path: "/market/mcp",
    element: (
      <AuthGuard>
        <MCPMarketPage />
      </AuthGuard>
    ),
  },
  {
    path: "/market/plugins",
    element: (
      <AuthGuard>
        <PluginMarketPage />
      </AuthGuard>
    ),
  },

  // 模型管理
  {
    path: "/models",
    element: (
      <AuthGuard>
        <ModelPage />
      </AuthGuard>
    ),
  },

  // 重定向路由
  { path: "/plans", element: <Navigate to="/tasks" replace /> },
  { path: "/semantic", element: <Navigate to="/knowledge" replace /> },

  // 终端
  {
    path: "/terminal",
    element: (
      <AuthGuard>
        <TerminalPage />
      </AuthGuard>
    ),
  },

  // 日志查看
  {
    path: "/logs",
    element: (
      <AuthGuard>
        <LogViewerPage />
      </AuthGuard>
    ),
  },

  // 沙箱管理
  {
    path: "/sandbox",
    element: (
      <AuthGuard>
        <SandboxPage />
      </AuthGuard>
    ),
  },

  // 媒体管理
  {
    path: "/media",
    element: (
      <AuthGuard>
        <MediaPage />
      </AuthGuard>
    ),
  },

  // 自动回复
  {
    path: "/autoreply",
    element: (
      <AuthGuard>
        <AutoReplyPage />
      </AuthGuard>
    ),
  },

  // 语音测试
  {
    path: "/voice-stt",
    element: (
      <AuthGuard>
        <STTTestPage />
      </AuthGuard>
    ),
  },

  // routes/index.tsx 原有保留路由（未在 App.tsx 中出现）
  { path: "/apikeys", element: <ApiKeyPage /> },
  { path: "/oauth", element: <OAuthPage /> },
];

export default routes;
