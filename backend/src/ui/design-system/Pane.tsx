/**
 * 面板组件（基于CC源码）
 * 提供面板容器功能，支持边框、颜色、布局等
 */

import React from 'react';
import { Box } from '../../ink';
import { PaneProps } from '../types/UITypes';
import { useTheme } from './ThemeProvider';
import { Divider } from './Divider';

/**
 * 面板组件（基于CC源码）
 * 
 * 面板是一个终端区域，出现在REPL提示下方，
 * 由彩色顶部边框线界定，上方有一行间隙和水平内边距。
 * 用于所有斜杠命令屏幕：/config、/help、/plugins、/sandbox、/stats、/permissions。
 * 
 * 对于确认/取消对话框（Esc取消，Enter确认），使用<Dialog>代替 - 它注册自己的按键绑定。
 * 对于完整的圆角边框卡片，使用<Panel>。
 * 
 * 在面板内渲染的子菜单应在Dialog上使用hideBorder，
 * 以便面板的边框保持单一框架。
 * 
 * @example
 * <Pane color="permission">
 *   <Tabs title="Sandbox:">...</Tabs>
 * </Pane>
 */
export function Pane({
  children,
  color = 'border',
  padding = 1,
  margin = 0,
  flexDirection = 'column',
  alignItems = 'flex-start',
  justifyContent = 'flex-start'
}: PaneProps) {
  const { theme } = useTheme();

  return (
    <Box
      flexDirection="column"
      marginTop={margin}
      marginBottom={margin}
    >
      {/* 顶部边框线（基于CC源码） */}
      <Divider color={color} orientation="horizontal" thickness={1} />
      
      {/* 内容区域（基于CC源码） */}
      <Box
        flexDirection={flexDirection}
        alignItems={alignItems}
        justifyContent={justifyContent}
        padding={padding}
        paddingTop={padding + 1} // 顶部额外间距
      >
        {children}
      </Box>
    </Box>
  );
}

/**
 * 卡片面板组件（基于CC源码）
 * 提供圆角边框的卡片样式
 */
export function CardPane({
  children,
  color = 'border',
  padding = 2,
  margin = 1
}: PaneProps) {
  const { theme } = useTheme();

  return (
    <Box
      borderStyle="round"
      borderColor={theme.colors[color]}
      padding={padding}
      margin={margin}
      flexDirection="column"
    >
      {children}
    </Box>
  );
}

/**
 * 侧边栏面板组件（基于CC源码）
 * 提供侧边栏样式的面板
 */
export function SidebarPane({
  children,
  color = 'border',
  width = 30,
  padding = 1
}: PaneProps & { width?: number }) {
  const { theme } = useTheme();

  return (
    <Box
      width={width}
      borderStyle="single"
      borderColor={theme.colors[color]}
      padding={padding}
      flexDirection="column"
      borderRight={true}
    >
      {children}
    </Box>
  );
}

/**
 * 内容面板组件（基于CC源码）
 * 提供主要内容区域的面板
 */
export function ContentPane({
  children,
  color = 'border',
  padding = 2,
  flexGrow = 1
}: PaneProps & { flexGrow?: number }) {
  const { theme } = useTheme();

  return (
    <Box
      flexGrow={flexGrow}
      padding={padding}
      flexDirection="column"
    >
      {children}
    </Box>
  );
}

export default Pane;