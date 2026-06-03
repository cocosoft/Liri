import { useEffect, useState, lazy, Suspense } from 'react';
import { useConfigStore } from '../../stores/configStore';
import { chatService } from '../../services/chatService';
import { appConfigService } from '../../services/appConfigService';
import { setBackendPort as setBackendUrlPort } from '../../services/backendUrl';
import { http } from '../../services/httpClient';
import FeatureFlagsPanel from '../settings/FeatureFlagsPanel';
import LocalAgentPanel from '../settings/LocalAgentPanel';
import NotificationsPanel from '../settings/NotificationsPanel';
import VoiceSettings from '../settings/VoiceSettings';
import type { BackendStatus } from '../../types';

/** 侧边栏导航项 */
interface NavItem { id: string; label: string; icon: string; }

/** 懒加载页面注册表 */
const PAGE_REGISTRY: Record<string, React.LazyExoticComponent<React.FC>> = {
  'skill-market': lazy(() => import('./SkillMarketPage')),
  'skills':       lazy(() => import('./SkillPage')),
  'oauth':        lazy(() => import('./OAuthPage')),
  'media':        lazy(() => import('./MediaPage')),
  'autoreply':    lazy(() => import('./AutoReplyPage')),
  'sandbox':      lazy(() => import('./SandboxPage')),
  'channels-page':lazy(() => import('./ChannelsPage')),
  'apikeys':      lazy(() => import('./ApiKeyPage')),
  'permissions':  lazy(() => import('./PermissionPage')),
  'models-admin': lazy(() => import('./ModelPage')),
  'files':        lazy(() => import('./FileExplorerPage')),
  'mcp':          lazy(() => import('./MCPMarketPage')),
  'cost':         lazy(() => import('./CostPage')),
};

/** 设置导航 */
const NAV_ITEMS: NavItem[] = [
  { id: 'config',     label: '通用配置', icon: '⚙️' },
  { id: 'skill-market', label: '技能市场', icon: '🧩' },
  { id: 'skills',       label: '技能管理', icon: '⚡' },
  { id: 'oauth',        label: 'OAuth认证', icon: '🔑' },
  { id: 'media',        label: '媒体管理', icon: '📺' },
  { id: 'autoreply',    label: '自动回复', icon: '💬' },
  { id: 'sandbox',      label: '沙箱管理', icon: '🏖️' },
  { id: 'channels-page',label: '消息渠道', icon: '📨' },
  { id: 'apikeys',      label: 'Liri密钥', icon: '🗝️' },
  { id: 'permissions',  label: '权限管理', icon: '🔐' },
  { id: 'models-admin', label: '模型管理', icon: '🧠' },
  { id: 'files',        label: '文件管理', icon: '📁' },
  { id: 'mcp',          label: 'MCP市场',  icon: '🔌' },
  { id: 'cost',         label: '成本统计', icon: '💰' },
];

/** 数据目录 API 响应 */
interface DataDirectoryResponse { currentDirectory: string; configuredDirectory: string | null; defaultDirectory: string; }
interface SetDataDirectoryResponse { success: boolean; message: string; directory: string; migration?: { copied: number; skipped: number; errors: string[] }; }

/** 侧边栏选中项持久化 */
const ACTIVE_NAV_KEY = 'liri-settings-active-nav';
function getPersistedNav(fallback: string): string {
  try { const s = localStorage.getItem(ACTIVE_NAV_KEY); if (s && NAV_ITEMS.some((n) => n.id === s)) return s; } catch { /* ignore */ }
  return fallback;
}

/** 时区选项 */
const TIMEZONE_OPTIONS = [
  { value: 'Asia/Shanghai', label: 'UTC+8 上海/北京' }, { value: 'Asia/Tokyo', label: 'UTC+9 东京' },
  { value: 'Asia/Seoul', label: 'UTC+9 首尔' }, { value: 'Asia/Singapore', label: 'UTC+8 新加坡' },
  { value: 'Asia/Kolkata', label: 'UTC+5:30 印度' }, { value: 'Asia/Dubai', label: 'UTC+4 迪拜' },
  { value: 'Europe/London', label: 'UTC+0 伦敦' }, { value: 'Europe/Paris', label: 'UTC+1 巴黎' },
  { value: 'Europe/Berlin', label: 'UTC+1 柏林' }, { value: 'Europe/Moscow', label: 'UTC+3 莫斯科' },
  { value: 'America/New_York', label: 'UTC-5 纽约' }, { value: 'America/Chicago', label: 'UTC-6 芝加哥' },
  { value: 'America/Los_Angeles', label: 'UTC-8 洛杉矶' }, { value: 'America/Sao_Paulo', label: 'UTC-3 圣保罗' },
  { value: 'Australia/Sydney', label: 'UTC+10 悉尼' }, { value: 'Pacific/Auckland', label: 'UTC+12 奥克兰' },
  { value: 'UTC', label: 'UTC+0 协调世界时' },
];

