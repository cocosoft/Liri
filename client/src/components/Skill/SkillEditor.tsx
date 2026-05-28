import { useState, useEffect } from 'react';
import type { Skill, SkillParameter, SkillCreateData } from '../../services/skillService';

interface SkillEditorProps {
  isDark: boolean;
  skill?: Skill | null;
  categories: string[];
  onSave: (data: SkillCreateData | Partial<Skill>) => void;
  onCancel: () => void;
}

const PARAMETER_TYPES: SkillParameter['type'][] = ['string', 'number', 'boolean', 'array', 'object'];

const PARAMETER_TYPE_LABELS: Record<SkillParameter['type'], string> = {
  string: '字符串',
  number: '数字',
  boolean: '布尔值',
  array: '数组',
  object: '对象',
};

function SkillEditor({ isDark, skill, categories, onSave, onCancel }: SkillEditorProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [parameters, setParameters] = useState<SkillParameter[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (skill) {
      setName(skill.name);
      setDescription(skill.description);
      setCategory(skill.category);
      setParameters(skill.parameters);
    } else {
      setName('');
      setDescription('');
      setCategory('');
      setParameters([]);
    }
  }, [skill]);

  const addParameter = () => {
    const newParam: SkillParameter = {
      name: '',
      type: 'string',
      required: false,
    };
    setParameters([...parameters, newParam]);
  };

  const updateParameter = (index: number, updates: Partial<SkillParameter>) => {
    const newParams = [...parameters];
    newParams[index] = { ...newParams[index], ...updates };
    setParameters(newParams);
  };

  const removeParameter = (index: number) => {
    setParameters(parameters.filter((_, i) => i !== index));
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) {
      newErrors.name = '请输入技能名称';
    }
    if (!category) {
      newErrors.category = '请选择分类';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;

    const data = skill
      ? {
          name,
          description,
          category,
          parameters,
        }
      : {
          name,
          description,
          category,
          parameters,
        };

    onSave(data as SkillCreateData);
  };

  return (
    <div className={`p-6 rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
      <h2 className={`text-xl font-bold mb-6 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
        {skill ? '编辑技能' : '创建技能'}
      </h2>

      <div className="space-y-4">
        <div>
          <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            技能名称 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入技能名称"
            className={`w-full px-3 py-2 rounded-lg text-sm border ${
              isDark
                ? 'bg-gray-700 border-gray-600 text-white'
                : 'bg-white border-gray-300 text-gray-900'
            } ${errors.name ? 'border-red-500' : ''} focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
          {errors.name && (
            <p className="text-sm text-red-500 mt-1">{errors.name}</p>
          )}
        </div>

        <div>
          <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            描述
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="输入技能描述"
            rows={3}
            className={`w-full px-3 py-2 rounded-lg text-sm border resize-none ${
              isDark
                ? 'bg-gray-700 border-gray-600 text-white'
                : 'bg-white border-gray-300 text-gray-900'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
        </div>

        <div>
          <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            分类 <span className="text-red-500">*</span>
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={`w-full px-3 py-2 rounded-lg text-sm border ${
              isDark
                ? 'bg-gray-700 border-gray-600 text-white'
                : 'bg-white border-gray-300 text-gray-900'
            } ${errors.category ? 'border-red-500' : ''} focus:outline-none focus:ring-2 focus:ring-blue-500`}
          >
            <option value="">选择分类</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          {errors.category && (
            <p className="text-sm text-red-500 mt-1">{errors.category}</p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              参数列表
            </label>
            <button
              onClick={addParameter}
              className={`px-3 py-1 rounded-lg text-sm font-medium ${
                isDark ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              + 添加参数
            </button>
          </div>

          {parameters.length === 0 ? (
            <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              暂无参数，点击上方按钮添加
            </p>
          ) : (
            <div className="space-y-3">
              {parameters.map((param, index) => (
                <div
                  key={index}
                  className={`p-3 rounded-lg border ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-200'}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      参数 {index + 1}
                    </span>
                    <button
                      onClick={() => removeParameter(index)}
                      className={`p-1 rounded ${isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <input
                      type="text"
                      value={param.name}
                      onChange={(e) => updateParameter(index, { name: e.target.value })}
                      placeholder="参数名称"
                      className={`px-2 py-1.5 rounded-lg text-sm border ${
                        isDark
                          ? 'bg-gray-800 border-gray-600 text-white'
                          : 'bg-white border-gray-300 text-gray-900'
                      } focus:outline-none focus:ring-1 focus:ring-blue-500`}
                    />
                    <select
                      value={param.type}
                      onChange={(e) => updateParameter(index, { type: e.target.value as SkillParameter['type'] })}
                      className={`px-2 py-1.5 rounded-lg text-sm border ${
                        isDark
                          ? 'bg-gray-800 border-gray-600 text-white'
                          : 'bg-white border-gray-300 text-gray-900'
                      } focus:outline-none focus:ring-1 focus:ring-blue-500`}
                    >
                      {PARAMETER_TYPES.map((type) => (
                        <option key={type} value={type}>{PARAMETER_TYPE_LABELS[type]}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={param.required}
                        onChange={(e) => updateParameter(index, { required: e.target.checked })}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>必填</span>
                    </div>
                  </div>

                  <input
                    type="text"
                    value={param.description || ''}
                    onChange={(e) => updateParameter(index, { description: e.target.value })}
                    placeholder="参数描述（可选）"
                    className={`w-full mt-2 px-2 py-1.5 rounded-lg text-sm border ${
                      isDark
                        ? 'bg-gray-800 border-gray-600 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
                    } focus:outline-none focus:ring-1 focus:ring-blue-500`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 mt-6">
        <button
          onClick={onCancel}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${
            isDark ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${
            isDark ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {skill ? '保存修改' : '创建技能'}
        </button>
      </div>
    </div>
  );
}

export default SkillEditor;