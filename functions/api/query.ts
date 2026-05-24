interface Env {
  AI: Ai;
}

interface QueryRequest {
  query: string;
  datasetVersion?: string;
}

interface QueryResponse {
  category: string | null;
  subcategory: string | null;
  measureType: string | null;
  timeRange: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  keywords: string | null;
  explanation: string;
}

const QUERY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const QUERY_CACHE_TTL_SECONDS = 90 * 24 * 60 * 60;
const queryCache = new Map<string, { expiresAt: number; value: QueryResponse }>();
const QUERY_MODELS = ['@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'];
const QUERY_MAX_TOKENS = 80;

const MONTHS: Record<string, string> = {
  january: '01', jan: '01',
  february: '02', feb: '02',
  march: '03', mar: '03',
  april: '04', apr: '04',
  may: '05',
  june: '06', jun: '06',
  july: '07', jul: '07',
  august: '08', aug: '08',
  september: '09', sep: '09', sept: '09',
  october: '10', oct: '10',
  november: '11', nov: '11',
  december: '12', dec: '12',
};

function normalizeQuery(query: string) {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeDatasetVersion(version?: string) {
  const trimmed = String(version ?? '').trim();
  return trimmed || 'unknown';
}

function buildCacheKey(query: string, datasetVersion?: string) {
  return `query:v1:${normalizeDatasetVersion(datasetVersion)}:${normalizeQuery(query)}`;
}

function buildEdgeRequest(cacheKey: string) {
  return new Request(`https://nlp-cache.local/query/${encodeURIComponent(cacheKey)}`);
}

async function getFromEdgeCache(cacheKey: string) {
  const cached = await caches.default.match(buildEdgeRequest(cacheKey));
  if (!cached) {
    return null;
  }

  try {
    return await cached.json<QueryResponse>();
  } catch {
    return null;
  }
}

async function setEdgeCache(cacheKey: string, value: QueryResponse) {
  const response = new Response(JSON.stringify(value), {
    headers: {
      'content-type': 'application/json',
      'cache-control': `public, max-age=${QUERY_CACHE_TTL_SECONDS}`,
    },
  });

  await caches.default.put(buildEdgeRequest(cacheKey), response);
}

function extractWithRules(query: string): QueryResponse | null {
  const q = query.toLowerCase();

  let category: string | null = null;
  let subcategory: string | null = null;
  let measureType: string | null = null;
  let timeRange: string | null = null;
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  let keywords: string | null = null;

  if (/\bnpp\b/.test(q)) {
    category = 'Account-to-Account';
    subcategory = 'NPP';
  } else if (/\bpayto\b/.test(q)) {
    category = 'Account-to-Account';
    subcategory = 'PayTo';
  } else if (/\bdirect\s+debit\b/.test(q)) {
    category = 'Account-to-Account';
    subcategory = 'Direct Debit';
  } else if (/\bdirect\s+credit\b/.test(q)) {
    category = 'Account-to-Account';
    subcategory = 'Direct Credit';
  } else if (/\bdirect\s+entry\b/.test(q)) {
    category = 'Account-to-Account';
    subcategory = 'Direct Entry';
  } else if (/\bcredit(\s+and\s+charge)?\s+card\b|\bcharge\s+card\b/.test(q)) {
    category = 'Cards';
    subcategory = 'Credit and Charge';
  } else if (/\bdebit\s+card\b/.test(q)) {
    category = 'Cards';
    subcategory = 'Debit';
  } else if (/\bprepaid\b/.test(q)) {
    category = 'Cards';
    subcategory = 'Prepaid';
  } else if (/\batm\b/.test(q)) {
    category = 'Cash and ATM';
    subcategory = 'ATM Withdrawals';
  } else if (/\bcheque\b|\bcheck\b/.test(q)) {
    category = 'Cheques';
    subcategory = 'Cheques';
  } else if (/\brtgs\b/.test(q)) {
    category = 'High Value';
    subcategory = 'RTGS';
  } else if (/\bcards?\b/.test(q)) {
    category = 'Cards';
  }

  if (/\bvalue\b|\bspend\w*\b|\bdollar\b|\$/.test(q)) {
    measureType = 'value';
  } else if (/\bnumber\b|\bhow many\b|\bcount\b|\btransactions?\b|\bvolume\b/.test(q)) {
    measureType = 'volume';
  } else if (/\baccounts?\b|\bon issue\b/.test(q)) {
    measureType = 'accounts';
  } else if (/\baverage\b|\bper.*transaction\b|\bmean\b/.test(q)) {
    measureType = null;
  }

  const rangeMatch = q.match(/\blast\s+(2|5|10)\s+years?\b/);
  if (rangeMatch) {
    timeRange = `${rangeMatch[1]}Y`;
  } else if (/\ball\s+time\b|\ball\s+history\b|\bfull\s+history\b/.test(q)) {
    timeRange = 'ALL';
  }

  const betweenMatch = q.match(/\b(20\d{2})\s*(?:to|\-|through|until|and)\s*(20\d{2})\b/);
  if (betweenMatch) {
    dateFrom = `${betweenMatch[1]}-01`;
    dateTo = `${betweenMatch[2]}-12`;
    timeRange = null;
  }

  const sinceMatch = q.match(/\bsince\s+(20\d{2})\b/);
  if (sinceMatch) {
    dateFrom = `${sinceMatch[1]}-01`;
    dateTo = null;
    timeRange = null;
  }

  const yearMatch = q.match(/\bin\s+(20\d{2})\b/);
  if (yearMatch) {
    dateFrom = `${yearMatch[1]}-01`;
    dateTo = `${yearMatch[1]}-12`;
    timeRange = null;
  }

  const monthYearMatch = q.match(/\bin\s+([a-z]+)\s+(20\d{2})\b/);
  if (monthYearMatch) {
    const month = MONTHS[monthYearMatch[1]];
    if (month) {
      dateFrom = `${monthYearMatch[2]}-${month}`;
      dateTo = `${monthYearMatch[2]}-${month}`;
      timeRange = null;
    }
  }

  const monthOnlyMatch = q.match(/\bin\s+([a-z]+)\b/);
  if (!dateFrom && monthOnlyMatch) {
    const month = MONTHS[monthOnlyMatch[1]];
    if (month) {
      dateFrom = `2025-${month}`;
      dateTo = `2025-${month}`;
      timeRange = null;
    }
  }

  if (/\bcontactless\b/.test(q)) {
    keywords = 'contactless';
  } else if (/\bmobile\s+wallet\b/.test(q)) {
    keywords = 'mobile wallet';
  }

  if (!category && !subcategory && !measureType && !timeRange && !dateFrom && !dateTo && !keywords) {
    return null;
  }

  const explanationParts = [
    subcategory || category || 'Payments',
    measureType ? `${measureType} metrics` : null,
    timeRange ? `over ${timeRange}` : null,
    dateFrom && dateTo ? `for ${dateFrom} to ${dateTo}` : null,
    dateFrom && !dateTo ? `since ${dateFrom}` : null,
  ].filter(Boolean);

  return {
    category,
    subcategory,
    measureType,
    timeRange,
    dateFrom,
    dateTo,
    keywords,
    explanation: explanationParts.join(' '),
  };
}

async function runQueryModel(
  ai: Ai,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
) {
  let lastError: unknown = null;
  for (const model of QUERY_MODELS) {
    try {
      return await ai.run(model, {
        messages,
        max_tokens: QUERY_MAX_TOKENS,
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('No query model available');
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

const SYSTEM_PROMPT = `Extract filters from a payments-data query and return JSON only.

Categories:
- Cards > Credit and Charge | Debit | Prepaid
- Cash and ATM > ATM Withdrawals
- Cheques > Cheques
- Account-to-Account > Direct Credit | Direct Debit | Direct Entry | NPP | PayTo
- High Value > RTGS

Measure types: value | volume | accounts | other

Use either timeRange OR dateFrom/dateTo:
- timeRange: 2Y | 5Y | 10Y | ALL
- dates: YYYY-MM

JSON schema:
{"category":string|null,"subcategory":string|null,"measureType":string|null,"timeRange":string|null,"dateFrom":string|null,"dateTo":string|null,"keywords":string|null,"explanation":string}

keywords should only be a specific series phrase not already represented by category/subcategory/measure/date; otherwise null.`;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await context.request.json<QueryRequest>();
    const query = body?.query?.trim();

    if (!query) {
      return Response.json({ error: 'query is required' }, { status: 400 });
    }

    const cacheKey = buildCacheKey(query, body?.datasetVersion);

    const cached = queryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return Response.json(cached.value);
    }

    const edgeCached = await getFromEdgeCache(cacheKey);
    if (edgeCached) {
      queryCache.set(cacheKey, {
        value: edgeCached,
        expiresAt: Date.now() + QUERY_CACHE_TTL_MS,
      });
      return Response.json(edgeCached);
    }

    const ruleBased = extractWithRules(query);
    if (ruleBased) {
      queryCache.set(cacheKey, {
        value: ruleBased,
        expiresAt: Date.now() + QUERY_CACHE_TTL_MS,
      });
      await setEdgeCache(cacheKey, ruleBased);
      return Response.json(ruleBased);
    }

    if (!context.env.AI) {
      return Response.json({ error: 'AI binding not available', code: 'AI_BINDING_MISSING' }, { status: 503 });
    }

    const response = await runQueryModel(context.env.AI, [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: query },
    ]);

    const aiResponse = response as unknown;
    let parsed: QueryResponse | null = null;

    // Workers AI returns { response: string | object, tool_calls, usage }
    const inner = aiResponse && typeof aiResponse === 'object'
      ? (aiResponse as Record<string, unknown>).response
      : aiResponse;

    if (inner && typeof inner === 'object') {
      // Model returned a structured object directly
      parsed = inner as QueryResponse;
    } else if (typeof inner === 'string') {
      const jsonMatch = (inner as string).trim().match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return Response.json({ error: 'Could not parse AI response', code: 'AI_PARSE_ERROR', raw: inner }, { status: 502 });
      }
      try {
        parsed = JSON.parse(jsonMatch[0]) as QueryResponse;
      } catch {
        return Response.json({ error: 'Invalid JSON from AI', code: 'AI_PARSE_ERROR', raw: inner }, { status: 502 });
      }
    } else {
      return Response.json({ error: 'Unexpected AI response shape', code: 'AI_PARSE_ERROR', raw: JSON.stringify(aiResponse) }, { status: 502 });
    }

    queryCache.set(cacheKey, {
      value: parsed,
      expiresAt: Date.now() + QUERY_CACHE_TTL_MS,
    });

    await setEdgeCache(cacheKey, parsed);

    return Response.json(parsed);
  } catch (err) {
    const { status, body } = classifyAiError(err);
    return Response.json(body, { status });
  }
};
