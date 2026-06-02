import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const DashboardPage = lazy(() => import('../components/views/DashboardPage'));
const LogViewerPage = lazy(() => import('../components/views/LogViewerPage'));
const KnowledgePage = lazy(() => import('../components/views/KnowledgePage'));
const AgentPage = lazy(() => import('../components/views/AgentPage'));
const CronPage = lazy(() => import('../components/views/CronPage'));
const TaskCenterPage = lazy(() => import('../components/views/TaskCenterPage'));
const ChannelsPage = lazy(() => import('../components/views/ChannelsPage'));
const SettingsPage = lazy(() => import('../components/views/SettingsPage'));
const BuddyPage = lazy(() => import('../components/views/BuddyPage'));
const FileExplorerPage = lazy(() => import('../components/views/FileExplorerPage'));
const LoginPage = lazy(() => import('../components/views/LoginPage'));
const ApiKeyPage = lazy(() => import('../components/views/ApiKeyPage'));
const STTTestPage = lazy(() => import('../components/views/STTTestPage'));
const SkillMarketPage = lazy(() => import('../components/views/SkillMarketPage'));
const MCPMarketPage = lazy(() => import('../components/views/MCPMarketPage'));

export const routes: RouteObject[] = [
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/apikeys',
    element: <ApiKeyPage />,
  },
  {
    path: '/dashboard',
    element: <DashboardPage />,
  },
  {
    path: '/logs',
    element: <LogViewerPage />,
  },
  {
    path: '/files',
    element: <FileExplorerPage />,
  },
  {
    path: '/knowledge',
    element: <KnowledgePage />,
  },
  {
    path: '/agent',
    element: <AgentPage />,
  },
  {
    path: '/cron',
    element: <CronPage />,
  },
  {
    path: '/tasks',
    element: <TaskCenterPage />,
  },
  {
    path: '/channels',
    element: <ChannelsPage />,
  },
  {
    path: '/settings',
    element: <SettingsPage />,
  },
  {
    path: '/buddy',
    element: <BuddyPage />,
  },
  {
    path: '/voice-stt',
    element: <STTTestPage />,
  },
  {
    path: '/skill-market',
    element: <SkillMarketPage />,
  },
  {
    path: '/mcp-market',
    element: <MCPMarketPage />,
  },
];

export default routes;