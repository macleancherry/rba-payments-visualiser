import fs from 'node:fs/promises';
import path from 'node:path';
import XLSX from 'xlsx';

const TABLES = [
  {
    code: 'C1.1',
    name: 'Credit and Charge Cards - Original Series - Aggregate Data',
    url: 'https://www.rba.gov.au/statistics/tables/xls/c01-1-hist.xlsx',
    category: 'Cards',
    subcategory: 'Credit and Charge',
  },
  {
    code: 'C1.2',
    name: 'Credit and Charge Cards - Original Series - Personal and Commercial Cards',
    url: 'https://www.rba.gov.au/statistics/tables/xls/c01-2-hist.xlsx',
    category: 'Cards',
    subcategory: 'Credit and Charge',
  },
  {
    code: 'C2.1',
    name: 'Debit Cards - Original Series',
    url: 'https://www.rba.gov.au/statistics/tables/xls/c02-1-hist.xlsx',
    category: 'Cards',
    subcategory: 'Debit',
  },
  {
    code: 'C2.2',
    name: 'Prepaid Cards - Original Series',
    url: 'https://www.rba.gov.au/statistics/tables/xls/c02-2-hist.xlsx',
    category: 'Cards',
    subcategory: 'Prepaid',
  },
  {
    code: 'C4.1',
    name: 'ATMs - Original Series',
    url: 'https://www.rba.gov.au/statistics/tables/xls/c04-1-hist.xlsx',
    category: 'Cash and ATM',
    subcategory: 'ATM Withdrawals',
  },
  {
    code: 'C5.1',
    name: 'Cheques - Original Series',
    url: 'https://www.rba.gov.au/statistics/tables/xls/c05-1-hist.xlsx',
    category: 'Cheques',
    subcategory: 'Cheques',
  },
  {
    code: 'C6.1',
    name: 'Direct Entry and NPP - Original Series',
    url: 'https://www.rba.gov.au/statistics/tables/xls/c06-1-hist.xlsx',
    category: 'Account-to-Account',
    subcategory: 'Direct Entry and NPP',
  },
  {
    code: 'C7',
    name: 'Real-time Gross Settlement Statistics',
    url: 'https://www.rba.gov.au/statistics/tables/xls/c07hist.xlsx',
    category: 'High Value',
    subcategory: 'RTGS',
  },
];

const EXCLUDED_SHEETS = new Set(['Notes', 'Series breaks']);

function parseNumber(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }

  const normalized = String(raw).replace(/,/g, '').trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toMonthStartIso(raw) {
  if (!raw) {
    return null;
  }

  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw);
    if (!d) {
      return null;
    }
    return `${String(d.y).padStart(4, '0')}-${String(d.m).padStart(2, '0')}-01`;
  }

  const text = String(raw).trim();
  const match = text.match(/^([A-Za-z]{3})-(\d{4})$/);
  if (!match) {
    return null;
  }

  const months = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
  };

  const month = months[match[1]];
  if (!month) {
    return null;
  }

  return `${match[2]}-${month}-01`;
}

function inferSubcategory(defaultSubcategory, title) {
  const lower = title.toLowerCase();
  if (lower.includes('payto')) {
    return 'PayTo';
  }
  if (lower.includes('new payments platform') || lower.includes('npp')) {
    return 'NPP';
  }
  if (lower.includes('credit transfers')) {
    return 'Direct Credit';
  }
  if (lower.includes('debit transfers')) {
    return 'Direct Debit';
  }
  if (lower.includes('direct entry')) {
    return 'Direct Entry';
  }
  return defaultSubcategory;
}

function inferMeasureType(title, units) {
  const t = title.toLowerCase();
  const u = units.toLowerCase();

  if (t.includes('value') || u.includes('$')) {
    return 'value';
  }
  if (t.includes('number') || u.includes("'000") || u.includes('million') || u.includes('number')) {
    return 'volume';
  }
  if (t.includes('account') || t.includes('cards on issue') || t.includes('stored value')) {
    return 'accounts';
  }

  return 'other';
}

