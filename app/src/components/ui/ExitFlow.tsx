/**
 * ExitFlow组件 - 退出确认流程 (Ink兼容版)
 */

import React, { useState, useEffect } from 'react';
import { Text, Box, useInput } from '../ink.js';
import { Spinner } from './Spinner.js';

type ExitStep = 'confirm' | 'saving' | 'done';

export interface ExitFlowProps {
  visible?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  hasUnsavedChanges?: boolean;
  saveChanges?: () => Promise<void>;
}

export function ExitFlow({
  visible = true,
  onConfirm,
  onCancel,
  hasUnsavedChanges = false,
  saveChanges,
}: ExitFlowProps): React.ReactNode {
  const [step, setStep] = useState<ExitStep>('confirm');
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setStep('confirm');
      setError(null);
      setAnswer(null);
    }
  }, [visible]);

  useInput((input, key) => {
    if (!visible || step !== 'confirm') return;

    if (key.return) {
      if (answer === 'y' || answer === 'Y') {
        if (hasUnsavedChanges && saveChanges) {
          handleSaveAndExit();
        } else {
          handleExit();
        }
      } else if (answer === 'n' || answer === 'N') {
        handleExit();
      } else {
        handleCancel();
      }
    } else if (input === 'y' || input === 'Y') {
      setAnswer('y');
    } else if (input === 'n' || input === 'N') {
      setAnswer('n');
    } else if (key.escape) {
      handleCancel();
    }
  });

  const handleSaveAndExit = async () => {
    if (!saveChanges) {
      handleExit();
      return;
    }

    setStep('saving');
    setError(null);

    try {
      await saveChanges();
      setStep('done');
      setTimeout(() => {
        if (onConfirm) onConfirm();
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      setStep('confirm');
      setAnswer(null);
    }
  };

  const handleExit = () => {
    setStep('done');
    setTimeout(() => {
      if (onConfirm) onConfirm();
    }, 300);
  };

  const handleCancel = () => {
    setStep('confirm');
    setError(null);
    setAnswer(null);
    if (onCancel) onCancel();
  };

  if (!visible) return null;

  if (step === 'saving') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box>
          <Spinner type="dots" color="yellow" />
          <Text color="yellow"> 正在保存更改...</Text>
        </Box>
      </Box>
    );
  }

  if (step === 'done') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box>
          <Text color="green">✓ 再见！</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box flexDirection="column">
        <Text bold color="yellow">
          确认退出
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {hasUnsavedChanges ? (
          <Box flexDirection="row">
            <Text>⚠️ </Text>
            <Text>您有未保存的更改。是否在退出前保存？</Text>
          </Box>
        ) : (
          <Text>确定要退出应用吗？</Text>
        )}

        {error && <Text color="red">{error}</Text>}
      </Box>

      <Box flexDirection="row" marginTop={1}>
        {hasUnsavedChanges && (
          <>
            <Text bold color={answer === 'y' ? 'green' : 'white'}>
              {' [Y]'}保存并退出
            </Text>
            <Text> </Text>
          </>
        )}
        <Text bold color={answer === 'n' ? 'green' : 'white'}>
          {'[N]'}不保存退出
        </Text>
        <Text> </Text>
        <Text bold color={answer === null ? 'green' : 'white'}>
          {'[Esc]'}取消
        </Text>
      </Box>
    </Box>
  );
}

export function createExitFlow(
  props?: Partial<ExitFlowProps>
): React.ReactNode {
  return <ExitFlow {...props} />;
}
