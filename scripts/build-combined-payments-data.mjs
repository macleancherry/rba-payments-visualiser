import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import * as cheerio from 'cheerio';
import XLSX from 'xlsx';

const DEVICE_URL = 'https://auspaynet.com.au/resources/device-statistics';
const FRAUD_LIST_URL = 'https://auspaynet.com.au/resources/fraud-statistics';
const APRA_URL = 'https://www.apra.gov.au/authorised-deposit-taking-institutions-points-of-presence-statistics';
const APRA_WORKBOOK_URL = 'https://www.apra.gov.au/sites/default/files/2025-10/Authorised%20deposit-taking%20institutions%20points%20of%20presence%20June%202017%20to%20June%202025.xlsx';

function cleanText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const text = cleanText(value).replace(/[$,%]/g, '').replace(/,/g, '').trim();
  if (!text || /^n\/a$/i.test(text) || text === '—') return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDollarAmount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const text = cleanText(value).replace(/[$,]/g, '').trim();
  if (!text || /^n\/a$/i.test(text)) return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMillionAmount(value) {
  const parsed = parseNumber(value);
  return parsed === null ? null : parsed * 1_000_000;
}

function serialToIso(serial) {
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed) return null;
  return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-01`;
}

function yearQuarterToIso(year, quarterName) {
  const months = {
    March: '03',
    June: '06',
    September: '09',
    December: '12',
  };

  const month = months[quarterName];
  return month ? `${year}-${month}-01` : null;
}

async function fetchHtml(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

async function fetchWorkbook(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return XLSX.read(buffer, { type: 'buffer' });
}

function upsertSeries(seriesMap, key, meta, point) {
  if (!seriesMap.has(key)) {
    seriesMap.set(key, {
      ...meta,
      points: [],
    });
  }

  seriesMap.get(key).points.push(point);
}

function finalizeSeries(seriesMap) {
  return Array.from(seriesMap.values())
    .map((series) => ({
      ...series,
      points: series.points.sort((left, right) => left.date.localeCompare(right.date)),
    }))
    .filter((series) => series.points.length > 0);
}

async function buildDeviceSeries() {
  const html = await fetchHtml(DEVICE_URL);
  const $ = cheerio.load(html);
  const tables = $('table').toArray();
  const definitions = [
    {
      tableIndex: 0,
      key: 'auspaynet-device-atm',
      title: 'AusPayNet Device Statistics: ATM terminals',
      sheetName: 'ATM Terminals',
      instrument: 'ATM',
    },
    {
      tableIndex: 1,
      key: 'auspaynet-device-eftpos',
      title: 'AusPayNet Device Statistics: EFTPOS terminals',
      sheetName: 'EFTPOS Terminals',
      instrument: 'EFTPOS',
    },
  ];

  return definitions.map((definition) => {
    const table = $(tables[definition.tableIndex]);
    const rows = table
      .find('tr')
      .toArray()
      .map((row) =>
        $(row)
          .find('th, td')
          .toArray()
          .map((cell) => cleanText($(cell).text())),
      )
      .filter((row) => row.some(Boolean));

    const points = [];
    const quarterColumns = ['March', 'June', 'September', 'December'];

    for (const row of rows.slice(1)) {
      const year = Number(row[0]);
      if (!Number.isFinite(year)) continue;

      quarterColumns.forEach((quarterName, index) => {
        const value = parseNumber(row[index + 1]);
        const date = yearQuarterToIso(year, quarterName);
        if (value === null || !date) return;
        points.push({ date, value });
      });
    }

    return {
      id: definition.key,
      tableCode: 'AusPayNet-Device-Statistics',
      tableName: 'Device Statistics',
      tableUrl: DEVICE_URL,
      sheetName: definition.sheetName,
      title: definition.title,
      frequency: 'Quarterly',
      units: 'Number',
      category: 'Infrastructure',
      subcategory: 'Device Statistics',
      measureType: 'other',
      dimensions: { instrument: definition.instrument },
      points,
    };
  });
}

function parseFraudPeriod(titleText) {
  const text = cleanText(titleText);
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  const finalYear = years[years.length - 1];
  if (!finalYear) return null;

  if (/\bJul\b|\bJuly\b/i.test(text)) {
    return `${finalYear}-06-01`;
  }

  return `${finalYear}-12-01`;
}

function metricKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

async function buildFraudSeries() {
  const listHtml = await fetchHtml(FRAUD_LIST_URL);
  const $list = cheerio.load(listHtml);
  const links = new Set();

  $list('a[href*="/resources/fraud-statistics/"]').each((_, element) => {
    const href = $list(element).attr('href');
    if (!href || href.includes('?page=')) return;
    if (/\/resources\/fraud-statistics\/[A-Za-z0-9\-]+$/i.test(href)) {
      links.add(new URL(href, FRAUD_LIST_URL).toString());
    }
  });

  const seriesMap = new Map();
  const pages = Array.from(links).sort();

  for (const pageUrl of pages) {
    const html = await fetchHtml(pageUrl);
    const $ = cheerio.load(html);
    const titleText = cleanText($('h1').first().text() || $('title').text());
    const pointDate = parseFraudPeriod(titleText);
    if (!pointDate) continue;

    const pageText = cleanText($('body').text());

    const pushSummaryMetric = (key, title, subcategory, regex, options = {}) => {
      const match = pageText.match(regex);
      if (!match) return;
      const raw = match[1];
      const value = options.million ? parseMillionAmount(raw) : parseDollarAmount(raw);
      if (value === null) return;

      upsertSeries(seriesMap, key, {
        id: key,
        tableCode: 'AusPayNet-Fraud-Statistics',
        tableName: 'Fraud Statistics',
        tableUrl: pageUrl,
        sheetName: titleText,
        title,
        frequency: 'Annual',
        units: options.million ? '$' : '$',
        category: 'Fraud',
        subcategory,
        measureType: 'value',
        dimensions: {},
      }, { date: pointDate, value });
    };

    pushSummaryMetric(
      'fraud-total-card-value',
      'AusPayNet Fraud: Total card fraud value',
      'Cards',
      /card fraud on Australian-issued cards[^$]*?\$([0-9,.]+)\s+million/i,
      { million: true },
    );

    pushSummaryMetric(
      'fraud-domestic-cnp-value',
      'AusPayNet Fraud: Domestic CNP value',
      'Cards',
      /domestic CNP fraud[^$]*?\$([0-9,.]+)\s+million/i,
      { million: true },
    );

    pushSummaryMetric(
      'fraud-overseas-cnp-value',
      'AusPayNet Fraud: Overseas CNP value',
      'Cards',
      /overseas CNP fraud[^$]*?\$([0-9,.]+)\s+million/i,
      { million: true },
    );

    pushSummaryMetric(
      'fraud-lost-stolen-value',
      'AusPayNet Fraud: Lost and stolen value',
      'Cards',
      /lost and stolen fraud[^$]*?\$([0-9,.]+)\s+million/i,
      { million: true },
    );

    pushSummaryMetric(
      'fraud-counterfeit-value',
      'AusPayNet Fraud: Counterfeit/skimming value',
      'Cards',
      /counterfeit\/skimming fraud[^$]*?\$([0-9,.]+)\s+million/i,
      { million: true },
    );

    pushSummaryMetric(
      'fraud-cheque-value',
      'AusPayNet Fraud: Cheque fraud value',
      'Cheques',
      /cheque fraud[^$]*?\$([0-9,.]+)\s+million/i,
      { million: true },
    );

    $('h3').each((_, headingElement) => {
      const heading = cleanText($(headingElement).text());
      if (!heading) return;

      let cursor = $(headingElement).next();
      let table = null;
      while (cursor.length) {
        if (cursor.is('table')) {
          table = cursor;
          break;
        }

        const nestedTable = cursor.find('table').first();
        if (nestedTable.length) {
          table = nestedTable;
          break;
        }

        if (cursor.is('h2, h3')) {
          break;
        }

        cursor = cursor.next();
      }

      if (!table) return;

      const rows = table
        .find('tr')
        .toArray()
        .map((row) =>
          $(row)
            .find('th, td')
            .toArray()
            .map((cell) => cleanText($(cell).text())),
        )
        .filter((row) => row.some(Boolean));

      if (!heading || rows.length < 2) return;

      if (heading.includes('Fraud Perpetrated on Australian Cheques and Cards')) {
        for (const row of rows.slice(2)) {
          const label = row[0];
          if (!label) continue;

          if (label === 'Cheques' || label === 'Australian-issued cards' || label === 'Total') {
            const fraudValue = parseDollarAmount(row[2]);
            const totalValue = parseMillionAmount(row[4]);

            if (fraudValue !== null) {
              const key = `fraud-summary-${metricKey(label)}-fraud-value`;
              upsertSeries(seriesMap, key, {
                id: key,
                tableCode: 'AusPayNet-Fraud-Statistics',
                tableName: 'Fraud Statistics',
                tableUrl: pageUrl,
                sheetName: heading,
                title: `AusPayNet Fraud: ${label} fraud value`,
                frequency: 'Annual',
                units: '$',
                category: 'Fraud',
                subcategory: label === 'Cheques' ? 'Cheques' : 'Cards',
                measureType: 'value',
                dimensions: {},
              }, { date: pointDate, value: fraudValue });
            }

            if (totalValue !== null) {
              const key = `fraud-summary-${metricKey(label)}-total-value`;
              upsertSeries(seriesMap, key, {
                id: key,
                tableCode: 'AusPayNet-Fraud-Statistics',
                tableName: 'Fraud Statistics',
                tableUrl: pageUrl,
                sheetName: heading,
                title: `AusPayNet Fraud: ${label} total value`,
                frequency: 'Annual',
                units: '$',
                category: 'Fraud',
                subcategory: label === 'Cheques' ? 'Cheques' : 'Cards',
                measureType: 'value',
                dimensions: {},
              }, { date: pointDate, value: totalValue });
            }
          }
        }
        return;
      }

      const totalRow = rows.find((row) => row[0] === 'Total' || row[0] === 'Total Debit Card Fraud');
      if (!totalRow) return;

      if (heading.includes('Cheque Fraud Perpetrated in Australia')) {
        const actualValue = parseDollarAmount(totalRow[2]);
        const exposureValue = parseDollarAmount(totalRow[4]);

        if (actualValue !== null) {
          const key = 'fraud-cheque-actual-value';
          upsertSeries(seriesMap, key, {
            id: key,
            tableCode: 'AusPayNet-Fraud-Statistics',
            tableName: 'Fraud Statistics',
            tableUrl: pageUrl,
            sheetName: heading,
            title: 'AusPayNet Fraud: Cheque actual value',
            frequency: 'Annual',
            units: '$',
            category: 'Fraud',
            subcategory: 'Cheques',
            measureType: 'value',
            dimensions: {},
          }, { date: pointDate, value: actualValue });
        }

        if (exposureValue !== null) {
          const key = 'fraud-cheque-exposure-value';
          upsertSeries(seriesMap, key, {
            id: key,
            tableCode: 'AusPayNet-Fraud-Statistics',
            tableName: 'Fraud Statistics',
            tableUrl: pageUrl,
            sheetName: heading,
            title: 'AusPayNet Fraud: Cheque exposure value',
            frequency: 'Annual',
            units: '$',
            category: 'Fraud',
            subcategory: 'Cheques',
            measureType: 'value',
            dimensions: {},
          }, { date: pointDate, value: exposureValue });
        }
      }

      if (heading.includes('Proprietary Debit Card Fraud Perpetrated in Australia')) {
        const totalValue = parseDollarAmount(totalRow[2]);
        if (totalValue !== null) {
          const key = 'fraud-debit-total-value';
          upsertSeries(seriesMap, key, {
            id: key,
            tableCode: 'AusPayNet-Fraud-Statistics',
            tableName: 'Fraud Statistics',
            tableUrl: pageUrl,
            sheetName: heading,
            title: 'AusPayNet Fraud: Debit card total value',
            frequency: 'Annual',
            units: '$',
            category: 'Fraud',
            subcategory: 'Debit',
            measureType: 'value',
            dimensions: {},
          }, { date: pointDate, value: totalValue });
        }
      }

      if (heading.includes('Scheme Credit, Debit and Charge Card Fraud Perpetrated in Australia and Overseas on Australia-issued Cards')) {
        const totalValue = parseDollarAmount(totalRow[6]);
        const domesticValue = parseDollarAmount(totalRow[2]);
        const overseasValue = parseDollarAmount(totalRow[4]);

        if (totalValue !== null) {
          const key = 'fraud-scheme-total-value';
          upsertSeries(seriesMap, key, {
            id: key,
            tableCode: 'AusPayNet-Fraud-Statistics',
            tableName: 'Fraud Statistics',
            tableUrl: pageUrl,
            sheetName: heading,
            title: 'AusPayNet Fraud: Scheme card total value',
            frequency: 'Annual',
            units: '$',
            category: 'Fraud',
            subcategory: 'Scheme cards',
            measureType: 'value',
            dimensions: {},
          }, { date: pointDate, value: totalValue });
        }

        if (domesticValue !== null) {
          const key = 'fraud-scheme-domestic-value';
          upsertSeries(seriesMap, key, {
            id: key,
            tableCode: 'AusPayNet-Fraud-Statistics',
            tableName: 'Fraud Statistics',
            tableUrl: pageUrl,
            sheetName: heading,
            title: 'AusPayNet Fraud: Scheme card domestic value',
            frequency: 'Annual',
            units: '$',
            category: 'Fraud',
            subcategory: 'Scheme cards',
            measureType: 'value',
            dimensions: {},
          }, { date: pointDate, value: domesticValue });
        }

        if (overseasValue !== null) {
          const key = 'fraud-scheme-overseas-value';
          upsertSeries(seriesMap, key, {
            id: key,
            tableCode: 'AusPayNet-Fraud-Statistics',
            tableName: 'Fraud Statistics',
            tableUrl: pageUrl,
            sheetName: heading,
            title: 'AusPayNet Fraud: Scheme card overseas value',
            frequency: 'Annual',
            units: '$',
            category: 'Fraud',
            subcategory: 'Scheme cards',
            measureType: 'value',
            dimensions: {},
          }, { date: pointDate, value: overseasValue });
        }
      }

      if (heading.includes('Fraud Perpetrated in Australia on Cards issued Overseas')) {
        const totalValue = parseDollarAmount(totalRow[2]);
        if (totalValue !== null) {
          const key = 'fraud-overseas-cards-total-value';
          upsertSeries(seriesMap, key, {
            id: key,
            tableCode: 'AusPayNet-Fraud-Statistics',
            tableName: 'Fraud Statistics',
            tableUrl: pageUrl,
            sheetName: heading,
            title: 'AusPayNet Fraud: Cards issued overseas total value',
            frequency: 'Annual',
            units: '$',
            category: 'Fraud',
            subcategory: 'Overseas cards',
            measureType: 'value',
            dimensions: {},
          }, { date: pointDate, value: totalValue });
        }
      }
    });
  }

  return finalizeSeries(seriesMap);
}

async function buildApraSeries() {
  const workbook = await fetchWorkbook(APRA_WORKBOOK_URL);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Key Stats'], { header: 1, raw: true, defval: null });
  const yearSerials = rows[3]?.slice(2, 11) ?? [];
  const yearDates = yearSerials.map((serial) => serialToIso(serial)).filter(Boolean);
  const seriesMap = new Map();
  const knownSections = [
    'Branch level of service',
    'Bank@Post',
    'Other face-to-face',
    'ADI-operated ATMs',
    'EFTPOS',
    'EFTPOS terminals',
  ];

  for (let index = 0; index < rows.length; index += 1) {
    const sectionLabel = cleanText(rows[index]?.[2]);
    if (!knownSections.some((section) => sectionLabel.includes(section))) continue;

    const totalRow = rows.slice(index + 1).find((row) => cleanText(row?.[0]) === 'Total');
    if (!totalRow) continue;

    const points = [];
    for (let yearIndex = 0; yearIndex < yearDates.length; yearIndex += 1) {
      const value = parseNumber(totalRow[yearIndex + 2]);
      const date = yearDates[yearIndex];
      if (value === null || !date) continue;
      points.push({ date, value });
    }

    const key = `apra-${sectionLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    seriesMap.set(key, {
      id: key,
      tableCode: 'APRA-Points-of-Presence',
      tableName: 'Key Stats',
      tableUrl: APRA_URL,
      sheetName: 'Key Stats',
      title: `APRA Points of Presence: ${sectionLabel}`,
      frequency: 'Annual',
      units: 'Number',
      category: 'Infrastructure',
      subcategory: 'Banking service presence',
      measureType: 'other',
      dimensions: { instrument: sectionLabel },
      points,
    });
  }

  return finalizeSeries(seriesMap);
}

async function main() {
  execFileSync(process.execPath, ['scripts/build-rba-original-data.mjs'], { stdio: 'inherit' });

  const outputPath = path.resolve(process.cwd(), 'public', 'data', 'rba-original-series.json');
  const payload = JSON.parse(await fs.readFile(outputPath, 'utf8'));

  const extraSeries = [
    ...(await buildDeviceSeries()),
    ...(await buildFraudSeries()),
    ...(await buildApraSeries()),
  ];

  payload.source = 'Composite payments data (RBA, AusPayNet, APRA)';
  payload.sources = [
    { name: 'Reserve Bank of Australia - Payments Statistics', url: 'https://www.rba.gov.au/payments-and-infrastructure/resources/payments-data.html' },
    { name: 'AusPayNet Device Statistics', url: DEVICE_URL },
    { name: 'AusPayNet Fraud Statistics', url: FRAUD_LIST_URL },
    { name: 'APRA Points of Presence Statistics', url: APRA_URL },
  ];
  payload.series = [...payload.series, ...extraSeries];

  await fs.writeFile(outputPath, JSON.stringify(payload));
  console.log(`Wrote ${payload.series.length} series to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});