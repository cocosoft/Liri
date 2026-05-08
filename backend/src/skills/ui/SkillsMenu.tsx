//
/**
 * 技能菜单组件（基于CC源码实现）
 * 支持按来源分组显示技能、技能搜索、技能详情展示
 */

import React, { useState, useEffect } from 'react';
import type { SkillDefinition, SkillSource } from '../utils/skillParser';
import type { SkillLoader } from '../utils/skillLoader';
import type { SkillTool } from '../tools/SkillTool';

/**
 * 技能菜单属性（基于CC源码）
 */
interface SkillsMenuProps {
  /**
   * 技能加载器实例
   */
  skillLoader: SkillLoader;
  
  /**
   * 技能工具实例
   */
  skillTool: SkillTool;
  
  /**
   * 是否显示
   */
  visible: boolean;
  
  /**
   * 关闭回调
   */
  onClose: () => void;
  
  /**
   * 技能选择回调
   */
  onSkillSelect: (skill: SkillDefinition) => void;
  
  /**
   * 当前工作目录
   */
  currentDirectory: string;
  
  /**
   * 允许的工具列表
   */
  allowedTools: string[];
}

/**
 * 技能分组（基于CC源码）
 */
interface SkillGroup {
  /**
   * 来源类型
   */
  source: SkillSource;
  
  /**
   * 显示名称
   */
  displayName: string;
  
  /**
   * 技能列表
   */
  skills: SkillDefinition[];
  
  /**
   * 是否展开
   */
  expanded: boolean;
}

/**
 * 技能菜单状态（基于CC源码）
 */
interface SkillsMenuState {
  /**
   * 技能分组
   */
  groups: SkillGroup[];
  
  /**
   * 搜索关键词
   */
  searchQuery: string;
  
  /**
   * 加载状态
   */
  loading: boolean;
  
  /**
   * 错误信息
   */
  error?: string;
  
  /**
   * 选中的技能
   */
  selectedSkill?: SkillDefinition;
  
  /**
   * 技能详情是否显示
   */
  showDetails: boolean;
}

/**
 * 技能菜单组件（基于CC源码实现）
 */
