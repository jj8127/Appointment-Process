'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.jj8127.Garam_in';
const IOS_STORE_URL = 'https://apps.apple.com/search?term=가람in';

function InviteContent() {
  const params = useSearchParams();
  const code = params.get('code') ?? '';
  const [launched, setLaunched] = useState(false);

  useEffect(() => {
    if (!code) return;

    const deeplink = `hanwhafcpass://signup?code=${code}`;
    window.location.href = deeplink;

    const timer = setTimeout(() => {
      setLaunched(true);
    }, 1800);

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') clearTimeout(timer);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [code]);

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  const isAndroid = /android/.test(ua);
  const isIos = /iphone|ipad|ipod/.test(ua);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        padding: '2rem',
        textAlign: 'center',
        backgroundColor: '#fff9f5',
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 18,
          backgroundColor: '#f36f21',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1.5rem',
          fontSize: 32,
          boxShadow: '0 4px 16px rgba(243,111,33,0.25)',
        }}
      >
        🎁
      </div>

      <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem', color: '#111' }}>
        가람in 추천 초대
      </h1>

      {code && (
        <div
          style={{
            backgroundColor: '#fff',
            border: '1.5px solid #f36f21',
            borderRadius: 12,
            padding: '1rem 1.5rem',
            margin: '1rem 0 1.5rem',
            width: '100%',
            maxWidth: 320,
          }}
        >
          <p style={{ color: '#6b7280', fontSize: '0.8rem', margin: '0 0 6px', fontWeight: 500 }}>
            추천 코드
          </p>
          <p
            style={{
              color: '#f36f21',
              fontSize: '1.6rem',
              fontWeight: 800,
              letterSpacing: 4,
              margin: 0,
            }}
          >
            {code}
          </p>
          <p style={{ color: '#9ca3af', fontSize: '0.75rem', margin: '6px 0 0' }}>
            앱 가입 시 자동으로 입력됩니다
          </p>
        </div>
      )}

      {!launched && code ? (
        <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
          가람in 앱을 여는 중...
        </p>
      ) : (
        <p style={{ color: '#374151', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
          앱이 없으시면 아래에서 설치 후 코드를 입력해주세요.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 300 }}>
        {(!isIos || isAndroid) && (
          <a
            href={PLAY_STORE_URL}
            style={{
              display: 'block',
              backgroundColor: '#111',
              color: '#fff',
              padding: '0.85rem 1.5rem',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: '0.95rem',
              textDecoration: 'none',
            }}
          >
            📱 Android (Play Store)
          </a>
        )}
        {(!isAndroid || isIos) && (
          <a
            href={IOS_STORE_URL}
            style={{
              display: 'block',
              backgroundColor: '#111',
              color: '#fff',
              padding: '0.85rem 1.5rem',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: '0.95rem',
              textDecoration: 'none',
            }}
          >
            🍎 iOS (App Store)
          </a>
        )}
        {code && (
          <a
            href={`hanwhafcpass://signup?code=${code}`}
            style={{
              display: 'block',
              backgroundColor: '#f36f21',
              color: '#fff',
              padding: '0.85rem 1.5rem',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: '0.95rem',
              textDecoration: 'none',
            }}
          >
            🚀 이미 설치됨 — 앱 열기
          </a>
        )}
      </div>

      <p style={{ color: '#d1d5db', fontSize: '0.75rem', marginTop: '2rem' }}>
        가람PA지사 · 가람in
      </p>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense>
      <InviteContent />
    </Suspense>
  );
}
