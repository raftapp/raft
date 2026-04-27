/**
 * Browser API adapter.
 *
 * Thin alias over the WebExtensions API. Source files reference the
 * namespaces re-exported from this module instead of touching the chrome.*
 * global directly so that the Firefox/Edge port (Phase 2) can swap the
 * implementation behind this single seam without touching every call site.
 *
 * On Chromium, every browser.* namespace resolves to the matching chrome.*
 * namespace — both values (runtime calls) and types. Resolution is done
 * via live property getters so that any late binding of chrome.* (e.g.
 * test mocks installed after module load) is reflected at the call site.
 */

export namespace browser {
  export import tabs = chrome.tabs
  export import tabGroups = chrome.tabGroups
  export import windows = chrome.windows
  export import storage = chrome.storage
  export import alarms = chrome.alarms
  export import runtime = chrome.runtime
  export import commands = chrome.commands
  export import contextMenus = chrome.contextMenus
  export import action = chrome.action
  export import identity = chrome.identity
}

// Replace the namespace's static value captures with live getters so
// callers always see the current chrome.* binding at access time.
const liveNamespaces = [
  'tabs',
  'tabGroups',
  'windows',
  'storage',
  'alarms',
  'runtime',
  'commands',
  'contextMenus',
  'action',
  'identity',
] as const
for (const name of liveNamespaces) {
  Object.defineProperty(browser, name, {
    get: () => (chrome as Record<string, unknown>)[name],
    configurable: true,
    enumerable: true,
  })
}
