import type { JSOptions, OnCompleteParams } from '@actbase/react-daum-postcode/lib/types';
import { useCallback, useMemo } from 'react';
import { Linking, View, type StyleProp, type ViewStyle } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { shouldStayInDaumPostcodeWebView } from '@/lib/daum-postcode';

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
  const injectedJavaScript = useMemo(
    () => `initOnReady(${JSON.stringify(jsOptions)});void(0);`,
    [jsOptions],
  );

  const handleMessage = useCallback(
    ({ nativeEvent }: WebViewMessageEvent) => {
      try {
        if (nativeEvent.data) {
          onSelected(JSON.parse(nativeEvent.data) as OnCompleteParams);
        }
      } catch (error) {
        onError(error);
      }
    },
    [onError, onSelected],
  );

  const handleShouldStartLoad = useCallback((request: ShouldStartLoadRequest) => {
    if (shouldStayInDaumPostcodeWebView(request.url)) {
      return true;
    }

    if (request.url) {
      void Linking.openURL(request.url);
    }
    return false;
  }, []);

  return (
    <View style={style}>
      <WebView
        source={{ html: DAUM_POSTCODE_HTML, baseUrl: 'https://postcode.map.daum.net' }}
        injectedJavaScript={injectedJavaScript}
        onMessage={handleMessage}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        mixedContentMode="compatibility"
        androidLayerType="hardware"
        renderToHardwareTextureAndroid
        useWebKit
      />
    </View>
  );
}
