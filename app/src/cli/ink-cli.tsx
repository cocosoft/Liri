#!/usr/bin/env node
//

import React, { useState, useEffect } from 'react';
import {
  render,
  Box,
  Text,
  Button,
  ScrollBox,
  AlternateScreen,
} from '@modules/ink';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { getSkillManager } from '@modules/skills/SkillManager';
import { getToolManager } from '@modules/tools/ToolManager';
import { profileReport } from '@modules/utils/startupProfiler';
import { CompanionSprite } from '@modules/buddy/CompanionSprite';
import { useBuddyNotification } from '@modules/buddy/useBuddyNotification';
import { TaskListV2 } from '@modules/components/TaskListV2';
import type { TaskGroup, TaskItem } from '@modules/components/TaskListV2';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 主菜单组件
 */
const MainMenu = ({
  onMenuChange,
}: {
  onMenuChange: (menu: string) => void;
}) => {
  return (
    <Box flexDirection="column" padding={2} width="100%">
      <Text bold color="green">
        Liri Command Line Interface
      </Text>
      <Text color="gray">Welcome to Liri CLI. Select an option below:</Text>
      <Box height={2} />

      <Button onClick={() => onMenuChange('skills')} width="100%">
        Manage Skills
      </Button>
      <Box height={1} />

      <Button onClick={() => onMenuChange('tools')} width="100%">
        Manage Tools
      </Button>
      <Box height={1} />

      <Button onClick={() => onMenuChange('profile')} width="100%">
        View Startup Profile
      </Button>
      <Box height={1} />

      <Button onClick={() => onMenuChange('tasks')} width="100%">
        Manage Tasks
      </Button>
      <Box height={1} />

      <Button onClick={() => process.exit(0)} width="100%" color="red">
        Exit
      </Button>
    </Box>
  );
};

/**
 * 技能菜单组件
 */
const SkillsMenu = ({
  skills,
  onMenuChange,
  onSkillExecute,
}: {
  skills: Map<string, any>;
  onMenuChange: (menu: string) => void;
  onSkillExecute: (skillName: string) => void;
}) => {
  return (
    <Box flexDirection="column" padding={2} width="100%">
      <Text bold color="green">
        Skills Menu
      </Text>
      <Box height={2} />

      <Button onClick={() => onMenuChange('list_skills')} width="100%">
        List Skills
      </Button>
      <Box height={1} />

      <Button onClick={() => onMenuChange('execute_skill')} width="100%">
        Execute Skill
      </Button>
      <Box height={1} />

      <Button onClick={() => onMenuChange('reload_skills')} width="100%">
        Reload Skills
      </Button>
      <Box height={1} />

      <Button onClick={() => onMenuChange('main')} width="100%" color="gray">
        Back to Main Menu
      </Button>
    </Box>
  );
};

/**
 * 工具菜单组件
 */
const ToolsMenu = ({
  tools,
  onMenuChange,
}: {
  tools: any[];
  onMenuChange: (menu: string) => void;
}) => {
  return (
    <Box flexDirection="column" padding={2} width="100%">
      <Text bold color="green">
        Tools Menu
      </Text>
      <Box height={2} />

      <Button onClick={() => onMenuChange('list_tools')} width="100%">
        List Tools
      </Button>
      <Box height={1} />

      <Button onClick={() => onMenuChange('main')} width="100%" color="gray">
        Back to Main Menu
      </Button>
    </Box>
  );
};

/**
 * 技能列表组件
 */
