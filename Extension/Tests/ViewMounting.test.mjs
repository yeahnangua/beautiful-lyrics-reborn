import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { Maid } from "../../Universal/Modules/Maid.ts";
import { Signal } from "../../Universal/Modules/Signal.ts";

const source = stripTypeScriptTypes(await readFile(new URL("../Source/LyricViews/mod.ts", import.meta.url), "utf8"))
  .replace(/^import\s+["'][^"']+["'];?\s*$/gm, "")
  .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "");
const main = ":is(#main-view, .Root__main-view)";
const queries = {
  current: `${main} .main-view-container div[data-overlayscrollbars-viewport]`,
  legacy: `${main} .main-view-container .os-host`,
  native: `${main} .main-view-container__scroll-node`,
};

async function withViews(run) {
  const frames = new Map(), listeners = new Set(), buttons = [], views = [], nodes = new Map();
  let nextFrame = 0;
  class Observer { observe() {} disconnect() {} }
  const overrides = { MutationObserver: Observer, ResizeObserver: Observer, Element: class {}, cancelAnimationFrame: id => frames.delete(id) };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, globalThis[key]]));
  Object.assign(globalThis, overrides);
  const maid = new Maid();
  const history = {
    location: { pathname: "/" },
    listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    push(value) {
      this.location = typeof value === "string" ? { pathname: value } : value;
      for (const fn of [...listeners]) fn(this.location);
    },
  };
  class Button {
    element = { style: {}, setAttribute() {} };
    constructor(label, icon, onClick) { this.onClick = onClick; buttons.push(this); }
    register() {} deregister() {}
  }
  class Page {
    Closed = new Signal();
    constructor(node, legacy) { this.node = node; this.legacy = legacy; views.push(this); }
    Close() { history.push("/"); }
    Destroy() { this.Closed.Fire(); }
  }
  class Fullscreen extends Page {}
  const mocks = {
    Maid, GlobalMaid: maid, OnSpotifyReady: Promise.resolve(),
    Defer: fn => { frames.set(++nextFrame, fn); return [2, nextFrame]; }, Timeout: () => () => {},
    SpotifyHistory: history, SpotifyPlaybar: { Button },
    Song: {}, SongChanged: new Signal(), SongLyrics: undefined,
    SongLyricsLoaded: new Signal(), HaveSongLyricsLoaded: false,
    checkKey: () => false, Icons: {}, ContainedPageView: Page, FullscreenPageView: Fullscreen,
    document: { querySelector: selector => nodes.get(selector) ?? null },
  };
  // Prevent the unrelated playbar-removal stage from polling in this fixture.
  nodes.set(".main-nowPlayingBar-extraControls", { children: [] });
  try {
    new Function(...Object.keys(mocks), source)(...Object.values(mocks));
    for (let tick = 0; tick < 8; tick++) await Promise.resolve();
    await run({ history, buttons, views, nodes, frames, listeners, Page, Fullscreen,
      flush() { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); } });
  } finally {
    maid.Destroy();
    assert.equal(frames.size, 0);
    assert.equal(listeners.size, 0);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
}

test("page mounts in current, legacy, and Windows native scroll containers", async () => {
  for (const kind of ["current", "legacy", "native"]) {
    await withViews(({ nodes, buttons, views }) => {
      const node = { id: "main-view", className: "bTgBWvuzt0s_dQWLj2OL" };
      nodes.set(queries[kind], node);
      buttons[0].onClick();
      assert.equal(views.length, 1);
      assert.equal(views[0].node, node);
      assert.equal(views[0].legacy, kind === "legacy");
      assert.equal(buttons[0].active, true);
    });
  }
});

test("fullscreen opens without a main viewport or right sidebar", async () => {
  await withViews(({ buttons, views, history, Fullscreen }) => {
    buttons[1].onClick();
    assert.equal(history.location.pathname, "/BeautifulLyrics/Fullscreen");
    assert.equal(views.length, 1);
    assert.ok(views[0] instanceof Fullscreen);
    assert.equal(views[0].node, true); // FromPlaybar is passed through.
  });
});

test("a delayed page mount remains bounded and is cancelled when switching to fullscreen", async () => {
  await withViews(({ buttons, history, nodes, views, frames, flush, Fullscreen }) => {
    buttons[0].onClick();
    assert.equal(views.length, 0);
    const waitingTasks = frames.size;
    for (let tick = 0; tick < 20; tick++) { flush(); assert.equal(frames.size, waitingTasks); }
    buttons[1].onClick();
    nodes.set(queries.native, {});
    flush();
    assert.equal(history.location.pathname, "/BeautifulLyrics/Fullscreen");
    assert.equal(views.length, 1);
    assert.ok(views[0] instanceof Fullscreen);
  });
});

test("delayed containers mount once and are reacquired after navigating away", async () => {
  await withViews(({ buttons, history, nodes, views, flush }) => {
    buttons[0].onClick();
    const first = {};
    nodes.set(queries.native, first);
    flush();
    assert.equal(views.length, 1);
    assert.equal(views[0].node, first);
    history.push("/");
    assert.equal(buttons[0].active, false);
    const replacement = {};
    nodes.set(queries.native, replacement);
    buttons[0].onClick();
    assert.equal(views.length, 2);
    assert.equal(views[1].node, replacement);
  });
});
