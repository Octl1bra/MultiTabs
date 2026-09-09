/**
 * MAIN world 补丁。禁止引用 chrome.*，禁止改变页面可见行为。
 * 所有段落各自 try/catch，一段失败不影响其它段。
 */
import {
  cookieKey,
  cookiesForHost,
  domainMatches,
  parseSetCookie,
  serializeCookieHeader,
} from "@/src/lib/cookie";
import type { ExtToPage, PageToExt } from "@/src/messaging";
import { STORAGE_PREFIX, type PageCookie, type PatchConfig } from "@/src/lib/types";

type JarCookie = PageCookie & { createdAt: number };

export function install(cfg: PatchConfig): void {
  const w = window as Window & typeof globalThis;
  if (w.__mt__?.installed) return;
  const prefix = `${STORAGE_PREFIX}${cfg.sid}:`;
  const storages = safe(() => patchWebStorage(prefix));
  safe(() => installNamespacePatches(prefix));
  const cookies = safe(() => patchCookies(cfg.cookies));
  Object.defineProperty(w, "__mt__", {
    value: Object.freeze({
      installed: true as const,
      cfg,
      update: (list: PageCookie[]) => cookies?.replace(list),
    }),
    configurable: false,
    enumerable: false,
    writable: false,
  });
  safe(() => patchWorkers(prefix));
  safe(() => blockServiceWorker());

  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== window) return;
    const d = e.data as ExtToPage | undefined;
    if (!d || d.__mt !== "ext") return;
    if (d.type === "cookiesUpdated") {
      cookies?.replace(d.cookies);
    } else if (d.type === "clearStorage") {
      storages?.clearAll();
      safe(() => clearNamespaces());
    }
  });
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    try {
      console.debug("[MultiTabs] patch section failed", err);
    } catch {
      /* ignore */
    }
    return undefined;
  }
}

function post(msg: PageToExt): void {
  window.postMessage(msg, "*");
}

/* ------------------------------------------------------------------ */
/* localStorage / sessionStorage                                        */
/* ------------------------------------------------------------------ */

function makeStorageProxy(real: Storage, prefix: string): Storage {
  const ownKeys = (): string[] => {
    const ks: string[] = [];
    for (let i = 0; i < real.length; i++) {
      const k = real.key(i);
      if (k !== null && k.startsWith(prefix)) ks.push(k.slice(prefix.length));
    }
    return ks;
  };
  const methods: Record<string, (...args: any[]) => unknown> = {
    getItem: (k: unknown) => real.getItem(prefix + String(k)),
    setItem: (k: unknown, v: unknown) => real.setItem(prefix + String(k), String(v)),
    removeItem: (k: unknown) => real.removeItem(prefix + String(k)),
    clear: () => {
      for (const k of ownKeys()) real.removeItem(prefix + k);
    },
    key: (i: unknown) => ownKeys()[Number(i)] ?? null,
  };
  const target = Object.create(Storage.prototype) as Storage;
  return new Proxy(target, {
    get(_t, p) {
      if (p === "length") return ownKeys().length;
      if (typeof p === "symbol") return p === Symbol.toStringTag ? "Storage" : undefined;
      if (Object.prototype.hasOwnProperty.call(methods, p)) return methods[p];
      const v = real.getItem(prefix + p);
      return v === null ? undefined : v;
    },
    set(_t, p, v) {
      if (typeof p === "string") real.setItem(prefix + p, String(v));
      return true;
    },
    deleteProperty(_t, p) {
      if (typeof p === "string") real.removeItem(prefix + p);
      return true;
    },
    has(_t, p) {
      if (typeof p !== "string") return false;
      return (
        p === "length" ||
        Object.prototype.hasOwnProperty.call(methods, p) ||
        real.getItem(prefix + p) !== null
      );
    },
    ownKeys() {
      return ownKeys();
    },
    getOwnPropertyDescriptor(_t, p) {
      if (typeof p !== "string") return undefined;
      const v = real.getItem(prefix + p);
      if (v === null) return undefined;
      return { value: v, writable: true, enumerable: true, configurable: true };
    },
  });
}

