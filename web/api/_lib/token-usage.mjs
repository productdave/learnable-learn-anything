export function createTokenUsageLedger() {
  return {
    total: emptyBucket(),
    byTask: {},
    calls: []
  };
}

export function recordTokenUsage(ledger, { task, provider, model, usage, meta = {} } = {}) {
  if (!ledger || !usage) return null;
  const bucket = usageBucket(usage);
  if (!hasTokens(bucket)) return null;
  const key = task || 'unknown';
  ledger.byTask[key] ||= emptyBucket();
  addBucket(ledger.total, bucket);
  addBucket(ledger.byTask[key], bucket);
  ledger.calls.push({
    task: key,
    provider: provider || null,
    model: model || null,
    ...bucket,
    ...meta
  });
  return bucket;
}

export function compactTokenUsage(ledger) {
  if (!ledger) return null;
  const total = normaliseBucket(ledger.total);
  const byTask = Object.fromEntries(
    Object.entries(ledger.byTask || {}).map(([task, bucket]) => [task, normaliseBucket(bucket)])
  );
  return {
    total,
    byTask,
    calls: Array.isArray(ledger.calls) ? ledger.calls : []
  };
}

function emptyBucket() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
    calls: 0
  };
}

function usageBucket(usage) {
  const inputTokens = number(usage.input_tokens);
  const outputTokens = number(usage.output_tokens);
  const cacheCreationInputTokens = number(usage.cache_creation_input_tokens);
  const cacheReadInputTokens = number(usage.cache_read_input_tokens);
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
    calls: 1
  };
}

function addBucket(target, source) {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheCreationInputTokens += source.cacheCreationInputTokens;
  target.cacheReadInputTokens += source.cacheReadInputTokens;
  target.totalTokens += source.totalTokens;
  target.calls += source.calls;
}

function normaliseBucket(bucket = emptyBucket()) {
  return {
    inputTokens: number(bucket.inputTokens),
    outputTokens: number(bucket.outputTokens),
    cacheCreationInputTokens: number(bucket.cacheCreationInputTokens),
    cacheReadInputTokens: number(bucket.cacheReadInputTokens),
    totalTokens: number(bucket.totalTokens),
    calls: number(bucket.calls)
  };
}

function hasTokens(bucket) {
  return bucket.totalTokens > 0;
}

function number(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
