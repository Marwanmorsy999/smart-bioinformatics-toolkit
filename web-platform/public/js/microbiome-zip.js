// Minimal ZIP entry extraction used by the microbiome page and the Worker for
// the documented Moving Pictures public dataset. Pure JS + Web Streams only;
// no Node dependency, no network call, no synthetic data.

function decodeName(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

async function inflateRaw(bytes, method) {
  if (method === 0) return bytes;
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream is unavailable; compressed ZIP entries cannot be extracted.");
  }
  const formats = method === 8 ? ["deflate-raw", "deflate"] : [];
  let lastError = null;
  for (const format of formats) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`unsupported ZIP compression method ${method}`);
}

// Locate entries from the LOCAL file headers. The official tutorial archive
// stores both FASTQ files uncompressed or deflated with local headers present;
// a central-directory fallback is used when sizes are only in the directory.
export async function extractZipEntries(buffer, wantedNames = []) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wanted = new Set(wantedNames);
  const found = new Map();
  const signature = (at) => view.getUint32(at, true);

  // Central directory fallback: streaming ZIPs leave local sizes at zero. The
  // directory still records the authoritative method, size and local offset.
  const directory = new Map();
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 66_000); at -= 1) {
    if (signature(at) === 0x06054b50) { eocd = at; break; }
  }
  if (eocd >= 0) {
    const count = view.getUint16(eocd + 10, true);
    let cursor = view.getUint32(eocd + 16, true);
    for (let index = 0; index < count && cursor + 46 <= bytes.length; index += 1) {
      if (signature(cursor) !== 0x02014b50) break;
      const method = view.getUint16(cursor + 10, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const nameLen = view.getUint16(cursor + 28, true);
      const extraLen = view.getUint16(cursor + 30, true);
      const commentLen = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const name = decodeName(bytes.subarray(cursor + 46, cursor + 46 + nameLen)).replace(/\\/g, "/");
      directory.set(name, { method, compressedSize, localOffset });
      cursor += 46 + nameLen + extraLen + commentLen;
    }
  }

  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const sig = signature(offset);
    if (sig === 0x04034b50) {
      const flags = view.getUint16(offset + 6, true);
      const method = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const uncompressedSize = view.getUint32(offset + 22, true);
      const nameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      const nameStart = offset + 30;
      const name = decodeName(bytes.subarray(nameStart, nameStart + nameLength)).replace(/\\/g, "/");
      const dataStart = nameStart + nameLength + extraLength;
      const fromDirectory = directory.get(name) ?? null;
      const effectiveSize = compressedSize || fromDirectory?.compressedSize || 0;
      const effectiveMethod = fromDirectory ? fromDirectory.method : method;
      const advance = effectiveSize > 0 ? dataStart + effectiveSize : offset + 30 + nameLength + extraLength;
      if ((!wanted.size || wanted.has(name) || wanted.has(name.split("/").pop())) && !found.has(name)) {
        if (effectiveSize > 0 && dataStart + effectiveSize <= bytes.length) {
          try {
            const raw = bytes.subarray(dataStart, dataStart + effectiveSize);
            const content = await inflateRaw(raw, effectiveMethod);
            found.set(name, { bytes: content.length, data: content, text: new TextDecoder().decode(content) });
          } catch (error) {
            found.set(name, { error: error?.message ?? String(error) });
          }
        } else {
          found.set(name, { error: "zip_entry_size_unavailable" });
        }
      }
      offset = advance;
    } else if (sig === 0x02014b50 || sig === 0x06054b50) {
      break;
    } else {
      offset += 1;
    }
  }
  return found;
}

// The tutorial archive stores gzip-compressed FASTQ entries; inflate that
// second layer here. A plain FASTQ entry passes through unchanged.
export async function maybeGunzip(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!(input[0] === 0x1f && input[1] === 0x8b)) return input;
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream is unavailable; gzip FASTQ entries cannot be read.");
  }
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const PUBLIC_DATASETS = Object.freeze({
  "moving-pictures-2026.10": Object.freeze({
    label: "Official Moving Pictures tutorial data (2026.10)",
    metadata_url: "https://moving-pictures-tutorial.readthedocs.io/en/2026.10/data/moving-pictures/sample-metadata.tsv",
    sequences_zip_url: "https://moving-pictures-tutorial.readthedocs.io/en/2026.10/data/moving-pictures/emp-single-end-sequences.zip",
    expected_metadata_sha256: "245f8e389ddf3dd05a95d870d214de918a06d03c5ce17750860446e09f9a7cc6",
    expected_zip_sha256: "992740724f9a8000e5d81bc23a6c2bb74e4aed4cc3542768a220a36bae22d373",
    sequence_entry: "emp-single-end-sequences/sequences.fastq.gz",
    barcode_entry: "emp-single-end-sequences/barcodes.fastq.gz",
    expected_samples: 34,
    expected_reads: 302581,
    rationale: "Mean quality stays high through position 120 (Q≈19.6) then declines steeply to Q≈3.8 by position 150; trim-left 0 and trunc-len 120 follow the observed data, not a copied tutorial value."
  })
});

export async function sha256Bytes(bytes) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
