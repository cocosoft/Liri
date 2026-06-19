/**
 * 反馈收集组件
 * 用于收集用户反馈
 */

import React, { useState } from 'react';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('Feedback');

export interface FeedbackProps {
  onSubmit?: (feedback: FeedbackData) => Promise<void>;
  onCancel?: () => void;
  visible?: boolean;
}

export interface FeedbackData {
  type: 'bug' | 'feature' | 'general';
  rating: number;
  message: string;
  email?: string;
  timestamp: Date;
}

export const Feedback: React.FC<FeedbackProps> = ({
  onSubmit,
  onCancel,
  visible = true,
}) => {
  const [type, setType] = useState<FeedbackData['type']>('general');
  const [rating, setRating] = useState(5);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!visible) return null;

  const handleSubmit = async () => {
    if (!message.trim()) return;

    setSubmitting(true);
    try {
      const feedback: FeedbackData = {
        type,
        rating,
        message: message.trim(),
        email: email.trim() || undefined,
        timestamp: new Date(),
      };

      if (onSubmit) {
        await onSubmit(feedback);
      }

      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setMessage('');
        setEmail('');
        setRating(5);
        setType('general');
      }, 2000);
    } catch (error) {
      logger.error('提交反馈失败', { error: String(error) });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="feedback-success">
        <div className="success-icon">✓</div>
        <div className="success-message">感谢您的反馈！</div>
      </div>
    );
  }

  return (
    <div className="feedback-container">
      <div className="feedback-header">
        <h3>提交反馈</h3>
        <button className="close-button" onClick={onCancel}>
          ×
        </button>
      </div>

      <div className="feedback-body">
        <div className="feedback-type">
          <label>反馈类型</label>
          <div className="type-options">
            <button
              className={`type-btn ${type === 'bug' ? 'active' : ''}`}
              onClick={() => setType('bug')}
            >
              🐛 Bug
            </button>
            <button
              className={`type-btn ${type === 'feature' ? 'active' : ''}`}
              onClick={() => setType('feature')}
            >
              💡 功能建议
            </button>
            <button
              className={`type-btn ${type === 'general' ? 'active' : ''}`}
              onClick={() => setType('general')}
            >
              💬 一般反馈
            </button>
          </div>
        </div>

        <div className="feedback-rating">
          <label>评分</label>
          <div className="rating-stars">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                className={`star-btn ${star <= rating ? 'active' : ''}`}
                onClick={() => setRating(star)}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        <div className="feedback-message">
          <label>反馈内容</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="请描述您的问题或建议..."
            rows={4}
          />
        </div>

        <div className="feedback-email">
          <label>邮箱（可选）</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
          />
        </div>
      </div>

      <div className="feedback-footer">
        <button
          className="submit-btn"
          onClick={handleSubmit}
          disabled={!message.trim() || submitting}
        >
          {submitting ? '提交中...' : '提交反馈'}
        </button>
        <button className="cancel-btn" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
};

/**
 * 创建反馈组件
 */
export function createFeedback(
  props?: Partial<FeedbackProps>
): React.ReactElement {
  return <Feedback {...props} />;
}
