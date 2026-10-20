// Published base USD rates; actual billing can depend on contract terms.
export const DECISION_PRICING = Object.freeze({
  inputPerMillion: 0.042,
  outputPerMillion: 0,
  source: "https://commandline.microsoft.com/microsoft-decision-1-model-foundry/",
});

export function decisionCost(usage) {
  const tokens = usage?.input_tokens;
  // Missing usage is unknown cost, not a free request. Output tokens are free.
  return Number.isSafeInteger(tokens) && tokens >= 0
    ? tokens / 1_000_000 * DECISION_PRICING.inputPerMillion : NaN;
}

export function formatUsd(value, digits = 4) {
  if (!Number.isFinite(value)) return "–";
  // Keep small, nonzero per-move costs visible instead of rounding them to $0.0000.
  const precision = value > 0 && value < 10 ** -digits
    ? Math.min(8, Math.max(digits, Math.ceil(-Math.log10(value)) + 1)) : digits;
  return `$${value.toFixed(precision)}`;
}