function patchWebStorage(prefix: string): { clearAll(): void } {
  const realLocal = window.localStorage;
  const realSession = window.sessionStorage;
  const localProxy = makeStorageProxy(realLocal, prefix);
  const sessionProxy = makeStorageProxy(realSession, prefix);
  Object.defineProperty(window, "localStorage", { get: () => localProxy, configurable: true });
  Object.defineProperty(window, "sessionStorage", { get: () => sessionProxy, configurable: true });

  const synthetic = new WeakSet<Event>();
  window.addEventListener(
    "storage",
    (e: StorageEvent) => {
      if (synthetic.has(e)) return;
      if (e.key === null) return; // 真实 storage 的 clear()，放行
      if (!e.key.startsWith(prefix)) {
        e.stopImmediatePropagation(); // 别的会话或主会话的 key，本页不该看到
        return;
      }
      const area =
        e.storageArea === realLocal
          ? localProxy
          : e.storageArea === realSession
            ? sessionProxy
            : null;
      let ev: StorageEvent;
      try {
        // StorageEvent 构造器对 storageArea 做 WebIDL 类型检查，只认真正的 Storage，
        // Proxy 会抛 "Failed to convert value to 'Storage'"。先用真实对象构造，再在实例上盖成代理。
        ev = new StorageEvent("storage", {
          key: e.key.slice(prefix.length),
          oldValue: e.oldValue,
          newValue: e.newValue,
          url: e.url,
          storageArea: e.storageArea,
        });
        if (area) Object.defineProperty(ev, "storageArea", { value: area, configurable: true });
      } catch {
        return; // 构造失败就让原事件（带前缀 key）继续传，好过页面什么都收不到
      }
      e.stopImmediatePropagation();
      synthetic.add(ev);
      window.dispatchEvent(ev);
    },
    true,
  );

  return {
    clearAll() {
      localProxy.clear();
      sessionProxy.clear();
    },
  };
}

/* ------------------------------------------------------------------ */
/* IndexedDB / CacheStorage / BroadcastChannel                          */
/* 自包含：也会被 toString() 后塞进 Worker 前置代码，只能引用全局对象     */
/* ------------------------------------------------------------------ */

function installNamespacePatches(prefix: string): void {
  const g = self as any;
  const strip = (n: unknown) =>
    typeof n === "string" && n.startsWith(prefix) ? n.slice(prefix.length) : n;

  const IDBF = g.IDBFactory && g.IDBFactory.prototype;
  if (IDBF && !IDBF.__mtPatched) {
    const open = IDBF.open;
    const del = IDBF.deleteDatabase;
    const dbs = IDBF.databases;
    IDBF.open = function (name: unknown, ...rest: unknown[]) {
      return open.call(this, prefix + String(name), ...rest);
    };
    IDBF.deleteDatabase = function (name: unknown, ...rest: unknown[]) {
      return del.call(this, prefix + String(name), ...rest);
    };
    if (dbs) {
      IDBF.databases = function () {
        return dbs
          .call(this)
          .then((list: Array<{ name?: string; version?: number }>) =>
            list
              .filter((d) => typeof d.name === "string" && d.name.startsWith(prefix))
              .map((d) => ({ name: (d.name as string).slice(prefix.length), version: d.version })),
          );
      };
    }
    Object.defineProperty(IDBF, "__mtPatched", { value: true });
    const DBP = g.IDBDatabase && g.IDBDatabase.prototype;
    const desc = DBP && Object.getOwnPropertyDescriptor(DBP, "name");
    if (desc && desc.get) {
      const get = desc.get;
      Object.defineProperty(DBP, "name", {
        get() {
          return strip(get.call(this));
        },
        configurable: true,
        enumerable: desc.enumerable,
      });
    }
  }

  const CSP = g.CacheStorage && g.CacheStorage.prototype;
  if (CSP && !CSP.__mtPatched) {
    const open = CSP.open;
    const has = CSP.has;
    const del = CSP.delete;
    const keys = CSP.keys;
    const match = CSP.match;
    CSP.open = function (n: unknown) {
      return open.call(this, prefix + String(n));
    };
    CSP.has = function (n: unknown) {
      return has.call(this, prefix + String(n));
    };
    CSP.delete = function (n: unknown) {
      return del.call(this, prefix + String(n));
    };
    CSP.keys = function () {
      return keys
        .call(this)
        .then((ks: string[]) =>
          ks.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)),
        );
    };
    CSP.match = function (req: unknown, opts?: { cacheName?: string } & Record<string, unknown>) {
      if (opts && typeof opts.cacheName === "string") {
        return match.call(this, req, { ...opts, cacheName: prefix + opts.cacheName });
      }
      // 没指定 cacheName：只在本会话的 cache 里找
      const lookup = async (cs: unknown, ks: string[]) => {
        for (const k of ks) {
          if (!k.startsWith(prefix)) continue;
          const r = await match.call(cs, req, { ...(opts || {}), cacheName: k });
          if (r) return r;
        }
        return undefined;
      };
      return keys.call(this).then((ks: string[]) => lookup(this, ks));
    };
    Object.defineProperty(CSP, "__mtPatched", { value: true });
  }

  const BC = g.BroadcastChannel;
  if (typeof BC === "function" && !BC.__mtPatched) {
    const Patched = class extends BC {
      constructor(name: unknown) {
        super(prefix + String(name));
      }
      get name(): string {
        return strip(super.name) as string;
      }
    };
    Object.defineProperty(Patched, "name", { value: "BroadcastChannel" });
    Object.defineProperty(Patched, "__mtPatched", { value: true });
    g.BroadcastChannel = Patched;
  }
}

