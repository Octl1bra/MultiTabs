/**
 * chrome.storage 的内存镜像 + 进程内互斥。
 *
 * 为什么要镜像：登录响应的 Set-Cookie 之后紧跟 302，跳转目标的请求几毫秒内就发出去了，
 * 规则更新链路上每一次 storage 读都是一次 IPC，加起来就输给浏览器。
 * 本 service worker 是唯一写入方，所以镜像和真实存储不会分叉；SW 被杀后镜像重新加载。
 * 写入仍然 await，保证 SW 被杀时最多丢最后一次写。
 */

type Area = chrome.storage.StorageArea;

class MirroredArea {
  private data: Record<string, unknown> | null = null;
  private loading: Promise<void> | null = null;

  constructor(private readonly area: Area) {}

  private async ensure(): Promise<Record<string, unknown>> {
    if (this.data) return this.data;
    if (!this.loading) {
      this.loading = this.area.get(null).then((all) => {
        this.data ??= { ...all };
      });
    }
    await this.loading;
    return this.data!;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return (await this.ensure())[key] as T | undefined;
  }

  async getAll(): Promise<Record<string, unknown>> {
    return { ...(await this.ensure()) };
  }

  /**
   * 写入不阻塞调用方：镜像同步更新，真实写入排队（chrome.storage 调用按发起顺序落盘）。
   * 规则更新的热路径上少几次 IPC 往返，代价是 SW 被杀时最多丢最后几毫秒的写。
   */
  async set(items: Record<string, unknown>): Promise<void> {
    const d = await this.ensure();
    Object.assign(d, items);
    this.pending = this.pending
      .then(() => this.area.set(items))
      .catch((e) => log("storage set", e));
  }

  async remove(keys: string | string[]): Promise<void> {
    const d = await this.ensure();
    for (const k of Array.isArray(keys) ? keys : [keys]) delete d[k];
    this.pending = this.pending
      .then(() => this.area.remove(keys))
      .catch((e) => log("storage remove", e));
  }

  private pending: Promise<void> = Promise.resolve();

  /** 等所有排队的写入落盘（测试和删除会话等需要确定性的地方用） */
  flush(): Promise<void> {
    return this.pending;
  }
}

export const local = new MirroredArea(chrome.storage.local);
export const session = new MirroredArea(chrome.storage.session);

const chains = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(
    key,
    next.catch(() => {}),
  );
  void next.finally(() => {
    if (chains.get(key) === next) chains.delete(key);
  });
  return next;
}

export function log(...args: unknown[]): void {
  console.debug("[MultiTabs]", ...args);
}
