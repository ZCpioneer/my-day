import { describe, it, expect } from "vitest";
import { bytesToBase64, encodeWav, floatToPcm16, mixToMono, resampleLinear } from "@/speech/wav";

describe("speech/wav", () => {
  it("resampleLinear：同采样率原样返回副本，48k→16k 长度变 1/3", () => {
    const src = new Float32Array(4800).fill(0.5);
    const same = resampleLinear(src, 16000, 16000);
    expect(same).toHaveLength(4800);
    expect(same).not.toBe(src);
    const down = resampleLinear(src, 48000, 16000);
    expect(down).toHaveLength(1600);
    expect(down[0]).toBeCloseTo(0.5);
  });

  it("mixToMono：多声道取平均", () => {
    const l = new Float32Array([1, -1]);
    const r = new Float32Array([0.5, 0.5]);
    const mono = mixToMono([l, r]);
    expect(mono[0]).toBeCloseTo(0.75);
    expect(mono[1]).toBeCloseTo(-0.25);
    expect(mixToMono([l])).toBe(l);
  });

  it("floatToPcm16：满幅映射并截断溢出", () => {
    const pcm = floatToPcm16(new Float32Array([1, -1, 0, 2, -2]));
    expect(pcm[0]).toBe(0x7fff);
    expect(pcm[1]).toBe(-0x8000);
    expect(pcm[2]).toBe(0);
    expect(pcm[3]).toBe(0x7fff);
    expect(pcm[4]).toBe(-0x8000);
  });

  it("encodeWav：44 字节头 + PCM 数据，字段正确", () => {
    const pcm = floatToPcm16(new Float32Array(160)); // 10ms @16k
    const buf = encodeWav(pcm, 16000);
    expect(buf.byteLength).toBe(44 + 320);
    const v = new DataView(buf);
    const str = (off: number, len: number) =>
      String.fromCharCode(...new Uint8Array(buf, off, len));
    expect(str(0, 4)).toBe("RIFF");
    expect(str(8, 4)).toBe("WAVE");
    expect(v.getUint16(22, true)).toBe(1); // 单声道
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16); // 位深
    expect(v.getUint32(40, true)).toBe(320); // data 大小
  });

  it("bytesToBase64：能还原原始字节", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 97, 98, 99]);
    const b64 = bytesToBase64(bytes);
    const back = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect([...back]).toEqual([...bytes]);
  });
});
