export function sendNotification(title: string, body: string): void {
  if (!("Notification" in window)) {
    return;
  }

  if (Notification.permission === "granted") {
    new Notification(title, { body });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission()
      .then((permission) => {
        if (permission === "granted") {
          new Notification(title, { body });
        }
      })
      .catch(() => {
        /* 浏览器拒绝或 API 不可用，静默忽略 */
      });
  }
}
