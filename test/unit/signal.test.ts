import {
  decodeSignalDesc,
  encodeSignalDesc,
  encodeSignalHeader,
  SIGNAL_MAX_BYTES,
} from "@/src/lib/signal";
import type { PatchConfig } from "@/src/lib/types";

const cfg: PatchConfig = {
  sid: "abc123",
  cookies: [
    {
      name: "who",
      value: "中文=;",
      domain: "localtest.me",
      hostOnly: false,
      path: "/",
      secure: true,
      sameSite: "lax",
      expires: null,
    },
  ],
};

describe("signal", () => {
  it("往返", () => {
    const desc = encodeSignalDesc(cfg)!;
    expect(desc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSignalDesc(desc)).toEqual(cfg);
    expect(encodeSignalHeader(cfg)).toBe(`mt;desc="${desc}"`);
  });
  it("超长返回 null", () => {
    const big = {
      sid: "x",
      cookies: [{ ...cfg.cookies[0]!, value: "a".repeat(SIGNAL_MAX_BYTES) }],
    };
    expect(encodeSignalDesc(big)).toBeNull();
    expect(encodeSignalHeader(big)).toBeNull();
  });
  it("坏输入返回 null", () => {
    expect(decodeSignalDesc("!!!")).toBeNull();
    expect(decodeSignalDesc(btoa('{"nope":1}'))).toBeNull();
  });
});
