/* global jest, __dirname, beforeEach, test, expect */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { hasInsuranceHomeContext } = require('../service-home');

let session;
let params;
let focusedCallback;
const replace = jest.fn();
const protectedQuery = jest.fn(() => { throw new Error('Protected query mounted at the public entry'); });
const notificationDecision = jest.fn();
const dependencies = {
  react: { ...React, useCallback: (callback) => callback },
  'react-native': { Platform: { OS: 'web' }, StyleSheet: { create: (styles) => styles } },
  '@tanstack/react-query': { useQuery: protectedQuery },
  'expo-router': {
    Redirect: 'Redirect',
    router: { replace },
    useLocalSearchParams: () => params,
    useFocusEffect: (callback) => { focusedCallback = callback; },
  },
  '@/hooks/use-session': { useSession: () => session },
  '@/components/ServiceHub': { default: 'ServiceHub' },
  '@/components/BrandedLoadingState': { default: 'Loading' },
  '@/lib/service-home': { hasInsuranceHomeContext },
  '@/lib/notification-navigation-coordinator': { waitForNotificationNavigationDecision: notificationDecision },
};
const exported = {};
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../app/index.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText;
new Function('require', 'exports', source)((name) => {
  if (Object.hasOwn(dependencies, name)) return dependencies[name];
  if (name === 'react/jsx-runtime') return require(name);
  return {};
}, exported);

beforeEach(() => {
  session = { role: null, hydrated: true, isRequestBoardDesigner: false };
  params = {};
  focusedCallback = undefined;
  replace.mockReset();
  protectedQuery.mockClear();
  notificationDecision.mockReset().mockResolvedValue(false);
});

test('guest and normal signed sessions mount the public service home with no protected query', () => {
  expect(exported.default().type).toBe('ServiceHub');
  session.role = 'fc';
  expect(exported.default().type).toBe('ServiceHub');
  expect(protectedQuery).not.toHaveBeenCalled();
});
test('hydration holds both public and explicit insurance routes', () => {
  session.hydrated = false;
  expect(exported.default().type).toBe('Loading');
  params = { mode: 'insurance' };
  expect(exported.default().type).toBe('Loading');
  expect(protectedQuery).not.toHaveBeenCalled();
});
test.each([{ mode: 'insurance' }, { notificationId: 'fictional-receipt' }])('signed-out protected context preserves skipAuto: %j', (context) => {
  params = context;
  const route = exported.default();
  expect(route.type).toBe('Redirect');
  expect(route.props.href).toBe('/login?skipAuto=1');
  expect(protectedQuery).not.toHaveBeenCalled();
});
test.each([{ mode: 'onboarding' }, { mode: 'exam' }, { mode: 'insurance' }, { notificationId: 'fictional-receipt' }])('signed insurance context still mounts its original home: %j', (context) => {
  params = context;
  session.role = 'admin';
  expect(exported.default().type.name).toBe('LegacyInsuranceHome');
});
test('stored designer landing waits for the notification decision', async () => {
  session = { ...session, role: 'fc', isRequestBoardDesigner: true };
  const route = exported.default();
  expect(route.type.name).toBe('DesignerHomeLanding');
  expect(route.type().type).toBe('Loading');
  focusedCallback();
  expect(replace).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(replace).toHaveBeenCalledWith('/request-board');
});
test.each(['notification', 'blur'])('designer landing gives priority to %s', async (reason) => {
  session = { ...session, role: 'fc', isRequestBoardDesigner: true };
  notificationDecision.mockResolvedValue(reason === 'notification');
  exported.default().type();
  const cancel = focusedCallback();
  if (reason === 'blur') cancel();
  await Promise.resolve();
  expect(replace).not.toHaveBeenCalled();
});
