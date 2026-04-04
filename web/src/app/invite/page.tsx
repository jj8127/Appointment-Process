'use client';
import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.jj8127.Garam_in';
const IOS_STORE_URL = 'https://apps.apple.com/search?term=가람in';

function InviteContent() {
  const params = useSearchParams();
  const code = params.get('code') ?? '';

  useEffect(() => {
    if (!code) return;

    const deeplink = `hanwhafcpass://signup?code=${code}`;
    window.location.href = deeplink;

    const timer = setTimeout(() => {
      const ua = navigator.userAgent.toLowerCase();
      if (/android/.test(ua)) {
        window.location.href = PLAY_STORE_URL;
      } else if (/iphone|ipad|ipod/.test(ua)) {
        window.location.href = IOS_STORE_URL;
      }
      // desktop: 안내 텍스트만 표시
    }, 2000);

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') clearTimeout(timer);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [code]);

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
          width: 64,
          height: 64,
          borderRadius: 16,
          backgroundColor: '#f36f21',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1.5rem',
          fontSize: 28,
        }}
      >
        🎁
      </div>
      <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.75rem', color: '#111' }}>
        가람in 앱으로 이동 중...
      </h2>
      {code && (
        <p style={{ color: '#6b7280', fontSize: '0.95rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
          추천 코드{' '}
          <strong style={{ color: '#f36f21', letterSpacing: 2 }}>{code}</strong>
          {'\n'}가 자동 입력됩니다.
        </p>
      )}
      <p style={{ color: '#9ca3af', fontSize: '0.85rem', lineHeight: 1.7 }}>
        앱이 열리지 않으면 스토어에서{' '}
        <strong style={{ color: '#374151' }}>가람in</strong>을 설치 후 다시 시도해주세요.
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
