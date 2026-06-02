//! Citation identifiers — deterministic UUID v5 derived from a claim_key.
//!
//! Port of `api-impl-js/core/citations/citation-id.js`. The durable citation
//! handle is an RFC-4122 v5 UUID computed as SHA-1 over (namespace bytes ||
//! claim_key bytes), with the version/variant bits stamped. This matches the
//! JS reference and Python's `uuid.uuid5` exactly, so the same claim_key maps
//! to the same uuid in every port.
//!
//! SHA-1 is implemented inline so the derivation is explicit and the core has
//! no crypto dependency.

/// Fixed namespace UUID for IRG claims. Every port MUST use this exact value.
pub const IRG_CLAIM_NAMESPACE: &str = "b1f7c0de-1c1a-5e2d-9a3b-1c1a0000c1a1";

/// Derive the durable claim UUID (v5) from a claim_key. Empty key -> empty string.
pub fn derive_claim_uuid(claim_key: &str) -> String {
    if claim_key.is_empty() {
        return String::new();
    }
    let ns = parse_uuid_bytes(IRG_CLAIM_NAMESPACE);
    let mut input = Vec::with_capacity(16 + claim_key.len());
    input.extend_from_slice(&ns);
    input.extend_from_slice(claim_key.as_bytes());

    let digest = sha1(&input);
    let mut b = [0u8; 16];
    b.copy_from_slice(&digest[0..16]);
    b[6] = (b[6] & 0x0f) | 0x50; // version 5
    b[8] = (b[8] & 0x3f) | 0x80; // RFC-4122 variant
    format_uuid(&b)
}

fn parse_uuid_bytes(s: &str) -> [u8; 16] {
    let hex: String = s.chars().filter(|c| *c != '-').collect();
    let mut b = [0u8; 16];
    for i in 0..16 {
        b[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).expect("valid namespace hex");
    }
    b
}

fn format_uuid(b: &[u8; 16]) -> String {
    let h: String = b.iter().map(|x| format!("{:02x}", x)).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

/// Minimal SHA-1 (RFC 3174). Sufficient for UUID v5 derivation.
fn sha1(msg: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    let ml: u64 = (msg.len() as u64) * 8;

    let mut data = msg.to_vec();
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0);
    }
    data.extend_from_slice(&ml.to_be_bytes());

    for chunk in data.chunks(64) {
        let mut w = [0u32; 80];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }

        let (mut a, mut b, mut c, mut d, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for (i, &wi) in w.iter().enumerate() {
            let (f, k) = if i < 20 {
                ((b & c) | ((!b) & d), 0x5A827999u32)
            } else if i < 40 {
                (b ^ c ^ d, 0x6ED9EBA1)
            } else if i < 60 {
                ((b & c) | (b & d) | (c & d), 0x8F1BBCDC)
            } else {
                (b ^ c ^ d, 0xCA62C1D6)
            };
            let tmp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = tmp;
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
    }

    let mut out = [0u8; 20];
    for i in 0..5 {
        out[i * 4..i * 4 + 4].copy_from_slice(&h[i].to_be_bytes());
    }
    out
}
