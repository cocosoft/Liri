/**
 * Onboarding组件 - 新用户引导
 * 提供3-5步的新用户引导流程
 */

import React, { useState } from 'react';
import { Text, Box } from 'ink';

export interface OnboardingStep {
  /** 步骤标题 */
  title: string;
  /** 步骤说明 */
  description: string;
  /** 步骤图标 */
  icon?: string;
  /** 高亮色 */
  color?: string;
}

export interface OnboardingProps {
  /** 引导步骤 */
  steps?: OnboardingStep[];
  /** 是否可见 */
  visible?: boolean;
  /** 完成回调 */
  onComplete?: () => void;
  /** 跳过回调 */
  onSkip?: () => void;
  /** 标题 */
  title?: string;
  /** 标题颜色 */
  titleColor?: string;
}

const defaultSteps: OnboardingStep[] = [
  {
    title: '连接 AI 模型',
    description: '配置 API Key 并选择您偏好的 AI 模型提供商',
    icon: '🔗',
    color: 'cyan',
  },
  {
    title: '探索工作区',
    description: '使用 /help 查看所有可用命令和快捷操作',
    icon: '🔍',
    color: 'yellow',
  },
  {
    title: '创建第一个任务',
    description: '输入自然语言描述，让 AI 助手帮您完成任务',
    icon: '📋',
    color: 'green',
  },
  {
    title: '管理技能与插件',
    description: '通过 /skills 和 /plugins 管理您的扩展能力',
    icon: '🧩',
    color: 'magenta',
  },
  {
    title: '查看统计分析',
    description: '使用 /stats 查看您的使用数据和成本分析',
    icon: '📊',
    color: 'blue',
  },
];

export function Onboarding({
  steps = defaultSteps,
  visible = true,
  onComplete,
  onSkip,
  title = '欢迎使用 PY_APP!',
  titleColor = 'cyan',
}: OnboardingProps): React.ReactNode {
  const [currentStep, setCurrentStep] = useState(0);
  const [completed, setCompleted] = useState(false);

  if (!visible) return null;

  if (completed) {
    return (
      <Box flexDirection="column" alignItems="center" paddingY={1}>
        <Text bold color="green">
          {'✓ 引导完成!'}
        </Text>
        <Text color="gray" dim>
          输入 /help 查看所有可用命令
        </Text>
      </Box>
    );
  }

  const step = steps[currentStep];
  const progress = ((currentStep + 1) / steps.length) * 100;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} width={60}>
      <Box marginBottom={1}>
        <Text bold color={titleColor}>
          {title}
        </Text>
      </Box>

      <Box marginBottom={1}>
        {steps.map((_, idx) => (
          <Box key={idx} marginRight={1}>
            <Text
              color={
                idx === currentStep
                  ? 'cyan'
                  : idx < currentStep
                  ? 'green'
                  : 'gray'
              }
            >
              {idx <= currentStep ? '●' : '○'}
            </Text>
          </Box>
        ))}
      </Box>

      <Box marginBottom={1}>
        {step.icon && <Text marginRight={1}>{step.icon}</Text>}
        <Text bold>
          {'步骤 '}{currentStep + 1}{'/'}{steps.length}{': '}{step.title}
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray" dim>
          {step.description}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dim>
          {'[Enter] 继续'}
        </Text>
        {currentStep < steps.length - 1 && (
          <>
            <Text> </Text>
            <Text color="gray" dim>
              {'[Space] 跳过'}
            </Text>
          </>
        )}
        <Text> </Text>
        <Text color="gray" dim>
          {'[Esc] 退出引导'}
        </Text>
      </Box>
    </Box>
  );
}
