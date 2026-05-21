import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format, parseISO, subYears } from 'date-fns';

type MeasureType = 'value' | 'volume' | 'accounts' | 'other';
type RangeOption = '2Y' | '5Y' | '10Y' | 'ALL';

type SeriesPoint = {
  date: string;
  value: number;
};

type SeriesDimensions = {
  segment?: string;
  cardType?: string;
  prepaidType?: string;
  location?: string;
  acquirer?: string;
  method?: string;
  instrument?: string;
};

type PaymentSeries = {
  id: string;
  tableCode: string;
  tableName?: string;
  tableUrl: string;
  sheetName: string;
  title: string;
  frequency: string;
  units: string;
  category: string;
  subcategory: string;
  measureType: MeasureType;
  dimensions: SeriesDimensions;
  points: SeriesPoint[];
};

type DatasetPayload = {
  generatedAt: string;
  source: string;
  series: PaymentSeries[];
};

const SERIES_COLORS = ['#0f4c81', '#11b5a4', '#ff7a59', '#0a2f5a', '#23a6d5', '#f4b400'];

const RANGE_YEARS: Record<Exclude<RangeOption, 'ALL'>, number> = {
  '2Y': 2,
  '5Y': 5,
  '10Y': 10,
};

function formatValue(value: number, units: string) {
  const unit = units.toLowerCase();
  const isCurrency = unit.includes('$');

  let absoluteValue = value;
  if (unit.includes('$ million') || unit === 'million') {
    absoluteValue = value * 1_000_000;
  } else if (unit.includes("'000")) {
    absoluteValue = value * 1_000;
  }

  return `${isCurrency ? '$' : ''}${Math.round(absoluteValue).toLocaleString()}`;
}

function shortenLabel(label: string, max = 34) {
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}

