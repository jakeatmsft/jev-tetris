// Published base USD rates; actual billing can depend on contract terms.
export const DECISION_PRICING = Object.freeze({
  inputPerMillion: 0.042,
  outputPerMillion: 0,
  source: "https://commandline.microsoft.com/microsoft-decision-1-model-foundry/",
});

export const OPENAI_DECISION_PRICING = Object.freeze({
  inputPerMillion: 0.10,
  outputPerMillion: null, // N/A for the Decision API.
  cachedInputPerMillion: 0.01,
  cacheWrite30MinPerMillion: 0.125,
  source: "https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/",
});

export function decisionCost(usage) {
  const tokens = usage?.input_tokens;
  // Missing usage is unknown cost, not a free request. Output tokens are free.
  return Number.isSafeInteger(tokens) && tokens >= 0
    ? tokens / 1_000_000 * DECISION_PRICING.inputPerMillion : NaN;
}

export function openaiDecisionCost(usage) {
  const tokens = usage?.input_tokens;
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
  const written = usage?.input_tokens_details?.cache_write_tokens ?? 0;
  if (![tokens, cached, written].every((value) => Number.isSafeInteger(value) && value >= 0)
    || cached + written > tokens) return NaN;
  // Cache reads and writes are part of total input, each billed at its own rate.
  // Output pricing is N/A; no output charge is added.
  return ((tokens - cached - written) * OPENAI_DECISION_PRICING.inputPerMillion
    + cached * OPENAI_DECISION_PRICING.cachedInputPerMillion
    + written * OPENAI_DECISION_PRICING.cacheWrite30MinPerMillion) / 1_000_000;
}

export function formatPricing(pricing) {
  const rate = (value) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
  const parts = [
    `${rate(pricing.inputPerMillion)} / 1M input tokens`,
    pricing.outputPerMillion === null ? "Output N/A"
      : pricing.outputPerMillion === 0 ? "Output tokens free"
        : `${rate(pricing.outputPerMillion)} / 1M output tokens`,
  ];
  if (pricing.cachedInputPerMillion != null) parts.push(`Cached input ${rate(pricing.cachedInputPerMillion)} / 1M`);
  if (pricing.cacheWrite30MinPerMillion != null) parts.push(`30-minute cached write ${rate(pricing.cacheWrite30MinPerMillion)} / 1M`);
  return parts.join(" · ");
}

export function formatUsd(value, digits = 4) {
  if (!Number.isFinite(value)) return "–";
  // Keep small, nonzero per-move costs visible instead of rounding them to $0.0000.
  const precision = value > 0 && value < 10 ** -digits
    ? Math.min(8, Math.max(digits, Math.ceil(-Math.log10(value)) + 1)) : digits;
  return `$${value.toFixed(precision)}`;
}
