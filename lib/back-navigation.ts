import type { Href } from 'expo-router';

type RouterLike = {
  back: () => void;
  replace: (href: Href) => void;
  canGoBack?: () => boolean;
};

export function goBackOrReplace(router: RouterLike, fallbackHref: Href) {
  if (router.canGoBack?.()) {
    router.back();
    return;
  }

  router.replace(fallbackHref);
}
