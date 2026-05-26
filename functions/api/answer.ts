interface Env {
  AI?: Ai;
}

interface SeriesSummary {
  title: string;
  units: string;
  points: { date: string; value: number }[];
}

interface AnswerRequest {
  query: string;
  series: SeriesSummary[];
  datasetVersion?: string;
}

const ANSWER_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const ANSWER_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const answerCache = new Map<string, { expiresAt: number; value: string }>();
const ANSWER_MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'];
const ANSWER_MAX_TOKENS = 320;

function normalizeQuery(query: string) {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeDatasetVersion(version?: string) {
  const trimmed = String(version ?? '').trim();
  return trimmed || 'unknown';
}

function hashString(text: string) {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function buildSeriesSignature(series: SeriesSummary[]) {
  return series
    .map((s) => {
      const pointsSig = s.points
        .slice(-24)
        .map((p) => `${p.date}:${p.value}`)
        .join('|');
      return `${s.title}~${s.units}~${pointsSig}`;
    })
    .sort()
    .join('||');
}

function buildCacheKey(query: string, datasetVersion: string | undefined, series: SeriesSummary[]) {
  const payloadSig = `${normalizeQuery(query)}::${buildSeriesSignature(series)}`;
  return `answer:v5:${normalizeDatasetVersion(datasetVersion)}:${hashString(payloadSig)}`;
}

function buildEdgeRequest(cacheKey: string) {
  return new Request(`https://nlp-cache.local/answer/${encodeURIComponent(cacheKey)}`);
}

async function getFromEdgeCache(cacheKey: string) {
  const cached = await caches.default.match(buildEdgeRequest(cacheKey));
  if (!cached) {
    return null;
  }

  try {
    const parsed = await cached.json<{ answer?: string }>();
    return parsed.answer ?? null;
  } catch {
    return null;
  }
}

async function setEdgeCache(cacheKey: string, answer: string) {
  const response = new Response(JSON.stringify({ answer }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': `public, max-age=${ANSWER_CACHE_TTL_SECONDS}`,
    },
  });

  await caches.default.put(buildEdgeRequest(cacheKey), response);
}

function formatPeriod(date: string) {
  const [year, month] = date.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const idx = Number(month) - 1;
  if (!Number.isFinite(idx) || idx < 0 || idx > 11) {
    return date;
  }
  return `${names[idx]} ${year}`;
}

function formatSeriesValue(value: number, units: string) {
  const lower = units.toLowerCase();
  const isCurrency = lower.includes('$');
  const compact = new Intl.NumberFormat('en-AU', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  return `${isCurrency ? '$' : ''}${compact}`;
}

function calculateChanges(points: { date: string; value: number }[]) {
  const out: Array<{ date: string; delta: number; pct: number | null }> = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1].value;
    const curr = points[i].value;
    const delta = curr - prev;
    const pct = prev === 0 ? null : (delta / Math.abs(prev)) * 100;
    out.push({ date: points[i].date, delta, pct });
  }
  return out;
}

function pickSeriesByTitle(series: SeriesSummary[], keyword: string) {
  const lower = keyword.toLowerCase();
  return series.find((s) => s.title.toLowerCase().includes(lower)) ?? null;
}

function answerGrowthSpike(series: SeriesSummary[]) {
  let best: { title: string; date: string; pct: number } | null = null;

  for (const s of series) {
    const changes = calculateChanges(s.points.filter((p) => Number.isFinite(p.value)));
    for (const c of changes) {
      if (c.pct === null) continue;
      if (!best || c.pct > best.pct) {
        best = { title: s.title, date: c.date, pct: c.pct };
      }
    }
  }

  if (!best) {
    return null;
  }

  return `The biggest growth spike occurred in ${formatPeriod(best.date)}, when ${best.title} rose ${best.pct.toFixed(1)}% versus the prior period.`;
}

function answerMomentumOvertake(series: SeriesSummary[]) {
  const npp = pickSeriesByTitle(series, 'npp') ?? series[0] ?? null;
  const directEntry = pickSeriesByTitle(series, 'direct entry') ?? series.find((s) => s !== npp) ?? null;
  if (!npp || !directEntry) {
    return null;
  }

  const nppChanges = calculateChanges(npp.points.filter((p) => Number.isFinite(p.value)));
  const deChanges = calculateChanges(directEntry.points.filter((p) => Number.isFinite(p.value)));
  const nppLatest = nppChanges[nppChanges.length - 1];
  const deLatest = deChanges[deChanges.length - 1];

  if (!nppLatest || !deLatest || nppLatest.pct === null || deLatest.pct === null) {
    return null;
  }

  const overtaken = nppLatest.pct > deLatest.pct;
  const comparator = overtaken ? 'faster than' : 'slower than';
  return `${overtaken ? 'Yes' : 'Not yet'} — in the latest period, NPP momentum is ${comparator} direct entry (${nppLatest.pct.toFixed(1)}% vs ${deLatest.pct.toFixed(1)}%).`;
}

