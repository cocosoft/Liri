import { useState, useEffect, useCallback } from 'react';
import { useConfigStore } from '../../stores/configStore';
import {
  skillMarketService,
  SkillSearchResult,
  InstalledSkill,
  ClawHubSkillMeta,
} from '../../services/skillMarketService';
import { SkillDetailModal } from './SkillDetailModal';

const CATEGORIES = [
  { value: '', label: '全部' },
  { value: 'productivity', label: '生产力' },
  { value: 'search', label: '搜索与研究' },
  { value: 'developer', label: '开发者工具' },
  { value: 'agents', label: 'Agent 联动' },
  { value: 'automation', label: '任务编排' },
  { value: 'creative', label: '创意可视化' },
  { value: 'communication', label: '通讯社交' },
  { value: 'security', label: '安全' },
  { value: 'mlops', label: 'ML/MLOps' },
  { value: 'fun', label: '娱乐' },
  { value: 'domain', label: '专业领域' },
];

function SkillMarketPage() {
  const { config } = useConfigStore();
  const isDark = config.theme === 'dark';

  const [searchResults, setSearchResults] = useState<SkillSearchResult[]>([]);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<ClawHubSkillMeta | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const loadInstalledSkills = useCallback(async () => {
    try {
      const skills = await skillMarketService.getInstalledSkills();
      setInstalledSkills(skills);
    } catch {
      // 静默失败，保留上次数据
    }
  }, []);

  useEffect(() => {
    loadInstalledSkills();
  }, [loadInstalledSkills]);

  useEffect(() => {
    if (!searchQuery) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await skillMarketService.search(
          searchQuery,
          categoryFilter || undefined
        );
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, categoryFilter]);

  const isInstalled = (skillId: string): boolean => {
    return installedSkills.some((s) => s.meta.id === skillId);
  };

  const isEnabled = (skillId: string): boolean => {
    const skill = installedSkills.find((s) => s.meta.id === skillId);
    return skill ? skill.enabled : false;
  };

  const handleInstall = async (skillId: string) => {
    setInstalling(skillId);
    try {
      await skillMarketService.install(skillId);
      await loadInstalledSkills();
    } catch (error) {
      console.error('安装技能失败:', error);
    } finally {
      setInstalling(null);
    }
  };

  const handleUninstall = async (skillId: string) => {
    if (!window.confirm('确定要卸载这个技能吗？')) {
      return;
    }

    setInstalling(skillId);
    try {
      await skillMarketService.uninstall(skillId);
      await loadInstalledSkills();
    } catch (error) {
      console.error('卸载技能失败:', error);
    } finally {
      setInstalling(null);
    }
  };

  const handleToggle = async (skillId: string, enabled: boolean) => {
    try {
      await skillMarketService.toggleEnabled(skillId, enabled);
      await loadInstalledSkills();
    } catch (error) {
      console.error('切换技能状态失败:', error);
    }
  };

  const handleShowDetail = (skill: ClawHubSkillMeta) => {
    setSelectedSkill(skill);
    setShowDetail(true);
  };

  const handleCloseDetail = () => {
    setShowDetail(false);
    setSelectedSkill(null);
  };

  const getStatusBadge = (skillId: string) => {
    if (!isInstalled(skillId)) {
      return null;
    }

    const enabled = isEnabled(skillId);

    return (
      <span
        className={`px-2 py-0.5 text-xs rounded-full ${
          enabled
            ? isDark
              ? 'bg-green-900/30 text-green-400'
              : 'bg-green-100 text-green-700'
            : isDark
              ? 'bg-gray-700 text-gray-400'
              : 'bg-gray-100 text-gray-600'
        }`}
      >
        {enabled ? '已启用' : '已禁用'}
      </span>
    );
  };

  return (
    <div className={`flex-1 overflow-y-auto ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
              技能市场
            </h1>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              浏览和安装 ClawHub 生态技能
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div
            className={`flex-1 relative ${isDark ? 'bg-gray-800' : 'bg-white'} rounded-lg border ${isDark ? 'border-gray-700' : 'border-gray-300'}`}
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索技能..."
              className={`w-full px-4 py-2 text-sm outline-none ${isDark ? 'bg-transparent text-white placeholder-gray-400' : 'bg-white text-gray-900 placeholder-gray-500'}`}
            />
            <svg
              className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

          <div className="flex gap-2 flex-wrap">
            {CATEGORIES.map((category) => (
              <button
                key={category.value}
                onClick={() => setCategoryFilter(category.value)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  categoryFilter === category.value
                    ? 'bg-blue-600 text-white'
                    : isDark
                      ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                {category.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
        >
          {loading ? (
            <div className="p-8 text-center text-gray-400">搜索中...</div>
          ) : !searchQuery ? (
            <div className="p-8 text-center">
              <div className="text-4xl mb-3">🔍</div>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                输入关键词搜索 ClawHub 技能市场
              </p>
              <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                已安装 {installedSkills.length} 个技能
              </p>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              未找到匹配的技能
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {searchResults.map((result) => (
                <div
                  key={result.skill.id}
                  className="px-4 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                  onClick={() => handleShowDetail(result.skill)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center ${isDark ? 'bg-gray-700' : 'bg-gray-100'}`}
                      >
                        <svg
                          className="w-5 h-5 text-gray-500"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                          />
                        </svg>
                      </div>
                      <div>
                        <h4
                          className={`font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}
                        >
                          {result.skill.name}
                        </h4>
                        <p
                          className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
                        >
                          {result.skill.description}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 ml-13 flex items-center gap-4">
                      <span
                        className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
                      >
                        v{result.skill.version}
                      </span>
                      <span
                        className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
                      >
                        作者: {result.skill.author}
                      </span>
                      {result.skill.category && (
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}
                        >
                          {result.skill.category}
                        </span>
                      )}
                      <span
                        className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
                      >
                        来源: {result.source}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-4" onClick={(e) => e.stopPropagation()}>
                    {getStatusBadge(result.skill.id)}
                    {isInstalled(result.skill.id) ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            handleToggle(
                              result.skill.id,
                              !isEnabled(result.skill.id)
                            )
                          }
                          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                            isEnabled(result.skill.id)
                              ? 'bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300'
                              : 'bg-blue-600 hover:bg-blue-700 text-white'
                          }`}
                        >
                          {isEnabled(result.skill.id) ? '禁用' : '启用'}
                        </button>
                        <button
                          onClick={() => handleUninstall(result.skill.id)}
                          className="px-3 py-1.5 text-sm rounded-lg bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 transition-colors"
                        >
                          卸载
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleInstall(result.skill.id)}
                        disabled={installing === result.skill.id}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                          installing === result.skill.id
                            ? 'bg-blue-400 text-white cursor-not-allowed'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }`}
                      >
                        {installing === result.skill.id ? '安装中...' : '安装'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showDetail && selectedSkill && (
        <SkillDetailModal
          skill={selectedSkill}
          isInstalled={isInstalled(selectedSkill.id)}
          isEnabled={isEnabled(selectedSkill.id)}
          installing={installing === selectedSkill.id}
          onClose={handleCloseDetail}
          onInstall={() => handleInstall(selectedSkill.id)}
          onUninstall={() => handleUninstall(selectedSkill.id)}
          onToggle={(enabled) => handleToggle(selectedSkill.id, enabled)}
        />
      )}
    </div>
  );
}

export default SkillMarketPage;
