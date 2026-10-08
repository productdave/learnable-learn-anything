import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

// Fail closed on non-public IPv4 and IPv6-only hosts for now. DNS is resolved
// once per hop and the checked address is pinned to the socket (no rebinding).
export function publicIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}
export async function checkedPublicAddress(url, { lookupImpl = lookup, signal } = {}) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('Only public HTTP/HTTPS sources on standard ports are supported.');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) || host.includes(':')) throw new Error('URL host is blocked (private / loopback / link-local).');
  signal?.throwIfAborted();
  const records = isIP(host) ? [{ address: host }] : await new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => lookupImpl(host, { family: 4, all: true })).then(resolve, reject)
      .finally(() => signal?.removeEventListener('abort', abort));
  });
  signal?.throwIfAborted();
  if (!records.length || records.some(item => !publicIPv4(item.address))) throw new Error('URL host is blocked (private / loopback / link-local).');
  return records[0].address;
}
function requestOnce(url, address, { headers, signal }) {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET', agent: false, signal, headers: { ...headers, 'accept-encoding': 'identity' },
      lookup: (_host, options, callback) => options.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4)
    }, incoming => {
      try {
        const body = [204, 205, 304].includes(incoming.statusCode) ? null : Readable.toWeb(incoming);
        const response = new Response(body, { status: incoming.statusCode, statusText: incoming.statusMessage, headers: incoming.headers });
        if (!body) incoming.resume();
        Object.defineProperty(response, 'url', { value: url.href });
        resolve(response);
      } catch (error) { incoming.destroy(); reject(error); }
    });
    request.on('error', reject); request.end();
  });
}
export async function publicFetch(input, options = {}, { lookupImpl = lookup, requestImpl = requestOnce } = {}) {
  let url = new URL(input);
  // Covers DNS, redirect chain and body consumption, even when callers stop
  // their header-only timeout. No credentials/cookies are forwarded.
  const timeout = AbortSignal.timeout(8000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  for (let hop = 0; hop < 6; hop++) {
    const address = await checkedPublicAddress(url, { lookupImpl, signal });
    const response = await requestImpl(url, address, { headers: options.headers, signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('Source redirect has no destination.');
    url = new URL(location, url);
  }
  throw new Error('Source redirected too many times.');
}
