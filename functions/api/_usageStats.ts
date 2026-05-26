interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface UsageStats {
  answersTotal: number;
  answersCacheMemoryHits: number;
  answersCacheEdgeHits: number;
  answersAiCalls: number;
  answersAiCallsAvoidedByCache: number;
  answersPromptTokens: number;
  answersCompletionTokens: number;
  queriesTotal: number;
  queriesCacheMemoryHits: number;
  queriesCacheEdgeHits: number;
  queriesAiCalls: number;
  queriesAiCallsAvoidedByCache: number;
  queriesPromptTokens: number;
  queriesCompletionTokens: number;
  estimatedManualSecondsSaved: number;
  daily: Record<string, DailyUsageBucket>;
  backfillVersion?: string;
  updatedAt: string;
}

export interface DailyUsageBucket {
  answersTotal: number;
  answersCacheHits: number;
  queriesTotal: number;
  queriesCacheHits: number;
  aiCalls: number;
  aiCallsAvoidedByCache: number;
  estimatedManualSecondsSaved: number;
}

export interface UsageSeries {
  id: string;
  title: string;
  units: string;
  category: string;
  subcategory: string;
  measureType: 'other' | 'volume';
  points: Array<{ date: string; value: number }>;
}

export type CacheSource = 'memory' | 'edge' | 'ai';

export interface QueryUsageEvent {
  cacheSource: CacheSource;
  aiUsed: boolean;
  tokenUsage?: Partial<TokenUsage>;
}

export interface AnswerUsageEvent {
  cacheSource: CacheSource;
  aiUsed: boolean;
  tokenUsage?: Partial<TokenUsage>;
  seriesCount: number;
  pointCount: number;
  query: string;
}

const STATS_CACHE_KEY = 'usage-stats:v1';
const HISTORICAL_BACKFILL_VERSION = '2026-05-token-chart-v1';

// Rough historical backfill from observed Cloudflare token usage chart (pre-telemetry period).
// Total token budget seeded here is ~14,010 to align with the shared dashboard snapshot.
const HISTORICAL_BACKFILL = {
  answersTotal: 10,
  answersAiCalls: 10,
  answersPromptTokens: 10_950,
  answersCompletionTokens: 1_240,
  queriesTotal: 3,
  queriesAiCalls: 3,
  queriesPromptTokens: 1_450,
  queriesCompletionTokens: 370,
  estimatedManualSecondsSaved: 7_800,
  daily: {
    '2026-05-21': {
      answersTotal: 4,
      answersCacheHits: 0,
      queriesTotal: 1,
      queriesCacheHits: 0,
      aiCalls: 5,
      aiCallsAvoidedByCache: 0,
      estimatedManualSecondsSaved: 2_600,
    },
    '2026-05-22': {
      answersTotal: 4,
      answersCacheHits: 0,
      queriesTotal: 1,
      queriesCacheHits: 0,
      aiCalls: 5,
      aiCallsAvoidedByCache: 0,
      estimatedManualSecondsSaved: 2_800,
    },
    '2026-05-23': {
      answersTotal: 2,
      answersCacheHits: 0,
      queriesTotal: 1,
      queriesCacheHits: 0,
      aiCalls: 3,
      aiCallsAvoidedByCache: 0,
      estimatedManualSecondsSaved: 2_400,
    },
  } as Record<string, DailyUsageBucket>,
};

function buildStatsRequest() {
  return new Request(`https://nlp-cache.local/stats/${encodeURIComponent(STATS_CACHE_KEY)}`);
}

function nowIso() {
  return new Date().toISOString();
}

function todayKey() {
  return nowIso().slice(0, 10);
}

function defaultDailyBucket(): DailyUsageBucket {
  return {
    answersTotal: 0,
    answersCacheHits: 0,
    queriesTotal: 0,
    queriesCacheHits: 0,
    aiCalls: 0,
    aiCallsAvoidedByCache: 0,
    estimatedManualSecondsSaved: 0,
  };
}

