/**
 * Wizard组件 - 步骤向导
 */

import React from 'react';
import { Text, Box } from '../ink.js';

export interface WizardStep {
  id: string;
  title: string;
  description?: string;
  status?: 'pending' | 'active' | 'completed' | 'error' | 'skipped';
}

export interface WizardProps {
  steps: WizardStep[];
  currentStep: string;
  activeColor?: string;
  completedColor?: string;
  pendingColor?: string;
  errorColor?: string;
  errorMessage?: string;
  showStepNumbers?: boolean;
  direction?: 'horizontal' | 'vertical';
}

function getStepIcon(
  step: WizardStep,
  index: number,
  showStepNumbers: boolean
): string {
  switch (step.status) {
    case 'completed':
      return '✓';
    case 'active':
      return '→';
    case 'error':
      return '✗';
    case 'skipped':
      return '·';
    default:
      return showStepNumbers ? String(index + 1) : ' ';
  }
}

function getStepColor(
  step: WizardStep,
  activeColor: string,
  completedColor: string,
  pendingColor: string,
  errorColor: string
): string {
  switch (step.status) {
    case 'completed':
      return completedColor;
    case 'active':
      return activeColor;
    case 'error':
      return errorColor;
    case 'skipped':
      return 'dim';
    default:
      return pendingColor;
  }
}

function renderStepLine(
  stepIndex: number,
  steps: WizardStep[],
  completedColor: string,
  _pendingColor: string
): React.ReactNode {
  if (stepIndex >= steps.length - 1) return null;

  const isCompleted = steps[stepIndex].status === 'completed';

  return (
    <Text
      dimColor={!isCompleted}
      color={isCompleted ? completedColor : undefined}
    >
      {' ─ '}
    </Text>
  );
}

function HorizontalStepIndicator({
  steps,
  activeColor,
  completedColor,
  pendingColor,
  errorColor,
  showStepNumbers,
}: WizardProps): React.ReactNode {
  return (
    <Box>
      {steps.map((step, index) => {
        const color = getStepColor(
          step,
          activeColor || 'cyan',
          completedColor || 'green',
          pendingColor || 'gray',
          errorColor || 'red'
        );
        const icon = getStepIcon(step, index, showStepNumbers ?? true);

        return (
          <Box key={step.id} alignItems="center">
            <Box marginRight={1}>
              <Text color={color} bold={step.status === 'active'}>
                {step.status === 'completed' ? (
                  <Text color={color}>{icon}</Text>
                ) : (
                  <Text color={color}>[{icon}]</Text>
                )}
              </Text>
            </Box>
            <Text
              color={color}
              bold={step.status === 'active'}
              dimColor={step.status === 'pending' || step.status === 'skipped'}
            >
              {step.title}
            </Text>
            {step.description && step.status === 'active' && (
              <Text dimColor> - {step.description}</Text>
            )}
            {renderStepLine(
              index,
              steps,
              completedColor || 'green',
              pendingColor || 'gray'
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function VerticalStepIndicator({
  steps,
  activeColor,
  completedColor,
  pendingColor,
  errorColor,
  showStepNumbers,
  errorMessage,
}: WizardProps): React.ReactNode {
  return (
    <Box flexDirection="column">
      {steps.map((step, index) => {
        const color = getStepColor(
          step,
          activeColor || 'cyan',
          completedColor || 'green',
          pendingColor || 'gray',
          errorColor || 'red'
        );
        const icon = getStepIcon(step, index, showStepNumbers ?? true);
        const isLast = index === steps.length - 1;

        return (
          <Box key={step.id} flexDirection="column">
            <Box alignItems="center">
              <Box flexDirection="column" alignItems="center" width={4}>
                <Text color={color} bold={step.status === 'active'}>
                  {step.status === 'completed' ? (
                    <Text color={color}>{icon}</Text>
                  ) : (
                    <Text color={color}>[{icon}]</Text>
                  )}
                </Text>
                {!isLast && <Text dimColor>│</Text>}
              </Box>
              <Box flexDirection="column" marginLeft={1}>
                <Text
                  color={color}
                  bold={step.status === 'active'}
                  dimColor={
                    step.status === 'pending' || step.status === 'skipped'
                  }
                >
                  {step.title}
                </Text>
                {step.description && (
                  <Text dimColor size={1}>
                    {step.description}
                  </Text>
                )}
                {step.status === 'error' && errorMessage && (
                  <Text color="red" dimColor>
                    {errorMessage}
                  </Text>
                )}
              </Box>
            </Box>
            {!isLast && <Box width={4} />}
          </Box>
        );
      })}
    </Box>
  );
}

export function Wizard(props: WizardProps): React.ReactNode {
  const { steps, currentStep, direction = 'horizontal' } = props;

  // Infer step statuses from currentStep if not explicitly set
  const inferredSteps = steps.map((step) => {
    if (step.status) return step;
    const stepIndex = steps.findIndex((s) => s.id === currentStep);
    const currentIndex = steps.findIndex((s) => s.id === step.id);
    if (currentIndex < stepIndex) {
      return { ...step, status: 'completed' as const };
    }
    if (currentIndex === stepIndex) {
      return { ...step, status: 'active' as const };
    }
    return { ...step, status: 'pending' as const };
  });

  const wizardProps = { ...props, steps: inferredSteps };

  if (direction === 'vertical') {
    return <VerticalStepIndicator {...wizardProps} />;
  }

  return <HorizontalStepIndicator {...wizardProps} />;
}
