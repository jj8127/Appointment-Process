export type PendingAdminFileWindow = {
  closed?: boolean;
  opener: unknown;
  close: () => void;
  location: {
    assign: (url: string) => void;
  };
};

export type OpenPendingAdminFileWindow = (
  url?: string,
  target?: string,
  features?: string,
) => PendingAdminFileWindow | null;

export function openPendingAdminFileWindow(openWindow: OpenPendingAdminFileWindow): PendingAdminFileWindow | null {
  const popup = openWindow('', '_blank');
  if (popup) {
    try {
      popup.opener = null;
    } catch {
      // Some browsers reject opener writes; keeping the user-opened window is still the reliable path.
    }
  }
  return popup;
}

export function navigatePendingAdminFileWindow(popup: PendingAdminFileWindow, signedUrl: string) {
  popup.location.assign(signedUrl);
}

export function closePendingAdminFileWindow(popup: PendingAdminFileWindow | null) {
  if (popup && !popup.closed) {
    popup.close();
  }
}
