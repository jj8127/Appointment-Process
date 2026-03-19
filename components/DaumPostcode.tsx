import type { JSOptions, OnCompleteParams } from '@actbase/react-daum-postcode/lib/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import WebView, {
  type WebViewErrorEvent,
  type WebViewHttpErrorEvent,
  type WebViewNavigation,
  type WebViewMessageEvent,
  type WebViewNavigationEvent,
  type WebViewOpenWindowEvent,
} from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { shouldStayInDaumPostcodeWebView } from '@/lib/daum-postcode';
import { logger } from '@/lib/logger';

const DEFAULT_JS_OPTIONS: JSOptions = {
  hideMapBtn: true,
};

const DAUM_POSTCODE_HTML = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width,initial-scale=1.0,minimum-scale=1.0,maximum-scale=1.0,user-scalable=no"
  >
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; padding: 0; background-color: #ececec; }
  </style>
</head>
<body>
  <div id="layer" style="width:100%; min-height:100%;"></div>
  <script type="text/javascript">
    function callback() {
      var elementLayer = document.getElementById('layer');
      elementLayer.innerHTML = '';
      new daum.Postcode({
        ...window.options,
        onsearch: function () {
          window.scrollTo(0, 0);
        },
        oncomplete: function (data) {
          window.ReactNativeWebView.postMessage(JSON.stringify(data));
        },
        onresize: function (size) {
          document.getElementById('layer').style.height = size.height + 'px';
        },
        onclose: function () {
          callback();
        },
        width: '100%',
        height: '100%',
      }).embed(elementLayer);
    }
    function initOnReady(options) {
      window.options = options;
      var script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      script.onreadystatechange = callback;
      script.onload = callback;
      var firstScript = document.getElementsByTagName('script')[0];
      firstScript.parentNode.insertBefore(script, firstScript);
    }
  </script>