const SkillsList = ({
  skills,
  onMenuChange,
}: {
  skills: Map<string, any>;
  onMenuChange: (menu: string) => void;
}) => {
  return (
    <Box flexDirection="column" padding={2} width="100%" height="100%">
      <Text bold color="green">
        Available Skills
      </Text>
      <Box height={1} />

      <ScrollBox width="100%" height="80%">
        {skills.size === 0 ? (
          <Text color="gray">No skills found.</Text>
        ) : (
          Array.from(skills.entries()).map(([name, skillInfo]) => (
            <Box key={name} marginBottom={2}>
              <Text bold>{name}</Text>
              <Text color="gray">
                Description: {skillInfo.skill.description}
              </Text>
              <Text color="gray">Version: {skillInfo.skill.version}</Text>
              <Text color="gray">Author: {skillInfo.skill.author}</Text>
              <Text color={skillInfo.state === 'initialized' ? 'green' : 'red'}>
                State: {skillInfo.state}
              </Text>
              {skillInfo.error && (
                <Text color="red">Error: {skillInfo.error}</Text>
              )}
            </Box>
          ))
        )}
      </ScrollBox>

      <Box height={2} />
      <Button onClick={() => onMenuChange('skills')} width="100%" color="gray">
        Back to Skills Menu
      </Button>
    </Box>
  );
};

/**
 * 工具列表组件
 */
const ToolsList = ({
  tools,
  onMenuChange,
}: {
  tools: any[];
  onMenuChange: (menu: string) => void;
}) => {
  return (
    <Box flexDirection="column" padding={2} width="100%" height="100%">
      <Text bold color="green">
        Available Tools
      </Text>
      <Box height={1} />

      <ScrollBox width="100%" height="80%">
        {tools.length === 0 ? (
          <Text color="gray">No tools found.</Text>
        ) : (
          tools.map((tool) => (
            <Box key={tool.name} marginBottom={2}>
              <Text bold>{tool.name}</Text>
              <Text color="gray">Description: {tool.description}</Text>
              <Text color="gray">Version: {tool.version || '1.0.0'}</Text>
            </Box>
          ))
        )}
      </ScrollBox>

      <Box height={2} />
      <Button onClick={() => onMenuChange('tools')} width="100%" color="gray">
        Back to Tools Menu
      </Button>
    </Box>
  );
};

/**
 * 启动分析报告组件
 */
const ProfileReport = ({
  onMenuChange,
}: {
  onMenuChange: (menu: string) => void;
}) => {
  return (
    <Box flexDirection="column" padding={2} width="100%" height="100%">
      <Text bold color="green">
        Startup Profile Report
      </Text>
      <Box height={1} />

      <ScrollBox width="100%" height="80%">
        {/* 这里将显示启动分析报告 */}
        <Text color="gray">Loading profile report...</Text>
      </ScrollBox>

      <Box height={2} />
      <Button onClick={() => onMenuChange('main')} width="100%" color="gray">
        Back to Main Menu
      </Button>
    </Box>
  );
};

/**
 * 任务视图组件
 * 从任务注册表加载真实数据，使用 TaskListV2 组件渲染
 */
