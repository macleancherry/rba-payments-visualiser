interface Env {
  AI: Ai;
}

interface QueryRequest {
  query: string;
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

const QUERY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const queryCache = new Map<string, { expiresAt: number; value: QueryResponse }>();

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

    if (!context.env.AI) {
      return Response.json({ error: 'AI binding not available', code: 'AI_BINDING_MISSING' }, { status: 503 });
    }

    const cacheKey = query.toLowerCase();
    const cached = queryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return Response.json(cached.value);
    }

    const response = await context.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: query },
      ],
      max_tokens: 120,
    });

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

    return Response.json(parsed);
  } catch (err) {
    const { status, body } = classifyAiError(err);
    return Response.json(body, { status });
  }
};
