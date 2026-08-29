#!/usr/bin/env node
//

import React, { useState, useEffect } from 'react';
import { Box, Text, Newline, Spacer, render } from '../ink';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('cli:simple-ink-cli.tsx');

/**
 * 主菜单组件
 */
const MainMenu = ({
  onMenuChange,
}: {
  onMenuChange: (menu: string) => void;
}) => {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">
        Liri Command Line Interface
      </Text>
      <Text color="gray">Welcome to Liri CLI. Select an option below:</Text>
      <Newline />

      <Text color="cyan" onPress={() => onMenuChange('skills')}>
        [S] Manage Skills
      </Text>
      <Newline />

      <Text color="cyan" onPress={() => onMenuChange('tools')}>
        [T] Manage Tools
      </Text>
      <Newline />

      <Text color="cyan" onPress={() => onMenuChange('profile')}>
        [P] View Startup Profile
      </Text>
      <Newline />

      <Text color="red" onPress={() => process.exit(0)}>
        [E] Exit
      </Text>
    </Box>
  );
};

/**
 * 技能菜单组件
 */
const SkillsMenu = ({
  onMenuChange,
}: {
  onMenuChange: (menu: string) => void;
}) => {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">
        Skills Menu
      </Text>
      <Newline />

      <Text color="cyan" onPress={() => onMenuChange('list_skills')}>
        [L] List Skills
      </Text>
      <Newline />

      <Text color="cyan" onPress={() => onMenuChange('main')}>
        [B] Back to Main Menu
      </Text>
    </Box>
  );
};

/**
 * 工具菜单组件
 */
const ToolsMenu = ({
  onMenuChange,
}: {
  onMenuChange: (menu: string) => void;
}) => {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">
        Tools Menu
      </Text>
      <Newline />

      <Text color="cyan" onPress={() => onMenuChange('list_tools')}>
        [L] List Tools
      </Text>
      <Newline />

      <Text color="cyan" onPress={() => onMenuChange('main')}>
        [B] Back to Main Menu
      </Text>
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
  skills: import('@modules/skills/types').Skill[];
  onMenuChange: (menu: string) => void;
}) => {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">
        Available Skills
      </Text>
      <Newline />

      {skills.length === 0 ? (
        <Text color="gray">No skills found.</Text>
      ) : (
        skills.map((skill) => (
          <Box key={skill.name} flexDirection="column" marginBottom={1}>
            <Text bold>{skill.name}</Text>
            <Text color="gray">Description: {skill.description}</Text>
            <Text color="gray">Version: {skill.version || 'N/A'}</Text>
            <Text color="gray">Source: {skill.source}</Text>
            <Text color={skill.impl.kind === 'executable' ? 'green' : 'yellow'}>
              Kind: {skill.impl.kind === 'executable' ? 'Executable' : 'Prompt'}
            </Text>
          </Box>
        ))
      )}

      <Newline />
      <Text color="cyan" onPress={() => onMenuChange('skills')}>
        [B] Back to Skills Menu
      </Text>
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
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">
        Available Tools
      </Text>
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
      <Text color="cyan" onPress={() => onMenuChange('tools')}>
        [B] Back to Tools Menu
      </Text>
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
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">
        Startup Profile Report
      </Text>
      <Newline />

      <Text color="gray">Loading profile report...</Text>

      <Newline />
      <Text color="cyan" onPress={() => onMenuChange('main')}>
        [B] Back to Main Menu
      </Text>
    </Box>
  );
};

/**
 * 主应用组件
 */
const App = () => {
  const [currentMenu, setCurrentMenu] = useState('main');
  const [skills, setSkills] = useState<import('@modules/skills/types').Skill[]>(
    []
  );
  const [tools, setTools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 初始化服务
  useEffect(() => {
    const initializeServices = async () => {
      try {
        const { SkillRegistry } = await import('../skills/SkillRegistry');
        const { BundledSkillLoader } =
          await import('../skills/loaders/sources/BundledSkillLoader');
        const registry = new SkillRegistry();
        const loader = new BundledSkillLoader();
        const loadedSkills = await loader.loadSkills();
        registry.registerBatch(loadedSkills);
        setSkills(registry.getAll());

        const { getToolManager } = await import('@modules/tools');
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
      {currentMenu === 'main' && <MainMenu onMenuChange={handleMenuChange} />}
      {currentMenu === 'skills' && (
        <SkillsMenu onMenuChange={handleMenuChange} />
      )}
      {currentMenu === 'tools' && <ToolsMenu onMenuChange={handleMenuChange} />}
      {currentMenu === 'list_skills' && (
        <SkillsList skills={skills} onMenuChange={handleMenuChange} />
      )}
      {currentMenu === 'list_tools' && (
        <ToolsList tools={tools} onMenuChange={handleMenuChange} />
      )}
      {currentMenu === 'profile' && (
        <ProfileReport onMenuChange={handleMenuChange} />
      )}
    </Box>
  );
};

// 渲染应用
render(<App />);