function matchesSeriesSearch(series: PaymentSeries, search: string) {
  if (!search) {
    return true;
  }

  const haystack = `${series.title} ${series.subcategory} ${series.category}`.toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function App() {
  const [dataset, setDataset] = useState<DatasetPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [category, setCategory] = useState('All');
  const [subcategory, setSubcategory] = useState('All');
  const [measureType, setMeasureType] = useState<'All' | MeasureType>('All');
  const [seriesSearch, setSeriesSearch] = useState('');
  const [timeRange, setTimeRange] = useState<RangeOption>('5Y');
  const [selectedSeries, setSelectedSeries] = useState<PaymentSeries[]>([]);

  const [dimSegment, setDimSegment] = useState('All');
  const [dimCardType, setDimCardType] = useState('All');
  const [dimPrepaidType, setDimPrepaidType] = useState('All');
  const [dimLocation, setDimLocation] = useState('All');
  const [dimAcquirer, setDimAcquirer] = useState('All');
  const [dimMethod, setDimMethod] = useState('All');
  const [dimInstrument, setDimInstrument] = useState('All');

  const [nlQuery, setNlQuery] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [nlResult, setNlResult] = useState<{ explanation: string } | null>(null);
  const [nlError, setNlError] = useState<string | null>(null);
  const nlInputRef = useRef<HTMLInputElement>(null);
  const [customFrom, setCustomFrom] = useState<string | null>(null);
  const [customTo, setCustomTo] = useState<string | null>(null);
  const [nlAnswer, setNlAnswer] = useState<string | null>(null);
  const [nlAnswerLoading, setNlAnswerLoading] = useState(false);
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);

  const [trendInsight, setTrendInsight] = useState<string | null>(null);
  const [trendInsightLoading, setTrendInsightLoading] = useState(false);
  const [volumeInsight, setVolumeInsight] = useState<string | null>(null);
  const [volumeInsightLoading, setVolumeInsightLoading] = useState(false);

  const generateChartInsights = async (series: PaymentSeries[], timelineData: Array<Record<string, number | string | null>>) => {
    if (!series.length || !timelineData.length) return;

    setTrendInsightLoading(true);
    setVolumeInsightLoading(true);

    try {
      const seriesInfo = series
        .slice(0, 4)
        .map((s) => ({ title: s.title, units: s.units }));

      const recentPoints = timelineData.slice(-6);
      const insightQuery = `Provide a brief, single-sentence insight about the payment trends shown in this filtered data. Be specific and analytical: ${JSON.stringify(seriesInfo)}. Recent data shows: ${JSON.stringify(recentPoints)}`;
      
      const insight = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: insightQuery,
          series: series
            .slice(0, 2)
            .map((s) => ({
              title: s.title,
              units: s.units,
              points: s.points.slice(-12),
            })),
        }),
      });

      if (insight.ok) {
        const { answer } = await insight.json() as { answer: string };
        setTrendInsight(answer);
        setVolumeInsight(answer);
      }
    } catch {
      // Silently fail - insights are optional
    } finally {
      setTrendInsightLoading(false);
      setVolumeInsightLoading(false);
    }
  };

  const getSeriesMatches = (
    nextCategory: string,
    nextSubcategory: string,
    nextMeasureType: 'All' | MeasureType,
    nextKeywords: string,
  ) => {
    if (!dataset) {
      return [] as PaymentSeries[];
    }

    return dataset.series
      .filter((series) => nextCategory === 'All' || series.category === nextCategory)
      .filter((series) => nextSubcategory === 'All' || series.subcategory === nextSubcategory)
      .filter((series) => nextMeasureType === 'All' || series.measureType === nextMeasureType)
      .filter((series) => matchesSeriesSearch(series, nextKeywords));
  };

  const handleReset = () => {
    setCategory('All');
    setSubcategory('All');
    setMeasureType('All');
    setSeriesSearch('');
    setTimeRange('5Y');
    setCustomFrom(null);
    setCustomTo(null);
    setDimSegment('All');
    setDimCardType('All');
    setDimPrepaidType('All');
    setDimLocation('All');
    setDimAcquirer('All');
    setDimMethod('All');
    setDimInstrument('All');
    setNlQuery('');
    setNlResult(null);
    setNlError(null);
    setNlAnswer(null);
    setSelectedSeries([]);
  };

  const handleNlQuery = async () => {
    const q = nlQuery.trim();
    if (!q) return;
    setNlLoading(true);
    setNlError(null);
    setNlResult(null);
    setNlAnswer(null);
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json() as {
        category?: string; subcategory?: string; measureType?: string;
        timeRange?: string; dateFrom?: string; dateTo?: string;
        keywords?: string; explanation: string;
      };

      const newCategory = data.category ?? 'All';
      const newSubcategory = data.subcategory ?? 'All';
      const newMeasureType = (data.measureType ?? 'All') as 'All' | MeasureType;
      const requestedKeywords = data.keywords?.trim() ?? '';
      const newFrom = (data.dateFrom || data.dateTo) ? (data.dateFrom ?? null) : null;
      const newTo = (data.dateFrom || data.dateTo) ? (data.dateTo ?? null) : null;
      const matchesWithKeywords = getSeriesMatches(newCategory, newSubcategory, newMeasureType, requestedKeywords);
      const matchesWithoutKeywords = getSeriesMatches(newCategory, newSubcategory, newMeasureType, '');
      const effectiveKeywords = requestedKeywords && matchesWithKeywords.length > 0 ? requestedKeywords : '';

      if (data.category) setCategory(newCategory);
      if (data.subcategory) setSubcategory(newSubcategory);
      if (data.measureType) setMeasureType(newMeasureType);
      if (newFrom || newTo) {
        setCustomFrom(newFrom);
        setCustomTo(newTo);
      } else if (data.timeRange) {
        setCustomFrom(null);
        setCustomTo(null);
        setTimeRange(data.timeRange as RangeOption);
      }
      setSeriesSearch(effectiveKeywords);
      setNlResult({ explanation: data.explanation });

      // Compute relevant series for the answer using the new filter values
      if (dataset) {
        const answerCandidates = (effectiveKeywords ? matchesWithKeywords : matchesWithoutKeywords);
        const matchingSeries = answerCandidates
          .filter((s) => !s.dimensions || Object.keys(s.dimensions).length === 0) // prefer aggregates
          .slice(0, 3);

        const topSeries = matchingSeries.length ? matchingSeries
          : matchesWithoutKeywords
              .slice(0, 2);

        const dateMin = newFrom ? `${newFrom}-01` : null;
        const dateMax = newTo ? `${newTo}-31` : null;

        const seriesPayload = topSeries.map((s) => ({
          title: s.title,
          units: s.units,
          points: s.points
            .filter((p) => (!dateMin || p.date >= dateMin) && (!dateMax || p.date <= dateMax))
            .slice(-24),
        }));

        if (seriesPayload.some((s) => s.points.length > 0)) {
          setNlAnswerLoading(true);
          fetch('/api/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: q, series: seriesPayload }),
          })
            .then((r) => r.json() as Promise<{ answer?: string; error?: string }>)
            .then((d) => setNlAnswer(d.answer ?? null))
            .catch(() => setNlAnswer(null))
            .finally(() => setNlAnswerLoading(false));
        }
      }
    } catch (e) {
      setNlError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setNlLoading(false);
    }
  };

  useEffect(() => {
    const run = async () => {
      try {
        const response = await fetch('/data/rba-original-series.json');
        if (!response.ok) {
          throw new Error(`Failed to load generated dataset (${response.status})`);
        }

        const payload = (await response.json()) as DatasetPayload;
        setDataset(payload);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : 'Unknown error');
      }
    };

    run();
  }, []);

  const categories = useMemo(() => {
    if (!dataset) {
      return [];
    }
    return Array.from(new Set(dataset.series.map((item) => item.category))).sort();
  }, [dataset]);

  const subcategories = useMemo(() => {
    if (!dataset) {
      return [];
    }

    return Array.from(
      new Set(
        dataset.series
          .filter((item) => category === 'All' || item.category === category)
          .map((item) => item.subcategory),
      ),
    ).sort();
  }, [category, dataset]);

  // Base series: filtered by category/subcategory/measure/search but NOT by dimensions
  const baseSeries = useMemo(() => {
    if (!dataset) {
      return [];
    }

    return dataset.series
      .filter((item) => category === 'All' || item.category === category)
      .filter((item) => subcategory === 'All' || item.subcategory === subcategory)
      .filter((item) => measureType === 'All' || item.measureType === measureType)
      .filter((item) => matchesSeriesSearch(item, seriesSearch))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [category, dataset, measureType, seriesSearch, subcategory]);

  // Available dimension values for the current base set
  const dimOptions = useMemo(() => {
    const get = (key: keyof SeriesDimensions) =>
      Array.from(new Set(baseSeries.map((s) => s.dimensions?.[key]).filter(Boolean) as string[])).sort();
    return {
      segment: get('segment'),
      cardType: get('cardType'),
      prepaidType: get('prepaidType'),
      location: get('location'),
      acquirer: get('acquirer'),
      method: get('method'),
      instrument: get('instrument'),
    };
  }, [baseSeries]);

  // Reset dimension filters when primary filters change
  useEffect(() => {
    setDimSegment('All');
    setDimCardType('All');
    setDimPrepaidType('All');
    setDimLocation('All');
    setDimAcquirer('All');
    setDimMethod('All');
    setDimInstrument('All');
  }, [category, subcategory, measureType, seriesSearch]);

  // Final series: base + dimension filters applied.
  // When a dimension is set to "All": if aggregates (series with no tag) exist in baseSeries,
  // show only those aggregates so breakdowns don't flood the list.
  // If no aggregate exists for that dimension (all series have a tag), show everything.
  const filteredSeries = useMemo(() => {
    const dimFilter = (item: PaymentSeries, key: keyof SeriesDimensions, selected: string) => {
      if (selected !== 'All') return item.dimensions?.[key] === selected;
      const hasAggregate = baseSeries.some((s) => !s.dimensions?.[key]);
      return hasAggregate ? !item.dimensions?.[key] : true;
    };
    return baseSeries
      .filter((item) => dimFilter(item, 'segment', dimSegment))
      .filter((item) => dimFilter(item, 'cardType', dimCardType))
      .filter((item) => dimFilter(item, 'prepaidType', dimPrepaidType))
      .filter((item) => dimFilter(item, 'location', dimLocation))
      .filter((item) => dimFilter(item, 'acquirer', dimAcquirer))
      .filter((item) => dimFilter(item, 'method', dimMethod))
      .filter((item) => dimFilter(item, 'instrument', dimInstrument));
  }, [baseSeries, dimSegment, dimCardType, dimPrepaidType, dimLocation, dimAcquirer, dimMethod, dimInstrument]);

  useEffect(() => {
    if (!filteredSeries.length) {
      setSelectedSeries([]);
      return;
    }

    setSelectedSeries((current) => {
      const stillVisible = current.filter((selected) =>
        filteredSeries.some((candidate) => candidate.id === selected.id),
      );
      if (stillVisible.length) {
        return stillVisible;
      }

      const preferred = filteredSeries.filter((item) => item.measureType === 'value').slice(0, 3);
      return preferred.length ? preferred : filteredSeries.slice(0, 3);
    });
  }, [filteredSeries]);

  const timelineRows = useMemo(() => {
    if (!selectedSeries.length) {
      return [] as Array<Record<string, number | string | null>>;
    }

    const allDates = new Set<string>();
    selectedSeries.forEach((series) => {
      series.points.forEach((point) => allDates.add(point.date));
    });

    const sortedDates = Array.from(allDates).sort();
    let minDate: string | null = null;
    let maxDate: string | null = null;
    if (customFrom || customTo) {
      minDate = customFrom ? `${customFrom}-01` : null;
      maxDate = customTo ? `${customTo}-31` : null;
    } else if (timeRange !== 'ALL') {
      minDate = format(subYears(new Date(), RANGE_YEARS[timeRange as Exclude<RangeOption, 'ALL'>]), 'yyyy-MM-01');
    }

    return sortedDates
      .filter((date) => (!minDate || date >= minDate) && (!maxDate || date <= maxDate))
      .map((date) => {
        const row: Record<string, number | string | null> = {
          date,
          label: format(parseISO(date), 'MMM yyyy'),
        };

        selectedSeries.forEach((series) => {
          const match = series.points.find((point) => point.date === date);
          row[series.id] = match?.value ?? null;
        });

        return row;
      });
  }, [selectedSeries, timeRange, customFrom, customTo]);

  useEffect(() => {
    if (selectedSeries.length > 0 && timelineRows.length > 0) {
      if (!nlAnswerLoading) {
        generateChartInsights(selectedSeries, timelineRows);
      }
    } else {
      setTrendInsight(null);
      setVolumeInsight(null);
    }
  }, [selectedSeries, timelineRows, nlAnswerLoading]);

  const latestBySeries = useMemo(() => {
    return selectedSeries
      .map((series) => ({
        label: shortenLabel(series.title),
        title: series.title,
        units: series.units,
        value: series.points[series.points.length - 1]?.value,
      }))
      .filter((item) => item.value !== undefined)
      .slice(0, 10);
  }, [selectedSeries]);

  const unitsBySeriesId = useMemo(() => {
    return new Map(selectedSeries.map((series) => [series.id, series.units]));
  }, [selectedSeries]);

  const quickStats = useMemo(() => {
    if (!dataset) {
      return [];
    }

    const defs = [
      {
        label: 'Debit card purchases',
        valueMatch: 'value of purchases',
        volumeMatch: 'Debit: Number of purchases',
      },
      {
        label: 'Credit card purchases',
        valueMatch: 'value of purchases: personal cards',
        volumeMatch: 'Credit and Charge: Number of purchases',
      },
      {
        label: 'NPP',
        valueMatch: 'value of npp payments',
        volumeMatch: 'total number of npp payments',
      },
      {
        label: 'PayTo',
        valueMatch: 'value of payto transactions',
        volumeMatch: 'number of payto transactions',
      },
      {
        label: 'Direct credit',
        valueMatch: 'value of credit transfers',
        volumeMatch: 'number of credit transfers',
      },
      {
        label: 'Direct debit',
        valueMatch: 'value of debit transfers',
        volumeMatch: 'number of debit transfers',
      },
    ];

    return defs
      .map((item) => {
        const valueSeries = dataset.series.find((candidate) =>
          candidate.title.toLowerCase().includes(item.valueMatch.toLowerCase()),
        );
        const volumeSeries = dataset.series.find((candidate) =>
          candidate.title.toLowerCase().includes(item.volumeMatch.toLowerCase()),
        );

        if (!valueSeries?.points.length) {
          return null;
        }

        const latestValue = valueSeries.points[valueSeries.points.length - 1];
        const latestVolume = volumeSeries?.points[volumeSeries.points.length - 1];

        return {
          label: item.label,
          value: formatValue(latestValue.value, valueSeries.units),
          volume: latestVolume ? formatValue(latestVolume.value, volumeSeries.units) : null,
          date: format(parseISO(latestValue.date), 'MMM yyyy'),
        };
      })
      .filter(Boolean) as Array<{ label: string; value: string; volume: string | null; date: string }>;
  }, [dataset]);

  if (loadError) {
    return (
      <Box className="page">
        <Alert severity="error">{loadError}</Alert>
      </Box>
    );
  }

  if (!dataset) {
    return (
      <Box className="loading-wrap">
        <CircularProgress />
        <Typography>Loading composite payments data...</Typography>
      </Box>
    );
  }

  if (isChartFullscreen) {
    return (
      <Box className="page" sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end', borderBottom: '1px solid #e0e0e0' }}>
          <IconButton onClick={() => setIsChartFullscreen(false)} title="Exit fullscreen">
            <FullscreenExitIcon />
          </IconButton>
        </Box>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, px: 2, pb: 2, overflow: 'auto' }}>
          <Card className="chart-card">
            <CardContent>
              <Box sx={{ mb: 2 }}>
                <Typography variant="h6" sx={{ mb: 0.5 }}>Trend Snapshot</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Track how each series moves over time. Compare trends and spot inflection points across your filtered selection.</Typography>
              </Box>
              <Box className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timelineRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" minTickGap={40} />
                    <YAxis />
                    <Tooltip
                      formatter={(value, name) => {
                        const units = unitsBySeriesId.get(String(name)) ?? 'Number';
                        return formatValue(Number(value), units);
                      }}
                    />
                    <Legend />
                    {selectedSeries.map((series, idx) => (
                      <Line
                        key={series.id}
                        type="monotone"
                        dataKey={series.id}
                        name={series.title}
                        stroke={SERIES_COLORS[idx % SERIES_COLORS.length]}
                        dot={false}
                        strokeWidth={2}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </Box>
              {trendInsight && (
                <Typography variant="caption" sx={{ mt: 1.5, display: 'block', color: 'text.secondary', fontStyle: 'italic' }}>
                  💡 {trendInsight}
                </Typography>
              )}
              {trendInsightLoading && (
                <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <CircularProgress size={12} />
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Generating insight…</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, lg: 7 }}>
              <Card className="chart-card">
                <CardContent>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="h6" sx={{ mb: 0.5 }}>Volume & Growth</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>Cumulative movement of your top series. Larger areas indicate higher volume; stacking shows relative contribution.</Typography>
                  </Box>
                  <Box className="chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={timelineRows}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" minTickGap={40} />
                        <YAxis />
                        <Tooltip
                          formatter={(value, name) => {
                            const units = unitsBySeriesId.get(String(name)) ?? 'Number';
                            return formatValue(Number(value), units);
                          }}
                        />
                        {selectedSeries.slice(0, 2).map((series, idx) => (
                          <Area
                            key={series.id}
                            type="monotone"
                            dataKey={series.id}
                            name={series.title}
                            stroke={SERIES_COLORS[idx % SERIES_COLORS.length]}
                            fill={SERIES_COLORS[idx % SERIES_COLORS.length]}
                            fillOpacity={0.25}
                          />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  </Box>
                  {volumeInsight && (
                    <Typography variant="caption" sx={{ mt: 1.5, display: 'block', color: 'text.secondary', fontStyle: 'italic' }}>
                      💡 {volumeInsight}
                    </Typography>
                  )}
                  {volumeInsightLoading && (
                    <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <CircularProgress size={12} />
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>Generating insight…</Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, lg: 5 }}>
              <Card className="chart-card">
                <CardContent>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="h6" sx={{ mb: 0.5 }}>Latest Month Rankings</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>Current performance snapshot. Compare the most recent data point for each series, ranked by magnitude.</Typography>
                  </Box>
                  <Box className="chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={latestBySeries} layout="vertical" margin={{ left: 20, right: 12 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis type="category" dataKey="label" width={220} />
                        <Tooltip
                          formatter={(value, _name, item) => {
                            const units = String(item.payload.units ?? '');
                            return formatValue(Number(value), units);
                          }}
                        />
                        <Bar dataKey="value" fill="#0f4c81" radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Box>
      </Box>
    );
  }

  return (
    <Box className="page">
      <Box className="hero-shell">
        <Typography variant="overline" className="badge">
          Payments Intelligence
        </Typography>
        <Typography variant="h2" className="hero-title">
          Explore Australia's Payments Ecosystem
        </Typography>
        <Typography className="hero-subtitle">
          Deep dive into a composite set of payments data spanning RBA, AusPayNet, and APRA sources.
          Ask questions in natural language. Discover trends. Make data-driven decisions.
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Chip label={`${dataset.series.length} data series`} sx={{ backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff' }} />
          <Chip label={`Latest: ${format(parseISO(dataset.generatedAt), 'dd MMM yyyy')}`} sx={{ backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff' }} />
          <Chip label="By Mac Cherry - Head of Payments @ Fat Zebra" sx={{ backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff' }} />
        </Stack>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {quickStats.map((stat) => (
          <Grid key={stat.label} size={{ xs: 12, md: 6, lg: 3 }}>
            <Card className="metric-card">
              <CardContent>
                <Typography variant="body2" className="metric-label">
                  {stat.label}
                </Typography>
                <Typography variant="h5" className="metric-value">
                  {stat.value}
                </Typography>
                {stat.volume && (
                  <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                    {stat.volume} transactions
                  </Typography>
                )}
                <Typography variant="caption">Latest month: {stat.date}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card sx={{ mb: 3, p: 1 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
            Interrogate the data
          </Typography>
          <TextField
            fullWidth
            placeholder='Ask anything: "Which months see the biggest increase in card payments?" or "Is growth in PayTo accelerating?"'
            value={nlQuery}
            inputRef={nlInputRef}
            onChange={(e) => setNlQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNlQuery(); }}
            disabled={nlLoading}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={handleNlQuery} disabled={nlLoading || !nlQuery.trim()} edge="end">
                      {nlLoading ? <CircularProgress size={20} /> : <AutoFixHighIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'text.secondary' }}>
            Try: "When did card payment growth spike the most?", "Has NPP overtaken direct entry in momentum?", or "Is PayTo acceleration sustained across recent quarters?"
          </Typography>
          {nlResult && (
            <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'text.secondary' }}>
              ✓ {nlResult.explanation}
            </Typography>
          )}
          {nlAnswerLoading && (
            <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={14} />
              <Typography variant="caption" color="text.secondary">Generating answer…</Typography>
            </Box>
          )}
          {nlAnswer && (
            <Alert severity="info" sx={{ mt: 1 }}>
              <Typography variant="body2">{nlAnswer}</Typography>
            </Alert>
          )}
          {nlError && (
            <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'error.main' }}>
              {nlError}
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Main 2-column layout: filters (left) and charts (right) */}
      <Grid container spacing={2}>
        {/* Left Column: Sticky Filters */}
        <Grid size={{ xs: 12, md: 3 }}>
          <Card className="filter-card" sx={{ position: 'sticky', top: 16 }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Filters</Typography>
                <Button size="small" onClick={handleReset} color="inherit" sx={{ textTransform: 'none', color: 'text.secondary' }}>Reset all</Button>
              </Box>
              <Stack spacing={2}>
                <FormControl fullWidth>
                  <InputLabel>Category</InputLabel>
                  <Select value={category} label="Category" onChange={(e) => setCategory(e.target.value)}>
                    <MenuItem value="All">All</MenuItem>
                    {categories.map((item) => (
                      <MenuItem key={item} value={item}>{item}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel>Subcategory</InputLabel>
                  <Select value={subcategory} label="Subcategory" onChange={(e) => setSubcategory(e.target.value)}>
                    <MenuItem value="All">All</MenuItem>
                    {subcategories.map((item) => (
                      <MenuItem key={item} value={item}>{item}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel>Measure</InputLabel>
                  <Select value={measureType} label="Measure" onChange={(e) => setMeasureType(e.target.value as 'All' | MeasureType)}>
                    <MenuItem value="All">All</MenuItem>
                    <MenuItem value="value">Value</MenuItem>
                    <MenuItem value="volume">Volume</MenuItem>
                    <MenuItem value="accounts">Accounts / Stock</MenuItem>
                    <MenuItem value="other">Other</MenuItem>
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel>Range</InputLabel>
                  <Select value={timeRange} label="Range" onChange={(e) => { setTimeRange(e.target.value as RangeOption); setCustomFrom(null); setCustomTo(null); }}>
                    <MenuItem value="2Y">2 Years</MenuItem>
                    <MenuItem value="5Y">5 Years</MenuItem>
                    <MenuItem value="10Y">10 Years</MenuItem>
                    <MenuItem value="ALL">All History</MenuItem>
                  </Select>
                  {(customFrom || customTo) && (
                    <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="caption" color="primary">
                        Custom: {customFrom ?? '…'} → {customTo ?? '…'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => { setCustomFrom(null); setCustomTo(null); }}>clear</Typography>
                    </Box>
                  )}
                </FormControl>
            {dimOptions.segment.length > 1 && (
                  <FormControl fullWidth>
                    <InputLabel>Segment</InputLabel>
                    <Select value={dimSegment} label="Segment" onChange={(e) => setDimSegment(e.target.value)}>
                      <MenuItem value="All">All</MenuItem>
                      {dimOptions.segment.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                    </Select>
                  </FormControl>
                )}

                {dimOptions.cardType.length > 1 && (
                  <FormControl fullWidth>
                    <InputLabel>Card Type</InputLabel>
                    <Select value={dimCardType} label="Card Type" onChange={(e) => setDimCardType(e.target.value)}>
                      <MenuItem value="All">All</MenuItem>
                      {dimOptions.cardType.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                    </Select>
                  </FormControl>
                )}

                {dimOptions.prepaidType.length > 1 && (
                  <FormControl fullWidth>
                    <InputLabel>Prepaid Type</InputLabel>
                    <Select value={dimPrepaidType} label="Prepaid Type" onChange={(e) => setDimPrepaidType(e.target.value)}>
                      <MenuItem value="All">All</MenuItem>
                      {dimOptions.prepaidType.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                    </Select>
                  </FormControl>
                )}

                {dimOptions.location.length > 1 && (
                  <FormControl fullWidth>
                    <InputLabel>Location</InputLabel>
                    <Select value={dimLocation} label="Location" onChange={(e) => setDimLocation(e.target.value)}>
                      <MenuItem value="All">All</MenuItem>
                      {dimOptions.location.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                    </Select>
                  </FormControl>
                )}

                {dimOptions.acquirer.length > 1 && (
                  <FormControl fullWidth>
                    <InputLabel>Acquirer</InputLabel>
                    <Select value={dimAcquirer} label="Acquirer" onChange={(e) => setDimAcquirer(e.target.value)}>
                      <MenuItem value="All">All</MenuItem>
                      {dimOptions.acquirer.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                    </Select>
                  </FormControl>
                )}

                {dimOptions.method.length > 1 && (
                  <FormControl fullWidth>
                    <InputLabel>Payment Method</InputLabel>
                    <Select value={dimMethod} label="Payment Method" onChange={(e) => setDimMethod(e.target.value)}>
                      <MenuItem value="All">All</MenuItem>
                      {dimOptions.method.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                    </Select>
                  </FormControl>
                )}

                {dimOptions.instrument.length > 1 && (
                  <FormControl fullWidth>
                    <InputLabel>Instrument</InputLabel>
                    <Select value={dimInstrument} label="Instrument" onChange={(e) => setDimInstrument(e.target.value)}>
                      <MenuItem value="All">All</MenuItem>
                      {dimOptions.instrument.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                    </Select>
                  </FormControl>
                )}

                <TextField fullWidth label="Search series" value={seriesSearch} onChange={(e) => setSeriesSearch(e.target.value)} />

                <Autocomplete
                  multiple
                  options={filteredSeries}
                  value={selectedSeries}
                  onChange={(_event, value) => setSelectedSeries(value.slice(0, 6))}
                  getOptionLabel={(option) => option.title}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  renderInput={(params) => <TextField {...params} label="Visible series" />}
                />
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Right Column: Charts */}
        <Grid size={{ xs: 12, md: 9 }}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
            <IconButton size="small" onClick={() => setIsChartFullscreen(true)} title="Fullscreen" sx={{ color: 'text.secondary' }}>
              <FullscreenIcon />
            </IconButton>
          </Box>
          <Grid container spacing={2}>
        <Grid size={{ xs: 12 }}>
          <Card className="chart-card">
            <CardContent>
              <Box sx={{ mb: 2 }}>
                <Typography variant="h6" sx={{ mb: 0.5 }}>Trend Snapshot</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Track how each series moves over time. Compare trends and spot inflection points across your filtered selection.
                </Typography>
              </Box>
              <Box className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timelineRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" minTickGap={40} />
                    <YAxis />
                    <Tooltip
                      formatter={(value, name) => {
                        const units = unitsBySeriesId.get(String(name)) ?? 'Number';
                        return formatValue(Number(value), units);
                      }}
                    />
                    <Legend />
                    {selectedSeries.map((series, idx) => (
                      <Line
                        key={series.id}
                        type="monotone"
                        dataKey={series.id}
                        name={series.title}
                        stroke={SERIES_COLORS[idx % SERIES_COLORS.length]}
                        dot={false}
                        strokeWidth={2}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </Box>
              {trendInsight && (
                <Typography variant="caption" sx={{ mt: 1.5, display: 'block', color: 'text.secondary', fontStyle: 'italic' }}>
                  💡 {trendInsight}
                </Typography>
              )}
              {trendInsightLoading && (
                <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <CircularProgress size={12} />
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Generating insight…</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 7 }}>
          <Card className="chart-card">
            <CardContent>
              <Box sx={{ mb: 2 }}>
                <Typography variant="h6" sx={{ mb: 0.5 }}>Volume & Growth</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Cumulative movement of your top series. Larger areas indicate higher volume; stacking shows relative contribution.
                </Typography>
              </Box>
              <Box className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timelineRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" minTickGap={40} />
                    <YAxis />
                    <Tooltip
                      formatter={(value, name) => {
                        const units = unitsBySeriesId.get(String(name)) ?? 'Number';
                        return formatValue(Number(value), units);
                      }}
                    />
                    {selectedSeries.slice(0, 2).map((series, idx) => (
                      <Area
                        key={series.id}
                        type="monotone"
                        dataKey={series.id}
                        name={series.title}
                        stroke={SERIES_COLORS[idx % SERIES_COLORS.length]}
                        fill={SERIES_COLORS[idx % SERIES_COLORS.length]}
                        fillOpacity={0.25}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </Box>
              {volumeInsight && (
                <Typography variant="caption" sx={{ mt: 1.5, display: 'block', color: 'text.secondary', fontStyle: 'italic' }}>
                  💡 {volumeInsight}
                </Typography>
              )}
              {volumeInsightLoading && (
                <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <CircularProgress size={12} />
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Generating insight…</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <Card className="chart-card">
            <CardContent>
              <Box sx={{ mb: 2 }}>
                <Typography variant="h6" sx={{ mb: 0.5 }}>Latest Month Rankings</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Current performance snapshot. Compare the most recent data point for each series, ranked by magnitude.
                </Typography>
              </Box>
              <Box className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={latestBySeries} layout="vertical" margin={{ left: 20, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="label" width={220} />
                    <Tooltip
                      formatter={(value, _name, item) => {
                        const units = String(item.payload.units ?? '');
                        return formatValue(Number(value), units);
                      }}
                    />
                    <Bar dataKey="value" fill="#0f4c81" radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        </Grid>
          </Grid>
        </Grid>
      </Grid>
    </Box>
  );
}

export default App;