function defaultStats(): UsageStats {
  return {
    answersTotal: 0,
    answersCacheMemoryHits: 0,
    answersCacheEdgeHits: 0,
    answersAiCalls: 0,
    answersAiCallsAvoidedByCache: 0,
    answersPromptTokens: 0,
    answersCompletionTokens: 0,
    queriesTotal: 0,
    queriesCacheMemoryHits: 0,
    queriesCacheEdgeHits: 0,
    queriesAiCalls: 0,
    queriesAiCallsAvoidedByCache: 0,
    queriesPromptTokens: 0,
    queriesCompletionTokens: 0,
    estimatedManualSecondsSaved: 0,
    daily: {},
    updatedAt: nowIso(),
  };
}

function mergeWithDefaults(value: Partial<UsageStats> | null | undefined): UsageStats {
  const merged = {
    ...defaultStats(),
    ...(value ?? {}),
    updatedAt: value?.updatedAt ?? nowIso(),
  };

  const safeDaily = merged.daily && typeof merged.daily === 'object' ? merged.daily : {};

  return {
    ...merged,
    daily: safeDaily,
  };
}

function applyHistoricalBackfill(stats: UsageStats) {
  if (stats.backfillVersion === HISTORICAL_BACKFILL_VERSION) {
    return false;
  }

  stats.answersTotal += HISTORICAL_BACKFILL.answersTotal;
  stats.answersAiCalls += HISTORICAL_BACKFILL.answersAiCalls;
  stats.answersPromptTokens += HISTORICAL_BACKFILL.answersPromptTokens;
  stats.answersCompletionTokens += HISTORICAL_BACKFILL.answersCompletionTokens;
  stats.queriesTotal += HISTORICAL_BACKFILL.queriesTotal;
  stats.queriesAiCalls += HISTORICAL_BACKFILL.queriesAiCalls;
  stats.queriesPromptTokens += HISTORICAL_BACKFILL.queriesPromptTokens;
  stats.queriesCompletionTokens += HISTORICAL_BACKFILL.queriesCompletionTokens;
  stats.estimatedManualSecondsSaved += HISTORICAL_BACKFILL.estimatedManualSecondsSaved;

  for (const [day, bucket] of Object.entries(HISTORICAL_BACKFILL.daily)) {
    const current = stats.daily[day] ?? defaultDailyBucket();
    stats.daily[day] = {
      answersTotal: current.answersTotal + bucket.answersTotal,
      answersCacheHits: current.answersCacheHits + bucket.answersCacheHits,
      queriesTotal: current.queriesTotal + bucket.queriesTotal,
      queriesCacheHits: current.queriesCacheHits + bucket.queriesCacheHits,
      aiCalls: current.aiCalls + bucket.aiCalls,
      aiCallsAvoidedByCache: current.aiCallsAvoidedByCache + bucket.aiCallsAvoidedByCache,
      estimatedManualSecondsSaved: current.estimatedManualSecondsSaved + bucket.estimatedManualSecondsSaved,
    };
  }

  stats.backfillVersion = HISTORICAL_BACKFILL_VERSION;
  stats.updatedAt = nowIso();
  return true;
}

export async function getUsageStats(): Promise<UsageStats> {
  const cached = await caches.default.match(buildStatsRequest());
  if (!cached) {
    const fresh = defaultStats();
    applyHistoricalBackfill(fresh);
    await setUsageStats(fresh);
    return fresh;
  }

  try {
    const parsed = await cached.json<Partial<UsageStats>>();
    const merged = mergeWithDefaults(parsed);
    if (applyHistoricalBackfill(merged)) {
      await setUsageStats(merged);
    }
    return merged;
  } catch {
    const fresh = defaultStats();
    applyHistoricalBackfill(fresh);
    await setUsageStats(fresh);
    return fresh;
  }
}

