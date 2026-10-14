import { Image } from 'react-native';
import type { PlatformHospital } from '@/lib/platform-api';

// Fictional directory embedded in explicitly enabled local preview builds.
const photos = [
  require('@/assets/images/hospital-demo/general-clinic.png'),
  require('@/assets/images/hospital-demo/dental-clinic.png'),
  require('@/assets/images/hospital-demo/clinic-exterior.png'),
].map((source) => typeof source === 'number' ? Image.resolveAssetSource(source).uri : typeof source === 'string' ? source : source.uri);

const entries = [
  { name: '온한방병원', provinceCode: '11', provinceName: '서울', district: '강남구', specialties: ['한방병원'], description: '한방 진료와 회복 상담을 한 공간에서 안내합니다.', photo: 0 },
  { name: '모두미소치과', provinceCode: '11', provinceName: '서울', district: '마포구', specialties: ['치과'], description: '개별 진료실과 편안한 대기 공간을 갖춘 치과입니다.', photo: 1 },
  { name: '온누리정형외과', provinceCode: '11', provinceName: '서울', district: '송파구', specialties: ['정형외과'], description: '관절과 척추 건강 상담을 위한 진료 공간입니다.', photo: 2 },
  { name: '라온안과의원', provinceCode: '41', provinceName: '경기', district: '성남시', specialties: ['안과'], description: '시력 검사와 눈 건강 상담을 위한 공간입니다.', photo: 0 },
  { name: '다온성형외과', provinceCode: '41', provinceName: '경기', district: '수원시', specialties: ['성형외과'], description: '충분한 상담을 바탕으로 진료 과정을 안내합니다.', photo: 2 },
  { name: '새봄건강검진센터', provinceCode: '41', provinceName: '경기', district: '고양시', specialties: ['건강검진센터'], description: '건강검진 항목과 예약 일정을 편리하게 안내합니다.', photo: 0 },
  { name: '바다온한방병원', provinceCode: '26', provinceName: '부산', district: '해운대구', specialties: ['한방병원'], description: '몸 상태에 맞춘 한방 진료와 회복 상담을 안내합니다.', photo: 2 },
  { name: '이음정형외과', provinceCode: '26', provinceName: '부산', district: '부산진구', specialties: ['정형외과'], description: '관절과 척추 진료를 위한 상담 공간을 갖추고 있습니다.', photo: 0 },
  { name: '부산온미소치과', provinceCode: '26', provinceName: '부산', district: '동래구', specialties: ['치과'], description: '독립된 진료 공간에서 구강 건강을 상담합니다.', photo: 1 },
  { name: '한빛성형외과', provinceCode: '30', provinceName: '대전', district: '유성구', specialties: ['성형외과'], description: '진료 전 상담부터 이후 일정까지 차분하게 안내합니다.', photo: 2 },
  { name: '대전맑은안과', provinceCode: '30', provinceName: '대전', district: '서구', specialties: ['안과'], description: '눈 건강 검사와 진료 일정을 편리하게 확인할 수 있습니다.', photo: 0 },
  { name: '이음건강검진센터', provinceCode: '30', provinceName: '대전', district: '중구', specialties: ['건강검진센터'], description: '검진 프로그램과 방문 전 준비 사항을 안내합니다.', photo: 2 },
];

export const HOSPITAL_DEMO: PlatformHospital[] = entries.map(({ photo, ...entry }, index) => ({
  ...entry,
  id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  region: `${entry.provinceName} ${entry.district}`,
  address: `${entry.provinceName} ${entry.district} 모두온샘플길 ${index + 1} (가상 주소)`,
  phone: null, websiteUrl: null,
  photoUrl: photos[photo],
  openingHours: '평일 09:00–18:00 · 토요일 09:00–13:00 · 일요일 휴무 (샘플)',
  verifiedAt: null,
  adPlacement: index < 3 || index % 3 === 0 ? 'regional_featured' : 'regional_list',
  revision: 0, measurementToken: 'local-hospital-demo',
}));
