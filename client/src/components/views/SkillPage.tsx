import { useEffect, useState } from 'react';
import { useConfigStore } from '../../stores/configStore';
import { useSkillStore } from '../../stores/skillStore';
import type { Skill, SkillCreateData, SkillStatus } from '../../services/skillService';
import SkillList from '../Skill/SkillList';
import SkillDetail from '../Skill/SkillDetail';
import SkillEditor from '../Skill/SkillEditor';

function SkillPage() {
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === 'dark';

  const {
    skills,
    total,
    selectedSkill,
    categories,
    error,
    loadSkills,
    loadCategories,
    createSkill,
    updateSkill,
    deleteSkill,
    enableSkill,
    disableSkill,
    setSelectedSkill,
  } = useSkillStore();

  const [sortBy, setSortBy] = useState<'createdAt' | 'updatedAt' | 'usageCount'>('updatedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<SkillStatus | 'all'>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

  useEffect(() => {
    loadSkills({ sortBy, sortOrder, category: categoryFilter || undefined, status: statusFilter === 'all' ? undefined : statusFilter });
    loadCategories();
  }, [loadSkills, loadCategories, sortBy, sortOrder, categoryFilter, statusFilter]);

  const handleSelectSkill = (skill: Skill) => {
    setSelectedSkill(skill);
    setShowEditor(false);
    setEditingSkill(null);
  };

  const handleCreate = () => {
    setEditingSkill(null);
    setShowEditor(true);
    setSelectedSkill(null);
  };

  const handleEdit = () => {
    if (selectedSkill) {
      setEditingSkill(selectedSkill);
      setShowEditor(true);
    }
  };

  const handleSave = async (data: SkillCreateData | Partial<Skill>) => {
    if (editingSkill) {
      await updateSkill(editingSkill.id, data);
    } else {
      await createSkill(data as SkillCreateData);
    }
    setShowEditor(false);
    setEditingSkill(null);
    loadSkills({ sortBy, sortOrder });
  };

  const handleDelete = async () => {
    if (selectedSkill && confirm('确定要删除这个技能吗？')) {
      await deleteSkill(selectedSkill.id);
      setSelectedSkill(null);
      loadSkills({ sortBy, sortOrder });
    }
  };

  const handleToggleStatus = async () => {
    if (selectedSkill) {
      if (selectedSkill.status === 'enabled') {
        await disableSkill(selectedSkill.id);
      } else {
        await enableSkill(selectedSkill.id);
      }
      loadSkills({ sortBy, sortOrder });
      setSelectedSkill(null);
    }
  };

  const STATUS_OPTIONS: { value: SkillStatus | 'all'; label: string }[] = [
    { value: 'all', label: '全部状态' },
    { value: 'enabled', label: '已启用' },
    { value: 'disabled', label: '已禁用' },
    { value: 'draft', label: '草稿' },
  ];

  return (
    <div className={`flex-1 overflow-hidden flex flex-col ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-7xl mx-auto w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
              技能管理
            </h1>
            <p className={`mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              管理和配置系统技能，共 {total} 个
            </p>
          </div>
          <button
            onClick={handleCreate}
            className={`px-4 py-2 rounded-lg font-medium text-white transition-colors ${
              isDark ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            + 创建技能
          </button>
        </div>

        {error && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${isDark ? 'bg-red-900/30 text-red-400 border border-red-800' : 'bg-red-50 text-red-600 border border-red-200'}`}>
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className={`px-3 py-2 rounded-lg text-sm border ${
              isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-700'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          >
            <option value="">全部分类</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as SkillStatus | 'all')}
            className={`px-3 py-2 rounded-lg text-sm border ${
              isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-700'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'createdAt' | 'updatedAt' | 'usageCount')}
            className={`px-3 py-2 rounded-lg text-sm border ${
              isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-700'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          >
            <option value="updatedAt">按更新时间</option>
            <option value="createdAt">按创建时间</option>
            <option value="usageCount">按使用次数</option>
          </select>

          <button
            onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
            className={`px-3 py-2 rounded-lg text-sm border ${
              isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-700'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          >
            {sortOrder === 'desc' ? '↓' : '↑'}
          </button>
        </div>

        {showEditor ? (
          <SkillEditor
            isDark={isDark}
            skill={editingSkill}
            categories={categories}
            onSave={handleSave}
            onCancel={() => {
              setShowEditor(false);
              setEditingSkill(null);
              if (selectedSkill) {
                setSelectedSkill(selectedSkill);
              }
            }}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <SkillList
                skills={skills}
                isDark={isDark}
                onSelect={handleSelectSkill}
                selectedId={selectedSkill?.id}
              />
            </div>

            <div>
              {selectedSkill ? (
                <SkillDetail
                  skill={selectedSkill}
                  isDark={isDark}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onToggleStatus={handleToggleStatus}
                />
              ) : (
                <div className={`h-full flex items-center justify-center rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                  <div className={`text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    <svg className="w-16 h-16 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <p>选择一个技能查看详情</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SkillPage;