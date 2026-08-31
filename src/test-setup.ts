// Browser APIs jsdom does not implement, stubbed so component tests can
// mount components that use them.
//
// These are shims for the test environment, never guards in the product:
// making a component ask "does ResizeObserver exist" to satisfy a test would
// put test concerns into flight code, and would hide the day a real browser
// turned out not to have it.

if (!('ResizeObserver' in globalThis)) {
  // Never fires. Every component that observes also does an initial layout
  // pass, so what is under test still renders; only the resize path is
  // inert, and jsdom has no layout to resize.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
