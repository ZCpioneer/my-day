import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { debugLog } from "./debug/log";
import { noopNotifier, type Notifier, type ReminderSpec } from "./notify";

function debugNotify(detail: string) {
  debugLog.push({ event: "notify", detail });
}

// LocalNotifications 的薄封装：任何失败（含用户拒绝权限）只记 debug，绝不抛异常、不打扰用户。
const capacitorNotifier: Notifier = {
  async requestPermission() {
    try {
      const cur = await LocalNotifications.checkPermissions();
      if (cur.display === "granted") return true;
      const res = await LocalNotifications.requestPermissions();
      if (res.display !== "granted") {
        debugNotify("通知权限被拒绝，本次不挂提醒");
        return false;
      }
      return true;
    } catch (e) {
      debugNotify(`通知权限请求失败：${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  },
  async cancelAll() {
    try {
      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length > 0) await LocalNotifications.cancel(pending);
    } catch (e) {
      debugNotify(`清空通知失败：${e instanceof Error ? e.message : String(e)}`);
    }
  },
  async schedule(reminders: ReminderSpec[]) {
    try {
      await LocalNotifications.schedule({
        notifications: reminders.map((r) => ({
          id: r.id,
          title: r.title,
          body: r.body,
          extra: { open: "todo" },
          schedule: { at: r.at },
        })),
      });
    } catch (e) {
      debugNotify(`挂通知失败：${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

/** 点开本地通知时切到待办页。非原生 no-op。 */
export function listenNotificationOpen(onOpen: () => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};
  let removed = false;
  const pending = LocalNotifications.addListener("localNotificationActionPerformed", () => {
    onOpen();
  });
  return () => {
    if (removed) return;
    removed = true;
    void pending.then((h) => h.remove());
  };
}

/** 按平台选实现：原生走 Capacitor 本地通知，web/测试直接 no-op。 */
export function createNotifier(): Notifier {
  return Capacitor.isNativePlatform() ? capacitorNotifier : noopNotifier;
}
