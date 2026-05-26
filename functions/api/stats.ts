import { buildUsageSeries, getUsageStats } from './_usageStats';

export const onRequestGet: PagesFunction = async () => {
  const stats = await getUsageStats();

  const answerCacheHits = stats.answersCacheMemoryHits + stats.answersCacheEdgeHits;
  const answerCacheHitRate = stats.answersTotal > 0 ? answerCacheHits / stats.answersTotal : 0;

  const queryCacheHits = stats.queriesCacheMemoryHits + stats.queriesCacheEdgeHits;
  const queryCacheHitRate = stats.queriesTotal > 0 ? queryCacheHits / stats.queriesTotal : 0;

  const aiCalls = stats.answersAiCalls + stats.queriesAiCalls;
  const aiCallsAvoidedByCache = stats.answersAiCallsAvoidedByCache + stats.queriesAiCallsAvoidedByCache;

  const payload = {
    ...stats,
    usageSeries: buildUsageSeries(stats),
    answerCacheHitRate,
    queryCacheHitRate,
    aiCalls,
    aiCallsAvoidedByCache,
    estimatedHoursSaved: stats.estimatedManualSecondsSaved / 3600,
  };

  return Response.json(payload, {
    headers: {
      'cache-control': 'no-store',
    },
  });
};