function answerSustainedAcceleration(series: SeriesSummary[]) {
  const payTo = pickSeriesByTitle(series, 'payto') ?? series[0] ?? null;
  if (!payTo) {
    return null;
  }

  const changes = calculateChanges(payTo.points.filter((p) => Number.isFinite(p.value)));
  if (changes.length < 3) {
    return null;
  }

  const recent = changes.slice(-3);
  const positiveCount = recent.filter((c) => c.delta > 0).length;
  const sustained = positiveCount >= 2;
  const latest = recent[recent.length - 1];
  const latestPct = latest.pct === null ? null : latest.pct.toFixed(1);

  if (latestPct === null) {
    return null;
  }

  return `${sustained ? 'Yes, mostly' : 'Not consistently'} — PayTo has risen in ${positiveCount} of the last 3 periods, with the latest move ${latestPct}% in ${formatPeriod(latest.date)}.`;
}

function detectCalculatedMetricIntent(query: string) {
  const q = query.toLowerCase();
  if (/\baverage\b.*\btransaction.*size\b|\btransaction.*size.*\baverage\b|\bper.*transaction\b/.test(q)) {
    return 'averageTransactionSize';
  }
  return null;
}

function normalizePaymentTypeKey(title: string) {
  const t = title.toLowerCase();
  if (t.includes('credit and charge')) return 'Credit and Charge';
  if (t.includes('debit')) return 'Debit';
  if (t.includes('prepaid')) return 'Prepaid';
  if (t.includes('payto')) return 'PayTo';
  if (t.includes('npp')) return 'NPP';
  if (t.includes('credit transfer')) return 'Direct Credit';
  if (t.includes('debit transfer')) return 'Direct Debit';

  const prefixMatch = title.match(/^([^:]+):/);
  if (prefixMatch?.[1]) {
    return prefixMatch[1].trim();
  }

  return null;
}

function isValueSeriesTitle(title: string) {
  const t = title.toLowerCase();
  return t.includes('value') && !t.includes('average');
}

function isVolumeSeriesTitle(title: string) {
  const t = title.toLowerCase();
  return (t.includes('number') || t.includes('volume') || t.includes('count')) && !t.includes('value');
}

function shouldPreferDeterministic(query: string) {
  const q = query.toLowerCase();
  return Boolean(
    detectCalculatedMetricIntent(q)
    || ((/highest|max(imum)?|peak|top/.test(q) || /lowest|min(imum)?|trough|bottom/.test(q)) && /month/.test(q))
    || /spike|biggest increase|max(imum)? increase|growth spike/.test(q)
    || (/overtaken|overtake|momentum/.test(q) && /npp|direct entry/.test(q))
    || (/acceleration|accelerating|sustained/.test(q) && /payto/.test(q))
  );
}

function answerAverageTransactionSize(query: string, series: SeriesSummary[]) {
  const q = query.toLowerCase();
  const byType = /\beach\b.*\bpayment\s+type\b|\bby\b.*\bpayment\s+type\b|\bpayment\s+types?\b/.test(q);

  const grouped = new Map<string, { value?: SeriesSummary; volume?: SeriesSummary }>();
  for (const s of series) {
    const key = normalizePaymentTypeKey(s.title);
    if (!key) continue;

    const current = grouped.get(key) ?? {};
    if (isValueSeriesTitle(s.title)) {
      current.value = s;
    }
    if (isVolumeSeriesTitle(s.title)) {
      current.volume = s;
    }
    grouped.set(key, current);
  }

  const rows: Array<{ key: string; avg: number; date: string }> = [];
  for (const [key, pair] of grouped.entries()) {
    const valueLatest = pair.value?.points[pair.value.points.length - 1];
    const volumeLatest = pair.volume?.points[pair.volume.points.length - 1];
    if (!valueLatest || !volumeLatest || volumeLatest.value === 0) {
      continue;
    }
    rows.push({
      key,
      avg: valueLatest.value / volumeLatest.value,
      date: valueLatest.date,
    });
  }

  if (!rows.length) {
    return null;
  }

  if (byType) {
    const formatter = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 });
    const sorted = rows.sort((a, b) => b.avg - a.avg).slice(0, 8);
    const lines = sorted.map((r) => `${r.key}: $${formatter.format(r.avg)}`);
    const date = formatPeriod(sorted[0].date);
    return `Average transaction size by payment type (${date}): ${lines.join('; ')}.`;
  }

  const preferredOrder = ['Credit and Charge', 'Debit', 'Prepaid', 'NPP', 'PayTo', 'Direct Credit', 'Direct Debit'];
  const picked = preferredOrder
    .map((name) => rows.find((r) => r.key === name))
    .find(Boolean) ?? rows[0];

  if (!picked) {
    return null;
  }

  const avgFormatted = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 }).format(picked.avg);
  return `Average transaction size for ${picked.key} is $${avgFormatted} in ${formatPeriod(picked.date)}.`;
}

