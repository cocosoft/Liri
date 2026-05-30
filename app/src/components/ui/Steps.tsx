/**
 * Steps组件 - 步骤指示器
 * 轻量级步骤展示组件，仅用于展示步骤进度，不含交互逻辑
 */

import React from 'react';
import { Text, Box } from '../ink.js';

export type StepStatus = 'pending' | 'active' | 'completed' | 'error';

export interface Step {
  title: string;
  description?: string;
  status?: StepStatus;
}

export interface StepsProps {
  steps: Step[];
  current?: number;
  direction?: 'horizontal' | 'vertical';
  activeColor?: string;
  completedColor?: string;
  errorColor?: string;
}

function getStepIcon(status: StepStatus): string {
  switch (status) {
    case 'completed':
      return '✓';
    case 'active':
      return '●';
    case 'error':
      return '✗';
    default:
      return '○';
  }
}

function getStepColor(
  status: StepStatus,
  activeColor: string,
  completedColor: string,
  errorColor: string
): string {
  switch (status) {
    case 'completed':
      return completedColor;
    case 'active':
      return activeColor;
    case 'error':
      return errorColor;
    default:
      return 'gray';
  }
}

export function Steps({
  steps,
  current = 0,
  direction = 'horizontal',
  activeColor = 'cyan',
  completedColor = 'green',
  errorColor = 'red',
}: StepsProps): React.ReactNode {
  const enrichedSteps: Step[] = steps.map((step, index) => {
    if (step.status) return step;
    if (index < current) return { ...step, status: 'completed' };
    if (index === current) return { ...step, status: 'active' };
    return { ...step, status: 'pending' };
  });

  if (direction === 'vertical') {
    return (
      <Box flexDirection="column">
        {enrichedSteps.map((step, index) => {
          const status = step.status || 'pending';
          const color = getStepColor(
            status,
            activeColor,
            completedColor,
            errorColor
          );
          const icon = getStepIcon(status);
          const isLast = index === enrichedSteps.length - 1;

          return (
            <Box key={index} flexDirection="column">
              <Box alignItems="center">
                <Box flexDirection="column" alignItems="center" width={3}>
                  <Text color={color} bold={status === 'active'}>
                    {icon}
                  </Text>
                  {!isLast && <Text dimColor>│</Text>}
                </Box>
                <Box flexDirection="column" marginLeft={1}>
                  <Text
                    color={color}
                    bold={status === 'active'}
                    dimColor={status === 'pending'}
                  >
                    {step.title}
                  </Text>
                  {step.description && (
                    <Text dimColor size={1}>
                      {step.description}
                    </Text>
                  )}
                </Box>
              </Box>
              {!isLast && <Box width={3} />}
            </Box>
          );
        })}
      </Box>
    );
  }

  return (
    <Box>
      {enrichedSteps.map((step, index) => {
        const status = step.status || 'pending';
        const color = getStepColor(
          status,
          activeColor,
          completedColor,
          errorColor
        );
        const icon = getStepIcon(status);
        const isLast = index === enrichedSteps.length - 1;

        return (
          <Box key={index} alignItems="center">
            <Box marginRight={1}>
              <Text color={color} bold={status === 'active'}>
                {status === 'completed' ? (
                  <Text color={color}>{icon}</Text>
                ) : (
                  <Text color={color}>[{icon}]</Text>
                )}
              </Text>
            </Box>
            <Text
              color={color}
              bold={status === 'active'}
              dimColor={status === 'pending'}
            >
              {step.title}
            </Text>
            {!isLast && <Text dimColor>{' ─ '}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
