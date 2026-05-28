import { useNavigate } from 'react-router-dom';
import { useBackendStore } from '../../stores/backendStore';

interface NavCardProps {
  icon: string;
  title: string;
  description: string;
  path: string;
}

function NavCard({ icon, title, description, path }: NavCardProps) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(path)}
      className="group bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 hover:shadow-lg transition-all hover:-translate-y-1 text-left"
    >
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
        {title}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {description}
      </p>
    </button>
  );
}

function HomePage() {
  const { status } = useBackendStore();
  const navigate = useNavigate();

  const getStatusColor = () => {
    if (status.running) return 'text-green-600 dark:text-green-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getStatusIcon = () => {
    if (status.running) return '🟢';
    return '🔴';
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 bg-gray-100 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto">
        {/* 欢迎区域 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            欢迎使用 PY_APP
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            快速访问常用功能，开始您的工作流程
          </p>
        </div>

        {/* 状态卡片 */}
        <div className="mb-8 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{getStatusIcon()}</span>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Backend 服务
                </h3>
                <p className={`text-sm ${getStatusColor()}`}>
                  {status.running ? '运行中' : '已停止'}
                  {status.running && status.port && ` · 端口 ${status.port}`}
                </p>
              </div>
            </div>
            <button
              onClick={() => navigate('/settings')}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm transition-colors"
            >
              管理 Backend
            </button>
          </div>
        </div>

        {/* 常用功能网格 */}
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">
          常用功能
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <NavCard
            icon="💬"
            title="聊天"
            description="与 AI 助手对话，处理各种任务"
            path="/chat"
          />
          <NavCard
            icon="📚"
            title="知识库"
            description="管理文档，进行知识检索"
            path="/knowledge"
          />
          <NavCard
            icon="💰"
            title="成本"
            description="查看 API 调用消费记录"
            path="/cost"
          />
          <NavCard
            icon="📊"
            title="仪表盘"
            description="系统概览和统计数据"
            path="/dashboard"
          />
          <NavCard
            icon="🎯"
            title="任务"
            description="管理和执行定时任务"
            path="/cron"
          />
          <NavCard
            icon="📁"
            title="文件"
            description="管理和操作文件系统"
            path="/files"
          />
          <NavCard
            icon="💻"
            title="终端"
            description="访问命令行终端"
            path="/terminal"
          />
          <NavCard
            icon="📈"
            title="监控"
            description="实时监控系统状态"
            path="/monitor"
          />
          <NavCard
            icon="⚙️"
            title="设置"
            description="系统配置和管理功能"
            path="/settings"
          />
        </div>

        {/* 快捷提示 */}
        <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-6 border border-blue-200 dark:border-blue-800">
          <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">
            💡 提示
          </h3>
          <p className="text-sm text-blue-700 dark:text-blue-400">
            点击右下角的 ⚙️ 按钮可以快速切换主题和管理 Backend 服务
          </p>
        </div>
      </div>
    </div>
  );
}

export default HomePage;
