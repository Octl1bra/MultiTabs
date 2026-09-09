// MV3 service worker.
const RULES = {
  1: {
    id: 1, priority: 1,
    // NOTE: omitting resourceTypes matches every type EXCEPT main_frame (DNR default). Must list explicitly.
    condition: { requestDomains: ['app.localtest.me'], resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'] },
    action: { type: 'modifyHeaders', responseHeaders: [{ header: 'Set-Cookie', operation: 'remove' }] },
  },
  2: {
    id: 2, priority: 1,
    condition: { requestDomains: ['app.localtest.me'], resourceTypes: ['main_frame', 'sub_frame'] },
    action: { type: 'modifyHeaders', responseHeaders: [{ header: 'Server-Timing', operation: 'append', value: 'mt;desc="c3Bpa2U"' }] },
  },
  3: {
    id: 3, priority: 1,
    condition: { requestDomains: ['app.localtest.me'], resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest'] },
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Cache-Control', operation: 'set', value: 'no-cache' }] },
  },
};
globalThis.RULES = RULES;

// ---- webRequest log, registered synchronously at top level ----
let writeChain = Promise.resolve();
function appendLog(rec) {
  writeChain = writeChain.then(async () => {
    const { wrLog = [] } = await chrome.storage.local.get('wrLog');
    wrLog.push(rec);
    await chrome.storage.local.set({ wrLog });
  }).catch(e => console.error('appendLog failed', e));
  return writeChain;
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const interesting = (details.responseHeaders ?? []).filter(h => {
      const n = h.name.toLowerCase();
      return n === 'set-cookie' || n === 'server-timing' || n === 'cache-control';
    });
    appendLog({
      event: 'headersReceived',
      url: details.url,
      type: details.type,
      tabId: details.tabId,
      frameId: details.frameId,
      fromCache: details.fromCache,
      statusCode: details.statusCode,
      requestId: details.requestId,
      timeStamp: details.timeStamp,
      headerCount: (details.responseHeaders ?? []).length,
      headers: interesting.map(h => ({ name: h.name, value: h.value })),
    });
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders', 'extraHeaders'],
);

// fromCache is NOT available on onHeadersReceived details; capture it from onResponseStarted (same requestId).
chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    appendLog({ event: 'responseStarted', requestId: details.requestId, url: details.url, type: details.type, fromCache: details.fromCache, ip: details.ip ?? null, statusCode: details.statusCode });
  },
  { urls: ['<all_urls>'] },
);

// ---- rules ----
async function installRules(ids) {
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const result = { ok: [], failed: [] };
  for (const id of ids) {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id], addRules: [RULES[id]] });
      result.ok.push(id);
    } catch (e) {
      result.failed.push({ id, error: String(e?.message ?? e) });
      // fallback for rule 2: append -> set
      if (id === 2) {
        const alt = structuredClone(RULES[2]);
        alt.action.responseHeaders[0].operation = 'set';
        try {
          await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id], addRules: [alt] });
          result.ok.push('2-as-set');
        } catch (e2) {
          result.failed.push({ id: '2-as-set', error: String(e2?.message ?? e2) });
        }
      }
    }
  }
  await chrome.storage.local.set({ rulesInstall: { at: Date.now(), before: existing.map(r => r.id), result } });
  return result;
}
globalThis.installRules = installRules;

chrome.runtime.onInstalled.addListener(async (d) => {
  await chrome.storage.local.set({ wrLog: [], installedReason: d.reason });
  // Only rules 1 and 2 at install; rule 3 is added by the test script (via probe page) for the cache phase.
  await installRules([1, 2]);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.cmd) {
      case 'getLog': return (await chrome.storage.local.get(['wrLog', 'rulesInstall', 'installedReason']));
      case 'clearLog': await chrome.storage.local.set({ wrLog: [] }); return { ok: true };
      case 'installRules': return installRules(msg.ids);
      case 'removeRules': await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: msg.ids }); return { ok: true };
      case 'getRules': return chrome.declarativeNetRequest.getSessionRules();
      case 'cookies': return chrome.cookies.getAll(msg.filter ?? {});
      case 'partitionKey': return chrome.cookies.getPartitionKey(msg.details);
      default: return { error: 'unknown cmd' };
    }
  })().then(sendResponse, e => sendResponse({ error: String(e?.message ?? e) }));
  return true;
});
