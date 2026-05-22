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
        .slice(-12)
        .map((p) => `${p.date}:${p.value}`)
        .join('|');
      return `${s.title}~${s.units}~${pointsSig}`;
    })
    .sort()
    .join('||');
}

function buildCacheKey(query: string, datasetVersion: string | undefined, series: SeriesSummary[]) {
  const payloadSig = `${normalizeQuery(query)}::${buildSeriesSignature(series)}`;
  return `answer:v1:${normalizeDatasetVersion(datasetVersion)}:${hashString(payloadSig)}`;
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

function buildDeterministicAnswer(_query: string, series: SeriesSummary[]) {
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
      points: s.points.slice(-12),
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

    const answer = buildDeterministicAnswer(query, normalizedSeries);

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