function inferDimensions(title) {
  const t = title.toLowerCase();
  const d = {};

  // Customer segment (credit/charge cards split into personal and commercial)
  if (t.includes('personal cards')) d.segment = 'Personal';
  else if (t.includes('commercial cards')) d.segment = 'Commercial';

  // For "acquired in Australia" series the location words refer to the acquirer, not the transaction location
  const isAcquirerSeries = t.includes('acquired in australia');

  if (!isAcquirerSeries) {
    if (t.includes('domestic')) d.location = 'Domestic';
    else if (t.includes('overseas')) d.location = 'Overseas';
  }

  // Acquirer perspective (issuer vs acquirer)
  if (isAcquirerSeries) {
    if (t.includes('own cards')) d.acquirer = 'Own cards';
    else if (t.includes('other domestic cards')) d.acquirer = 'Other domestic cards';
    else if (t.includes('overseas-issued cards')) d.acquirer = 'Overseas-issued cards';
  }

  // Payment interaction method
  if (t.includes('non-contactless')) d.method = 'Non-contactless';
  else if (t.includes('contactless')) d.method = 'Contactless';
  else if (t.includes('device not present')) d.method = 'Device not present';
  else if (t.includes('device present')) d.method = 'Device present';

  // Payment instrument (deepest level)
  if (t.includes('mobile wallet')) d.instrument = 'Mobile wallet';
  else if (/contactless: card|not present: card/.test(t)) d.instrument = 'Card';
  else if (/contactless: other|not present: other/.test(t)) d.instrument = 'Other';

  return d;
}

async function loadWorkbook(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return XLSX.read(buffer, { type: 'buffer' });
}

function parseSheet(table, sheetName, worksheet) {
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null });

  const titles = rows[1] ?? [];
  const frequencies = rows[3] ?? [];
  const types = rows[4] ?? [];
  const units = rows[5] ?? [];
  const seriesIds = rows[10] ?? [];

  const series = [];

  for (let c = 1; c < titles.length; c += 1) {
    const title = String(titles[c] ?? '').trim();
    const frequency = String(frequencies[c] ?? '').trim();
    const seriesType = String(types[c] ?? '').trim();
    const unit = String(units[c] ?? '').trim();
    const seriesId = String(seriesIds[c] ?? '').trim();

    if (!title || !seriesId) {
      continue;
    }

    if (seriesType && seriesType.toLowerCase() !== 'original') {
      continue;
    }

    const points = [];

    for (let r = 11; r < rows.length; r += 1) {
      const date = toMonthStartIso(rows[r]?.[0]);
      if (!date) {
        continue;
      }

      const value = parseNumber(rows[r]?.[c]);
      if (value === null) {
        continue;
      }

      points.push({ date, value });
    }

    if (!points.length) {
      continue;
    }

    series.push({
      id: seriesId,
      tableCode: table.code,
      tableName: table.name,
      tableUrl: table.url,
      sheetName,
      title,
      frequency: frequency || 'Monthly',
      units: unit || 'Number',
      category: table.category,
      subcategory: inferSubcategory(table.subcategory, title),
      measureType: inferMeasureType(title, unit),
      dimensions: inferDimensions(title),
      points,
    });
  }

  return series;
}

async function main() {
  const startedAt = new Date().toISOString();
  const allSeries = [];

  for (const table of TABLES) {
    const workbook = await loadWorkbook(table.url);

    for (const sheetName of workbook.SheetNames) {
      if (EXCLUDED_SHEETS.has(sheetName)) {
        continue;
      }

      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) {
        continue;
      }

      allSeries.push(...parseSheet(table, sheetName, worksheet));
    }
  }

  const payload = {
    generatedAt: startedAt,
    source: 'Reserve Bank of Australia - Payments Data (Original Series)',
    tables: TABLES,
    series: allSeries,
  };

  const outputPath = path.resolve(process.cwd(), 'public', 'data', 'rba-original-series.json');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(payload));

  console.log(`Wrote ${allSeries.length} series to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
