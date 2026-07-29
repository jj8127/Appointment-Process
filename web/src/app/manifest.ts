import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: '가람in 관리자',
    short_name: '가람in',
    description: '가람in FC 위촉·시험·알림·운영 관리 웹',
    start_url: '/auth',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#f97316',
    lang: 'ko-KR',
    categories: ['business', 'productivity'],
    icons: [
      {
        src: '/store-icon.png',
        sizes: '2475x2475',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
