import type { Href } from 'expo-router';

type RouterLike = {
  back: () => void;
  replace: (href: Href) => void;
  canGoBack?: () => boolean;
};

type StackRouterLike = RouterLike & {
  dismissAll?: () => void;
  canDismiss?: () => boolean;
  dismissTo?: (href: Href) => void;
};

export function goBackOrReplace(router: RouterLike, fallbackHref: Href) {
  if (router.canGoBack?.()) {
    router.back();
    return;
  }

  router.replace(fallbackHref);
}

/**
 * Clears the history before opening href: logout, an expired session and the service hub root.
 * A plain replace would leave the earlier screens underneath, so back would walk through them again.
 */
export function resetTo(router: StackRouterLike, href: Href) {
  if (router.canDismiss?.()) router.dismissAll?.();
  router.replace(href);
}

/**
 * Opens a parent screen (home, request board home) by going back to it when it is already in the
 * history, instead of stacking a second copy; otherwise the current screen is replaced as before.
 */
export function returnTo(router: StackRouterLike, href: Href) {
  if (router.dismissTo) {
    router.dismissTo(href);
    return;
  }
  router.replace(href);
}
