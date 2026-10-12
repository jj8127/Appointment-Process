import { Image } from 'react-native';
import type { PlatformHospital } from '@/lib/platform-api';

// Fictional directory embedded in explicitly enabled local preview builds.
const photos = [
  require('@/assets/images/hospital-demo/general-clinic.png'),
  require('@/assets/images/hospital-demo/dental-clinic.png'),
  require('@/assets/images/hospital-demo/clinic-exterior.png'),
].map((source) => typeof source === 'number' ? Image.resolveAssetSource(source).uri : typeof source === 'string' ? source : source.uri);

const entries = [
  { name: '온빛내과의원', provinceCode: '11', provinceName: '서울', district: '강남구', specialties: ['내과'], description: '차분한 진료 공간과 건강 상담실을 갖춘 내과입니다.', photo: 0 },
  { name: '모두미소치과', provinceCode: '11', provinceName: '서울', district: '마포구', specialties: ['치과'], description: '개별 진료실과 편안한 대기 공간을 갖춘 치과입니다.', photo: 1 },
  { name: '온누리정형외과', provinceCode: '11', provinceName: '서울', district: '송파구', specialties: ['정형외과', '재활의학과'], description: '관절 진료와 재활 상담을 한 공간에서 안내합니다.', photo: 2 },
  { name: '라온안과의원', provinceCode: '41', provinceName: '경기', district: '성남시', specialties: ['안과'], description: '시력 검사와 눈 건강 상담을 위한 공간입니다.', photo: 0 },
  { name: '다온피부과의원', provinceCode: '41', provinceName: '경기', district: '수원시', specialties: ['피부과'], description: '밝은 진료실에서 피부 건강 상담을 진행합니다.', photo: 2 },
  { name: '아이온소아청소년과', provinceCode: '41', provinceName: '경기', district: '고양시', specialties: ['소아청소년과'], description: '아이와 보호자가 함께 머무는 가족 대기실이 있습니다.', photo: 0 },
  { name: '바다온이비인후과', provinceCode: '26', provinceName: '부산', district: '해운대구', specialties: ['이비인후과'], description: '귀·코·목 건강을 상담하는 진료 공간입니다.', photo: 2 },
  { name: '이음신경과의원', provinceCode: '26', provinceName: '부산', district: '부산진구', specialties: ['신경과'], description: '신경과 진료와 일상 건강 상담을 안내합니다.', photo: 0 },
  { name: '부산온미소치과', provinceCode: '26', provinceName: '부산', district: '동래구', specialties: ['치과'], description: '독립된 진료 공간에서 구강 건강을 상담합니다.', photo: 1 },
  { name: '한빛산부인과의원', provinceCode: '30', provinceName: '대전', district: '유성구', specialties: ['산부인과'], description: '여성 건강 상담을 위한 편안한 공간입니다.', photo: 2 },
  { name: '대전이음재활의학과', provinceCode: '30', provinceName: '대전', district: '서구', specialties: ['재활의학과', '정형외과'], description: '움직임과 일상 회복에 관한 진료를 안내합니다.', photo: 0 },
  { name: '마음온내과의원', provinceCode: '30', provinceName: '대전', district: '중구', specialties: ['내과'], description: '건강 검진 상담과 내과 진료를 안내합니다.', photo: 2 },
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
