// Helpers exposed on window for page.evaluate. Extension pages can call chrome.* directly.
window.probe = {
  send: (msg) => chrome.runtime.sendMessage(msg),
  storage: () => chrome.storage.local.get(null),
  rules: () => chrome.declarativeNetRequest.getSessionRules(),
  cookies: (filter) => chrome.cookies.getAll(filter ?? {}),
  partitionKey: (details) => chrome.cookies.getPartitionKey(details),
  tabs: (q) => chrome.tabs.query(q ?? {}),
  frames: (tabId) => chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => location.href }),
};
