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
      return Response.json({ error: 'AI binding not available' }, { status: 500 });
    }

    // Build a compact data summary for the prompt
    const dataSummary = series.map((s) => {
      const pts = s.points.slice(-24); // last 24 data points
      const rows = pts.map((p) => `${p.date}: ${p.value}`).join(', ');
      return `Series: ${s.title} (${s.units})\nData: ${rows}`;
    }).join('\n\n');

    const userMessage = `User question: "${query}"\n\nAvailable data:\n${dataSummary}`;

    const response = await context.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 200,
    });

    const aiResponse = response as unknown;
    const inner = aiResponse && typeof aiResponse === 'object'
      ? (aiResponse as Record<string, unknown>).response
      : aiResponse;

    const answer = typeof inner === 'string' ? inner.trim() : JSON.stringify(inner);

    return Response.json({ answer });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
