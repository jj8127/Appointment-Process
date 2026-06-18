import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOURCE_DIRS = ['app', 'components'];
const LEGACY_LOADING_PATTERNS = [
  'ActivityIndicator',
  '@/components/LoadingSkeleton',
  '<Skeleton',
  '<CardSkeleton',
  '<ListSkeleton',
  '<FormSkeleton',
  '<BoardSkeleton',
  '<TextSkeleton',
  '불러오는 중...',
  '조회 중...',
  '조회중',
  '현황 조회 중...',
  '임시사번 확인 중',
  '메시지 불러오는 중...',
  'PDF 업로드중...',
  '파일 전송 중...',
  '저장 중...',
  '저장중...',
  '삭제 중...',
  '삭제중...',
  '처리중...',
  '발송 알림중...',
  '전송중',
  "isDeleting ? '삭제 중'",
  '확인 중...',
  '추천인 정보를 확인 중입니다...',
  '카테고리를 불러오는 중입니다.',
] as const;

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      if (entry === '__tests__') {
        return [];
      }
      return listSourceFiles(fullPath);
    }

    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

describe('branded loading usage contract', () => {
  it('uses the shared branded loading animation instead of legacy loading UI', () => {
    const offenders = SOURCE_DIRS
      .flatMap((sourceDir) => listSourceFiles(join(process.cwd(), sourceDir)))
      .flatMap((filePath) => {
        const source = readFileSync(filePath, 'utf8');
        const matchedPatterns = LEGACY_LOADING_PATTERNS.filter((pattern) => source.includes(pattern));

        return matchedPatterns.map((pattern) => `${relative(process.cwd(), filePath)} :: ${pattern}`);
      });

    expect(offenders).toEqual([]);
  });
});
