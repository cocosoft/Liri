import type { Skill, SkillStatus } from '../../services/skillService';

interface SkillListProps {
  skills: Skill[];
  isDark: boolean;
  onSelect: (skill: Skill) => void;
  selectedId?: string | null;
}

const STATUS_LABELS: Record<SkillStatus, string> = {
  enabled: '启用',
  disabled: '禁用',
  draft: '草稿',
};

const STATUS_COLORS: Record<SkillStatus, string> = {
  enabled: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  disabled: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
};

function SkillList({ skills, isDark, onSelect, selectedId }: SkillListProps) {
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (skills.length === 0) {
    return (
      <div className={`text-center py-12 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <p>暂无技能</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {skills.map((skill) => (
        <div
          key={skill.id}
          onClick={() => onSelect(skill)}
          className={`p-4 rounded-lg border cursor-pointer transition-colors ${
            selectedId === skill.id
              ? isDark
                ? 'bg-blue-900/30 border-blue-500'
                : 'bg-blue-50 border-blue-500'
              : isDark
              ? 'bg-gray-800 border-gray-700 hover:bg-gray-700'
              : 'bg-white border-gray-200 hover:bg-gray-50'
          }`}
        >
          <div className="flex items-start justify-between mb-2">
            <h3 className={`font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
              {skill.name}
            </h3>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[skill.status]}`}>
              {STATUS_LABELS[skill.status]}
            </span>
          </div>
          <p className={`text-sm line-clamp-2 mb-2 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            {skill.description}
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-xs ${
                isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-600'
              }`}>
                {skill.category}
              </span>
              <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {skill.parameters.length} 个参数
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                使用 {skill.usageCount} 次
              </span>
              <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {formatDate(skill.updatedAt)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default SkillList;