async function setUsageStats(stats: UsageStats) {
  const response = new Response(JSON.stringify(stats), {
    headers: {
      'content-type': 'application/json',
      // keep this effectively permanent; key version controls resets.
      'cache-control': 'public, max-age=31536000',
    },
  });

  await caches.default.put(buildStatsRequest(), response);
}

function ensureDailyBucket(stats: UsageStats, dateKey: string) {
  if (!stats.daily[dateKey]) {
    stats.daily[dateKey] = defaultDailyBucket();
  }
  return stats.daily[dateKey];
}

function sanitizeTokenUsage(usage?: Partial<TokenUsage>) {
  return {
    promptTokens: Number.isFinite(usage?.promptTokens) ? Math.max(0, Number(usage?.promptTokens)) : 0,
    completionTokens: Number.isFinite(usage?.completionTokens) ? Math.max(0, Number(usage?.completionTokens)) : 0,
  };
}

function estimateManualAnalysisSeconds(event: AnswerUsageEvent) {
  const baseSeconds = 150;
  const seriesSeconds = Math.min(event.seriesCount, 12) * 28;
  const pointSeconds = Math.min(event.pointCount, 240) * 1.2;
  const complexityBonus = /average|growth|compare|trend|highest|lowest|spike|momentum|accelerat/i.test(event.query) ? 80 : 35;
  return Math.round(baseSeconds + seriesSeconds + pointSeconds + complexityBonus);
}

async function mutateUsageStats(mutator: (stats: UsageStats) => void) {
  const current = await getUsageStats();
  mutator(current);
  current.updatedAt = nowIso();
  await setUsageStats(current);
}

export async function recordQueryUsage(event: QueryUsageEvent) {
  const tokens = sanitizeTokenUsage(event.tokenUsage);
  await mutateUsageStats((stats) => {
    const bucket = ensureDailyBucket(stats, todayKey());
    stats.queriesTotal += 1;
    bucket.queriesTotal += 1;

    if (event.cacheSource === 'memory') {
      stats.queriesCacheMemoryHits += 1;
      stats.queriesAiCallsAvoidedByCache += 1;
      bucket.queriesCacheHits += 1;
      bucket.aiCallsAvoidedByCache += 1;
    } else if (event.cacheSource === 'edge') {
      stats.queriesCacheEdgeHits += 1;
      stats.queriesAiCallsAvoidedByCache += 1;
      bucket.queriesCacheHits += 1;
      bucket.aiCallsAvoidedByCache += 1;
    }

    if (event.aiUsed) {
      stats.queriesAiCalls += 1;
      stats.queriesPromptTokens += tokens.promptTokens;
      stats.queriesCompletionTokens += tokens.completionTokens;
      bucket.aiCalls += 1;
    }
  });
}

export async function recordAnswerUsage(event: AnswerUsageEvent) {
  const tokens = sanitizeTokenUsage(event.tokenUsage);
  const estimatedSeconds = estimateManualAnalysisSeconds(event);
  await mutateUsageStats((stats) => {
    const bucket = ensureDailyBucket(stats, todayKey());
    stats.answersTotal += 1;
    bucket.answersTotal += 1;

    if (event.cacheSource === 'memory') {
      stats.answersCacheMemoryHits += 1;
      stats.answersAiCallsAvoidedByCache += 1;
      bucket.answersCacheHits += 1;
      bucket.aiCallsAvoidedByCache += 1;
    } else if (event.cacheSource === 'edge') {
      stats.answersCacheEdgeHits += 1;
      stats.answersAiCallsAvoidedByCache += 1;
      bucket.answersCacheHits += 1;
      bucket.aiCallsAvoidedByCache += 1;
    }

    if (event.aiUsed) {
      stats.answersAiCalls += 1;
      stats.answersPromptTokens += tokens.promptTokens;
      stats.answersCompletionTokens += tokens.completionTokens;
      bucket.aiCalls += 1;
    }

    stats.estimatedManualSecondsSaved += estimatedSeconds;
    bucket.estimatedManualSecondsSaved += estimatedSeconds;
  });
}

