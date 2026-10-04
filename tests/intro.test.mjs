import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../intro-init.js', import.meta.url), 'utf8');

function visit(storage, reducedMotion = false) {
  const classes = new Set();
  const listeners = new Map();
  const introListeners = new Map();
  let removed = false;
  const intro = {
    addEventListener(name, handler) { introListeners.set(name, handler); },
    remove() { removed = true; },
  };
  const document = {
    documentElement: {
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
    },
    addEventListener(name, handler) { listeners.set(name, handler); },
    getElementById(name) { return name === 'site-intro' ? intro : null; },
  };
  const window = {
    matchMedia() { return { matches: reducedMotion }; },
    setTimeout() { return 1; },
  };
  vm.runInNewContext(source, { document, window, sessionStorage: storage });
  return {
    classes,
    get removed() { return removed; },
    ready() { listeners.get('DOMContentLoaded')(); },
    finish() { introListeners.get('animationend')({ target: intro }); },
  };
}

test('intro plays once and releases the overlay after animation', () => {
  const items = new Map();
  const storage = { getItem: (key) => items.get(key), setItem: (key, value) => items.set(key, value) };
  const first = visit(storage);
  assert.equal(first.classes.has('intro-play'), true);
  first.ready();
  first.finish();
  assert.equal(first.classes.has('intro-play'), false);
  assert.equal(first.removed, true);

  const second = visit(storage);
  assert.equal(second.classes.has('intro-play'), false);
  second.ready();
  assert.equal(second.removed, true);
});

test('reduced motion skips the overlay', () => {
  const storage = { getItem: () => null, setItem: () => {} };
  const page = visit(storage, true);
  assert.equal(page.classes.has('intro-play'), false);
  page.ready();
  assert.equal(page.removed, true);
});

test('blocked storage keeps the page usable', () => {
  const storage = { getItem() { throw new Error('blocked'); } };
  const page = visit(storage);
  assert.equal(page.classes.has('intro-play'), false);
  page.ready();
  assert.equal(page.removed, true);
});
