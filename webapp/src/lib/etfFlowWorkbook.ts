import { inflateRawSync } from "node:zlib";

import { packZip, type ZipFile } from "./xlsxPack";

/** 이미 R2에 올라간 요청 양식에서 운용사 표기만 지운다. 차트·수치는 그대로 둔다. */
const LABEL_SWAPS: Array<[string, string]> = [
  ["미래에셋자산운용", ""],
  ["국내 유사 ETF는 있는 경우.. TIGER면 좀 더 선호", "국내 유사 ETF는 있는 경우"],
  ["TIGER면 좀 더 선호", ""],
];

function unpackZip(input: Uint8Array): ZipFile[] {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("xlsx zip header missing");
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const files: ZipFile[] = [];
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error("xlsx central directory is invalid");
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (!data) throw new Error(`unsupported xlsx compression ${method}`);
    files.push({ name, data });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function stripXml(text: string): string {
  let next = text;
  for (const [from, to] of LABEL_SWAPS) next = next.split(from).join(to);
  return next;
}

/** 다운로드 직전에 미래에셋·TIGER 우선 문구를 시트 XML에서 제거한다. */
export function stripMiraeAssetLabels(input: Uint8Array): Buffer {
  const files = unpackZip(input);
  let changed = false;
  const next = files.map((file) => {
    if (!file.name.endsWith(".xml")) return file;
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const text = raw.toString("utf8");
    const stripped = stripXml(text);
    if (stripped === text) return file;
    changed = true;
    return { name: file.name, data: Buffer.from(stripped, "utf8") };
  });
  return changed ? packZip(next) : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
}
