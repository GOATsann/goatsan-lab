import "server-only";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, request } from "undici";

// Fetching a PDF from a link someone pasted, without letting that link reach our own network: https only, the
// standard port, no user:password, every address the name resolves to must be public (checked inside the
// connection itself, so a DNS answer can't change between the check and the connect), at most 4 redirects
// (each checked the same way), and a hard size cap while downloading.

export class FetchError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}
function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) return privateV4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

const agent = new Agent({
  connect: {
    lookup(hostname, options, cb) {
      lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return cb(err, "", 4);
        const list = (Array.isArray(addresses) ? addresses : [addresses]) as { address: string; family: number }[];
        if (!list.length || list.some((a) => privateIp(a.address))) {
          return cb(new FetchError(400, "That link points to a private address."), "", 4);
        }
        if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: typeof list) => void)(null, list);
        cb(null, list[0].address, list[0].family);
      });
    },
  },
  headersTimeout: 20_000,
  bodyTimeout: 60_000,
});

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError(400, "That isn't a link.");
  }
  if (url.protocol !== "https:") throw new FetchError(400, "Only https links work.");
  if (url.username || url.password) throw new FetchError(400, "Links with a username or password don't work.");
  if (url.port && url.port !== "443") throw new FetchError(400, "Only links on the standard https port work.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && privateIp(host)) throw new FetchError(400, "That link points to a private address.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new FetchError(400, "That link points to a private address.");
  }
  return url;
}

export async function fetchPdf(raw: string, maxBytes: number): Promise<{ data: Buffer; url: URL }> {
  let url = checkUrl(raw);
  for (let hop = 0; hop <= 4; hop++) {
    let res;
    try {
      res = await request(url, {
        method: "GET",
        dispatcher: agent,
        headers: { "user-agent": "paper-tutor/0.1 (+https://github.com/GOATsann/goatsan-lab)", accept: "application/pdf,*/*" },
      });
    } catch (e) {
      if (e instanceof FetchError) throw e;
      throw new FetchError(502, "Couldn't reach that link.");
    }
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      await res.body.dump();
      url = checkUrl(new URL(String(res.headers.location), url).toString());
      continue;
    }
    if (res.statusCode !== 200) {
      await res.body.dump();
      throw new FetchError(502, `That link answered ${res.statusCode}.`);
    }
    const declared = Number(res.headers["content-length"] ?? 0);
    if (declared > maxBytes) {
      await res.body.dump();
      throw new FetchError(413, `That PDF is ${Math.round(declared / 1024 / 1024)} MB; the limit is ${maxBytes / 1024 / 1024} MB.`);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > maxBytes) {
        res.body.destroy();
        throw new FetchError(413, `That PDF is larger than ${maxBytes / 1024 / 1024} MB.`);
      }
      chunks.push(chunk as Buffer);
    }
    const data = Buffer.concat(chunks);
    if (data.subarray(0, 5).toString() !== "%PDF-") throw new FetchError(415, "That link isn't a PDF.");
    return { data, url };
  }
  throw new FetchError(400, "That link redirects too many times.");
}
