import { Feather } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { SystemBarsModal } from '@/components/SystemBarsModal';

// pdf.js renders inside the WebView because Android WebView and Custom Tabs cannot show PDFs.
const PDFJS_VERSION = '3.11.174';
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

export function buildPdfViewerHtml(url: string) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=4, user-scalable=yes">
<style>
html,body{margin:0;background:#e5e7eb}
#pages{display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px 0 24px}
canvas{display:block;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.15);max-width:100%}
</style></head><body><div id="pages"></div>
<script src="${PDFJS_BASE}/pdf.min.js"></script>
<script>
(function(){
  var post=function(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));};
  if(!window.pdfjsLib){post({type:'error'});return;}
  pdfjsLib.GlobalWorkerOptions.workerSrc='${PDFJS_BASE}/pdf.worker.min.js';
  var holder=document.getElementById('pages');
  var width=Math.min(window.innerWidth,900)-16;
  var ratio=Math.min(window.devicePixelRatio||1,2);
  pdfjsLib.getDocument({url:${JSON.stringify(url)},withCredentials:false}).promise.then(function(pdf){
    post({type:'loaded',pages:pdf.numPages});
    var rendered={};
    var canvases=[];
    function render(n){
      if(rendered[n])return;rendered[n]=true;
      pdf.getPage(n).then(function(page){
        var base=page.getViewport({scale:1});
        var vp=page.getViewport({scale:(width/base.width)*ratio});
        var c=canvases[n-1];c.width=vp.width;c.height=vp.height;
        page.render({canvasContext:c.getContext('2d'),viewport:vp});
      });
    }
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){if(e.isIntersecting)render(Number(e.target.dataset.page));});
    },{rootMargin:'800px 0px'});
    for(var i=1;i<=pdf.numPages;i++){
      var c=document.createElement('canvas');c.dataset.page=i;
      c.style.width=width+'px';c.style.height=Math.round(width*1.414)+'px';
      holder.appendChild(c);canvases.push(c);io.observe(c);
    }
    pdf.getPage(1).then(function(p){
      var v=p.getViewport({scale:1});var h=Math.round(width*v.height/v.width)+'px';
      canvases.forEach(function(c){c.style.height=h;});
    });
  }).catch(function(){post({type:'error'});});
})();
</script></body></html>`;
}

type Props = {
  visible: boolean;
  url: string | null;
  title: string;
  onClose: () => void;
  onSave: () => void;
  onShare?: () => void;
  onOpenExternal: () => void;
  saving?: boolean;
};

export function PdfViewerModal({ visible, url, title, onClose, onSave, onShare, onOpenExternal, saving }: Props) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [pages, setPages] = useState(0);
  const source = useMemo(() => (url ? { html: buildPdfViewerHtml(url), baseUrl: 'https://localhost/' } : null), [url]);

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type: string; pages?: number };
      if (message.type === 'loaded') {
        setState('loaded');
        setPages(message.pages ?? 0);
      }
      if (message.type === 'error') setState('error');
    } catch {
      setState('error');
    }
  };

  return (
    <SystemBarsModal visible={visible} animationType="slide" onRequestClose={onClose}>
      {(insets) => <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="PDF 닫기" hitSlop={8} onPress={onClose}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
            <Feather name="x" size={24} color="#111827" />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            {pages > 0 ? <Text style={styles.subtitle}>{`${pages}쪽`}</Text> : null}
          </View>
          {onShare ? (
            <Pressable accessibilityRole="button" accessibilityLabel="PDF 공유" hitSlop={8} onPress={onShare}
              style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
              <Feather name="share-2" size={21} color="#111827" />
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="PDF 저장" accessibilityState={{ busy: !!saving, disabled: !!saving }}
            disabled={saving} hitSlop={8} onPress={onSave}
            style={({ pressed }) => [styles.headerButton, (pressed || saving) && styles.pressed]}>
            {saving ? <ActivityIndicator size="small" color="#111827" /> : <Feather name="download" size={21} color="#111827" />}
          </Pressable>
        </View>
        {source ? (
          <WebView
            key={url ?? ''}
            originWhitelist={['*']}
            source={source}
            onMessage={onMessage}
            onLoadStart={() => setState('loading')}
            onError={() => setState('error')}
            setSupportMultipleWindows={false}
            style={styles.web}
          />
        ) : null}
        {state === 'loading' ? (
          <View style={styles.overlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#f36f21" />
          </View>
        ) : null}
        {state === 'error' ? (
          <View style={styles.overlay}>
            <Text style={styles.errorText}>PDF를 앱에서 열지 못했습니다.</Text>
            <Pressable accessibilityRole="button" onPress={onOpenExternal}
              style={({ pressed }) => [styles.errorButton, pressed && styles.pressed]}>
              <Text style={styles.errorButtonText}>다른 앱으로 열기</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={{ height: insets.bottom, backgroundColor: '#e5e7eb' }} />
      </View>}
    </SystemBarsModal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  pressed: { opacity: 0.6 },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 12, color: '#6b7280' },
  web: { flex: 1, backgroundColor: '#e5e7eb' },
  overlay: { position: 'absolute', left: 0, right: 0, top: 120, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 14 },
  errorText: { fontSize: 15, color: '#374151' },
  errorButton: { minHeight: 44, paddingHorizontal: 18, borderRadius: 12, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  errorButtonText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