async function clearNamespaces(): Promise<void> {
  // 调用的是已打补丁的 API，所以只影响本会话前缀
  try {
    const dbs = await indexedDB.databases();
    for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name);
  } catch {
    /* ignore */
  }
  try {
    for (const k of await caches.keys()) await caches.delete(k);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* document.cookie / cookieStore                                        */
/* ------------------------------------------------------------------ */

function patchCookies(initial: PageCookie[]): { replace(list: PageCookie[]): void } {
  const host = location.hostname.toLowerCase();
  const secureCtx = location.protocol === "https:";
  const jar = new Map<string, JarCookie>();
  let seq = 0;
  const listeners = new Set<() => void>();

  const replace = (list: PageCookie[]) => {
    jar.clear();
    seq = 0;
    for (const c of list) jar.set(cookieKey(c), { ...c, createdAt: seq++ });
    for (const fn of listeners) safe(fn);
  };
  replace(initial);

  const visible = (): JarCookie[] =>
    cookiesForHost([...jar.values()], host, { secureContext: secureCtx, includeHttpOnly: false });
  const view = (): string => serializeCookieHeader(visible());

  const setCookie = (raw: string): void => {
    const parsed = parseSetCookie(raw, new URL(location.href));
    if (!parsed) return;
    const c = parsed.cookie;
    if (c.httpOnly) return; // 脚本不能设 HttpOnly
    if (c.secure && !secureCtx) return;
    if (!domainMatches(host, c.domain, c.hostOnly)) return;
    const k = cookieKey(c);
    if (parsed.isDeletion) jar.delete(k);
    else
      jar.set(k, {
        name: c.name,
        value: c.value,
        domain: c.domain,
        hostOnly: c.hostOnly,
        path: c.path,
        secure: c.secure,
        sameSite: c.sameSite,
        expires: c.expires,
        createdAt: jar.get(k)?.createdAt ?? seq++,
      });
    post({ __mt: "page", type: "setCookie", header: raw });
    for (const fn of listeners) safe(fn);
  };

  Object.defineProperty(Document.prototype, "cookie", {
    get() {
      return view();
    },
    set(v: unknown) {
      setCookie(String(v));
    },
    configurable: true,
    enumerable: true,
  });

  if ("cookieStore" in window) {
    const target = new EventTarget();
    const toItem = (c: JarCookie) => ({
      name: c.name,
      value: c.value,
      domain: c.hostOnly ? null : c.domain,
      path: c.path,
      expires: c.expires,
      secure: c.secure,
      sameSite: c.sameSite === "unspecified" ? "lax" : c.sameSite,
      partitioned: false,
    });
    const filterBy = (arg: unknown) => {
      const opt = typeof arg === "string" ? { name: arg } : ((arg ?? {}) as { name?: string });
      return visible().filter((c) => opt.name === undefined || c.name === opt.name);
    };
    const buildHeader = (a: unknown, b?: unknown): string => {
      const o =
        typeof a === "string"
          ? { name: a, value: String(b ?? "") }
          : ((a ?? {}) as {
              name?: string;
              value?: string;
              domain?: string | null;
              path?: string;
              expires?: number | Date | null;
              sameSite?: string;
            });
      let h = `${o.name ?? ""}=${o.value ?? ""}; Path=${o.path ?? "/"}`;
      if (o.domain) h += `; Domain=${o.domain}`;
      if (o.expires !== undefined && o.expires !== null) {
        const t = o.expires instanceof Date ? o.expires.getTime() : Number(o.expires);
        h += `; Expires=${new Date(t).toUTCString()}`;
      }
      if (o.sameSite) h += `; SameSite=${o.sameSite}`;
      if (secureCtx) h += "; Secure";
      return h;
    };
    const cs = {
      get: async (arg: unknown) => filterBy(arg).map(toItem)[0] ?? null,
      getAll: async (arg?: unknown) => filterBy(arg).map(toItem),
      set: async (a: unknown, b?: unknown) => {
        setCookie(buildHeader(a, b));
      },
      delete: async (a: unknown) => {
        const o =
          typeof a === "string"
            ? { name: a }
            : ((a ?? {}) as { name?: string; domain?: string | null; path?: string });
        let h = `${o.name ?? ""}=; Max-Age=0; Path=${o.path ?? "/"}`;
        if (o.domain) h += `; Domain=${o.domain}`;
        setCookie(h);
      },
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
      onchange: null as null | ((e: Event) => void),
    };
    listeners.add(() => {
      const ev = new Event("change");
      Object.defineProperty(ev, "changed", { value: visible().map(toItem) });
      Object.defineProperty(ev, "deleted", { value: [] });
      target.dispatchEvent(ev);
      if (typeof cs.onchange === "function") cs.onchange(ev);
    });
    Object.defineProperty(window, "cookieStore", { value: cs, configurable: true });
  }

  return { replace };
}

/* ------------------------------------------------------------------ */
/* Worker / SharedWorker                                                */
/* ------------------------------------------------------------------ */

function rewriteWorkerUrl(url: unknown, prefix: string): string | URL {
  let u: URL;
  try {
    u = new URL(String(url), location.href);
  } catch {
    return url as string;
  }
  if (u.origin !== location.origin || (u.protocol !== "http:" && u.protocol !== "https:")) {
    return url as string;
  }
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", u.href, false);
    xhr.send();
    if (xhr.status < 200 || xhr.status >= 300) return url as string;
    const prelude = `(${installNamespacePatches.toString()})(${JSON.stringify(prefix)});\n`;
    return URL.createObjectURL(new Blob([prelude + xhr.responseText], { type: "text/javascript" }));
  } catch {
    return url as string;
  }
}