</body>
</html>
`;

const WEBVIEW_WINDOW_PATCH = `
(function () {
  var DEBUG_PREFIX = '__postcode_debug__:';
  var debug = function (type, payload) {
    try {
      window.ReactNativeWebView.postMessage(
        DEBUG_PREFIX + JSON.stringify({
          type: type,
          payload: payload || null,
          href: window.location.href
        })
      );
    } catch (error) {}
  };

  var redirectInPlace = function (url) {
    if (!url || typeof url !== 'string') {
      return null;
    }
    debug('window.redirectInPlace', { url: url });
    window.location.href = url;
    return null;
  };

  window.open = function (url, target, features) {
    debug('window.open', { url: url, target: target || null, features: features || null });
    return redirectInPlace(url);
  };

  document.addEventListener(
    'click',
    function (event) {
      var node = event.target;
      while (node && node.tagName !== 'A') {
        node = node.parentElement;
      }

      if (!node) {
        return;
      }

      var href = node.getAttribute('href');
      var target = node.getAttribute('target');
      debug('anchor.click', { href: href, target: target || null });

      if (target === '_blank' && href) {
        event.preventDefault();
        redirectInPlace(href);
      }
    },
    true
  );

  window.addEventListener('beforeunload', function () {
    debug('window.beforeunload');
  });

  window.addEventListener('pagehide', function () {
    debug('window.pagehide');
  });

  debug('window.patch.ready');
})();
true;
`;

const DEBUG_MESSAGE_PREFIX = '__postcode_debug__:';
const POSTCODE_DEBUG_EXTERNAL_BLOCK = typeof __DEV__ !== 'undefined' && __DEV__;

type DaumPostcodeProps = {
  jsOptions?: JSOptions;
  onSelected: (data: OnCompleteParams) => void;
  onError: (error: unknown) => void;
  style?: StyleProp<ViewStyle>;
};

export function DaumPostcode({
  jsOptions = DEFAULT_JS_OPTIONS,
  onSelected,
  onError,
  style,
}: DaumPostcodeProps) {
  const webViewRef = useRef<WebView>(null);
  const [lastDebugLine, setLastDebugLine] = useState('postcode:init');
  const injectedJavaScript = useMemo(
    () => `initOnReady(${JSON.stringify(jsOptions)});void(0);`,
    [jsOptions],
  );

  const updateDebugLine = useCallback((label: string, data?: Record<string, unknown>) => {
    const suffix = data
      ? Object.entries(data)
          .filter(([, value]) => value !== undefined && value !== null && value !== '')
          .slice(0, 3)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(' ')
      : '';
    const line = suffix ? `${label} ${suffix}` : label;
    setLastDebugLine(line);
    logger.debug('[postcode] trace', { label, ...data });
  }, []);

  const openExternalUrl = useCallback(
    (source: 'shouldStartLoad' | 'openWindow', url: string) => {
      updateDebugLine(`external:${source}`, { url });

      if (POSTCODE_DEBUG_EXTERNAL_BLOCK) {
        Alert.alert('postcode external open blocked', `${source}\n${url}`);
        return;
      }

      void Linking.openURL(url);
    },
    [updateDebugLine],
  );

  useEffect(() => {
    updateDebugLine('mounted');

    if (POSTCODE_DEBUG_EXTERNAL_BLOCK) {
      Alert.alert('postcode debug mounted', 'DaumPostcode component rendered');
    }
  }, [updateDebugLine]);

  const handleMessage = useCallback(
    ({ nativeEvent }: WebViewMessageEvent) => {
      try {
        if (nativeEvent.data) {
          if (nativeEvent.data.startsWith(DEBUG_MESSAGE_PREFIX)) {
            const debugPayload = JSON.parse(
              nativeEvent.data.slice(DEBUG_MESSAGE_PREFIX.length),
            ) as { type?: string; payload?: unknown; href?: string };
            updateDebugLine(`web:${debugPayload.type ?? 'unknown'}`, {
              href: debugPayload.href,
            });
            return;
          }

          updateDebugLine('selected', {
            length: nativeEvent.data.length,
          });
          onSelected(JSON.parse(nativeEvent.data) as OnCompleteParams);
        }
      } catch (error) {
        updateDebugLine('message-parse-failed');
        logger.warn('[postcode] message parse failed', {
          message: error instanceof Error ? error.message : String(error),
          raw: nativeEvent.data,
        });
        onError(error);
      }
    },
    [onError, onSelected, updateDebugLine],
  );

  const handleShouldStartLoad = useCallback((request: ShouldStartLoadRequest) => {
    const stayInWebView = shouldStayInDaumPostcodeWebView(request.url);
    logger.debug('[postcode] shouldStartLoad', {
      url: request.url,
      stayInWebView,
      navigationType: request.navigationType,
      isTopFrame: request.isTopFrame,
      mainDocumentURL: request.mainDocumentURL,
    });
    updateDebugLine('shouldStartLoad', {
      stay: stayInWebView,
      url: request.url,
    });

    if (stayInWebView) {
      return true;
    }

    if (request.url) {
      logger.warn('[postcode] opening external url from shouldStartLoad', { url: request.url });
      openExternalUrl('shouldStartLoad', request.url);
    }
    return false;
  }, [openExternalUrl, updateDebugLine]);

  const handleOpenWindow = useCallback(
    ({ nativeEvent }: WebViewOpenWindowEvent) => {
      const targetUrl = nativeEvent.targetUrl?.trim();
      updateDebugLine('openWindow', { targetUrl });
      logger.debug('[postcode] openWindow', { targetUrl });
      if (!targetUrl) {
        return;
      }

      if (shouldStayInDaumPostcodeWebView(targetUrl)) {
        webViewRef.current?.injectJavaScript(
          `window.location.href = ${JSON.stringify(targetUrl)}; true;`,
        );
        return;
      }

      logger.warn('[postcode] opening external url from openWindow', { targetUrl });
      openExternalUrl('openWindow', targetUrl);
    },
    [openExternalUrl, updateDebugLine],
  );

  const handleLoadStart = useCallback(({ nativeEvent }: WebViewNavigationEvent) => {
    updateDebugLine('loadStart', { url: nativeEvent.url });
    logger.debug('[postcode] loadStart', {
      url: nativeEvent.url,
      loading: nativeEvent.loading,
      canGoBack: nativeEvent.canGoBack,
      canGoForward: nativeEvent.canGoForward,
    });
  }, [updateDebugLine]);

  const handleLoadEnd = useCallback(({ nativeEvent }: WebViewNavigationEvent) => {
    updateDebugLine('loadEnd', { url: nativeEvent.url });
    logger.debug('[postcode] loadEnd', {
      url: nativeEvent.url,
      loading: nativeEvent.loading,
      canGoBack: nativeEvent.canGoBack,
      canGoForward: nativeEvent.canGoForward,
    });
  }, [updateDebugLine]);

  const handleNavigationStateChange = useCallback((event: WebViewNavigation) => {
    updateDebugLine('navState', { url: event.url, title: event.title });
    logger.debug('[postcode] navigationStateChange', {
      url: event.url,
      loading: event.loading,
      canGoBack: event.canGoBack,
      canGoForward: event.canGoForward,
      title: event.title,
    });
  }, [updateDebugLine]);

  const handleError = useCallback(({ nativeEvent }: WebViewErrorEvent) => {
    updateDebugLine('loadError', { url: nativeEvent.url, code: nativeEvent.code });
    logger.warn('[postcode] loadError', {
      url: nativeEvent.url,
      code: nativeEvent.code,
      description: nativeEvent.description,
      domain: nativeEvent.domain,
    });
  }, [updateDebugLine]);

  const handleHttpError = useCallback(({ nativeEvent }: WebViewHttpErrorEvent) => {
    updateDebugLine('httpError', { url: nativeEvent.url, code: nativeEvent.statusCode });
    logger.warn('[postcode] httpError', {
      url: nativeEvent.url,
      statusCode: nativeEvent.statusCode,
      description: nativeEvent.description,
    });
  }, [updateDebugLine]);

  return (
    <View style={style}>
      {POSTCODE_DEBUG_EXTERNAL_BLOCK ? (
        <View style={styles.debugBanner} pointerEvents="none">
          <Text style={styles.debugBannerText} numberOfLines={2}>
            {lastDebugLine}
          </Text>
        </View>
      ) : null}
      <WebView
        ref={webViewRef}
        source={{ html: DAUM_POSTCODE_HTML, baseUrl: 'https://postcode.map.daum.net' }}
        originWhitelist={['*']}
        injectedJavaScript={injectedJavaScript}
        injectedJavaScriptBeforeContentLoaded={WEBVIEW_WINDOW_PATCH}
        onMessage={handleMessage}
        onLoadStart={handleLoadStart}
        onLoadEnd={handleLoadEnd}
        onNavigationStateChange={handleNavigationStateChange}
        onError={handleError}
        onHttpError={handleHttpError}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onOpenWindow={handleOpenWindow}
        mixedContentMode="compatibility"
        androidLayerType="hardware"
        renderToHardwareTextureAndroid
        useWebKit
      />
    </View>
  );
}

const styles = StyleSheet.create({
  debugBanner: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    zIndex: 10,
    backgroundColor: 'rgba(17, 24, 39, 0.88)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  debugBannerText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