export function buildUsageSeries(stats: UsageStats): UsageSeries[] {
  const days = Object.keys(stats.daily).sort();

  let cumulativeHoursSaved = 0;
  let cumulativeAiCallsAvoided = 0;
  let cumulativeAiCallsExecuted = 0;

  const hoursSavedPoints: Array<{ date: string; value: number }> = [];
  const aiAvoidedPoints: Array<{ date: string; value: number }> = [];
  const aiCallsPoints: Array<{ date: string; value: number }> = [];
  const answerCacheHitRatePoints: Array<{ date: string; value: number }> = [];

  for (const day of days) {
    const bucket = stats.daily[day];
    if (!bucket) continue;

    cumulativeHoursSaved += bucket.estimatedManualSecondsSaved / 3600;
    cumulativeAiCallsAvoided += bucket.aiCallsAvoidedByCache;
    cumulativeAiCallsExecuted += bucket.aiCalls;

    hoursSavedPoints.push({ date: day, value: Number(cumulativeHoursSaved.toFixed(2)) });
    aiAvoidedPoints.push({ date: day, value: cumulativeAiCallsAvoided });
    aiCallsPoints.push({ date: day, value: cumulativeAiCallsExecuted });

    const answerCacheHitRate = bucket.answersTotal > 0
      ? (bucket.answersCacheHits / bucket.answersTotal) * 100
      : 0;
    answerCacheHitRatePoints.push({ date: day, value: Number(answerCacheHitRate.toFixed(2)) });
  }

  const fallbackDate = todayKey();
  const withFallback = (points: Array<{ date: string; value: number }>, value: number) =>
    points.length ? points : [{ date: fallbackDate, value }];

  return [
    {
      id: 'site-usage-hours-saved',
      title: 'Site Usage: Estimated analyst hours saved (cumulative)',
      units: 'Hours',
      category: 'Site Usage',
      subcategory: 'Productivity',
      measureType: 'other',
      points: withFallback(hoursSavedPoints, Number((stats.estimatedManualSecondsSaved / 3600).toFixed(2))),
    },
    {
      id: 'site-usage-ai-avoided',
      title: 'Site Usage: AI calls avoided by cache (cumulative)',
      units: 'Number',
      category: 'Site Usage',
      subcategory: 'Caching',
      measureType: 'volume',
      points: withFallback(aiAvoidedPoints, stats.answersAiCallsAvoidedByCache + stats.queriesAiCallsAvoidedByCache),
    },
    {
      id: 'site-usage-ai-calls',
      title: 'Site Usage: AI calls requiring tokens (cumulative)',
      units: 'Number',
      category: 'Site Usage',
      subcategory: 'AI Cost',
      measureType: 'volume',
      points: withFallback(aiCallsPoints, stats.answersAiCalls + stats.queriesAiCalls),
    },
    {
      id: 'site-usage-answer-cache-hit-rate',
      title: 'Site Usage: Answer cache hit rate (daily)',
      units: 'Percent',
      category: 'Site Usage',
      subcategory: 'Caching',
      measureType: 'other',
      points: withFallback(answerCacheHitRatePoints, 0),
    },
  ];
}

export function extractTokenUsage(rawResponse: unknown): TokenUsage {
  if (!rawResponse || typeof rawResponse !== 'object') {
    return { promptTokens: 0, completionTokens: 0 };
  }

  const usage = (rawResponse as Record<string, unknown>).usage;
  if (!usage || typeof usage !== 'object') {
    return { promptTokens: 0, completionTokens: 0 };
  }

  const usageObj = usage as Record<string, unknown>;
  const promptTokens = Number(usageObj.prompt_tokens ?? usageObj.input_tokens ?? 0);
  const completionTokens = Number(usageObj.completion_tokens ?? usageObj.output_tokens ?? 0);

  return {
    promptTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
    completionTokens: Number.isFinite(completionTokens) ? completionTokens : 0,
  };
}
