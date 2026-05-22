interface Env {
  AI: Ai;
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

type ErrorResponse = {
  error: string;
  code?: string;
};

function classifyAiError(err: unknown): { status: number; body: ErrorResponse } {
  const message = err instanceof Error ? err.message : String(err);
  const lowered = message.toLowerCase();

  if (message.includes('4006') || lowered.includes('daily free allocation')) {
    return {
      status: 429,
      body: {
        error: 'NLP capacity is temporarily unavailable because the daily AI quota has been reached. Please try again later, or use the filters below to find the data manually.',
        code: 'AI_QUOTA_EXCEEDED',
      },
    };
  }

  return {
    status: 502,
    body: {
      error: message,
      code: 'AI_UPSTREAM_ERROR',
    },
  };
}

const SYSTEM_PROMPT = `You are a concise analyst for Australian payments data from the Reserve Bank of Australia (RBA).

The user asked a question and you have been provided with the relevant data series. Write a 2-4 sentence natural language answer that:
- Directly addresses the user's question
- References specific values and trends from the data (e.g. latest value, year-on-year change, notable trends)
- Mentions the time period and units
- Does not mention "RBA" or "the data shows" — speak naturally as if you know this information

Keep it brief and informative. Do not use markdown formatting or bullet points — plain prose only.`;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await context.request.json<AnswerRequest>();
    const { query, series } = body ?? {};

    if (!query || !series?.length) {
      return Response.json({ error: 'query and series are required' }, { status: 400 });
    }

    if (!context.env.AI) {
      return Response.json({ error: 'AI binding not available', code: 'AI_BINDING_MISSING' }, { status: 503 });
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

    // Build a compact data summary for the prompt
    const dataSummary = normalizedSeries.map((s) => {
      const pts = s.points;
      const rows = pts.map((p) => `${p.date}: ${p.value}`).join(', ');
      return `Series: ${s.title} (${s.units})\nData: ${rows}`;
    }).join('\n\n');

    const userMessage = `User question: "${query}"\n\nAvailable data:\n${dataSummary}`;

    const response = await context.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 120,
    });

    const aiResponse = response as unknown;
    const inner = aiResponse && typeof aiResponse === 'object'
      ? (aiResponse as Record<string, unknown>).response
      : aiResponse;

    const answer = typeof inner === 'string' ? inner.trim() : JSON.stringify(inner);

    answerCache.set(cacheKey, {
      value: answer,
      expiresAt: Date.now() + ANSWER_CACHE_TTL_MS,
    });

    await setEdgeCache(cacheKey, answer);

    return Response.json({ answer });
  } catch (e) {
    const { status, body } = classifyAiError(e);
    return Response.json(body, { status });
  }
};
