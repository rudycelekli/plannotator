/**
 * Cmd/Ctrl+P in plan review and annotate. Regression guarded: inside the VS
 * Code panel the page printing (and preventing the key) instead of VS Code's
 * Quick Open, and Caps Lock silently killing the key.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { shouldPrintOnKey } from './printShortcut';

const g = globalThis as { window?: unknown };
const hadWindow = 'window' in g;
const savedWindow = g.window;
afterEach(() => {
  if (hadWindow) g.window = savedWindow;
  else delete g.window;
});

const key = (init: Partial<KeyboardEvent>) => ({ key: 'p', metaKey: true, ctrlKey: false, shiftKey: false, target: null, ...init }) as KeyboardEvent;

describe('shouldPrintOnKey', () => {
  test('prints in a browser tab; never from a text field or while blocked', () => {
    g.window = {};
    expect(shouldPrintOnKey(key({}), false)).toBe(true);
    expect(shouldPrintOnKey(key({ metaKey: false, ctrlKey: true }), false)).toBe(true);
    expect(shouldPrintOnKey(key({ target: { tagName: 'TEXTAREA' } as unknown as EventTarget }), false)).toBe(false);
    expect(shouldPrintOnKey(key({}), true)).toBe(false);
    expect(shouldPrintOnKey(key({ key: 'o' }), false)).toBe(false);
  });

  // Caps Lock reports `P` with shiftKey false, and the registry's own letter
  // matching is case-insensitive, so the binding must be too. `Mod+Shift+P`
  // is a different chord and stays unbound.
  test('the letter is read in either case; Shift is not the binding', () => {
    g.window = {};
    expect(shouldPrintOnKey(key({ key: 'P' }), false)).toBe(true);
    expect(shouldPrintOnKey(key({ key: 'P', shiftKey: true }), false)).toBe(false);
    expect(shouldPrintOnKey(key({ shiftKey: true }), false)).toBe(false);
  });

  test('inside the VS Code panel the key is left to VS Code (Quick Open)', () => {
    g.window = { __PLANNOTATOR_VSCODE: true };
    expect(shouldPrintOnKey(key({}), false)).toBe(false);
  });
});