function patchWorkers(prefix: string): void {
  const OW = window.Worker;
  if (typeof OW === "function") {
    const PW = class extends OW {
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(rewriteWorkerUrl(url, prefix), opts);
      }
    };
    Object.defineProperty(PW, "name", { value: "Worker" });
    window.Worker = PW;
  }
  const OSW = window.SharedWorker;
  if (typeof OSW === "function") {
    const PSW = class extends OSW {
      constructor(url: string | URL, opts?: string | WorkerOptions) {
        super(rewriteWorkerUrl(url, prefix), opts);
      }
    };
    Object.defineProperty(PSW, "name", { value: "SharedWorker" });
    window.SharedWorker = PSW;
  }
}

/* ------------------------------------------------------------------ */
/* ServiceWorker：阻断                                                   */
/* ------------------------------------------------------------------ */

function blockServiceWorker(): void {
  const sw = navigator.serviceWorker;
  if (!sw) return;
  const proto = ServiceWorkerContainer.prototype;
  proto.register = function () {
    return Promise.reject(
      new DOMException(
        "Service worker registration is blocked by MultiTabs in this session tab",
        "SecurityError",
      ),
    );
  };
  const controlled = !!sw.controller;
  sw.getRegistrations()
    .then(async (regs) => {
      for (const r of regs) await r.unregister().catch(() => {});
      if (controlled && regs.length) {
        // 本次加载仍被旧 SW 接管，注销后重载一次逃出来
        const flag = "mt:swreload";
        const store = window.sessionStorage; // 已是本会话前缀视图，够用
        if (store.getItem(flag) === location.href) return;
        store.setItem(flag, location.href);
        location.reload();
      }
    })
    .catch(() => {});
}
