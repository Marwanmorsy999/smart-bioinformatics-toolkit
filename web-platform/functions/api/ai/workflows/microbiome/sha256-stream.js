// M7.14.2 pure-JS incremental SHA-256 for the official SILVA classifier.
//
// The classifier is ~218 MB. A Worker must never hold the whole file in memory:
// callers stream bounded chunks through createSha256() and compare the final
// digest with the published checksum before any upload is attempted. No R2,
// no provider key, no external hashing service and no platform-specific API is
// used. All values returned here come from the bytes actually read.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
]);

const rotr = (value, shift) => (value >>> shift) | (value << (32 - shift));
const hex32 = (value) => (value >>> 0).toString(16).padStart(8, "0");

/**
 * Incremental SHA-256. update() accepts any byte view (or a string, encoded as
 * UTF-8 for convenience in tests); digest() may be called at any point without
 * destroying accumulated state, so callers can stream chunks of any size.
 */
export function createSha256() {
  const state = H0.slice();
  const block = new Uint8Array(64);
  const w = new Uint32Array(64);
  let buffered = 0;
  let total = 0;

  function compress() {
    for (let index = 0; index < 16; index += 1) {
      const offset = index * 4;
      w[index] = (((block[offset] << 24) | (block[offset + 1] << 16)
        | (block[offset + 2] << 8) | block[offset + 3]) >>> 0);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = w[index - 15];
      const right = w[index - 2];
      const s0 = rotr(left, 7) ^ rotr(left, 18) ^ (left >>> 3);
      const s1 = rotr(right, 17) ^ rotr(right, 19) ^ (right >>> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choose + K[index] + w[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
    buffered = 0;
  }

  function update(bytes) {
    let source;
    if (typeof bytes === "string") source = new TextEncoder().encode(bytes);
    else if (bytes instanceof Uint8Array) source = bytes;
    else if (bytes instanceof ArrayBuffer) source = new Uint8Array(bytes);
    else if (bytes && typeof bytes.byteLength === "number" && typeof bytes.buffer === "object") {
      source = new Uint8Array(bytes.buffer, bytes.byteOffset ?? 0, bytes.byteLength);
    } else throw new Error("sha256 update requires bytes");
    total += source.length;
    let offset = 0;
    while (offset < source.length) {
      const take = Math.min(64 - buffered, source.length - offset);
      block.set(source.subarray(offset, offset + take), buffered);
      buffered += take;
      offset += take;
      if (buffered === 64) compress();
    }
    return { bytes: total };
  }

  function digest() {
    // Clone the intermediate state so digest() can be called for progress
    // inspection without corrupting a stream that continues afterwards.
    const savedState = state.slice();
    const savedBlock = block.slice();
    const savedBuffered = buffered;
    const savedTotal = total;
    block[buffered] = 0x80;
    buffered += 1;
    if (buffered > 56) {
      while (buffered < 64) { block[buffered] = 0; buffered += 1; }
      compress();
    }
    while (buffered < 56) { block[buffered] = 0; buffered += 1; }
    const bits = savedTotal * 8;
    const high = Math.floor(bits / 0x100000000) >>> 0;
    const low = bits >>> 0;
    block[56] = (high >>> 24) & 0xff; block[57] = (high >>> 16) & 0xff;
    block[58] = (high >>> 8) & 0xff; block[59] = high & 0xff;
    block[60] = (low >>> 24) & 0xff; block[61] = (low >>> 16) & 0xff;
    block[62] = (low >>> 8) & 0xff; block[63] = low & 0xff;
    compress();
    const result = Array.from(state, hex32).join("");
    state.set(savedState); block.set(savedBlock);
    buffered = savedBuffered; total = savedTotal;
    return result;
  }

  return { update, digest, get bytes() { return total; } };
}

export function sha256Bytes(bytes) {
  const hasher = createSha256();
  hasher.update(bytes);
  return hasher.digest();
}

function normalizedChecksum(value) {
  return String(value ?? "").trim().toLowerCase().replace(/^sha256\$/, "");
}

/**
 * Stream and verify a remote artifact without buffering it. The fetch carries
 * no credentials and no URL/body is logged. A size or checksum mismatch (or a
 * fetch failure) returns an exact reason with ok:false — the caller must not
 * upload in that case. `chunkBytes` bounds each hashing step.
 */
export async function verifyRemoteSha256(fetchImpl, url, {
  expected_sha256, expected_bytes, chunkBytes = 1024 * 1024
} = {}) {
  const expected = normalizedChecksum(expected_sha256);
  const expectedSize = Number(expected_bytes);
  const out = {
    ok: false, verified: false, source_url: url, expected_sha256: expected || null,
    expected_bytes: Number.isFinite(expectedSize) ? expectedSize : null,
    actual_bytes: 0, computed_sha256: null, reason: null, chunks: 0,
    basis: "streamed_bounded_chunks_pure_js_sha256"
  };
  const fail = (reason) => ({ ...out, reason });
  if (!/^https?:\/\//i.test(String(url ?? "")) || String(url).length > 2048) return fail("invalid_source_url");
  if (!/^[0-9a-f]{64}$/.test(expected) || !Number.isInteger(expectedSize) || expectedSize <= 0) {
    return fail("invalid_expected_provenance");
  }
  const size = Math.max(1024, Math.min(Number(chunkBytes) || 1024 * 1024, 8 * 1024 * 1024));
  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "*/*" } });
  } catch (error) {
    return fail(`fetch_failed: ${error?.name ?? "Error"}: ${String(error?.message ?? error).slice(0, 300)}`);
  }
  if (!response?.ok) return fail(`fetch_http_error: HTTP ${response?.status ?? "unknown"}`);

  const hasher = createSha256();
  const reader = response.body?.getReader?.();
  if (!reader) {
    // Fail closed: buffering the whole response here would defeat the purpose
    // of a bounded stream. No upload may follow an unverifiable response.
    return fail("stream_unavailable: response body exposed no reader; no upload was attempted");
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value ?? []);
      if (!chunk.length) continue;
      out.actual_bytes += chunk.length;
      if (out.actual_bytes > expectedSize) {
        out.reason = `size_exceeded: streamed more than ${expectedSize} bytes; no upload was attempted`;
        break;
      }
      for (let offset = 0; offset < chunk.length; offset += size) {
        hasher.update(chunk.subarray(offset, Math.min(offset + size, chunk.length)));
        out.chunks += 1;
      }
    }
  } catch (error) {
    out.reason = `stream_read_failed: ${error?.name ?? "Error"}: ${String(error?.message ?? error).slice(0, 300)}`;
  } finally {
    try { await reader.cancel(); } catch { /* stream already closed */ }
  }
  out.computed_sha256 = hasher.digest();
  if (out.reason) return out;
  if (out.actual_bytes !== expectedSize) {
    return { ...out, reason: `size_mismatch: streamed ${out.actual_bytes} bytes; expected ${expectedSize} bytes; no upload was attempted` };
  }
  if (out.computed_sha256 !== expected) {
    return { ...out, reason: `checksum_mismatch: computed ${out.computed_sha256}; expected ${expected}; no upload was attempted` };
  }
  return { ...out, ok: true, verified: true, reason: null };
}
