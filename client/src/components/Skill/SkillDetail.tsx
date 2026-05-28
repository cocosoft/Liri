import type { Skill } from '../../services/skillService';

interface SkillDetailProps {
  skill: Skill;
  isDark: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
}

const STATUS_LABELS: Record<Skill['status'], string> = {
  enabled: '已启用',
  disabled: '已禁用',
  draft: '草稿',
};

const STATUS_COLORS: Record<Skill['status'], string> = {
  enabled: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  disabled: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
};

function SkillDetail({ skill, isDark, onEdit, onDelete, onToggleStatus }: SkillDetailProps) {
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const PARAMETER_TYPE_LABELS: Record<Skill['parameters'][0]['type'], string> = {
    string: '字符串',
    number: '数字',
    boolean: '布尔值',
    array: '数组',
    object: '对象',
  };

  return (
    <div className={`p-6 rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h2 className={`text-xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
              {skill.name}
            </h2>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[skill.status]}`}>
              {STATUS_LABELS[skill.status]}
            </span>
          </div>
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {skill.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleStatus}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              skill.status === 'enabled'
                ? isDark
                  ? 'bg-yellow-900/30 text-yellow-400 hover:bg-yellow-800/30'
                  : 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100'
                : isDark
                ? 'bg-green-900/30 text-green-400 hover:bg-green-800/30'
                : 'bg-green-50 text-green-600 hover:bg-green-100'
            }`}
          >
            {skill.status === 'enabled' ? '禁用' : '启用'}
          </button>
          <button
            onClick={onEdit}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              isDark ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            编辑
          </button>
          <button
            onClick={onDelete}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              isDark ? 'bg-red-900/30 text-red-400 hover:bg-red-800/30' : 'bg-red-50 text-red-600 hover:bg-red-100'
            }`}
          >
            删除
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className={`p-4 rounded-lg ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
          <h3 className={`text-sm font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            基本信息
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>分类</span>
              <span className={isDark ? 'text-gray-200' : 'text-gray-800'}>{skill.category}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>创建时间</span>
              <span className={isDark ? 'text-gray-200' : 'text-gray-800'}>
                {formatDate(skill.createdAt)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>更新时间</span>
              <span className={isDark ? 'text-gray-200' : 'text-gray-800'}>
                {formatDate(skill.updatedAt)}
              </span>
            </div>
          </div>
        </div>

        <div className={`p-4 rounded-lg ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
          <h3 className={`text-sm font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            使用统计
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>使用次数</span>
              <span className={isDark ? 'text-gray-200' : 'text-gray-800'}>{skill.usageCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>最后使用</span>
              <span className={isDark ? 'text-gray-200' : 'text-gray-800'}>
                {skill.lastUsedAt ? formatDate(skill.lastUsedAt) : '从未使用'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {skill.parameters.length > 0 && (
        <div className={`mt-6 p-4 rounded-lg ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
          <h3 className={`text-sm font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            参数列表 ({skill.parameters.length})
          </h3>
          <div className="space-y-2">
            {skill.parameters.map((param) => (
              <div
                key={param.name}
                className={`p-3 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-white'} border ${isDark ? 'border-gray-700' : 'border-gray-200'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                    {param.name}
                  </span>
                  {param.required && (
                    <span className={`px-1.5 py-0.5 rounded text-xs ${isDark ? 'bg-red-900/30 text-red-400' : 'bg-red-100 text-red-600'}`}>
                      必填
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className={`px-2 py-0.5 rounded text-xs ${isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-600'}`}>
                    {PARAMETER_TYPE_LABELS[param.type]}
                  </span>
                  {param.default !== undefined && (
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                      默认: {JSON.stringify(param.default)}
                    </span>
                  )}
                </div>
                {param.description && (
                  <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {param.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default SkillDetail;