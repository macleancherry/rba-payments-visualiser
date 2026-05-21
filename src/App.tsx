import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
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
  if (units.includes('$')) {
    return `$${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}m`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function shortenLabel(label: string, max = 34) {
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
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
  const [dimLocation, setDimLocation] = useState('All');
  const [dimAcquirer, setDimAcquirer] = useState('All');
  const [dimMethod, setDimMethod] = useState('All');
  const [dimInstrument, setDimInstrument] = useState('All');

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
      .filter((item) =>
        seriesSearch ? `${item.title} ${item.subcategory} ${item.category}`.toLowerCase().includes(seriesSearch.toLowerCase()) : true,
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [category, dataset, measureType, seriesSearch, subcategory]);

  // Available dimension values for the current base set
  const dimOptions = useMemo(() => {
    const get = (key: keyof SeriesDimensions) =>
      Array.from(new Set(baseSeries.map((s) => s.dimensions?.[key]).filter(Boolean) as string[])).sort();
    return {
      segment: get('segment'),
      location: get('location'),
      acquirer: get('acquirer'),
      method: get('method'),
      instrument: get('instrument'),
    };
  }, [baseSeries]);

  // Reset dimension filters when primary filters change
  useEffect(() => {
    setDimSegment('All');
    setDimLocation('All');
    setDimAcquirer('All');
    setDimMethod('All');
    setDimInstrument('All');
  }, [category, subcategory, measureType, seriesSearch]);

  // Final series: base + dimension filters applied
  const filteredSeries = useMemo(() => {
    return baseSeries
      .filter((item) => dimSegment === 'All' || (item.dimensions?.segment ?? 'All') === dimSegment)
      .filter((item) => dimLocation === 'All' || (item.dimensions?.location ?? 'All') === dimLocation)
      .filter((item) => dimAcquirer === 'All' || (item.dimensions?.acquirer ?? 'All') === dimAcquirer)
      .filter((item) => dimMethod === 'All' || (item.dimensions?.method ?? 'All') === dimMethod)
      .filter((item) => dimInstrument === 'All' || (item.dimensions?.instrument ?? 'All') === dimInstrument);
  }, [baseSeries, dimSegment, dimLocation, dimAcquirer, dimMethod, dimInstrument]);

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
    const minDate =
      timeRange === 'ALL'
        ? null
        : format(subYears(new Date(), RANGE_YEARS[timeRange as Exclude<RangeOption, 'ALL'>]), 'yyyy-MM-01');

    return sortedDates
      .filter((date) => (minDate ? date >= minDate : true))
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
  }, [selectedSeries, timeRange]);

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

  const quickStats = useMemo(() => {
    if (!dataset) {
      return [];
    }

    const defs = [
      { label: 'Debit card purchases', match: 'value of purchases' },
      { label: 'Credit card purchases', match: 'value of purchases: personal cards' },
      { label: 'NPP volume', match: 'total number of npp payments' },
      { label: 'PayTo volume', match: 'number of payto transactions' },
      { label: 'Direct credit volume', match: 'number of credit transfers' },
      { label: 'Direct debit volume', match: 'number of debit transfers' },
    ];

    return defs
      .map((item) => {
        const series = dataset.series.find((candidate) =>
          candidate.title.toLowerCase().includes(item.match.toLowerCase()),
        );

        if (!series?.points.length) {
          return null;
        }

        const latest = series.points[series.points.length - 1];
        return {
          label: item.label,
          value: formatValue(latest.value, series.units),
          date: format(parseISO(latest.date), 'MMM yyyy'),
        };
      })
      .filter(Boolean) as Array<{ label: string; value: string; date: string }>;
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
        <Typography>Loading RBA original-series payments data...</Typography>
      </Box>
    );
  }

  return (
    <Box className="page">
      <Box className="hero-shell">
        <Typography variant="overline" className="badge">
          Reserve Bank Payments Explorer
        </Typography>
        <Typography variant="h2" className="hero-title">
          Australian Payments Data, Original Series
        </Typography>
        <Typography className="hero-subtitle">
          Organised into clear payment families including Cards (Credit, Debit, Prepaid), Direct Entry,
          NPP, PayTo, ATM, Cheques and RTGS, sourced directly from RBA original-series tables.
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Chip label={`Series: ${dataset.series.length}`} />
          <Chip label={`Updated: ${format(parseISO(dataset.generatedAt), 'dd MMM yyyy')}`} />
          <Chip label="Source: RBA Payments Data" />
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
                <Typography variant="caption">Latest month: {stat.date}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card className="filter-card">
        <CardContent>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6, lg: 3 }}>
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Select value={category} label="Category" onChange={(e) => setCategory(e.target.value)}>
                  <MenuItem value="All">All</MenuItem>
                  {categories.map((item) => (
                    <MenuItem key={item} value={item}>
                      {item}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 6, lg: 3 }}>
              <FormControl fullWidth>
                <InputLabel>Subcategory</InputLabel>
                <Select
                  value={subcategory}
                  label="Subcategory"
                  onChange={(e) => setSubcategory(e.target.value)}
                >
                  <MenuItem value="All">All</MenuItem>
                  {subcategories.map((item) => (
                    <MenuItem key={item} value={item}>
                      {item}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 6, lg: 3 }}>
              <FormControl fullWidth>
                <InputLabel>Measure</InputLabel>
                <Select
                  value={measureType}
                  label="Measure"
                  onChange={(e) => setMeasureType(e.target.value as 'All' | MeasureType)}
                >
                  <MenuItem value="All">All</MenuItem>
                  <MenuItem value="value">Value</MenuItem>
                  <MenuItem value="volume">Volume</MenuItem>
                  <MenuItem value="accounts">Accounts / Stock</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 6, lg: 3 }}>
              <FormControl fullWidth>
                <InputLabel>Range</InputLabel>
                <Select
                  value={timeRange}
                  label="Range"
                  onChange={(e) => setTimeRange(e.target.value as RangeOption)}
                >
                  <MenuItem value="2Y">2 Years</MenuItem>
                  <MenuItem value="5Y">5 Years</MenuItem>
                  <MenuItem value="10Y">10 Years</MenuItem>
                  <MenuItem value="ALL">All History</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            {dimOptions.segment.length > 1 && (
              <Grid size={{ xs: 12, md: 6, lg: 3 }}>
                <FormControl fullWidth>
                  <InputLabel>Segment</InputLabel>
                  <Select value={dimSegment} label="Segment" onChange={(e) => setDimSegment(e.target.value)}>
                    <MenuItem value="All">All</MenuItem>
                    {dimOptions.segment.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            )}
            {dimOptions.location.length > 1 && (
              <Grid size={{ xs: 12, md: 6, lg: 3 }}>
                <FormControl fullWidth>
                  <InputLabel>Location</InputLabel>
                  <Select value={dimLocation} label="Location" onChange={(e) => setDimLocation(e.target.value)}>
                    <MenuItem value="All">All</MenuItem>
                    {dimOptions.location.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            )}
            {dimOptions.acquirer.length > 1 && (
              <Grid size={{ xs: 12, md: 6, lg: 3 }}>
                <FormControl fullWidth>
                  <InputLabel>Acquirer</InputLabel>
                  <Select value={dimAcquirer} label="Acquirer" onChange={(e) => setDimAcquirer(e.target.value)}>
                    <MenuItem value="All">All</MenuItem>
                    {dimOptions.acquirer.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            )}
            {dimOptions.method.length > 1 && (
              <Grid size={{ xs: 12, md: 6, lg: 3 }}>
                <FormControl fullWidth>
                  <InputLabel>Payment Method</InputLabel>
                  <Select value={dimMethod} label="Payment Method" onChange={(e) => setDimMethod(e.target.value)}>
                    <MenuItem value="All">All</MenuItem>
                    {dimOptions.method.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            )}
            {dimOptions.instrument.length > 1 && (
              <Grid size={{ xs: 12, md: 6, lg: 3 }}>
                <FormControl fullWidth>
                  <InputLabel>Instrument</InputLabel>
                  <Select value={dimInstrument} label="Instrument" onChange={(e) => setDimInstrument(e.target.value)}>
                    <MenuItem value="All">All</MenuItem>
                    {dimOptions.instrument.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            )}
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                label="Search series"
                value={seriesSearch}
                onChange={(e) => setSeriesSearch(e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Autocomplete
                multiple
                options={filteredSeries}
                value={selectedSeries}
                onChange={(_event, value) => setSelectedSeries(value.slice(0, 6))}
                getOptionLabel={(option) => option.title}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                renderInput={(params) => <TextField {...params} label="Visible series" />}
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Grid container spacing={2} sx={{ mt: 0.5 }}>
        <Grid size={{ xs: 12 }}>
          <Card className="chart-card">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Trend View
              </Typography>
              <Box className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timelineRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" minTickGap={40} />
                    <YAxis />
                    <Tooltip />
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
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 7 }}>
          <Card className="chart-card">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Momentum Area
              </Typography>
              <Box className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timelineRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" minTickGap={40} />
                    <YAxis />
                    <Tooltip />
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
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <Card className="chart-card">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Latest Monthly Snapshot
              </Typography>
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
  );
}

export default App;
