//
/**
 * 退出确认流程组件
 * 处理应用退出确认
 */

import React, { useState, useEffect } from 'react';

export interface ExitFlowProps {
  visible?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  hasUnsavedChanges?: boolean;
  saveChanges?: () => Promise<void>;
}

export const ExitFlow: React.FC<ExitFlowProps> = ({
  visible = true,
  onConfirm,
  onCancel,
  hasUnsavedChanges = false,
  saveChanges,
}) => {
  const [step, setStep] = useState<'confirm' | 'saving' | 'done'>('confirm');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setStep('confirm');
      setError(null);
    }
  }, [visible]);

  if (!visible) return null;

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
    if (onCancel) onCancel();
  };

  if (step === 'saving') {
    return (
      <div className="exit-flow-overlay">
        <div className="exit-flow-dialog">
          <div className="exit-flow-saving">
            <div className="spinner"></div>
            <div className="saving-text">正在保存更改...</div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="exit-flow-overlay">
        <div className="exit-flow-dialog">
          <div className="exit-flow-done">
            <div className="done-icon">✓</div>
            <div className="done-text">再见！</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="exit-flow-overlay">
      <div className="exit-flow-dialog">
        <div className="exit-flow-header">
          <h3>确认退出</h3>
        </div>

        <div className="exit-flow-body">
          {hasUnsavedChanges ? (
            <div className="unsaved-warning">
              <div className="warning-icon">⚠️</div>
              <div className="warning-text">
                您有未保存的更改。是否在退出前保存？
              </div>
            </div>
          ) : (
            <div className="exit-message">
              确定要退出应用吗？
            </div>
          )}

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
        </div>

        <div className="exit-flow-footer">
          {hasUnsavedChanges && (
            <button className="save-exit-btn" onClick={handleSaveAndExit}>
              保存并退出
            </button>
          )}
          <button className="exit-btn" onClick={handleExit}>
            {hasUnsavedChanges ? '不保存退出' : '退出'}
          </button>
          <button className="cancel-btn" onClick={handleCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * 创建退出流程组件
 */
export function createExitFlow(props?: Partial<ExitFlowProps>): React.ReactElement {
  return <ExitFlow {...props} />;
}

/**
 * 退出确认Hook
 */
export function useExitConfirmation(
  hasUnsavedChanges: boolean,
  onExit: () => void,
  onSave?: () => Promise<void>
) {
  const [showExitDialog, setShowExitDialog] = useState(false);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const requestExit = () => {
    if (hasUnsavedChanges) {
      setShowExitDialog(true);
    } else {
      onExit();
    }
  };

  const confirmExit = () => {
    setShowExitDialog(false);
    onExit();
  };

  const saveAndExit = async () => {
    if (onSave) {
      await onSave();
    }
    setShowExitDialog(false);
    onExit();
  };

  const cancelExit = () => {
    setShowExitDialog(false);
  };

  return {
    showExitDialog,
    requestExit,
    confirmExit,
    saveAndExit,
    cancelExit,
  };
}