function SettingsPage() {
  const { config, setConfig } = useConfigStore();
  const [activeNav, setActiveNav] = useState(() => getPersistedNav('config'));
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({ running: false, port: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendPort, setBackendPort] = useState('7890');
  const [portSaved, setPortSaved] = useState(false);
  const [dataDirectory, setDataDirectory] = useState('');
  const [configuredDirectory, setConfiguredDirectory] = useState<string | null>(null);
  const [defaultDirectory, setDefaultDirectory] = useState('');
  const [dataDirSaved, setDataDirSaved] = useState(false);
  const [dataDirError, setDataDirError] = useState<string | null>(null);
  const [migrateData, setMigrateData] = useState(true);
  const [migrationResult, setMigrationResult] = useState<{ copied: number; skipped: number; errors: string[] } | null>(null);
  const isDark = config.theme === 'dark';

  /** 导航切换 */
  const switchNav = (id: string) => { setActiveNav(id); try { localStorage.setItem(ACTIVE_NAV_KEY, id); } catch { /* ignore */ } };

  // ── 初始化 ──
  useEffect(() => { loadPersistedPort(); loadDataDirectory(); checkBackendStatus(); const iv = setInterval(checkBackendStatus, 5000); return () => clearInterval(iv); }, []);

  // ── 数据目录 ──
  const loadDataDirectory = async () => {
    try { const r = await http.get<DataDirectoryResponse>('/v1/settings/data-directory'); if (r) { setDataDirectory(r.currentDirectory || ''); setConfiguredDirectory(r.configuredDirectory || null); setDefaultDirectory(r.defaultDirectory || ''); } } catch { /* ignore */ }
  };
  const handleSaveDataDirectory = async () => {
    if (!dataDirectory.trim()) { setDataDirError('目录路径不能为空'); return; }
    setDataDirSaved(false); setDataDirError(null); setMigrationResult(null);
    try { const r = await http.put<SetDataDirectoryResponse>('/v1/settings/data-directory', { directory: dataDirectory, migrate: migrateData }); if (r?.success) { setConfiguredDirectory(dataDirectory); setDataDirSaved(true); if (r.migration) setMigrationResult(r.migration); setTimeout(() => { setDataDirSaved(false); setMigrationResult(null); }, 5000); } } catch (e: any) { setDataDirError(e.response?.data?.error?.message || '保存失败'); }
  };
  const handleResetDataDirectory = async () => { try { await http.put('/v1/settings/data-directory', { directory: defaultDirectory, migrate: migrateData }); setDataDirectory(defaultDirectory); setConfiguredDirectory(null); setDataDirSaved(true); setTimeout(() => setDataDirSaved(false), 3000); } catch { /* ignore */ } };

  // ── 端口 ──
  const loadPersistedPort = async () => { try { const a = await appConfigService.get(); setBackendPort(String(a.httpPort)); } catch { /* ignore */ } };
  const handleSavePort = async () => {
    const port = parseInt(backendPort, 10); if (isNaN(port) || port < 1024 || port > 65535) { setError('端口号必须在 1024-65535 之间'); return; }
    setPortSaved(false); setError(null);
    try { await appConfigService.set({ ...(await appConfigService.get()), httpPort: port }); setBackendUrlPort(port); if (typeof window !== 'undefined' && '__TAURI__' in window) { try { const c = await import('@tauri-apps/api/core'); if (c && typeof c.invoke === 'function') await c.invoke('set_backend_port', { port }); } catch { /* ignore */ } } setPortSaved(true); setTimeout(() => setPortSaved(false), 3000); } catch (e) { setError(String(e)); }
  };

  // ── 后端 ──
  const checkBackendStatus = async () => { try { const s = await chatService.getBackendStatus(); setBackendStatus(s); if (s.port) setBackendPort(String(s.port)); } catch { setBackendStatus({ running: false, port: null }); } };
  const handleStartBackend = async () => { setLoading(true); setError(null); try { await chatService.startBackend(); await checkBackendStatus(); } catch (e) { setError(String(e)); } finally { setLoading(false); } };
  const handleStopBackend = async () => { setLoading(true); setError(null); try { await chatService.stopBackend(); await checkBackendStatus(); } catch (e) { setError(String(e)); } finally { setLoading(false); } };

  const toggleTheme = () => setConfig('theme', isDark ? 'light' : 'dark');

  return (
    <div className="flex flex-1 min-w-0 h-full bg-gray-50 dark:bg-gray-900">
      {/* ── 左侧导航 ── */}
      <aside className="w-52 flex-shrink-0 overflow-y-auto border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-4 pt-5 pb-3"><h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">设置</h2></div>
        <nav className="pb-6">{renderSidebar()}</nav>
      </aside>

      {/* ── 右侧主内容区（横向填满）── */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-white dark:bg-gray-800">
        {renderContent()}
      </main>
    </div>
  );

  function renderSidebar() {
    return NAV_ITEMS.map((item) => {
      const isActive = activeNav === item.id;
      return (
        <button key={item.id} onClick={() => switchNav(item.id)}
          className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors text-left ${
            isActive
              ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium border-r-2 border-blue-500'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200'
          }`}>
          <span className="text-base flex-shrink-0">{item.icon}</span>
          <span className="truncate">{item.label}</span>
        </button>
      );
    });
  }

  function renderContent() {
    switch (activeNav) {
      case 'config': return <>
        {renderAppearance()}
        {renderBackendService()}
        {renderDataStorage()}
        <FeatureFlagsPanel isDark={isDark}
          features={((config.features as Record<string, unknown>) || { autoCompact: true, showTurnDuration: true, fileCheckpointing: true, terminalProgressBar: true, showStatusInTerminalTab: false, respectGitignore: true, copyFullResponse: false, todoEnabled: true, showExpandedTodos: false }) as unknown as Parameters<typeof FeatureFlagsPanel>[0]['features']}
          onUpdate={(u) => setConfig('features', { ...((config.features as object) || {}), ...u })} />
        <NotificationsPanel isDark={isDark}
          notifications={((config.notifications as Record<string, unknown>) || { preferredChannel: 'auto', idleThresholdMs: 60000, taskCompleteEnabled: true, inputNeededEnabled: true, agentPushEnabled: true }) as unknown as Parameters<typeof NotificationsPanel>[0]['notifications']}
          onUpdate={(u) => setConfig('notifications', { ...((config.notifications as object) || {}), ...u })} />
        <VoiceSettings isDark={isDark} />
        <LocalAgentPanel isDark={isDark}
          localAgent={((config.ai as Record<string, unknown>)?.localAgent || { enabled: false, routing: { strategy: 'cloud-first' as const, fallbackToCloud: true } }) as unknown as Parameters<typeof LocalAgentPanel>[0]['localAgent']}
          ollama={(((config.ai as Record<string, unknown>)?.localAgent as Record<string, unknown>)?.ollama || { enabled: false, baseUrl: 'http://localhost:11434', defaultModel: 'llama3', timeout: 120000 }) as unknown as Parameters<typeof LocalAgentPanel>[0]['ollama']}
          onUpdateLocalAgent={(u) => setConfig('ai', { ...((config.ai as object) || {}), localAgent: { ...(((config.ai as Record<string, unknown>)?.localAgent as object) || {}), ...u } })}
          onUpdateOllama={(u) => setConfig('ai', { ...((config.ai as object) || {}), localAgent: { ...(((config.ai as Record<string, unknown>)?.localAgent as object) || {}), ollama: { ...(((config.ai as Record<string, unknown>)?.localAgent as Record<string, unknown>)?.ollama as object || {}), ...u } } })} />
      </>;
      default: {
        const Page = PAGE_REGISTRY[activeNav];
        if (Page) return <Suspense fallback={<div className="flex items-center justify-center py-12 text-gray-400">加载中...</div>}><Page /></Suspense>;
        return null;
      }
    }
  }

  function renderAppearance() {
    const language = (config.language as string) || navigator.language || 'zh-CN';
    const timezone = (config.timezone as string) || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    return (
      <SectionCard title="外观">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div><div className="text-sm font-medium text-gray-700 dark:text-gray-300">主题模式</div><div className="text-xs text-gray-500 mt-0.5">当前: {isDark ? '深色' : '浅色'}</div></div>
            <ToggleBtn checked={isDark} onChange={toggleTheme}>{isDark ? '🌙' : '☀️'}</ToggleBtn>
          </div>
          <div className="h-px bg-gray-200 dark:bg-gray-700" />
          <FormField label="界面语言">
            <select value={language} onChange={(e) => setConfig('language', e.target.value)} className="w-full max-w-sm px-3 py-1.5 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100">
              <option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="ja-JP">日本語</option><option value="ko-KR">한국어</option><option value="fr-FR">Français</option><option value="de-DE">Deutsch</option><option value="es-ES">Español</option><option value="pt-BR">Português (BR)</option><option value="ru-RU">Русский</option><option value="ar-SA">العربية</option>
            </select>
          </FormField>
          <FormField label="时区">
            <select value={timezone} onChange={(e) => setConfig('timezone', e.target.value)} className="w-full max-w-sm px-3 py-1.5 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100">
              {TIMEZONE_OPTIONS.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
            </select>
          </FormField>
        </div>
      </SectionCard>
    );
  }

  function renderBackendService() {
    return (
      <SectionCard title="后端服务">
        <div className="space-y-3">
          <InfoRow label="状态" value={backendStatus.running ? `运行中 (端口 ${backendStatus.port})` : '已停止'} />
          <div className="flex items-center gap-2"><label className="text-sm text-gray-600 dark:text-gray-400">端口号</label><input type="number" value={backendPort} onChange={(e) => setBackendPort(e.target.value)} disabled={backendStatus.running} className="flex-1 max-w-[120px] px-2 py-1 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100" /><ActionBtn onClick={handleSavePort} disabled={backendStatus.running}>应用端口</ActionBtn>{portSaved && <span className="text-xs text-green-500">已保存</span>}</div>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">{error}</div>}
          <div className="flex gap-2">
            {backendStatus.running ? <ActionBtn onClick={handleStopBackend} variant="danger" disabled={loading}>{loading ? '处理中...' : '停止'}</ActionBtn> : <ActionBtn onClick={handleStartBackend} variant="primary" disabled={loading}>{loading ? '处理中...' : '启动'}</ActionBtn>}
            <ActionBtn onClick={checkBackendStatus} variant="secondary">刷新状态</ActionBtn>
          </div>
        </div>
      </SectionCard>
    );
  }

  function renderDataStorage() {
    return (
      <SectionCard title="数据存储">
        <div className="space-y-3">
          <input type="text" value={dataDirectory} onChange={(e) => setDataDirectory(e.target.value)} placeholder="请输入数据目录路径" className="w-full px-3 py-2 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
          {configuredDirectory && <p className="text-xs text-gray-500">当前已配置自定义目录</p>}
          {!configuredDirectory && defaultDirectory && <p className="text-xs text-gray-500">默认目录: {defaultDirectory}</p>}
          {dataDirError && <p className="text-xs text-red-500">{dataDirError}</p>}
          <div className="flex items-center gap-2"><input type="checkbox" id="migrateData" checked={migrateData} onChange={(e) => setMigrateData(e.target.checked)} className="w-4 h-4" /><label htmlFor="migrateData" className="text-sm text-gray-700 dark:text-gray-300">迁移现有数据</label></div>
          {migrationResult && <MigrationResult result={migrationResult} />}
          <div className="flex gap-2"><ActionBtn onClick={handleSaveDataDirectory} variant="primary">应用</ActionBtn>{configuredDirectory && <ActionBtn onClick={handleResetDataDirectory} variant="secondary">恢复默认</ActionBtn>}{dataDirSaved && !migrationResult && <span className="text-xs text-green-500 self-center">已保存</span>}</div>
        </div>
      </SectionCard>
    );
  }

}

/* ── 内部组件 ── */

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="px-6 py-5 border-b border-gray-100 dark:border-gray-700 last:border-b-0"><h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">{title}</h3>{children}</section>;
}
function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between"><span className="text-sm text-gray-600 dark:text-gray-400">{label}</span><span className="text-sm text-gray-900 dark:text-gray-100">{value}</span></div>;
}
function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>{children}</div>;
}
function ActionBtn({ onClick, variant = 'primary', disabled, children }: { onClick: () => void; variant?: 'primary' | 'danger' | 'secondary'; disabled?: boolean; children: React.ReactNode }) {
  const c = { primary: 'bg-blue-600 hover:bg-blue-700 text-white', danger: 'bg-red-600 hover:bg-red-700 text-white', secondary: 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300' };
  return <button onClick={onClick} disabled={disabled} className={`px-3 py-1.5 text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed ${c[variant]}`}>{children}</button>;
}
function ToggleBtn({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children?: React.ReactNode }) {
  return <button onClick={() => onChange(!checked)} className={`relative w-12 h-6 rounded-full transition-colors ${checked ? 'bg-blue-500' : 'bg-gray-300'}`}><span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform flex items-center justify-center text-xs ${checked ? 'translate-x-6' : 'translate-x-0'}`}>{children}</span></button>;
}
function MigrationResult({ result }: { result: { copied: number; skipped: number; errors: string[] } }) {
  return <div className={`p-3 rounded ${result.errors.length > 0 ? 'bg-yellow-50 dark:bg-yellow-900/20' : 'bg-green-50 dark:bg-green-900/20'}`}><p className="text-sm text-gray-700 dark:text-gray-300">迁移完成：<span className="font-medium">{result.copied}</span> 个已迁移，{result.skipped} 个已跳过</p>{result.errors.length > 0 && <div className="mt-2"><p className="text-xs text-red-500">迁移错误:</p>{result.errors.slice(0, 3).map((err, idx) => <p key={idx} className="text-xs text-red-500">{err}</p>)}</div>}</div>;
}

export default SettingsPage;
