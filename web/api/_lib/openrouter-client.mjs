// Normalizes schema-constrained text into Learnable's existing Messages facade.
// Native PDF/search and images are deliberately separate acceptance gates.
import { createHash } from 'node:crypto';
import { openRouterRoute, quoteOpenRouterText, refuse, OpenRouterError } from './openrouter-policy.mjs';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_KEYS = new Set(['model', 'max_tokens', 'system', 'tools', 'tool_choice', 'messages', 'temperature', 'top_p', 'top_k']);
const hash = json => createHash('sha256').update(json).digest('hex');

async function boundedResult(response) {
  const limit = 4 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) refuse('uncertain', 'Gateway response exceeded the receipt limit.');
  const reader = response.body?.getReader();
  if (!reader) refuse('uncertain', 'Gateway returned no receipt.');
  const parts = []; let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) refuse('uncertain', 'Gateway response exceeded the receipt limit.');
      parts.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function tokenDetails(value, names) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(names.filter(k => Number.isSafeInteger(value[k]) && value[k] >= 0).map(k => [k, value[k]]));
}

function invalidOutput(message, receipt, { retryable = true, kind = 'tool' } = {}) {
  const error = new OpenRouterError('invalid_output', message);
  // Only attached after durable settlement. The stage may use its existing
  // second attempt; no new retry loop or raw model output is exposed here.
  error.paidOutput = { usage: receipt.usage, retryable, kind };
  throw error;
}

function textContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.some(b => b?.type !== 'text' || typeof b.text !== 'string'
      || Object.keys(b).some(k => !['type', 'text'].includes(k))))
    refuse('unsupported', 'Native documents, images, citations and tool history need a separately accepted adapter.');
  return content.map(b => b.text).join('\n');
}

export function prepareOpenRouterText(original, route) {
  let opts;
  try { opts = JSON.parse(JSON.stringify(original)); } catch { refuse('unsupported', 'AI request is not JSON serializable.'); }
  if (!opts || Object.keys(opts).some(k => !REQUEST_KEYS.has(k)) || opts.model !== route.model
      || typeof opts.system !== 'string' || !Array.isArray(opts.tools) || opts.tools.length !== 1
      || !Array.isArray(opts.messages) || !opts.messages.length)
    refuse('unsupported', 'Request does not match the reviewed text route.');
  const tool = opts.tools[0];
  if (tool.name !== route.tool || !tool.input_schema || tool.type
      || Object.keys(tool).some(k => !['name', 'description', 'input_schema'].includes(k))
      || (opts.tool_choice && (opts.tool_choice.type !== 'tool' || opts.tool_choice.name !== route.tool
        || Object.keys(opts.tool_choice).some(k => !['type', 'name'].includes(k)))))
    refuse('unsupported', 'Unexpected tool or tool choice.');
  const messages = [{ role: 'system', content: opts.system }, ...opts.messages.map(m => {
    if (!['user', 'assistant'].includes(m?.role) || Object.keys(m).some(k => !['role', 'content'].includes(k)))
      refuse('unsupported', 'Unsupported message role or metadata.');
    return { role: m.role, content: textContent(m.content) };
  })];
  const reservedMicrousd = quoteOpenRouterText(route, opts.max_tokens);
  // Only approved fields are built. Incompatible forced tools/sampling are not forwarded.
  const body = { model: route.model, messages, max_tokens: opts.max_tokens, stream: false,
    reasoning: route.reasoning,
    provider: { only: [route.provider], allow_fallbacks: false, require_parameters: true,
      data_collection: 'deny', max_price: { prompt: route.inputDollarsPerMillion, completion: route.outputDollarsPerMillion } },
    response_format: { type: 'json_schema', json_schema: { name: route.tool, strict: true, schema: tool.input_schema } } };
  const json = JSON.stringify(body);
  if (Buffer.byteLength(json) > route.maxInputBytes) refuse('unsupported', 'Request is too large for the reviewed text route.');
  return { body, json, reservedMicrousd, fingerprint: hash(json) };
}

