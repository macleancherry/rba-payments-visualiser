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
  keywords: string | null;
  explanation: string;
}

const SYSTEM_PROMPT = `You are a helpful assistant for an Australian payments data explorer powered by Reserve Bank of Australia (RBA) data.

The user will ask a natural language question about payments data. Your job is to extract filter parameters from their question and return a JSON object.

Available categories and subcategories:
- Cards > Credit and Charge
- Cards > Debit
- Cards > Prepaid
- Cash and ATM > ATM Withdrawals
- Cheques > Cheques
- Account-to-Account > Direct Credit
- Account-to-Account > Direct Debit
- Account-to-Account > Direct Entry
- Account-to-Account > NPP
- Account-to-Account > PayTo
- High Value > RTGS

Available measure types:
- value (dollar values, e.g. "$X million")
- volume (transaction counts, number of transactions)
- accounts (cards on issue, account counts)
- other

Available time ranges:
- 2Y (2 years)
- 5Y (5 years)
- 10Y (10 years)
- ALL (all available history)

Return ONLY a valid JSON object with these fields (use null for any you cannot determine):
{
  "category": string or null,
  "subcategory": string or null,
  "measureType": string or null,
  "timeRange": string or null,
  "keywords": string or null,
  "explanation": string (brief human-readable summary of what you understood)
}

Examples:
- "credit card spending last 2 years" → {"category":"Cards","subcategory":"Credit and Charge","measureType":"value","timeRange":"2Y","keywords":null,"explanation":"Credit and charge card transaction values over the last 2 years"}
- "how many NPP payments" → {"category":"Account-to-Account","subcategory":"NPP","measureType":"volume","timeRange":null,"keywords":null,"explanation":"NPP payment volumes"}
- "debit card contactless transactions" → {"category":"Cards","subcategory":"Debit","measureType":null,"timeRange":null,"keywords":"contactless","explanation":"Debit card contactless transactions"}
- "cards on issue" → {"category":"Cards","subcategory":null,"measureType":"accounts","timeRange":null,"keywords":"cards on issue","explanation":"Cards on issue across card types"}`;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await context.request.json<QueryRequest>();
    const query = body?.query?.trim();

    if (!query) {
      return Response.json({ error: 'query is required' }, { status: 400 });
    }

    if (!context.env.AI) {
      return Response.json({ error: 'AI binding not available' }, { status: 500 });
    }

    const response = await context.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: query },
      ],
      max_tokens: 300,
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
        return Response.json({ error: 'Could not parse AI response', raw: inner }, { status: 500 });
      }
      try {
        parsed = JSON.parse(jsonMatch[0]) as QueryResponse;
      } catch {
        return Response.json({ error: 'Invalid JSON from AI', raw: inner }, { status: 500 });
      }
    } else {
      return Response.json({ error: 'Unexpected AI response shape', raw: JSON.stringify(aiResponse) }, { status: 500 });
    }

    return Response.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
};
