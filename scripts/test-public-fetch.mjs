import assert from 'node:assert/strict';
import { publicIPv4, checkedPublicAddress, publicFetch } from '../web/api/_lib/public-fetch.mjs';
let checks = 0;
for (const ip of ['0.0.0.0', '10.1.1.1', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.1.1', '192.168.1.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', '::ffff:127.0.0.1']) { assert.equal(publicIPv4(ip), false, ip); checks++; }
assert.equal(publicIPv4('93.184.216.34'), true); checks++;
for (const url of ['http://localhost/a', 'http://127.1/a', 'http://2130706433/a', 'https://[::1]/', 'https://user:pass@example.com/', 'https://example.com:444/']) { await assert.rejects(checkedPublicAddress(new URL(url))); checks++; }
await assert.rejects(checkedPublicAddress(new URL('https://example.com'), { lookupImpl: async () => [{ address: '127.0.0.1' }] }), /blocked/); checks++;
await assert.rejects(checkedPublicAddress(new URL('https://example.com'), { lookupImpl: async () => [{ address: '93.184.216.34' }, { address: '10.0.0.1' }] }), /blocked/); checks++;
let requests = 0, resolutions = 0;
const lookupImpl = async () => { resolutions++; return [{ address: '93.184.216.34' }]; };
await assert.rejects(publicFetch('https://example.com', {}, { lookupImpl, requestImpl: async (_url, address) => { requests++; assert.equal(address, '93.184.216.34'); return new Response('', { status: 302, headers: { location: 'http://169.254.169.254/credentials' } }); } }), /blocked/);
assert.equal(requests, 1); checks++;
const result = await publicFetch('https://example.com/a', {}, { lookupImpl, requestImpl: async url => url.pathname === '/a' ? new Response('', { status: 301, headers: { location: '/b' } }) : new Response('ok') });
assert.equal(await result.text(), 'ok'); assert.equal(resolutions, 3); checks++;
await assert.rejects(publicFetch('https://example.com', {}, { lookupImpl, requestImpl: async () => new Response('', { status: 302, headers: { location: '/' } }) }), /too many/); checks++;
const controller = new AbortController(); controller.abort();
await assert.rejects(publicFetch('https://example.com', { signal: controller.signal }, { lookupImpl, requestImpl: async () => { throw new Error('must not run'); } }), /abort/i); checks++;
console.log(`Public source fetch: ${checks} checks passed, with DNS/HTTP doubles and no network calls.`);