export const SkillsMenu: React.FC<SkillsMenuProps> = ({
  skillLoader,
  skillTool,
  visible,
  onClose,
  onSkillSelect,
  currentDirectory,
  allowedTools,
}) => {
  const [state, setState] = useState<SkillsMenuState>({
    groups: [],
    searchQuery: '',
    loading: false,
    showDetails: false,
  });

  /**
   * 加载技能（基于CC源码）
   */
  useEffect(() => {
    if (visible) {
      loadSkills();
    }
  }, [visible]);

  const loadSkills = async () => {
    setState(prev => ({ ...prev, loading: true, error: undefined }));
    
    try {
      const result = await skillLoader.loadAllSkills();
      
      if (result.errors.length > 0) {
        console.warn('Skill loading warnings:', result.errors);
      }
      
      // 分组技能（基于CC源码）
      const groups = createSkillGroups(result.skills);
      
      setState(prev => ({
        ...prev,
        groups,
        loading: false,
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  /**
   * 创建技能分组（基于CC源码）
   */
  const createSkillGroups = (skills: SkillDefinition[]): SkillGroup[] => {
    const sourceGroups: Record<SkillSource, SkillDefinition[]> = {
      [SkillSource.USER]: [],
      [SkillSource.PROJECT]: [],
      [SkillSource.BUILTIN]: [],
      [SkillSource.BUNDLED]: [],
      [SkillSource.PLUGIN]: [],
      [SkillSource.MCP]: [],
    };
    
    // 按来源分组
    skills.forEach(skill => {
      sourceGroups[skill.source].push(skill);
    });
    
    // 转换为UI分组
    return Object.entries(sourceGroups)
      .filter(([_, skills]) => skills.length > 0)
      .map(([source, skills]) => ({
        source: source as SkillSource,
        displayName: getSourceDisplayName(source as SkillSource),
        skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
        expanded: true,
      }))
      .sort((a, b) => getSourcePriority(b.source) - getSourcePriority(a.source));
  };

  /**
   * 获取来源显示名称（基于CC源码）
   */
  const getSourceDisplayName = (source: SkillSource): string => {
    const names = {
      [SkillSource.USER]: '用户技能',
      [SkillSource.PROJECT]: '项目技能',
      [SkillSource.BUILTIN]: '内置技能',
      [SkillSource.BUNDLED]: '捆绑技能',
      [SkillSource.PLUGIN]: '插件技能',
      [SkillSource.MCP]: 'MCP技能',
    };
    
    return names[source];
  };

  /**
   * 获取来源优先级（基于CC源码）
   */
  const getSourcePriority = (source: SkillSource): number => {
    const priorities = {
      [SkillSource.USER]: 100,
      [SkillSource.PROJECT]: 90,
      [SkillSource.PLUGIN]: 80,
      [SkillSource.BUILTIN]: 70,
      [SkillSource.BUNDLED]: 60,
      [SkillSource.MCP]: 50,
    };
    
    return priorities[source] || 0;
  };

  /**
   * 切换分组展开状态（基于CC源码）
   */
  const toggleGroup = (source: SkillSource) => {
    setState(prev => ({
      ...prev,
      groups: prev.groups.map(group =>
        group.source === source
          ? { ...group, expanded: !group.expanded }
          : group
      ),
    }));
  };

  /**
   * 处理搜索（基于CC源码）
   */
  const handleSearch = (query: string) => {
    setState(prev => ({ ...prev, searchQuery: query }));
  };

  /**
   * 过滤技能（基于CC源码）
   */
  const getFilteredSkills = (): SkillGroup[] => {
    const { groups, searchQuery } = state;
    
    if (!searchQuery.trim()) {
      return groups;
    }
    
    const query = searchQuery.toLowerCase();
    
    return groups
      .map(group => ({
        ...group,
        skills: group.skills.filter(skill =>
          skill.name.toLowerCase().includes(query) ||
          skill.description.toLowerCase().includes(query) ||
          (skill.frontmatter['when-to-use']?.toLowerCase().includes(query) ?? false)
        ),
      }))
      .filter(group => group.skills.length > 0);
  };

  /**
   * 选择技能（基于CC源码）
   */
  const handleSkillSelect = (skill: SkillDefinition) => {
    setState(prev => ({ ...prev, selectedSkill: skill, showDetails: true }));
  };

  /**
   * 执行技能（基于CC源码）
   */
  const handleExecuteSkill = async (skill: SkillDefinition) => {
    try {
      onSkillSelect(skill);
      onClose();
    } catch (error) {
      console.error('Failed to execute skill:', error);
    }
  };

  /**
   * 渲染技能分组（基于CC源码）
   */
  const renderSkillGroup = (group: SkillGroup) => (
    <div key={group.source} className="skill-group">
      <div 
        className="group-header"
        onClick={() => toggleGroup(group.source)}
      >
        <span className="group-name">{group.displayName}</span>
        <span className="group-count">({group.skills.length})</span>
        <span className="group-toggle">
          {group.expanded ? '▼' : '▶'}
        </span>
      </div>
      
      {group.expanded && (
        <div className="group-skills">
          {group.skills.map(skill => (
            <div
              key={skill.name}
              className="skill-item"
              onClick={() => handleSkillSelect(skill)}
            >
              <div className="skill-name">{skill.name}</div>
              <div className="skill-description">{skill.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  /**
   * 渲染技能详情（基于CC源码）
   */
  const renderSkillDetails = () => {
    const { selectedSkill } = state;
    
    if (!selectedSkill) {
      return null;
    }
    
    return (
      <div className="skill-details">
        <div className="details-header">
          <h3>{selectedSkill.name}</h3>
          <button 
            className="close-details"
            onClick={() => setState(prev => ({ ...prev, showDetails: false }))}
          >
            ×
          </button>
        </div>
        
        <div className="details-content">
          <p><strong>描述:</strong> {selectedSkill.description}</p>
          
          {selectedSkill.frontmatter['when-to-use'] && (
            <p><strong>使用时机:</strong> {selectedSkill.frontmatter['when-to-use']}</p>
          )}
          
          {selectedSkill.frontmatter.arguments && (
            <div>
              <strong>参数:</strong>
              <ul>
                {(Array.isArray(selectedSkill.frontmatter.arguments)
                  ? selectedSkill.frontmatter.arguments
                  : [selectedSkill.frontmatter.arguments]
                ).map((arg, index) => (
                  <li key={index}>{arg}</li>
                ))}
              </ul>
            </div>
          )}
          
          {selectedSkill.frontmatter['allowed-tools'] && (
            <p>
              <strong>允许的工具:</strong>{' '}
              {selectedSkill.frontmatter['allowed-tools'].join(', ')}
            </p>
          )}
          
          <div className="details-actions">
            <button
              className="execute-button"
              onClick={() => handleExecuteSkill(selectedSkill)}
            >
              执行技能
            </button>
          </div>
        </div>
      </div>
    );
  };

  /**
   * 渲染空状态（基于CC源码）
   */
  const renderEmptyState = () => (
    <div className="empty-state">
      <h3>暂无可用技能</h3>
      <p>请检查技能目录配置或安装相关技能。</p>
      <button onClick={loadSkills}>重新加载</button>
    </div>
  );

  if (!visible) {
    return null;
  }

  const filteredGroups = getFilteredSkills();

  return (
    <div className="skills-menu-overlay">
      <div className="skills-menu">
        <div className="menu-header">
          <h2>技能菜单</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="menu-search">
          <input
            type="text"
            placeholder="搜索技能..."
            value={state.searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
        
        <div className="menu-content">
          {state.loading ? (
            <div className="loading-state">加载中...</div>
          ) : state.error ? (
            <div className="error-state">
              <h3>加载失败</h3>
              <p>{state.error}</p>
              <button onClick={loadSkills}>重试</button>
            </div>
          ) : state.showDetails ? (
            renderSkillDetails()
          ) : filteredGroups.length === 0 ? (
            renderEmptyState()
          ) : (
            <div className="skills-list">
              {filteredGroups.map(renderSkillGroup)}
            </div>
          )}
        </div>
        
        <div className="menu-footer">
          <span className="footer-info">
            共 {filteredGroups.reduce((sum, group) => sum + group.skills.length, 0)} 个技能
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * 技能菜单样式（基于CC源码）
 */
const styles = `
.skills-menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.skills-menu {
  background: white;
  border-radius: 8px;
  width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.menu-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #e0e0e0;
}

.menu-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.close-button {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  padding: 4px 8px;
}

.menu-search {
  padding: 16px 20px;
  border-bottom: 1px solid #e0e0e0;
}

.menu-search input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.menu-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 20px;
}

.loading-state, .error-state, .empty-state {
  padding: 40px 20px;
  text-align: center;
  color: #666;
}

.error-state {
  color: #d32f2f;
}

.skill-group {
  margin: 16px 0;
}

.group-header {
  display: flex;
  align-items: center;
  padding: 8px 0;
  cursor: pointer;
  user-select: none;
}

.group-name {
  font-weight: 600;
  margin-right: 8px;
}

.group-count {
  color: #666;
  font-size: 12px;
  margin-right: auto;
}

.group-toggle {
  color: #666;
}

.group-skills {
  margin-left: 16px;
}

.skill-item {
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  margin: 4px 0;
}

.skill-item:hover {
  background: #f5f5f5;
}

.skill-name {
  font-weight: 500;
  margin-bottom: 2px;
}

.skill-description {
  font-size: 12px;
  color: #666;
  line-height: 1.3;
}

.skill-details {
  padding: 20px 0;
}

.details-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.details-header h3 {
  margin: 0;
}

.close-details {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
}

.details-content p {
  margin: 8px 0;
}

.details-actions {
  margin-top: 20px;
}

.execute-button {
  background: #1976d2;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
}

.menu-footer {
  padding: 12px 20px;
  border-top: 1px solid #e0e0e0;
  font-size: 12px;
  color: #666;
}
`;

// 注入样式
if (typeof document !== 'undefined') {
  const styleElement = document.createElement('style');
  styleElement.textContent = styles;
  document.head.appendChild(styleElement);
}

export default SkillsMenu;