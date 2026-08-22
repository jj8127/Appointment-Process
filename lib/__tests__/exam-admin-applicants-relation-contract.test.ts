import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('mobile administrator exam applicant relationship contract', () => {
  it('uses the type-aware registration-to-round foreign key in both applicant lists', () => {
    for (const path of ['app/exam-manage.tsx', 'app/exam-manage2.tsx']) {
      const source = read(path);

      expect(source).toContain('exam_rounds!exam_registrations_round_exam_type_fkey!inner');
      expect(source).not.toContain('exam_rounds!inner');
    }
  });
});
