// Browser APIs jsdom does not implement, stubbed so component tests can
// mount components that use them.
//
// Shims here rather than feature checks in the components, which would put
// test concerns into product code.

if (!('ResizeObserver' in globalThis)) {
  // Never fires. Components also do an initial layout pass, and jsdom has no
  // layout to resize.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
