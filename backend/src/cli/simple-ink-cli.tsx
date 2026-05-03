#!/usr/bin/env node
// @ts-nocheck

import React, { useState, useEffect } from 'react';
import { Box, Text, Newline, Spacer, render } from '../ink';

/**
 * 主菜单组件
 */
const MainMenu = ({ onMenuChange }: { onMenuChange: (menu: string) => void }) => {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">PY_APP Command Line Interface</Text>
      <Text color="gray">Welcome to PY_APP CLI. Select an option below:</Text>
      <Newline />

      <Text color="cyan" onPress={() => onMenuChange('skills')}>[S] Manage Skills</Text>
      <Newline />

      <Text color="cyan" onPress={() => onMenuChange('tools')}>[T] Manage Tools</Text>
      <Newline />

      <Text color="cyan" onPress={() => onMenuChange('profile')}>[P] View Startup Profile</Text>
      <Newline />

      <Text color="red" onPress={() => process.exit(0)}>[E] Exit</Text>
    </Box>
  );
};

/**
 * 技能菜单组件
 */
const SkillsMenu = ({
  onMenuChange
}: {
  onMenuChange: (menu: string) => void;
}) => {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">Skills Menu</Text>
      <Newline />

      <Text color="cyan" onPress={() => onMenuChange('list_skills')}>[L] List Skills</Text>
      <Newline />

      <Text color="cyan" onPress={() => onMenuChange('main')}>[B] Back to Main Menu</Text>
    </Box>
  );
};

/**
 * 工具菜单组件
 */
const ToolsMenu = ({
  onMenuChange
}: {
  onMenuChange: (menu: string) => void;
}) => {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">Tools Menu</Text>
      <Newline />

      <Text color="cyan" onPress={() => onMenuChange('list_tools')}>[L] List Tools</Text>
      <Newline />

      <Text color="cyan" onPress={() => onMenuChange('main')}>[B] Back to Main Menu</Text>
    </Box>
  );
};

/**
 * 技能列表组件
 */
const SkillsList = ({
  skills,
  onMenuChange
}: {
  skills: Map<string, any>;
  onMenuChange: (menu: string) => void;
}) => {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">Available Skills</Text>
      <Newline />

      {skills.size === 0 ? (
        <Text color="gray">No skills found.</Text>
      ) : (
        Array.from(skills.entries()).map(([name, skillInfo]) => (
          <Box key={name} flexDirection="column" marginBottom={1}>
            <Text bold>{name}</Text>
            <Text color="gray">Description: {skillInfo.skill.description}</Text>
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

      <Newline />
      <Text color="cyan" onPress={() => onMenuChange('skills')}>[B] Back to Skills Menu</Text>
    </Box>
  );
};

/**
 * 工具列表组件
 */
const ToolsList = ({
  tools,
  onMenuChange
}: {
  tools: any[];
  onMenuChange: (menu: string) => void;
}) => {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">Available Tools</Text>
      <Newline />

      {tools.length === 0 ? (
        <Text color="gray">No tools found.</Text>
      ) : (
        tools.map((tool) => (
          <Box key={tool.name} flexDirection="column" marginBottom={1}>
            <Text bold>{tool.name}</Text>
            <Text color="gray">Description: {tool.description}</Text>
            <Text color="gray">Version: {tool.version || '1.0.0'}</Text>
          </Box>
        ))
      )}

      <Newline />
      <Text color="cyan" onPress={() => onMenuChange('tools')}>[B] Back to Tools Menu</Text>
    </Box>
  );
};

/**
 * 启动分析报告组件
 */
const ProfileReport = ({ onMenuChange }: { onMenuChange: (menu: string) => void }) => {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">Startup Profile Report</Text>
      <Newline />

      <Text color="gray">Loading profile report...</Text>

      <Newline />
      <Text color="cyan" onPress={() => onMenuChange('main')}>[B] Back to Main Menu</Text>
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

  // 初始化服务
  useEffect(() => {
    const initializeServices = async () => {
      try {
        const { getSkillManager } = await import('../skills/SkillManager');
        const skillManager = await getSkillManager();
        await skillManager.initialize();
        setSkills(skillManager.getSkills());

        const { getToolManager } = await import('../tools/ToolManager');
        const toolManager = getToolManager();
        setTools(toolManager.getTools());
      } catch (error) {
        console.error('Error initializing services:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeServices();
  }, []);

  if (loading) {
    return (
      <Box flexDirection="column" justifyContent="center" alignItems="center">
        <Text>Loading...</Text>
      </Box>
    );
  }

  const handleMenuChange = (menu: string) => {
    setCurrentMenu(menu);
  };

  return (
    <Box flexDirection="column" width="100%">
      {currentMenu === 'main' && (
        <MainMenu onMenuChange={handleMenuChange} />
      )}
      {currentMenu === 'skills' && (
        <SkillsMenu
          onMenuChange={handleMenuChange}
        />
      )}
      {currentMenu === 'tools' && (
        <ToolsMenu
          onMenuChange={handleMenuChange}
        />
      )}
      {currentMenu === 'list_skills' && (
        <SkillsList
          skills={skills}
          onMenuChange={handleMenuChange}
        />
      )}
      {currentMenu === 'list_tools' && (
        <ToolsList
          tools={tools}
          onMenuChange={handleMenuChange}
        />
      )}
      {currentMenu === 'profile' && (
        <ProfileReport onMenuChange={handleMenuChange}
        />
      )}
    </Box>
  );
};

// 渲染应用
render(<App />);