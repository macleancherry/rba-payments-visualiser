# Auspaynet & Partners Payment Datasets - Integration Assessment

## Available Datasets

### 1. **RBA Payments Statistics** ✅ (CURRENT)
- **Status**: Currently integrated
- **Data Points**: 248+ series (Cards, Direct Entry, NPP, PayTo, Cheques, High Value)
- **Unit Types**: $ million (119), million (34), '000 (93), Number (2)
- **Frequency**: Monthly & Quarterly
- **Format**: Extracted via RBA Excel sheets → JSON pipeline
- **Coverage**: 1990s-present with some gaps
- **Notes**: Already fully normalized in dashboard

---

### 2. **AusPayNet Device Statistics** 📊
- **Data**: ATM and EFTPOS terminal counts (quarterly snapshots)
- **Period**: 1989-present (comprehensive historical)
- **Format**: HTML tables → scrapable
- **Frequency**: Quarterly (March, June, September, December)
- **Sample 2025 data**:
  - ATMs: 22,767 (Dec 2025)
  - EFTPOS: 1,014,734 (Dec 2025)
- **Trend**: Both declining (ATMs: 32k→23k; EFTPOS volatile 950k-1M range)
- **Integration**: Easy—convert quarterly snapshots to monthly series (interpolate)
- **Relevance**: ⭐⭐⭐⭐⭐ High—shows infrastructure investment/decline
- **URL**: https://www.auspaynet.com.au/resources/device-statistics

### 3. **AusPayNet Fraud Statistics** 🔴
- **Data**: Annual half-yearly reports with detailed fraud breakdown
- **Latest**: Jan-Dec 2022 (full year), then semi-annual reports
- **Coverage**: Cheques, Proprietary debit cards, Scheme cards (credit/debit/charge)
- **Metrics per category**:
  - Fraud transactions count & value
  - Total transactions count & value
  - Fraud rate (% of transactions, % of value)
- **Sample 2022**:
  - Total card fraud: $577M (16.5% growth YoY)
  - Fraud rate: 57.5¢ per $1,000 spent
  - CNP fraud: $516.8M (dominant category)
- **Format**: HTML tables + PDF reports
- **Integration**: Moderate—periodic (semi-annual), different grain than RBA data
- **Relevance**: ⭐⭐⭐⭐ Medium-High—fraud trends complement transaction health
- **URL**: https://auspaynet.com.au/resources/fraud-statistics

### 4. **APRA Points of Presence Statistics** 🏦
- **Data**: Physical banking service channels by institution & region
- **Frequency**: Annual (June snapshot)
- **Latest**: June 2017-June 2025 (downloadable XLSX)
- **Coverage**: 5 channel types
  - Face-to-face branches (main level)
  - Other face-to-face
  - Bank@Post locations
  - ATMs
  - EFTPOS
- **Geography**: By state/territory, remoteness classification (ASGS)
- **Format**: Excel spreadsheet (26 MB)
- **Integration**: Moderate—annual updates, geographic dimension
- **Relevance**: ⭐⭐⭐ Medium—complements device stats with institutional attribution
- **URL**: https://www.apra.gov.au/authorised-deposit-taking-institutions-points-of-presence-statistics

### 5. **AFCA Data Cube** 📈
- **Data**: Financial complaints trends (issues, types, outcomes)
- **Status**: Accessible at data.afca.org.au (appears to be behind auth wall)
- **Relevance**: ⭐⭐ Low-Medium—different domain (complaints vs transactions)
- **Integration**: ⚠️ Blocked—needs investigation on access terms
- **URL**: https://data.afca.org.au/

### 6. **ACCC Targeting Scams Reports** 🚨
- **Data**: Annual scam activity trends & impact
- **Format**: PDF reports
- **Frequency**: Annual
- **Relevance**: ⭐ Low—tangential to payments ecosystem
- **Integration**: Skip for MVP
- **URL**: https://www.accc.gov.au/publications/targeting-scams-report-on-scam-activity

### 7. **BIS Red Book Statistics** 🌍
- **Data**: International payments data across 29+ CPMI member countries
- **Coverage**: Australia included
- **Metrics**: Retail payments, currency, FMI statistics
- **Format**: Data portal at bis.org/statistics
- **Frequency**: Annual (2024 published Apr 2026)
- **Relevance**: ⭐⭐ Low—Australia is just one country; international context only
- **Integration**: Complex—would need API or manual export
- **URL**: https://www.bis.org/statistics/payment_stats.htm

### 8. **RBA Consumer Payments Survey** 📋
- **Data**: Triennial consumer behavior survey
- **Frequency**: Every 3 years
- **Format**: PDF reports + tables
- **Coverage**: Consumer preference trends (which methods used, frequency)
- **Relevance**: ⭐⭐⭐ Medium—contextualizes transaction data
- **Integration**: Manual extraction from reports (infrequent updates)
- **URL**: https://www.rba.gov.au/payments-and-infrastructure/consumer-payments-survey/

---

## Integration Roadmap

### **Phase 1 (MVP - Dev Branch Focus)**
Estimated: 5-7 hours combined

#### 1.1 Device Statistics (Web Scraper)
- **File**: `scripts/fetch-auspaynet-devices.mjs`
- **Approach**: 
  - Scrape https://www.auspaynet.com.au/resources/device-statistics
  - Parse quarterly HTML tables (ATM + EFTPOS)
  - Create 2 series: `AusPayNet: ATM Count`, `AusPayNet: EFTPOS Count`
  - Interpolate quarterly → monthly for alignment
- **Output**: New rows in data JSON with source attribution
- **Time**: ~2-3 hours