export function openRouterReceipt(result, reservation, route) {
  const u = result?.usage;
  if (result?.error || result?.model !== route.model || result?.provider !== route.provider
      || typeof result?.id !== 'string' || !/^gen-[A-Za-z0-9_-]{1,180}$/.test(result.id)
      || !u || typeof u.cost !== 'number' || !Number.isFinite(u.cost) || u.cost < 0
      || !Number.isSafeInteger(u.prompt_tokens) || u.prompt_tokens < 0 || u.prompt_tokens > route.inputTokenBound
      || !Number.isSafeInteger(u.completion_tokens) || u.completion_tokens < 0
      || u.completion_tokens > reservation.body.max_tokens)
    refuse('uncertain', 'Gateway identity or usage could not be reconciled. The reservation stays held.');
  const actualMicrousd = Math.ceil(u.cost * 1e6);
  if (!Number.isSafeInteger(actualMicrousd) || actualMicrousd > reservation.reservedMicrousd)
    refuse('uncertain', 'Reported AI cost exceeded the reviewed reservation.');
  return { actualMicrousd, providerRequestId: result.id,
    usage: { input_tokens: u.prompt_tokens, output_tokens: u.completion_tokens,
      cost: u.cost, gateway: 'openrouter', model: result.model, provider: result.provider,
      // Retain provider accounting details without converting absent fields to invented units.
      prompt_tokens_details: tokenDetails(u.prompt_tokens_details, ['cached_tokens', 'cache_write_tokens']),
      completion_tokens_details: tokenDetails(u.completion_tokens_details, ['reasoning_tokens']) } };
}

export function createOpenRouterClient({ apiKey, policy, task, ledger, validateResult,
  requestBudget = null, beforeDispatch = null, fetcher = fetch, now = Date.now } = {}) {
  if (typeof window !== 'undefined' || !apiKey || !ledger?.reserve || !ledger?.settle || !ledger?.hold
      || typeof validateResult !== 'function') refuse('configuration', 'Server key, durable ledger and result validator are required.');
  let stopped = null;
  return { messages: { async create(original) {
    if (stopped) throw stopped;
    const route = openRouterRoute(policy, task, { now: now() });
    const reservation = prepareOpenRouterText(original, route);
    await beforeDispatch?.();
    if (stopped) throw stopped;
    requestBudget?.assertCanStart();
    const request = requestBudget?.beginRequest();
    let hold, settled = false;
    try {
      hold = await ledger.reserve({ ...reservation, operationKey: `${task}:${reservation.fingerprint}`, model: route.model, task });
      request?.throwIfExpired?.();
      // Recheck the lease after reservation; a cancellation must not initiate paid work.
      await beforeDispatch?.();
      if (stopped) throw stopped;
      openRouterRoute(policy, task, { now: now() });
      request?.throwIfExpired?.();
      const response = await fetcher(ENDPOINT, { method: 'POST', redirect: 'error',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: reservation.json, signal: request?.signal || AbortSignal.timeout(240000) });
      // No response body or credentials are copied into user-visible errors.
      if (!response.ok) refuse('uncertain', `Gateway request returned HTTP ${response.status}; spending needs reconciliation.`);
      const result = await boundedResult(response);
      request?.throwIfExpired?.();
      const receipt = openRouterReceipt(result, reservation, route);
      await ledger.settle(hold, receipt);
      settled = true;
      const choice = result.choices?.length === 1 ? result.choices[0] : null;
      if (choice?.message?.refusal || choice?.finish_reason === 'content_filter')
        invalidOutput('The paid response was refused.', receipt, { retryable: false });
      if (!choice || choice.finish_reason !== 'stop' || choice.message?.tool_calls
          || typeof choice.message?.content !== 'string')
        invalidOutput('The paid response was incomplete or in an unsupported format.', receipt,
          { kind: choice?.finish_reason === 'length' ? 'truncated' : 'tool' });
      let input;
      try { input = validateResult(JSON.parse(choice.message.content)); }
      catch { invalidOutput('The paid response failed the course output contract. Return the complete schema-conforming result.', receipt); }
      return { id: result.id, model: result.model, stop_reason: 'tool_use', usage: receipt.usage,
        content: [{ type: 'tool_use', id: `tool_${result.id}`, name: route.tool, input }] };
    } catch (error) {
      if (!settled) {
        // Reserve may itself have committed with a lost reply. Halt this client;
        // the durable pending row protects future runner leases as well.
        stopped = error instanceof OpenRouterError ? error : new OpenRouterError('uncertain', 'AI outcome is uncertain; reconcile spending before retrying.');
        if (hold) await ledger.hold(hold);
        throw stopped;
      }
      throw error;
    } finally { request?.close(); }
  } } };
}
