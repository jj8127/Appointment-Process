import { readFileSync } from 'fs';
import { join } from 'path';

const appSources = ['app/board.tsx', 'app/admin-board-manage.tsx'];

function readRepoFile(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function readStyleBlock(source: string, styleName: string) {
  const match = source.match(new RegExp(`${styleName}: \\{([\\s\\S]*?)\\n  \\},`));
  return match?.[1] ?? '';
}

describe('board detail badge layout', () => {
  it('keeps detail author badges on a stable wrapping row in every board detail modal', () => {
    for (const path of appSources) {
      const source = readRepoFile(path);

      expect(source).toContain('styles.detailAuthorBadgeRow');

      const rowStyle = readStyleBlock(source, 'detailAuthorBadgeRow');
      expect(rowStyle).toContain("flexDirection: 'row'");
      expect(rowStyle).toContain("alignItems: 'center'");
      expect(rowStyle).toContain("flexWrap: 'wrap'");
    }
  });

  it('keeps role and category badges visually aligned in board detail rows', () => {
    for (const path of appSources) {
      const source = readRepoFile(path);

      const roleBadge = readStyleBlock(source, 'roleBadge');
      const categoryBadge = readStyleBlock(source, 'categoryBadge');
      const roleText = readStyleBlock(source, 'roleText');
      const categoryText = readStyleBlock(source, 'categoryBadgeText');

      expect(roleBadge).toContain('minHeight: 26');
      expect(roleBadge).toContain("alignItems: 'center'");
      expect(roleBadge).toContain("justifyContent: 'center'");
      expect(categoryBadge).toContain('minHeight: 26');
      expect(categoryBadge).toContain("alignItems: 'center'");
      expect(categoryBadge).toContain("justifyContent: 'center'");
      expect(roleText).toContain('lineHeight: 14');
      expect(categoryText).toContain('lineHeight: 14');
    }
  });
});