const TasksView = ({
  onMenuChange,
}: {
  onMenuChange: (menu: string) => void;
}) => {
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
  const [taskCount, setTaskCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTasks = async () => {
      try {
        const { taskRegistry } = await import('@modules/tasks/TaskRegistry');
        const allTasks = taskRegistry.getAllTasks();
        const groups: TaskGroup[] = [];
        const statusOrder = ['running', 'pending', 'completed', 'failed'];

        for (const status of statusOrder) {
          const statusTasks: TaskItem[] = [];
          for (const task of allTasks) {
            const state = task.taskState;
            let mappedStatus: TaskItem['status'] = 'pending';
            if (state.status === 'running') mappedStatus = 'running';
            else if (state.status === 'completed') mappedStatus = 'completed';
            else if (state.status === 'failed') mappedStatus = 'failed';
            else if (state.status === 'killed') mappedStatus = 'cancelled';

            if (
              (status === 'running' && mappedStatus === 'running') ||
              (status === 'pending' && mappedStatus === 'pending') ||
              (status === 'completed' && mappedStatus === 'completed') ||
              (status === 'failed' && (mappedStatus === 'failed' || mappedStatus === 'cancelled'))
            ) {
              const meta = state.metadata || {};
              statusTasks.push({
                id: state.id,
                title: state.description || 'Untitled',
                description: state.error ? `Error: ${state.error}` : undefined,
                status: mappedStatus,
                priority: (meta.priority as TaskItem['priority']) || undefined,
                tags: meta.tags as string[] | undefined,
              });
            }
          }
          if (statusTasks.length > 0) {
            const label =
              status === 'running' ? 'Running' :
              status === 'pending' ? 'Pending' :
              status === 'completed' ? 'Completed' :
              'Failed/Cancelled';
            groups.push({ name: label, tasks: statusTasks });
          }
        }

        setTaskGroups(groups);
        setTaskCount(allTasks.length);
      } catch {
        // 任务注册表可能未初始化
      } finally {
        setLoading(false);
      }
    };
    loadTasks();
  }, []);

  if (loading) {
    return (
      <Box flexDirection="column" padding={2} width="100%" height="100%">
        <Text bold color="green">
          Task Management
        </Text>
        <Box height={1} />
        <Text>Loading tasks...</Text>
        <Box height={2} />
        <Button onClick={() => onMenuChange('main')} width="100%" color="gray">
          Back to Main Menu
        </Button>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={2} width="100%" height="100%">
      <Text bold color="green">
        Task Management {taskCount > 0 ? `(${taskCount} tasks)` : ''}
      </Text>
      <Box height={1} />

      <ScrollBox width="100%" height="80%">
        {taskGroups.length === 0 ? (
          <Text color="gray">No tasks found.</Text>
        ) : (
          <TaskListV2
            groups={taskGroups}
            showProgressBar={false}
            showPriority={true}
            showTags={false}
            expandAll={false}
          />
        )}
      </ScrollBox>

      <Box height={2} />
      <Button onClick={() => onMenuChange('main')} width="100%" color="gray">
        Back to Main Menu
      </Button>
    </Box>
  );
};

/**
 * 主应用组件
 */
const App = () => {
  const [currentMenu, setCurrentMenu] = useState('main');
  const [skills, setSkills] = useState<Map<string, any>>(new Map());
  const [tools, setTools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 使用伙伴系统通知
  useBuddyNotification();

  // 初始化服务
  useEffect(() => {
    const initializeServices = async () => {
      try {
        const skillManager = await getSkillManager();
        await skillManager.initialize();
        setSkills(skillManager.getSkills());

        const toolManager = getToolManager();
        setTools((toolManager as any).getTools());
      } catch (error) {
        logger.error('Error initializing services:', { error });
      } finally {
        setLoading(false);
      }
    };

    initializeServices();
  }, []);

  if (loading) {
    return (
      <Box
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
        height="100%"
      >
        <Text>Loading...</Text>
      </Box>
    );
  }

  const handleMenuChange = (menu: string) => {
    setCurrentMenu(menu);
  };

  const handleSkillExecute = (skillName: string) => {
    // 处理技能执行逻辑
    logger.info('Executing skill:', { skillName });
  };

  return (
    <AlternateScreen>
      <Box height="100%" width="100%" flexDirection="column">
        <Box flexGrow={1}>
          {currentMenu === 'main' && (
            <MainMenu onMenuChange={handleMenuChange} />
          )}
          {currentMenu === 'skills' && (
            <SkillsMenu
              skills={skills}
              onMenuChange={handleMenuChange}
              onSkillExecute={handleSkillExecute}
            />
          )}
          {currentMenu === 'tools' && (
            <ToolsMenu tools={tools} onMenuChange={handleMenuChange} />
          )}
          {currentMenu === 'list_skills' && (
            <SkillsList skills={skills} onMenuChange={handleMenuChange} />
          )}
          {currentMenu === 'list_tools' && (
            <ToolsList tools={tools} onMenuChange={handleMenuChange} />
          )}
          {currentMenu === 'profile' && (
            <ProfileReport onMenuChange={handleMenuChange} />
          )}
          {currentMenu === 'tasks' && (
            <TasksView onMenuChange={handleMenuChange} />
          )}
        </Box>
        <Box>
          <CompanionSprite />
        </Box>
      </Box>
    </AlternateScreen>
  );
};

// 渲染应用
render(<App />);
