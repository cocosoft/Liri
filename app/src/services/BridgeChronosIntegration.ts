import { PushNotificationService } from '../chronos/ChronosRemoteTrigger';

export interface BridgeChronosIntegration {
  notifyBridgeSessionStart(sessionId: string): Promise<boolean>;
  notifyBridgeSessionEnd(sessionId: string): Promise<boolean>;
  notifyTaskScheduled(
    sessionId: string,
    taskName: string,
    scheduledTime: Date
  ): Promise<boolean>;
  notifyTaskCompleted(
    sessionId: string,
    taskName: string,
    result: 'success' | 'failure'
  ): Promise<boolean>;
}

export function createBridgeChronosHook(): BridgeChronosIntegration {
  const notifier = new PushNotificationService();

  return {
    async notifyBridgeSessionStart(sessionId: string): Promise<boolean> {
      return notifier.sendNotification({
        title: 'Bridge Session Started',
        body: `A new bridge session has been created: ${sessionId}`,
        urgency: 'normal',
      });
    },

    async notifyBridgeSessionEnd(sessionId: string): Promise<boolean> {
      return notifier.sendNotification({
        title: 'Bridge Session Ended',
        body: `Bridge session ${sessionId} has ended.`,
        urgency: 'low',
      });
    },

    async notifyTaskScheduled(
      sessionId: string,
      taskName: string,
      scheduledTime: Date
    ): Promise<boolean> {
      return notifier.sendNotification({
        title: 'Chronos Task Scheduled',
        body: `Task "${taskName}" scheduled at ${scheduledTime.toLocaleString()} for session ${sessionId}`,
        urgency: 'normal',
      });
    },

    async notifyTaskCompleted(
      sessionId: string,
      taskName: string,
      result: 'success' | 'failure'
    ): Promise<boolean> {
      return notifier.notifyTaskComplete(taskName, result);
    },
  };
}
