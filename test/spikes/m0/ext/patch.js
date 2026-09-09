// MAIN world, document_start, all frames.
(() => {
  const navs = performance.getEntriesByType('navigation');
  const nav = navs[0];
  const st = nav?.serverTiming ?? null;
  const stJson = JSON.stringify(st);
  const de = document.documentElement;
  let wroteDataset = false;
  if (de) {
    de.dataset.mtSignal = stJson;
    wroteDataset = true;
  }
  window.__mtProbe = {
    navEntryCount: navs.length,
    hasNavEntry: !!nav,
    serverTiming: st ? st.map(e => ({ name: e.name, duration: e.duration, description: e.description })) : null,
    hasMt: !!st?.some(e => e.name === 'mt'),
    hasSite: !!st?.some(e => e.name === 'site'),
    documentElementExists: !!de,
    wroteDataset,
    readyState: document.readyState,
    currentScript: document.currentScript === null ? null : String(document.currentScript),
    headChildCount: document.head ? document.head.childElementCount : null,
    bodyExists: !!document.body,
    href: location.href,
    isTop: window === window.top,
    t: performance.now(),
  };
})();
