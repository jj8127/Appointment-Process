const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.jj8127.Garam_in';
const IOS_STORE_URL =
  'https://apps.apple.com/search?term=%EA%B0%80%EB%9E%8Ain';

function buildHtml(rawCode: string): string {
  const safeCode = rawCode.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 20);
  const deeplink = safeCode
    ? 'hanwhafcpass://signup?code=' + safeCode
    : '';

  // 인라인 한국어 문자열 대신 HTML 엔티티 + JS 런타임 주입으로 인코딩 문제 회피
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>&#44032;&#46988;in &#52488;&#45824;</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff9f5;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem 1.5rem;text-align:center}
.icon{width:72px;height:72px;background:#f36f21;border-radius:18px;font-size:32px;display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem;box-shadow:0 4px 16px rgba(243,111,33,.25)}
h1{font-size:1.4rem;font-weight:800;color:#111;margin-bottom:.5rem}
.sub{font-size:.9rem;color:#6b7280;margin-bottom:1.25rem}
.card{background:#fff;border:1.5px solid #f36f21;border-radius:14px;padding:1rem 1.5rem 1.1rem;width:100%;max-width:320px;margin:0 auto 1.5rem}
.lbl{font-size:.75rem;color:#9ca3af;font-weight:500;margin-bottom:6px}
.code{font-size:1.7rem;font-weight:800;color:#f36f21;letter-spacing:4px}
.hint{font-size:.75rem;color:#9ca3af;margin-top:6px}
.btns{display:flex;flex-direction:column;gap:10px;width:100%;max-width:300px;margin:0 auto}
.btn{display:block;padding:.85rem 1.5rem;border-radius:11px;font-weight:600;font-size:.95rem;text-decoration:none;border:none;cursor:pointer;width:100%;text-align:center}
.p{background:#f36f21;color:#fff}
.d{background:#111;color:#fff}
footer{color:#d1d5db;font-size:.72rem;margin-top:2rem}
</style>
</head>
<body>
<div class="icon">&#127873;</div>
<h1 id="ttl"></h1>
<p class="sub" id="sub"></p>
${safeCode ? `<div class="card"><p class="lbl" id="lbl"></p><p class="code">${safeCode}</p><p class="hint" id="hnt"></p></div>` : ''}
<div class="btns">
${deeplink ? `<a class="btn p" href="${deeplink}" id="appBtn"></a>` : ''}
<a class="btn d" href="${PLAY_STORE_URL}" id="andBtn"></a>
<a class="btn d" href="${IOS_STORE_URL}" id="iosBtn"></a>
</div>
<footer id="ft"></footer>
<script>
(function(){
  var t={
    ttl:'\uAC00\uB78C\uC778 \uCD94\uCC9C \uCD08\uB300',
    sub:'${safeCode ? '\uC571\uC774 \uC5C6\uC73C\uC2DC\uBA74 \uC544\uB798\uC5D0\uC11C \uC124\uCE58\uD574 \uC8FC\uC138\uC694.' : '\uC720\uD6A8\uD558\uC9C0 \uC54A\uC740 \uCD08\uB300 \uB9C1\uD06C\uC785\uB2C8\uB2E4.'}',
    lbl:'\uCD94\uCC9C \uCF54\uB4DC',
    hnt:'\uC571 \uAC00\uC785 \uC2DC \uC790\uB3D9 \uC785\uB825\uB429\uB2C8\uB2E4',
    app:'\uD83D\uDE80 \uAC00\uB78C\uC778 \uC571 \uC5F4\uAE30',
    and:'\uD83D\uDCF1 Android (Play Store)',
    ios:'\uD83C\uDF4E iOS (App Store)',
    ft:'\uAC00\uB78C\uBD10\uC0AC\uC9C0\uC0AC \u00B7 \uAC00\uB78C\uC778'
  };
  function s(id,txt){var el=document.getElementById(id);if(el)el.textContent=txt;}
  s('ttl',t.ttl); s('sub',t.sub); s('lbl',t.lbl); s('hnt',t.hnt);
  s('appBtn',t.app); s('andBtn',t.and); s('iosBtn',t.ios); s('ft',t.ft);
})();
</script>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' },
    });
  }

  const url = new URL(req.url);
  const code = (url.searchParams.get('code') ?? '').trim().toUpperCase();

  return new Response(buildHtml(code), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
});
