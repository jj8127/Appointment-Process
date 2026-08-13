type LegacyPushSubscription = {
  unsubscribe: () => Promise<boolean>;
};

type LegacyNotification = {
  close: () => void;
};

type LegacyServiceWorkerRegistration = {
  pushManager?: {
    getSubscription: () => Promise<LegacyPushSubscription | null>;
  };
  getNotifications: () => Promise<LegacyNotification[]>;
};

export type SystemNotificationRetirementDependencies = {
  deleteServerRegistration: () => Promise<unknown>;
  getRegistrations: () => Promise<readonly LegacyServiceWorkerRegistration[]>;
};

export async function retireSystemNotificationsWith(
  dependencies: SystemNotificationRetirementDependencies,
): Promise<void> {
  await dependencies.deleteServerRegistration().catch(() => undefined);

  const registrations = await dependencies.getRegistrations().catch(() => []);
  await Promise.all(registrations.map(async (registration) => {
    const subscription = await registration.pushManager
      ?.getSubscription()
      .catch(() => null);
    await subscription?.unsubscribe().catch(() => false);

    const notifications = await registration.getNotifications().catch(() => []);
    notifications.forEach((notification) => notification.close());
  }));
}

export async function retireBrowserSystemNotifications(): Promise<void> {
  await retireSystemNotificationsWith({
    deleteServerRegistration: () => fetch('/api/web-push/subscribe', {
      method: 'DELETE',
      credentials: 'same-origin',
    }),
    getRegistrations: () => 'serviceWorker' in navigator
      ? navigator.serviceWorker.getRegistrations()
      : Promise.resolve([]),
  });
}
