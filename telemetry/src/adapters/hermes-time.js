// Exact decimal milliseconds for selection, separate from rounded event timestamps.
// Bound work on untrusted metadata. Invalid/unsupported encodings return null.
function decimal(value) {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) return null;
  const exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 128) return null;
  let n = BigInt((match[1] || '') + match[2] + (match[3] ?? ''));
  let scale = Math.max(0, -exponent);
  if (exponent > 0) n *= 10n ** BigInt(exponent);
  return { n, scale };
}

function render({ n, scale }) {
  const sign = n < 0n ? '-' : '';
  const digits = (n < 0n ? -n : n).toString().padStart(scale + 1, '0');
  return sign + (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits);
}

export function compareMillis(left, right) {
  const a = decimal(String(left)), b = decimal(String(right));
  const x = a.n * 10n ** BigInt(b.scale), y = b.n * 10n ** BigInt(a.scale);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function historyTimestampMillis(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? String(value.getTime()) : null;
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) return null;
  const text = String(value).trim();
  if (!text || text.length > 128) return null;
  const numeric = decimal(text);
  if (numeric) {
    // Preserve the established Hermes seconds/milliseconds threshold.
    if (numeric.n < 10_000_000_000n * 10n ** BigInt(numeric.scale)) numeric.n *= 1000n;
    const ms = render(numeric);
    return Math.abs(Number(ms)) <= 8.64e15 ? ms : null;
  }
  const iso = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!iso) return null;
  // Date.parse normalizes impossible calendar dates: reject rather than repair.
  const local = `${iso[1]}T${iso[2]}`;
  const localMs = Date.parse(`${local}Z`);
  if (!Number.isFinite(localMs) || new Date(localMs).toISOString().slice(0, 19) !== local) return null;
  const base = Date.parse(local + iso[4]);
  if (!Number.isFinite(base)) return null;
  const fraction = iso[3] ?? '';
  return render({ n: BigInt(base) * 10n ** BigInt(fraction.length) + BigInt(fraction || '0') * 1000n, scale: fraction.length });
}

export function registerHistoryTime(db, sinceMs, untilMs) {
  db.function('collector_in_window', { deterministic: true }, value => {
    const ms = historyTimestampMillis(value);
    return ms !== null && (sinceMs === null || compareMillis(ms, sinceMs) >= 0)
      && (untilMs === null || compareMillis(ms, untilMs) < 0) ? 1 : 0;
  });
  // Approximate milliseconds are only coverage metadata, never a selection gate.
  db.function('collector_time_ms', { deterministic: true }, value => {
    const ms = historyTimestampMillis(value);
    return ms === null ? null : Number(ms);
  });
}