function toKeywords(text: string) {
  return normalizeQuery(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .filter((w) => !['which', 'month', 'highest', 'lowest', 'what', 'when', 'does', 'did', 'the', 'and', 'for', 'with', 'from', 'over', 'last'].includes(w));
}

function findBestSeriesForQuery(query: string, series: SeriesSummary[]) {
  const queryWords = new Set(toKeywords(query));
  if (!queryWords.size) {
    return series[0] ?? null;
  }

  let best: { series: SeriesSummary; score: number } | null = null;
  for (const s of series) {
    const titleWords = new Set(toKeywords(s.title));
    let score = 0;
    for (const word of queryWords) {
      if (titleWords.has(word)) {
        score += 2;
      } else if (s.title.toLowerCase().includes(word)) {
        score += 1;
      }
    }

    if (!best || score > best.score) {
      best = { series: s, score };
    }
  }

  return best?.score ? best.series : series[0] ?? null;
}

function answerExtremeMonth(query: string, series: SeriesSummary[], kind: 'highest' | 'lowest') {
  const target = findBestSeriesForQuery(query, series);
  if (!target) {
    return null;
  }

  const pts = target.points.filter((p) => Number.isFinite(p.value));
  if (!pts.length) {
    return null;
  }

  const chosen = pts.reduce((acc, cur) => {
    if (!acc) return cur;
    if (kind === 'highest') {
      return cur.value > acc.value ? cur : acc;
    }
    return cur.value < acc.value ? cur : acc;
  }, null as { date: string; value: number } | null);

  if (!chosen) {
    return null;
  }

  return `For ${target.title}, the ${kind} month in the current analysis window is ${formatPeriod(chosen.date)} at ${formatSeriesValue(chosen.value, target.units)}.`;
}

function buildDeterministicAnswer(_query: string, series: SeriesSummary[]) {
  const query = _query.toLowerCase();
  const calculatedMetric = detectCalculatedMetricIntent(query);
  if (calculatedMetric === 'averageTransactionSize') {
    const avg = answerAverageTransactionSize(_query, series);
    if (avg) {
      return avg;
    }
  }

  if (/highest|max(imum)?|peak|top/.test(query) && /month/.test(query)) {
    const highest = answerExtremeMonth(query, series, 'highest');
    if (highest) {
      return highest;
    }
  }

  if (/lowest|min(imum)?|trough|bottom/.test(query) && /month/.test(query)) {
    const lowest = answerExtremeMonth(query, series, 'lowest');
    if (lowest) {
      return lowest;
    }
  }

  if (/spike|biggest increase|max(imum)? increase|growth spike/.test(query)) {
    const spikeAnswer = answerGrowthSpike(series);
    if (spikeAnswer) {
      return spikeAnswer;
    }
  }

  if (/overtaken|overtake|momentum/.test(query) && /npp|direct entry/.test(query)) {
    const momentumAnswer = answerMomentumOvertake(series);
    if (momentumAnswer) {
      return momentumAnswer;
    }
  }

  if (/acceleration|accelerating|sustained/.test(query) && /payto/.test(query)) {
    const accelerationAnswer = answerSustainedAcceleration(series);
    if (accelerationAnswer) {
      return accelerationAnswer;
    }
  }

  const lines = series
    .slice(0, 2)
    .map((s) => {
      const pts = s.points.filter((p) => Number.isFinite(p.value));
      const latest = pts[pts.length - 1];
      const previous = pts[pts.length - 2] ?? null;

      if (!latest) {
        return `${s.title} has no recent data points in the selected range.`;
      }

      const latestValue = formatSeriesValue(latest.value, s.units);
      if (!previous || previous.value === 0) {
        return `${s.title} is ${latestValue} in ${formatPeriod(latest.date)}.`;
      }

      const deltaPct = ((latest.value - previous.value) / Math.abs(previous.value)) * 100;
      const direction = deltaPct >= 0 ? 'up' : 'down';
      return `${s.title} is ${latestValue} in ${formatPeriod(latest.date)}, ${direction} ${Math.abs(deltaPct).toFixed(1)}% from ${formatPeriod(previous.date)}.`;
    });

  return lines.join(' ');
}

const SYSTEM_PROMPT = `You are a senior analyst writing concise answers about payments data.

Rules:
- Answer the user's exact question directly.
- Use the provided metrics and time periods.
- Prefer a clear yes/no first when the question implies it.
- Include specific numbers and dates.
- If asked for highest/lowest month, explicitly name the month and value.
- 2-4 sentences maximum.
- Plain text only.`;

function buildSeriesAnalytics(series: SeriesSummary[]) {
  return series.slice(0, 10).map((s) => {
    const pts = s.points.filter((p) => Number.isFinite(p.value));
    const latest = pts[pts.length - 1] ?? null;
    const previous = pts[pts.length - 2] ?? null;
    const changes = calculateChanges(pts);
    const maxIncrease = changes
      .filter((c) => c.pct !== null)
      .sort((a, b) => (b.pct ?? Number.NEGATIVE_INFINITY) - (a.pct ?? Number.NEGATIVE_INFINITY))[0] ?? null;

    return {
      title: s.title,
      units: s.units,
      latest: latest ? { date: latest.date, value: latest.value } : null,
      previous: previous ? { date: previous.date, value: previous.value } : null,
      first: pts[0] ? { date: pts[0].date, value: pts[0].value } : null,
      latestChangePct: latest && previous && previous.value !== 0
        ? ((latest.value - previous.value) / Math.abs(previous.value)) * 100
        : null,
      maxIncreasePct: maxIncrease?.pct ?? null,
      maxIncreaseDate: maxIncrease?.date ?? null,
      highestPoint: pts.length ? pts.reduce((a, b) => (b.value > a.value ? b : a)) : null,
      lowestPoint: pts.length ? pts.reduce((a, b) => (b.value < a.value ? b : a)) : null,
      recentChangesPct: changes.slice(-3).map((c) => c.pct),
      recentPoints: pts.slice(-24),
    };
  });
}

async function runAnswerModel(ai: Ai, query: string, analytics: ReturnType<typeof buildSeriesAnalytics>) {
  const userPrompt = `Question: ${query}\n\nSeries analytics:\n${JSON.stringify(analytics)}`;
  let lastError: unknown = null;

  for (const model of ANSWER_MODELS) {
    try {
      const response = await ai.run(model, {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: ANSWER_MAX_TOKENS,
      });

      const aiResponse = response as unknown;
      const inner = aiResponse && typeof aiResponse === 'object'
        ? (aiResponse as Record<string, unknown>).response
        : aiResponse;
      const answer = typeof inner === 'string' ? inner.trim() : JSON.stringify(inner);

      if (answer) {
        return answer;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('No answer model available');
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await context.request.json<AnswerRequest>();
    const { query, series } = body ?? {};

    if (!query || !series?.length) {
      return Response.json({ error: 'query and series are required' }, { status: 400 });
    }

    const normalizedSeries = series.map((s) => ({
      title: s.title,
      units: s.units,
      points: s.points.slice(-36),
    }));

    const cacheKey = buildCacheKey(query, body?.datasetVersion, normalizedSeries);
    const cached = answerCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return Response.json({ answer: cached.value });
    }

    const edgeCached = await getFromEdgeCache(cacheKey);
    if (edgeCached) {
      answerCache.set(cacheKey, {
        value: edgeCached,
        expiresAt: Date.now() + ANSWER_CACHE_TTL_MS,
      });
      return Response.json({ answer: edgeCached });
    }

    if (!context.env.AI) {
      return Response.json({ error: 'AI binding not available', code: 'AI_BINDING_MISSING' }, { status: 503 });
    }

    const analytics = buildSeriesAnalytics(normalizedSeries);
    const answer = await runAnswerModel(context.env.AI, query, analytics);

    answerCache.set(cacheKey, {
      value: answer,
      expiresAt: Date.now() + ANSWER_CACHE_TTL_MS,
    });

    await setEdgeCache(cacheKey, answer);

    return Response.json({ answer });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
};
