import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(join(process.cwd(), 'app/home-lite.tsx'), 'utf8');
const parsed = ts.createSourceFile('home-lite.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const screen = parsed.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'HomeLiteScreen');
if (!screen) throw new Error('Home-lite screen is missing.');
const renderScript = ts.transpileModule(`(${screen.getText(parsed).replace('export default function', 'function')})();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;

type Element = { type: string; props: Record<string, unknown>; children: unknown[] };
type Actor = { hydrated: boolean; role: 'fc' | 'admin' | null; isRequestBoardDesigner: boolean };

function render(actor: Actor, identityCompleted = false) {
  const push = jest.fn();
  const replace = jest.fn();
  const effects: (() => void)[] = [];
  const tree = runInNewContext(renderScript, {
    React: { createElement: (type: string, props: Record<string, unknown>, ...children: unknown[]) => ({ type, props: props ?? {}, children }) },
    useSession: () => ({ ...actor, displayName: '' }),
    useAppLogout: () => () => undefined,
    useIdentityStatus: () => ({ data: { identityCompleted }, isLoading: false }),
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => void) => { effects.push(effect); },
    useFocusEffect: () => undefined,
    router: { push, replace },
    SafeAreaView: 'SafeAreaView', View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', Feather: 'Feather',
    styles: {}, COLORS: { text: { primary: '#111827' }, primary: '#f36f21' }, LOCKED_ITEMS: [],
    HOME_LITE_PRIMARY_ACTION_ROUTE: '/apply-gate',
    addSentryBreadcrumb: () => undefined,
    buildHomeEntryBreadcrumb: () => ({}),
  }) as Element;
  const elements: Element[] = [];
  const walk = (item: unknown) => {
    if (Array.isArray(item)) { item.forEach(walk); return; }
    if (!item || typeof item !== 'object' || !('type' in item)) return;
    const element = item as Element;
    elements.push(element);
    element.children.forEach(walk);
  };
  walk(tree);
  effects.forEach((effect) => effect());
  return { elements, push, replace };
}

describe('allowance access from the incomplete-identity FC home', () => {
  it('opens the real allowance route while preserving the required-information workflow', () => {
    const result = render({ hydrated: true, role: 'fc', isRequestBoardDesigner: false });
    const allowance = result.elements.find((element) => element.props.accessibilityLabel === '수당 그래프');
    expect(allowance).toBeDefined();
    (allowance!.props.onPress as () => void)();
    expect(result.push).toHaveBeenLastCalledWith('/referral-allowance');
    const requiredInfo = result.elements.find((element) => element.props.testID === 'home-lite-apply-start');
    (requiredInfo!.props.onPress as () => void)();
    expect(result.push).toHaveBeenLastCalledWith('/apply-gate');
    expect(result.replace).not.toHaveBeenCalled();
  });

  it.each([
    { hydrated: false, role: 'fc', isRequestBoardDesigner: false },
    { hydrated: true, role: null, isRequestBoardDesigner: false },
    { hydrated: true, role: 'admin', isRequestBoardDesigner: false },
    { hydrated: true, role: 'fc', isRequestBoardDesigner: true },
  ] satisfies Actor[])('does not expose the personal entry for $role / hydrated=$hydrated / designer=$isRequestBoardDesigner', (actor) => {
    expect(render(actor).elements.some((element) => element.props.accessibilityLabel === '수당 그래프')).toBe(false);
  });

  it('keeps the completed-identity transition to the full home', () => {
    const result = render({ hydrated: true, role: 'fc', isRequestBoardDesigner: false }, true);
    expect(result.replace).toHaveBeenCalledWith('/');
  });
});