#### 1.2 Fraud Statistics (HTML Table Parser)
- **File**: `scripts/fetch-auspaynet-fraud.mjs`
- **Approach**:
  - Parse fraud statistics pages (multiple years)
  - Extract tables for:
    - Cheque fraud (value, count, rates)
    - Card fraud by type (Lost/Stolen, CNP, Counterfeit, etc.)
  - Handle semi-annual reporting grain
- **Output**: Multiple new series aggregating fraud metrics
- **Time**: ~3-4 hours

### **Phase 2 (Enhanced Context - Follow-up)**
Estimated: 5-7 hours combined

#### 2.1 APRA Points of Presence
- **File**: `scripts/fetch-apra-devices.mjs`
- **Approach**:
  - Download annual XLSX from APRA
  - Parse per-bank and per-state aggregates
  - Create state-level dimension
  - Extract: Branch counts, Bank@Post, ATM/EFTPOS by location
- **Integration**: Add geographic selector to UI
- **Time**: ~2-3 hours

#### 2.2 RBA Consumer Survey
- **File**: `scripts/parse-rba-consumer-survey.mjs`
- **Approach**:
  - Manual extraction from latest triennial report PDF
  - Create metrics: Card_Adoption_%, Cash_Adoption_%, PayTo_Awareness_%
  - Lower update frequency (3-year cycle)
- **Time**: ~1-2 hours

### **Phase 3 (International Context - Lower Priority)**
Estimated: 4-6 hours

#### 3.1 BIS Red Book (AU Subset)
- **File**: `scripts/fetch-bis-red-book.mjs`
- **Approach**:
  - Investigate BIS data portal/API for Australian data export
  - Or manual export from bis.org/statistics/dataportal
  - Extract Australian payment methods, volumes, values
- **Challenge**: Portal may not expose AU-specific easy export
- **Time**: ~4-6 hours (investigation-dependent)

---

## Data Modeling Strategy

### New JSON Schema Fields
```javascript
{
  source: "rba" | "auspaynet-devices" | "auspaynet-fraud" | "apra" | "rba-survey",
  sourceUrl: "https://...",
  sourceOrganization: "RBA" | "AusPayNet" | "APRA",
  category: "Transactions" | "Infrastructure" | "Fraud" | "Banking Services" | "Consumer Behavior",
  subcategory: "Cards" | "ATM/Device" | "Branch" | "Fraud Type",
  updateFrequency: "monthly" | "quarterly" | "annual" | "triennial",
  // ... existing fields (title, units, points, etc.)
}
```

### Sample New Series (Phase 1)
```
1. AusPayNet: ATM Count (Quarterly)
   - units: "Number"
   - points: [{date: 2025-03-01, value: 23985}, ...]
   
2. AusPayNet: EFTPOS Count (Quarterly)
   - units: "Number"
   - points: [{date: 2025-03-01, value: 979191}, ...]
   
3. AusPayNet: Card Fraud - Value (Semi-annual)
   - units: "$ million"
   - points: [{date: 2022-12-31, value: 577}, ...]
   
4. AusPayNet: Card Fraud Rate (Semi-annual)
   - units: "cents per $1000"
   - points: [{date: 2022-12-31, value: 57.5}, ...]
```

---

## Technical Challenges & Solutions

| Dataset | Challenge | Solution |
|---------|-----------|----------|
| Device Stats | Quarterly grain vs monthly RBA | Interpolate Q1/Q2/Q3/Q4 to M1-M3, M4-M6, etc. or display as step function |
| Fraud Stats | Semi-annual vs monthly RBA | Show latest available; add visual "data freshness" indicator |
| APRA | Annual updates & geography | Create state/region dimension filter in UI |
| AFCA | Auth wall on data portal | Contact AFCA for data access terms/agreement |
| BIS | International portal without AU export | Script manual downloads or investigate CPMI API |

---

## Dashboard UI Updates Required

1. **Data Source Attribution**
   - Add "Data Sources" card/legend showing all integrated sources
   - Color-coding by source (RBA=blue, AusPayNet=orange, APRA=green, etc.)

2. **Frequency Indicator**
   - Display update frequency per series (Monthly, Quarterly, Annual, etc.)
   - Show "Last updated: [date]" for each source

3. **Geographic Dimension** (APRA data)
   - Add state/territory filter when viewing APRA branch data
   - Or new tab for institutional banking service geography

4. **Fraud Category Explainer**
   - New chart section: "Fraud Trends" with category breakdown
   - Show CNP vs Lost/Stolen vs Counterfeit trends over time

---

## Recommended Dev Branch Workflow

```bash
# On dev branch:
1. Create scripts/ for all new data fetchers
2. Update public/data building pipeline
3. Extend JSON schema with source metadata
4. Create new React components for fraud/device sections
5. Add data source attribution UI
6. Test with combined dataset
7. Deploy dev version to staging URL
8. Commit with comprehensive PR to main for code review
```

---

## Estimated Total Integration Time

| Phase | Time | Priority |
|-------|------|----------|
| Phase 1 (Devices + Fraud) | 5-7 hrs | 🔴 HIGH |
| Phase 2 (APRA + Survey) | 5-7 hrs | 🟠 MEDIUM |
| Phase 3 (BIS Research) | 4-6 hrs | 🟡 LOW |
| Testing & Refinement | 3-5 hrs | N/A |
| **Total** | **17-25 hrs** | — |

*Can parallelize Phase 1 & 2 to ~10-14 hours total*

---

## Next Steps

1. ✅ Create dev branch (done)
2. ⏳ Build Device Statistics scraper (Phase 1.1)
3. ⏳ Build Fraud Statistics parser (Phase 1.2)
4. ⏳ Update data build pipeline
5. ⏳ Extend React components for new data
6. ⏳ Deploy to staging & test
7. ⏳ Code review & merge to main

**Ready to go crazy with data! 🚀**
