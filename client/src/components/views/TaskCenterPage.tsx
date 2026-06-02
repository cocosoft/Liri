import { useEffect, useRef, useState } from 'react';
import { useCronStore } from '../../stores/cronStore';
import { useAgentStore } from '../../stores/agentStore';
import type { AgentTaskTemplate } from '../../types';
import { SkeletonCard } from '../common/Skeleton';
import CronExecutionHistory from '../Cron/CronExecutionHistory';
import CronRetryConfig from '../Cron/CronRetryConfig';

function TaskCenterPage() {
  const { tasks: cronTasks, isLoading: isCronLoading, loadTasks: loadCronTasks, toggleTask: toggleCronTask, deleteTask: deleteCronTask, runTaskNow: runCronTaskNow, createTask: createCronTask } = useCronStore();
  const { 
    tasks: agentTasks, 
    isLoading: isAgentLoading, 
    error: agentError, 
    taskLogs,
    selectedTask,
    loadTasks: loadAgentTasks, 
    executeTask: executeAgentTask, 
    cancelTask: cancelAgentTask, 
    getTaskProgress: getAgentTaskProgress,
    createTask: createAgentTask,
    updateTask: updateAgentTask,
    deleteTask: deleteAgentTask,
    selectTask: selectAgentTask,
  } = useAgentStore();
  
  // 状态管理
  const [activeTab, setActiveTab] = useState<'cron' | 'agent' | 'history' | 'retry'>('cron');
  
  // Agent任务状态
  const [expandedAgentTaskId, setExpandedAgentTaskId] = useState<string | null>(null);
  const [agentSearchQuery, setAgentSearchQuery] = useState('');
  const [agentStatusFilter, setAgentStatusFilter] = useState<'all' | 'pending' | 'running' | 'completed' | 'failed'>('all');
  const [selectedAgentTaskIds, setSelectedAgentTaskIds] = useState<string[]>([]);
  
  // 定时任务状态
  const [expandedCronTaskId, setExpandedCronTaskId] = useState<string | null>(null);
  const [cronSearchQuery, setCronSearchQuery] = useState('');
  const [cronStatusFilter, setCronStatusFilter] = useState<'all' | 'running' | 'error' | 'idle'>('all');
  const [selectedCronTaskIds, setSelectedCronTaskIds] = useState<string[]>([]);
  const [agentSortBy, setAgentSortBy] = useState<'created_at' | 'name' | 'priority'>('created_at');
  const [agentSortOrder, setAgentSortOrder] = useState<'asc' | 'desc'>('desc');
  const [cronSortBy, setCronSortBy] = useState<'lastRun' | 'name' | 'nextRun'>('lastRun');
  const [cronSortOrder, setCronSortOrder] = useState<'asc' | 'desc'>('desc');
  
  // 弹窗状态
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showCronCreateModal, setShowCronCreateModal] = useState(false);
  const [editingTask, setEditingTask] = useState<typeof agentTasks[0] | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // 表单状态
  const [newTaskForm, setNewTaskForm] = useState({ 
    name: '', 
    description: '', 
    prompt: '', 
    tags: [] as string[], 
    priority: 'medium' as 'high' | 'medium' | 'low',
    scheduleEnabled: false,
    scheduleType: 'cron' as 'cron' | 'interval' | 'once',
    cronExpression: '',
    intervalMinutes: 60,
    scheduledTime: ''
  });
  const [editTaskForm, setEditTaskForm] = useState({ 
    name: '', 
    description: '', 
    tags: [] as string[], 
    priority: 'medium' as 'high' | 'medium' | 'low' 
  });
  const [tagInput, setTagInput] = useState('');
  const [templates, setTemplates] = useState<AgentTaskTemplate[]>([]);
  const [newTemplateForm, setNewTemplateForm] = useState({ 
    name: '', 
    description: '', 
    prompt: '', 
    priority: 'medium' as 'high' | 'medium' | 'low', 
    tags: [] as string[] 
  });
  const [templateTagInput, setTemplateTagInput] = useState('');
  const [newCronForm, setNewCronForm] = useState({ 
    name: '', 
    expression: '', 
    description: '', 
    enabled: true 
  });
  
  const expandedPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DRAFT_KEY = 'agent-task-draft';
  const DRAFT_SAVE_DELAY_MS = 400;

  // 过滤函数
  const filteredAgentTasks = agentTasks.filter(task => {
    const matchesSearch = !agentSearchQuery || 
      task.name.toLowerCase().includes(agentSearchQuery.toLowerCase()) ||
      task.description?.toLowerCase().includes(agentSearchQuery.toLowerCase());
    const matchesStatus = agentStatusFilter === 'all' || task.status === agentStatusFilter;
    return matchesSearch && matchesStatus;
  }).sort((a, b) => {
    const multiplier = agentSortOrder === 'asc' ? 1 : -1;
    if (agentSortBy === 'name') {
      return multiplier * (a.name || '').localeCompare(b.name || '');
    }
    if (agentSortBy === 'priority') {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const aP = priorityOrder[a.priority || 'medium'] ?? 1;
      const bP = priorityOrder[b.priority || 'medium'] ?? 1;
      return multiplier * (aP - bP);
    }
    return multiplier * ((a.created_at || 0) - (b.created_at || 0));
  });

  const filteredCronTasks = cronTasks.filter(task => {
    const matchesSearch = !cronSearchQuery || 
      task.name.toLowerCase().includes(cronSearchQuery.toLowerCase()) ||
      task.description?.toLowerCase().includes(cronSearchQuery.toLowerCase());
    const matchesStatus = cronStatusFilter === 'all' || task.status === cronStatusFilter;
    return matchesSearch && matchesStatus;
  }).sort((a, b) => {
    const multiplier = cronSortOrder === 'asc' ? 1 : -1;
    if (cronSortBy === 'name') {
      return multiplier * (a.name || '').localeCompare(b.name || '');
    }
    if (cronSortBy === 'nextRun') {
      return multiplier * ((a.nextRun || 0) - (b.nextRun || 0));
    }
    return multiplier * ((a.lastRun || 0) - (b.lastRun || 0));
  });

  // 批量选择
  const isAllAgentSelected = filteredAgentTasks.length > 0 && 
    filteredAgentTasks.every(task => selectedAgentTaskIds.includes(task.id));

  const isAllCronSelected = filteredCronTasks.length > 0 && 
    filteredCronTasks.every(task => selectedCronTaskIds.includes(task.id));

  // 草稿管理
  const saveDraft = (form: typeof newTaskForm) => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch (e) {
      console.warn('Failed to save draft:', e);
    }
  };

  const loadDraft = (): typeof newTaskForm => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const draft = JSON.parse(saved);
        return { 
          ...draft, 
          priority: draft.priority || 'medium',
          scheduleEnabled: draft.scheduleEnabled || false,
          scheduleType: draft.scheduleType || 'cron',
          cronExpression: draft.cronExpression || '',
          intervalMinutes: draft.intervalMinutes || 60,
          scheduledTime: draft.scheduledTime || ''
        };
      }
    } catch (e) {
      console.warn('Failed to load draft:', e);
    }
    return { 
      name: '', 
      description: '', 
      prompt: '', 
      tags: [], 
      priority: 'medium',
      scheduleEnabled: false,
      scheduleType: 'cron',
      cronExpression: '',
      intervalMinutes: 60,
      scheduledTime: ''
    };
  };

  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      console.warn('Failed to clear draft:', e);
    }
  };

  const debouncedSaveDraft = (form: typeof newTaskForm) => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
    }
    draftSaveTimerRef.current = setTimeout(() => {
      saveDraft(form);
    }, DRAFT_SAVE_DELAY_MS);
  };

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // 标签管理
  interface FormWithTags {
    tags: string[];
  }

  const addTag = <T extends FormWithTags>(form: T, setForm: (updater: (prev: T) => T) => void, tag: string) => {
    const trimmedTag = tag.trim();
    if (trimmedTag && !form.tags.includes(trimmedTag)) {
      setForm((prev: T) => ({ ...prev, tags: [...prev.tags, trimmedTag] }));
    }
  };

  const removeTag = <T extends FormWithTags>(_form: T, setForm: (updater: (prev: T) => T) => void, tag: string) => {
    setForm((prev: T) => ({ ...prev, tags: prev.tags.filter((t: string) => t !== tag) }));
  };

  // 模板管理
  const loadTemplates = () => {
    const saved = localStorage.getItem('agent-task-templates');
    if (saved) {
      try {
        setTemplates(JSON.parse(saved));
      } catch {
        setTemplates([]);
      }
    }
  };

  const saveTemplates = (newTemplates: AgentTaskTemplate[]) => {
    localStorage.setItem('agent-task-templates', JSON.stringify(newTemplates));
    setTemplates(newTemplates);
  };

  const createTemplate = () => {
    if (!newTemplateForm.name.trim() || !newTemplateForm.prompt.trim()) return;
    
    const template: AgentTaskTemplate = {
      id: Date.now().toString(),
      name: newTemplateForm.name.trim(),
      description: newTemplateForm.description.trim() || undefined,
      prompt: newTemplateForm.prompt.trim(),
      priority: newTemplateForm.priority,
      tags: newTemplateForm.tags,
      createdAt: Date.now(),
    };
    
    saveTemplates([template, ...templates]);
    setNewTemplateForm({ name: '', description: '', prompt: '', priority: 'medium', tags: [] });
    setShowTemplateModal(false);
  };

  const applyTemplate = (template: AgentTaskTemplate) => {
    setNewTaskForm({
      name: template.name,
      description: template.description || '',
      prompt: template.prompt,
      priority: template.priority || 'medium',
      tags: [...(template.tags || [])],
      scheduleEnabled: false,
      scheduleType: 'cron',
      cronExpression: '',
      intervalMinutes: 60,
      scheduledTime: ''
    });
    setShowTemplateModal(false);
    setShowCreateModal(true);
  };

  const deleteTemplate = (templateId: string) => {
    if (confirm('确定要删除这个模板吗？')) {
      saveTemplates(templates.filter(t => t.id !== templateId));
    }
  };

  const addTemplateTag = () => {
    const trimmedTag = templateTagInput.trim();
    if (trimmedTag && !newTemplateForm.tags.includes(trimmedTag)) {
      setNewTemplateForm(prev => ({ ...prev, tags: [...prev.tags, trimmedTag] }));
    }
    setTemplateTagInput('');
  };

  const removeTemplateTag = (tag: string) => {
    setNewTemplateForm(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
  };

  // 初始化
  useEffect(() => {
    const draft = loadDraft();
    if (draft.name || draft.description || draft.prompt) {
      const shouldRestore = window.confirm('检测到未完成的任务草稿，是否恢复？');
      if (shouldRestore) {
        setNewTaskForm(draft);
      }
    }
    loadTemplates();
  }, []);

  useEffect(() => {
    if (showCreateModal) {
      debouncedSaveDraft(newTaskForm);
    }
    return () => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
      }
    };
  }, [newTaskForm, showCreateModal]);

  // 批量操作函数
  const toggleSelectAllAgents = () => {
    if (isAllAgentSelected) {
      setSelectedAgentTaskIds([]);
    } else {
      setSelectedAgentTaskIds(filteredAgentTasks.map(task => task.id));
    }
  };

  const toggleSelectAllCrons = () => {
    if (isAllCronSelected) {
      setSelectedCronTaskIds([]);
    } else {
      setSelectedCronTaskIds(filteredCronTasks.map(task => task.id));
    }
  };

  const toggleSelectAgentTask = (taskId: string) => {
    setSelectedAgentTaskIds(prev => 
      prev.includes(taskId) 
        ? prev.filter(id => id !== taskId)
        : [...prev, taskId]
    );
  };

  const toggleSelectCronTask = (taskId: string) => {
    setSelectedCronTaskIds(prev => 
      prev.includes(taskId) 
        ? prev.filter(id => id !== taskId)
        : [...prev, taskId]
    );
  };

  const handleAgentBatchDelete = async () => {
    if (selectedAgentTaskIds.length === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedAgentTaskIds.length} 个Agent任务吗？`)) return;
    
    try {
      for (const id of selectedAgentTaskIds) {
        await deleteAgentTask(id);
      }
      setSelectedAgentTaskIds([]);
      showNotification(`成功删除 ${selectedAgentTaskIds.length} 个Agent任务`, 'success');
    } catch (e) {
      showNotification('删除Agent任务失败', 'error');
    }
  };

  const handleAgentBatchExecute = async () => {
    if (selectedAgentTaskIds.length === 0) return;
    const completedTasks = agentTasks.filter(
      task => selectedAgentTaskIds.includes(task.id) && task.status === 'completed'
    );
    
    if (completedTasks.length === 0) {
      showNotification('没有可重新执行的已完成Agent任务', 'info');
      return;
    }

    try {
      for (const task of completedTasks) {
        await executeAgentTask(task.name);
      }
      setSelectedAgentTaskIds([]);
      showNotification(`已重新执行 ${completedTasks.length} 个Agent任务`, 'success');
    } catch (e) {
      showNotification('重新执行Agent任务失败', 'error');
    }
  };

  const handleCronBatchDelete = async () => {
    if (selectedCronTaskIds.length === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedCronTaskIds.length} 个定时任务吗？`)) return;
    
    try {
      for (const id of selectedCronTaskIds) {
        await deleteCronTask(id);
      }
      setSelectedCronTaskIds([]);
      showNotification(`成功删除 ${selectedCronTaskIds.length} 个定时任务`, 'success');
    } catch (e) {
      showNotification('删除定时任务失败', 'error');
    }
  };

  const handleCronBatchExecute = async () => {
    if (selectedCronTaskIds.length === 0) return;
    
    try {
      for (const id of selectedCronTaskIds) {
        await runCronTaskNow(id);
      }
      setSelectedCronTaskIds([]);
      showNotification(`已手动执行 ${selectedCronTaskIds.length} 个定时任务`, 'success');
    } catch (e) {
      showNotification('执行定时任务失败', 'error');
    }
  };

  // 数据加载
  useEffect(() => {
    loadCronTasks();
    loadAgentTasks();
    const interval = setInterval(() => {
      loadCronTasks();
      loadAgentTasks();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (expandedPollRef.current) {
      clearInterval(expandedPollRef.current);
      expandedPollRef.current = null;
    }
    if (expandedAgentTaskId) {
      getAgentTaskProgress(expandedAgentTaskId);
      expandedPollRef.current = setInterval(() => {
        getAgentTaskProgress(expandedAgentTaskId);
      }, 2000);
    }
    return () => {
      if (expandedPollRef.current) {
        clearTimeout(expandedPollRef.current);
      }
    };
  }, [expandedAgentTaskId]);

  // 任务操作
  const handleCreateAgentTask = async () => {
    if (!newTaskForm.name.trim()) return;
    if (isSubmitting) return;
    
    const scheduleConfig = newTaskForm.scheduleEnabled ? {
      type: newTaskForm.scheduleType,
      cronExpression: newTaskForm.scheduleType === 'cron' ? newTaskForm.cronExpression : undefined,
      intervalMinutes: newTaskForm.scheduleType === 'interval' ? newTaskForm.intervalMinutes : undefined,
      scheduledTime: newTaskForm.scheduleType === 'once' ? newTaskForm.scheduledTime : undefined,
      enabled: true,
    } : undefined;
    
    setIsSubmitting(true);
    try {
      await createAgentTask({
        name: newTaskForm.name.trim(),
        description: newTaskForm.description.trim(),
        prompt: newTaskForm.prompt.trim(),
        priority: newTaskForm.priority,
        metadata: { tags: newTaskForm.tags, scheduleConfig },
      });
      setNewTaskForm({ 
        name: '', 
        description: '', 
        prompt: '', 
        tags: [], 
        priority: 'medium',
        scheduleEnabled: false,
        scheduleType: 'cron',
        cronExpression: '',
        intervalMinutes: 60,
        scheduledTime: ''
      });
      clearDraft();
      setShowCreateModal(false);
      showNotification('Agent任务创建成功', 'success');
    } catch (e) {
      showNotification('创建Agent任务失败', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenEditModal = (task: typeof agentTasks[0]) => {
    setEditingTask(task);
    setEditTaskForm({ 
      name: task.name, 
      description: task.description || '',
      tags: (task.metadata as Record<string, unknown>)?.tags as string[] || [], 
      priority: task.priority || 'medium'
    });
    setShowEditModal(true);
  };

  const handleUpdateAgentTask = async () => {
    if (!editingTask) return;
    await updateAgentTask(editingTask.id, {
      name: editTaskForm.name.trim(),
      description: editTaskForm.description.trim(),
    });
    setShowEditModal(false);
    setEditingTask(null);
  };

  const handleExecuteAgentTask = async (taskName: string) => {
    try {
      await executeAgentTask(taskName);
      await loadAgentTasks();
      showNotification(`任务 "${taskName}" 已开始执行`, 'success');
    } catch (e) {
      showNotification(`执行任务 "${taskName}" 失败`, 'error');
    }
  };

  // 状态颜色映射
  const cronStatusColor: Record<string, string> = {
    running: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    idle: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  };

  const agentStatusColor: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  const agentStatusText: Record<string, string> = {
    pending: '等待中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
  };

  const cronStatusText: Record<string, string> = {
    running: '运行中',
    error: '错误',
    idle: '空闲',
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN');
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      {/* 通知提示 */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
          notification.type === 'success' ? 'bg-green-500 text-white' :
          notification.type === 'error' ? 'bg-red-500 text-white' :
          'bg-blue-500 text-white'
        }`}>
          {notification.message}
        </div>
      )}
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            任务中心
          </h2>
          {activeTab === 'cron' && (
            <button
              onClick={() => setShowCronCreateModal(true)}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
            >
              新建定时任务
            </button>
          )}
          {activeTab === 'agent' && (
            <div className="flex gap-2">
              <button
                onClick={() => setShowTemplateModal(true)}
                className="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-700 text-white rounded"
              >
                模板管理
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
              >
                新建 Agent 任务
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab('cron')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'cron'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            定时任务
          </button>
          <button
            onClick={() => setActiveTab('agent')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'agent'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Agent 任务
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'history'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            执行历史
          </button>
          <button
            onClick={() => setActiveTab('retry')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'retry'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            重试配置
          </button>
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            {/* 定时任务页面 */}
            {activeTab === 'cron' && (
              <>
                {/* 统计面板 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">总任务</p>
                        <p className="text-lg font-medium text-gray-900 dark:text-gray-100">{cronTasks.length}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">运行中</p>
                        <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                          {cronTasks.filter(t => t.status === 'running').length}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">空闲</p>
                        <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                          {cronTasks.filter(t => t.status === 'idle').length}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">错误</p>
                        <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                          {cronTasks.filter(t => t.status === 'error').length}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 批量操作栏 */}
                {selectedCronTaskIds.length > 0 && (
                  <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-blue-700 dark:text-blue-300">
                        已选择 <strong>{selectedCronTaskIds.length}</strong> 个定时任务
                      </span>
                      <button
                        onClick={() => setSelectedCronTaskIds([])}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        取消选择
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCronBatchExecute}
                        className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg"
                      >
                        立即执行
                      </button>
                      <button
                        onClick={handleCronBatchDelete}
                        className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg"
                      >
                        批量删除
                      </button>
                    </div>
                  </div>
                )}

                {/* 搜索筛选栏 */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <input
                      type="checkbox"
                      checked={isAllCronSelected}
                      onChange={toggleSelectAllCrons}
                      disabled={filteredCronTasks.length === 0}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <div className="flex-1 w-full sm:w-auto">
                      <div className="relative">
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
                        </svg>
                        <input
                          type="text"
                          placeholder="搜索定时任务..."
                          value={cronSearchQuery}
                          onChange={(e) => setCronSearchQuery(e.target.value)}
                          className="w-full sm:w-64 pl-10 pr-4 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={cronStatusFilter}
                      onChange={(e) => setCronStatusFilter(e.target.value as any)}
                      className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100"
                    >
                      <option value="all">全部状态</option>
                      <option value="running">运行中</option>
                      <option value="idle">空闲</option>
                      <option value="error">错误</option>
                    </select>
                    <select
                      value={cronSortBy}
                      onChange={(e) => setCronSortBy(e.target.value as 'lastRun' | 'name' | 'nextRun')}
                      className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100"
                    >
                      <option value="lastRun">上次执行</option>
                      <option value="name">名称</option>
                      <option value="nextRun">下次执行</option>
                    </select>
                    <button
                      onClick={() => setCronSortOrder(cronSortOrder === 'asc' ? 'desc' : 'asc')}
                      className="px-2 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                      title={cronSortOrder === 'asc' ? '升序 ↑' : '降序 ↓'}
                    >
                      {cronSortOrder === 'asc' ? '↑' : '↓'}
                    </button>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      共 {filteredCronTasks.length} 个定时任务
                    </span>
                    <button
                      onClick={loadCronTasks}
                      disabled={isCronLoading}
                      className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50"
                    >
                      刷新
                    </button>
                  </div>
                </div>

                {/* 定时任务列表 */}
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  {isCronLoading && filteredCronTasks.length === 0 ? (
                    <div className="p-4 space-y-3">
                      <SkeletonCard count={3} />
                    </div>
                  ) : filteredCronTasks.length === 0 ? (
                    <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                      暂无匹配的定时任务
                      <p className="text-sm mt-2">尝试调整搜索关键词或筛选条件</p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
                      {filteredCronTasks.map((task) => (
                        <li
                          key={task.id}
                          className={`group px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                            selectedCronTaskIds.includes(task.id) ? 'ring-2 ring-blue-500' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-3 min-w-0">
                              <input
                                type="checkbox"
                                checked={selectedCronTaskIds.includes(task.id)}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  toggleSelectCronTask(task.id);
                                }}
                                className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${cronStatusColor[task.status] || ''}`}>
                                    {cronStatusText[task.status] || task.status}
                                  </span>
                                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                                    task.enabled 
                                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' 
                                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                  }`}>
                                    {task.enabled ? '✓ 已启用' : '✗ 已禁用'}
                                  </span>
                                  <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                    {task.name}
                                  </h3>
                                </div>
                                {task.description && (
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                                    {task.description}
                                  </p>
                                )}
                                {task.expression && (
                                  <div className="mt-2">
                                    <code className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded font-mono text-gray-600 dark:text-gray-300">
                                      {task.expression}
                                    </code>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    runCronTaskNow(task.id);
                                  }}
                                  className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 rounded"
                                  title="立即执行"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleCronTask(task.id, !task.enabled);
                                  }}
                                  className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
                                  title={task.enabled ? '禁用' : '启用'}
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    {task.enabled 
                                      ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0" />
                                      : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                    }
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0" />
                                  </svg>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm('确定要删除这个定时任务吗？')) {
                                      deleteCronTask(task.id);
                                    }
                                  }}
                                  className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
                                  title="删除"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedCronTaskId(expandedCronTaskId === task.id ? null : task.id);
                                }}
                                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                              >
                                <svg className={`w-4 h-4 transition-transform ${expandedCronTaskId === task.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                            </div>
                          </div>

                          {/* 定时任务展开详情 */}
                          {expandedCronTaskId === task.id && (
                            <div className="mt-3 space-y-3 border-t border-gray-100 dark:border-gray-700 pt-3">
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    runCronTaskNow(task.id);
                                  }}
                                  className="text-xs px-2 py-1 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-600 rounded hover:bg-green-50 dark:hover:bg-green-900/30"
                                >
                                  立即执行
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleCronTask(task.id, !task.enabled);
                                  }}
                                  className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30"
                                >
                                  {task.enabled ? '禁用' : '启用'}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm('确定要删除这个定时任务吗？')) {
                                      deleteCronTask(task.id);
                                    }
                                  }}
                                  className="text-xs px-2 py-1 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                                >
                                  删除
                                </button>
                              </div>

                              {task.expression && (
                                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded">
                                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Cron 表达式</span>
                                  <code className="block mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre font-mono bg-white dark:bg-gray-800 p-2 rounded">
                                    {task.expression}
                                  </code>
                                </div>
                              )}

                              {task.nextRun && (
                                <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
                                  <span className="text-xs font-medium text-blue-500 dark:text-blue-400">下次执行时间</span>
                                  <p className="mt-1 text-sm text-blue-600 dark:text-blue-300">
                                    {formatTimestamp(task.nextRun)}
                                  </p>
                                </div>
                              )}

                              {task.lastRun && (
                                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded">
                                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">上次执行时间</span>
                                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                                    {formatTimestamp(task.lastRun)}
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}

            {/* Agent任务页面 */}
            {activeTab === 'agent' && (
              <>
                {agentError && (
                  <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
                    {agentError}
                  </div>
                )}

                {/* 统计面板 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">总任务</p>
                        <p className="text-lg font-medium text-gray-900 dark:text-gray-100">{agentTasks.length}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">已完成</p>
                        <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                          {agentTasks.filter(t => t.status === 'completed').length}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">运行中</p>
                        <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                          {agentTasks.filter(t => t.status === 'running').length}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">已失败</p>
                        <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                          {agentTasks.filter(t => t.status === 'failed').length}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 批量操作栏 */}
                {selectedAgentTaskIds.length > 0 && (
                  <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-blue-700 dark:text-blue-300">
                        已选择 <strong>{selectedAgentTaskIds.length}</strong> 个Agent任务
                      </span>
                      <button
                        onClick={() => setSelectedAgentTaskIds([])}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        取消选择
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleAgentBatchExecute}
                        className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg"
                      >
                        重新执行已完成任务
                      </button>
                      <button
                        onClick={handleAgentBatchDelete}
                        className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg"
                      >
                        批量删除
                      </button>
                    </div>
                  </div>
                )}

                {/* 搜索筛选栏 */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <input
                      type="checkbox"
                      checked={isAllAgentSelected}
                      onChange={toggleSelectAllAgents}
                      disabled={filteredAgentTasks.length === 0}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <div className="flex-1 w-full sm:w-auto">
                      <div className="relative">
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
                        </svg>
                        <input
                          type="text"
                          placeholder="搜索Agent任务..."
                          value={agentSearchQuery}
                          onChange={(e) => setAgentSearchQuery(e.target.value)}
                          className="w-full sm:w-64 pl-10 pr-4 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={agentStatusFilter}
                      onChange={(e) => setAgentStatusFilter(e.target.value as any)}
                      className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100"
                    >
                      <option value="all">全部状态</option>
                      <option value="pending">等待中</option>
                      <option value="running">运行中</option>
                      <option value="completed">已完成</option>
                      <option value="failed">已失败</option>
                    </select>
                    <select
                      value={agentSortBy}
                      onChange={(e) => setAgentSortBy(e.target.value as 'created_at' | 'name' | 'priority')}
                      className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100"
                    >
                      <option value="created_at">创建时间</option>
                      <option value="name">名称</option>
                      <option value="priority">优先级</option>
                    </select>
                    <button
                      onClick={() => setAgentSortOrder(agentSortOrder === 'asc' ? 'desc' : 'asc')}
                      className="px-2 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                      title={agentSortOrder === 'asc' ? '升序 ↑' : '降序 ↓'}
                    >
                      {agentSortOrder === 'asc' ? '↑' : '↓'}
                    </button>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      共 {filteredAgentTasks.length} 个Agent任务
                    </span>
                    <button
                      onClick={loadAgentTasks}
                      disabled={isAgentLoading}
                      className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50"
                    >
                      刷新
                    </button>
                  </div>
                </div>

                {/* Agent任务列表 */}
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  {isAgentLoading && filteredAgentTasks.length === 0 ? (
                    <div className="p-4 space-y-3">
                      <SkeletonCard count={3} />
                    </div>
                  ) : filteredAgentTasks.length === 0 ? (
                    <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                      暂无匹配的Agent任务
                      <p className="text-sm mt-2">尝试调整搜索关键词或筛选条件</p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
                      {filteredAgentTasks.map((task) => (
                        <li
                          key={task.id}
                          onClick={() => selectAgentTask(task)}
                          className={`group px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer ${
                            selectedAgentTaskIds.includes(task.id) ? 'ring-2 ring-blue-500' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-3 min-w-0">
                              <input
                                type="checkbox"
                                checked={selectedAgentTaskIds.includes(task.id)}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  toggleSelectAgentTask(task.id);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${agentStatusColor[task.status] || ''}`}>
                                    {agentStatusText[task.status] || task.status}
                                  </span>
                                  {task.priority && (
                                    <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                                      task.priority === 'high' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                                      task.priority === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' :
                                      'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                    }`}>
                                      {task.priority === 'high' ? '🔴 高' : task.priority === 'medium' ? '🟡 中' : '🟢 低'}
                                    </span>
                                  )}
                                  <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                    {task.name || task.type || '未知任务'}
                                  </h3>
                                </div>
                                {task.description && (
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                                    {task.description}
                                  </p>
                                )}
                                <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 dark:text-gray-500">
                                  <span>创建于 {formatTimestamp(task.created_at)}</span>
                                  {task.tokenUsed !== undefined && (
                                    <span>消耗 {task.tokenUsed} tokens</span>
                                  )}
                                </div>
                                {task.metadata && Array.isArray((task.metadata as Record<string, unknown>)?.tags) && ((task.metadata as Record<string, unknown>).tags as string[]).length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {((task.metadata as Record<string, unknown>).tags as string[]).map((tag: string) => (
                                      <span
                                        key={tag}
                                        className="px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded"
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              {task.progress !== undefined && (
                                <div className="w-16 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-blue-500 rounded-full transition-all"
                                    style={{ width: `${task.progress}%` }}
                                  />
                                </div>
                              )}
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleExecuteAgentTask(task.name);
                                  }}
                                  className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 rounded"
                                  title="执行"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0" />
                                  </svg>
                                </button>
                                {(task.status === 'pending' || task.status === 'running') && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      cancelAgentTask(task.id);
                                    }}
                                    className="p-1.5 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/30 rounded"
                                    title="取消"
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenEditModal(task);
                                  }}
                                  className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
                                  title="编辑"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm('确定要删除这个Agent任务吗？')) {
                                      deleteAgentTask(task.id);
                                    }
                                  }}
                                  className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
                                  title="删除"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedAgentTaskId(expandedAgentTaskId === task.id ? null : task.id);
                                }}
                                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                              >
                                <svg className={`w-4 h-4 transition-transform ${expandedAgentTaskId === task.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                            </div>
                          </div>

                          {/* Agent任务展开详情 */}
                          {expandedAgentTaskId === task.id && (
                            <div className="mt-3 space-y-3 border-t border-gray-100 dark:border-gray-700 pt-3">
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleExecuteAgentTask(task.name);
                                  }}
                                  className="text-xs px-2 py-1 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-600 rounded hover:bg-green-50 dark:hover:bg-green-900/30"
                                >
                                  执行
                                </button>
                                {(task.status === 'pending' || task.status === 'running') && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      cancelAgentTask(task.id);
                                    }}
                                    className="text-xs px-2 py-1 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-600 rounded hover:bg-orange-50 dark:hover:bg-orange-900/30"
                                  >
                                    取消
                                  </button>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenEditModal(task);
                                  }}
                                  className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30"
                                >
                                  编辑
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm('确定要删除这个Agent任务吗？')) {
                                      deleteAgentTask(task.id);
                                    }
                                  }}
                                  className="text-xs px-2 py-1 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                                >
                                  删除
                                </button>
                              </div>

                              {task.result && (
                                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded">
                                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">执行结果</span>
                                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
                                    {task.result}
                                  </p>
                                </div>
                              )}

                              {selectedTask?.id === task.id && taskLogs.length > 0 && (
                                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded">
                                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">执行日志</span>
                                  <pre className="mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-auto max-h-48 font-mono">
                                    {taskLogs.join('\n')}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}

            {/* 执行历史页面 */}
            {activeTab === 'history' && <CronExecutionHistory />}

            {/* 重试配置页面 */}
            {activeTab === 'retry' && <CronRetryConfig />}
          </div>

          {/* 侧边任务详情面板 */}
          {activeTab === 'agent' && selectedTask && (
            <div className="w-80 shrink-0">
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 sticky top-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">任务详情</h3>
                  <button
                    onClick={() => selectAgentTask(null as any)}
                    className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-4">
                  {/* 基本信息 */}
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">基本信息</h4>
                    <div className="space-y-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{selectedTask.name}</p>
                      </div>
                      {selectedTask.description && (
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{selectedTask.description}</p>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${agentStatusColor[selectedTask.status] || ''}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${selectedTask.status === 'running' ? 'bg-blue-400 animate-pulse' : selectedTask.status === 'completed' ? 'bg-green-400' : selectedTask.status === 'failed' ? 'bg-red-400' : 'bg-gray-400'}`} />
                          {agentStatusText[selectedTask.status] || selectedTask.status}
                        </span>
                        {selectedTask.priority && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            selectedTask.priority === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                            selectedTask.priority === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                            'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                          }`}>
                            {selectedTask.priority === 'high' ? '高优先级' : selectedTask.priority === 'medium' ? '中优先级' : '低优先级'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 分隔线 */}
                  <div className="border-t border-gray-100 dark:border-gray-700" />

                  {/* 时间信息 */}
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">时间信息</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                         <span className="text-xs text-gray-500 dark:text-gray-400">创建时间</span>
                         <span className="text-xs text-gray-700 dark:text-gray-300">{formatTimestamp(selectedTask.created_at)}</span>
                       </div>
                     </div>
                   </div>

                   {/* 分隔线 */}
                   <div className="border-t border-gray-100 dark:border-gray-700" />

                   {/* 资源消耗 */}
                   <div>
                     <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">资源消耗</h4>
                     <div className="space-y-2">
                       {selectedTask.tokenUsed !== undefined && (
                         <div className="flex justify-between items-center">
                           <span className="text-xs text-gray-500 dark:text-gray-400">Token 消耗</span>
                           <span className="text-xs font-mono text-gray-700 dark:text-gray-300">{selectedTask.tokenUsed}</span>
                         </div>
                       )}
                     </div>
                   </div>

                  {/* 执行日志 */}
                  {taskLogs.length > 0 && (
                    <>
                      <div className="border-t border-gray-100 dark:border-gray-700" />
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">执行日志</h4>
                        <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-auto max-h-48 font-mono bg-gray-50 dark:bg-gray-700/50 p-2 rounded border border-gray-100 dark:border-gray-700">
                          {taskLogs.join('\n')}
                        </pre>
                      </div>
                    </>
                  )}

                  {/* 分隔线 */}
                  <div className="border-t border-gray-100 dark:border-gray-700" />

                  {/* 操作提示 */}
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">快捷操作</h4>
                    <div className="space-y-1.5">
                      {selectedTask.status === 'pending' && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                          <span className="text-blue-500">▶</span> 点击执行按钮开始任务
                        </p>
                      )}
                      {selectedTask.status === 'running' && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                          <span className="text-orange-500">⏸</span> 点击取消按钮中止任务
                        </p>
                      )}
                      {selectedTask.status === 'completed' && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                          <span className="text-green-500">✓</span> 任务已完成，可重新执行
                        </p>
                      )}
                      {selectedTask.status === 'failed' && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                          <span className="text-red-500">✗</span> 任务失败，可重新执行
                        </p>
                      )}
                      <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <span className="text-gray-400">✎</span> 点击编辑按钮修改任务
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <span className="text-gray-400">🗑</span> 点击删除按钮移除任务
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 新建Agent任务模态框 */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreateModal(false)}>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="p-6">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">新建 Agent 任务</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">任务名称 *</label>
                    <input
                      type="text"
                      value={newTaskForm.name}
                      onChange={(e) => setNewTaskForm(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                      placeholder="输入任务名称"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">描述</label>
                    <textarea
                      value={newTaskForm.description}
                      onChange={(e) => setNewTaskForm(prev => ({ ...prev, description: e.target.value }))}
                      rows={2}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 resize-none"
                      placeholder="输入任务描述"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">提示词</label>
                    <textarea
                      value={newTaskForm.prompt}
                      onChange={(e) => setNewTaskForm(prev => ({ ...prev, prompt: e.target.value }))}
                      rows={4}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 resize-none"
                      placeholder="输入任务提示词"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">优先级</label>
                    <select
                      value={newTaskForm.priority}
                      onChange={(e) => setNewTaskForm(prev => ({ ...prev, priority: e.target.value as 'high' | 'medium' | 'low' }))}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                    >
                      <option value="high">高</option>
                      <option value="medium">中</option>
                      <option value="low">低</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">标签</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addTag(newTaskForm, setNewTaskForm, tagInput);
                            setTagInput('');
                          }
                        }}
                        className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                        placeholder="输入标签后按回车"
                      />
                      <button
                        onClick={() => {
                          addTag(newTaskForm, setNewTaskForm, tagInput);
                          setTagInput('');
                        }}
                        className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                      >
                        添加
                      </button>
                    </div>
                    {newTaskForm.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {newTaskForm.tags.map(tag => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded"
                          >
                            {tag}
                            <button
                              onClick={() => removeTag(newTaskForm, setNewTaskForm, tag)}
                              className="text-blue-400 hover:text-blue-600"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newTaskForm.scheduleEnabled}
                        onChange={(e) => setNewTaskForm(prev => ({ ...prev, scheduleEnabled: e.target.checked }))}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">启用定时执行</span>
                    </label>
                  </div>
                  {newTaskForm.scheduleEnabled && (
                    <div className="pl-6 space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">定时类型</label>
                        <select
                          value={newTaskForm.scheduleType}
                          onChange={(e) => setNewTaskForm(prev => ({ ...prev, scheduleType: e.target.value as 'cron' | 'interval' | 'once' }))}
                          className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                        >
                          <option value="cron">Cron 表达式</option>
                          <option value="interval">固定间隔</option>
                          <option value="once">单次定时</option>
                        </select>
                      </div>
                      {newTaskForm.scheduleType === 'cron' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cron 表达式</label>
                          <input
                            type="text"
                            value={newTaskForm.cronExpression}
                            onChange={(e) => setNewTaskForm(prev => ({ ...prev, cronExpression: e.target.value }))}
                            className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 font-mono"
                            placeholder="*/5 * * * *"
                          />
                        </div>
                      )}
                      {newTaskForm.scheduleType === 'interval' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">间隔（分钟）</label>
                          <input
                            type="number"
                            value={newTaskForm.intervalMinutes}
                            onChange={(e) => setNewTaskForm(prev => ({ ...prev, intervalMinutes: parseInt(e.target.value) || 60 }))}
                            min={1}
                            className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                          />
                        </div>
                      )}
                      {newTaskForm.scheduleType === 'once' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">执行时间</label>
                          <input
                            type="datetime-local"
                            value={newTaskForm.scheduledTime}
                            onChange={(e) => setNewTaskForm(prev => ({ ...prev, scheduledTime: e.target.value }))}
                            className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleCreateAgentTask}
                    disabled={!newTaskForm.name.trim() || isSubmitting}
                    className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    创建
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 编辑Agent任务模态框 */}
        {showEditModal && editingTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowEditModal(false)}>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
              <div className="p-6">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">编辑 Agent 任务</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">任务名称</label>
                    <input
                      type="text"
                      value={editTaskForm.name}
                      onChange={(e) => setEditTaskForm(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">描述</label>
                    <textarea
                      value={editTaskForm.description}
                      onChange={(e) => setEditTaskForm(prev => ({ ...prev, description: e.target.value }))}
                      rows={2}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">优先级</label>
                    <select
                      value={editTaskForm.priority}
                      onChange={(e) => setEditTaskForm(prev => ({ ...prev, priority: e.target.value as 'high' | 'medium' | 'low' }))}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                    >
                      <option value="high">高</option>
                      <option value="medium">中</option>
                      <option value="low">低</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">标签</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addTag(editTaskForm, setEditTaskForm, tagInput);
                            setTagInput('');
                          }
                        }}
                        className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                        placeholder="输入标签后按回车"
                      />
                      <button
                        onClick={() => {
                          addTag(editTaskForm, setEditTaskForm, tagInput);
                          setTagInput('');
                        }}
                        className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                      >
                        添加
                      </button>
                    </div>
                    {editTaskForm.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {editTaskForm.tags.map(tag => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded"
                          >
                            {tag}
                            <button
                              onClick={() => removeTag(editTaskForm, setEditTaskForm, tag)}
                              className="text-blue-400 hover:text-blue-600"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    onClick={() => setShowEditModal(false)}
                    className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleUpdateAgentTask}
                    className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 模板管理模态框 */}
        {showTemplateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowTemplateModal(false)}>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">模板管理</h3>
                  <button
                    onClick={() => setShowTemplateModal(false)}
                    className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">创建新模板</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">模板名称 *</label>
                      <input
                        type="text"
                        value={newTemplateForm.name}
                        onChange={(e) => setNewTemplateForm(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                        placeholder="输入模板名称"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">描述</label>
                      <input
                        type="text"
                        value={newTemplateForm.description}
                        onChange={(e) => setNewTemplateForm(prev => ({ ...prev, description: e.target.value }))}
                        className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                        placeholder="输入模板描述"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">提示词 *</label>
                      <textarea
                        value={newTemplateForm.prompt}
                        onChange={(e) => setNewTemplateForm(prev => ({ ...prev, prompt: e.target.value }))}
                        rows={3}
                        className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 resize-none"
                        placeholder="输入模板提示词"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">优先级</label>
                      <select
                        value={newTemplateForm.priority}
                        onChange={(e) => setNewTemplateForm(prev => ({ ...prev, priority: e.target.value as 'high' | 'medium' | 'low' }))}
                        className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                      >
                        <option value="high">高</option>
                        <option value="medium">中</option>
                        <option value="low">低</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">标签</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={templateTagInput}
                          onChange={(e) => setTemplateTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addTemplateTag();
                            }
                          }}
                          className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                          placeholder="输入标签后按回车"
                        />
                        <button
                          onClick={addTemplateTag}
                          className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                        >
                          添加
                        </button>
                      </div>
                      {newTemplateForm.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {newTemplateForm.tags.map(tag => (
                            <span
                              key={tag}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded"
                            >
                              {tag}
                              <button
                                onClick={() => removeTemplateTag(tag)}
                                className="text-blue-400 hover:text-blue-600"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={createTemplate}
                      disabled={!newTemplateForm.name.trim() || !newTemplateForm.prompt.trim()}
                      className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      创建模板
                    </button>
                  </div>
                </div>

                {templates.length > 0 ? (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">已有模板</h4>
                    {templates.map(template => (
                      <div
                        key={template.id}
                        className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg flex items-center justify-between"
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{template.name}</p>
                          {template.description && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{template.description}</p>
                          )}
                          {template.tags && template.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {template.tags.map(tag => (
                                <span key={tag} className="px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => applyTemplate(template)}
                            className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded"
                          >
                            使用
                          </button>
                          <button
                            onClick={() => deleteTemplate(template.id)}
                            className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-400 dark:text-gray-500">
                    暂无模板，请创建新模板
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {/* 新建定时任务模态框 */}
        {showCronCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCronCreateModal(false)}>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
              <div className="p-6">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">新建定时任务</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">任务名称 *</label>
                    <input
                      type="text"
                      value={newCronForm.name}
                      onChange={(e) => setNewCronForm((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="输入定时任务名称"
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 placeholder-gray-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cron 表达式 *</label>
                    <input
                      type="text"
                      value={newCronForm.expression}
                      onChange={(e) => setNewCronForm((prev) => ({ ...prev, expression: e.target.value }))}
                      placeholder="例如: 0 */6 * * *"
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 placeholder-gray-400 font-mono"
                    />
                    <p className="text-xs text-gray-400 mt-1">格式: 分 时 日 月 周 (空格分隔)</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">描述</label>
                    <textarea
                      value={newCronForm.description}
                      onChange={(e) => setNewCronForm((prev) => ({ ...prev, description: e.target.value }))}
                      placeholder="输入任务描述（可选）"
                      rows={3}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="cron-enabled"
                      checked={newCronForm.enabled}
                      onChange={(e) => setNewCronForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="cron-enabled" className="text-sm text-gray-700 dark:text-gray-300">
                      创建后立即启用
                    </label>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    onClick={() => {
                      setShowCronCreateModal(false);
                      setNewCronForm({ name: '', expression: '', description: '', enabled: true });
                    }}
                    className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg"
                  >
                    取消
                  </button>
                  <button
                    onClick={async () => {
                      if (!newCronForm.name.trim() || !newCronForm.expression.trim()) {
                        showNotification('请填写任务名称和 Cron 表达式', 'info');
                        return;
                      }
                      if (isSubmitting) return;
                      setIsSubmitting(true);
                      try {
                        await createCronTask({
                          name: newCronForm.name.trim(),
                          expression: newCronForm.expression.trim(),
                          description: newCronForm.description.trim(),
                          enabled: newCronForm.enabled,
                        });
                        setShowCronCreateModal(false);
                        setNewCronForm({ name: '', expression: '', description: '', enabled: true });
                        showNotification('定时任务创建成功', 'success');
                      } catch (e) {
                        showNotification('创建定时任务失败', 'error');
                      } finally {
                        setIsSubmitting(false);
                      }
                    }}
                    disabled={!newCronForm.name.trim() || !newCronForm.expression.trim() || isSubmitting}
                    className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    创建
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TaskCenterPage;