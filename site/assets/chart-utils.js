((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MarketLensUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const INTERVALS = new Set(["1D", "1W", "1M"]);

  function intervalKey(time, interval) {
    if (interval === "1M") return time.slice(0, 7);
    if (interval !== "1W") return time;

    const date = new Date(`${time}T00:00:00Z`);
    const daysFromMonday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - daysFromMonday);
    return date.toISOString().slice(0, 10);
  }

  function aggregateRecords(records, interval = "1D") {
    if (!Array.isArray(records)) return [];
    if (!INTERVALS.has(interval)) throw new Error(`지원하지 않는 봉 간격입니다: ${interval}`);
    if (interval === "1D") return records.map((record) => ({ ...record }));

    const groups = [];
    let current = null;
    records.forEach((record) => {
      const key = intervalKey(record.time, interval);
      if (!current || current.key !== key) {
        current = {
          key,
          first: record,
          latest: record,
          high: record.high,
          low: record.low,
          volume: record.volume,
        };
        groups.push(current);
        return;
      }

      current.latest = record;
      current.high = Math.max(current.high, record.high);
      current.low = Math.min(current.low, record.low);
      current.volume += record.volume;
    });

    return groups.map((group) => ({
      ...group.latest,
      time: group.latest.time,
      open: group.first.open,
      high: group.high,
      low: group.low,
      close: group.latest.close,
      volume: group.volume,
    }));
  }

  function buildVolumeProfile(records, options = {}) {
    const source = Array.isArray(records)
      ? records.filter(
          (record) =>
            Number.isFinite(record?.low) &&
            Number.isFinite(record?.high) &&
            Number.isFinite(record?.volume)
        )
      : [];
    if (!source.length) {
      return { bins: [], poc: null, vah: null, val: null, totalVolume: 0, maxVolume: 0 };
    }

    const binCount = Math.min(80, Math.max(8, Math.round(options.binCount || 28)));
    const valueAreaRatio = Math.min(0.95, Math.max(0.5, options.valueAreaRatio || 0.7));
    let minimum = Math.min(...source.map((record) => Math.min(record.low, record.high)));
    let maximum = Math.max(...source.map((record) => Math.max(record.low, record.high)));
    if (maximum <= minimum) {
      const padding = Math.max(Math.abs(minimum) * 0.001, 0.01);
      minimum -= padding;
      maximum += padding;
    }

    const step = (maximum - minimum) / binCount;
    const bins = Array.from({ length: binCount }, (_, index) => ({
      low: minimum + step * index,
      high: minimum + step * (index + 1),
      price: minimum + step * (index + 0.5),
      volume: 0,
      upVolume: 0,
      downVolume: 0,
    }));

    source.forEach((record) => {
      const low = Math.max(minimum, Math.min(record.low, record.high));
      const high = Math.min(maximum, Math.max(record.low, record.high));
      const startIndex = Math.min(binCount - 1, Math.max(0, Math.floor((low - minimum) / step)));
      const endIndex = Math.min(binCount - 1, Math.max(startIndex, Math.floor((high - minimum) / step)));
      const distributedVolume = Math.max(0, record.volume) / (endIndex - startIndex + 1);
      const isUp = Number(record.close) >= Number(record.open);

      for (let index = startIndex; index <= endIndex; index += 1) {
        bins[index].volume += distributedVolume;
        if (isUp) bins[index].upVolume += distributedVolume;
        else bins[index].downVolume += distributedVolume;
      }
    });

    const totalVolume = bins.reduce((sum, bin) => sum + bin.volume, 0);
    const maxVolume = Math.max(...bins.map((bin) => bin.volume));
    const pocIndex = bins.reduce(
      (best, bin, index) => (bin.volume > bins[best].volume ? index : best),
      0
    );
    let valueAreaLow = pocIndex;
    let valueAreaHigh = pocIndex;
    let accumulated = bins[pocIndex].volume;
    const target = totalVolume * valueAreaRatio;

    while (accumulated < target && (valueAreaLow > 0 || valueAreaHigh < bins.length - 1)) {
      const lowerVolume = valueAreaLow > 0 ? bins[valueAreaLow - 1].volume : -1;
      const upperVolume = valueAreaHigh < bins.length - 1 ? bins[valueAreaHigh + 1].volume : -1;
      if (upperVolume >= lowerVolume && valueAreaHigh < bins.length - 1) {
        valueAreaHigh += 1;
        accumulated += bins[valueAreaHigh].volume;
      } else if (valueAreaLow > 0) {
        valueAreaLow -= 1;
        accumulated += bins[valueAreaLow].volume;
      } else {
        break;
      }
    }

    return {
      bins: bins.map((bin, index) => ({
        ...bin,
        isPoc: index === pocIndex,
        isValueArea: index >= valueAreaLow && index <= valueAreaHigh,
      })),
      poc: bins[pocIndex].price,
      vah: bins[valueAreaHigh].high,
      val: bins[valueAreaLow].low,
      totalVolume,
      maxVolume,
    };
  }

  function normaliseRecords(records, startTime = "") {
    const source = Array.isArray(records)
      ? records.filter(
          (record) =>
            typeof record?.time === "string" &&
            record.time >= startTime &&
            Number.isFinite(record.close)
        )
      : [];
    const base = Number(source[0]?.close);
    if (!Number.isFinite(base) || base === 0) return [];

    return source.map((record) => ({
      time: record.time,
      value: ((record.close - base) / base) * 100,
    }));
  }

  function aggregateSentimentRecords(sentimentRecords, priceRecords, interval = "1D") {
    if (!INTERVALS.has(interval)) throw new Error(`지원하지 않는 봉 간격입니다: ${interval}`);
    const sentiment = Array.isArray(sentimentRecords)
      ? sentimentRecords.filter(
          (record) =>
            typeof record?.time === "string" &&
            Number.isFinite(record.value) &&
            record.value >= 0 &&
            record.value <= 100
        )
      : [];
    const prices = Array.isArray(priceRecords) ? priceRecords : [];
    if (!sentiment.length || !prices.length) return [];

    const byBucket = new Map();
    sentiment.forEach((record) => {
      byBucket.set(intervalKey(record.time, interval), record);
    });
    return prices.flatMap((priceRecord) => {
      const match = byBucket.get(intervalKey(priceRecord.time, interval));
      return match
        ? [{ ...match, sourceTime: match.time, time: priceRecord.time }]
        : [];
    });
  }

  function lowerBoundByTime(records, targetTime) {
    let low = 0;
    let high = Array.isArray(records) ? records.length : 0;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (records[middle].time < targetTime) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function buildRangeComparison(priceRecords, sentimentByDate, startIndex, endIndex) {
    if (!Array.isArray(priceRecords) || !priceRecords.length) return null;
    const firstIndex = Math.max(0, Math.min(startIndex, endIndex, priceRecords.length - 1));
    const lastIndex = Math.max(0, Math.min(Math.max(startIndex, endIndex), priceRecords.length - 1));
    const start = priceRecords[firstIndex];
    const end = priceRecords[lastIndex];
    const priceReturn = Number(start?.close)
      ? ((Number(end?.close) / Number(start.close)) - 1) * 100
      : null;
    const startSentiment = sentimentByDate?.get?.(start?.time);
    const endSentiment = sentimentByDate?.get?.(end?.time);
    const sentimentChange = Number.isFinite(startSentiment?.value) && Number.isFinite(endSentiment?.value)
      ? endSentiment.value - startSentiment.value
      : null;
    return {
      startDate: start?.time,
      endDate: end?.time,
      startPrice: start?.close,
      endPrice: end?.close,
      priceReturn,
      startSentiment: startSentiment?.value ?? null,
      endSentiment: endSentiment?.value ?? null,
      sentimentChange,
      barCount: lastIndex - firstIndex + 1,
    };
  }

  function buildMergedSentimentCsv(priceRecords, sentimentRecords) {
    const prices = new Map(
      (Array.isArray(priceRecords) ? priceRecords : []).map((record) => [record.time, record])
    );
    const lines = ["date,qqq_close,qqq_change_pct,fear_greed,fear_greed_change,classification"];
    let previousPrice = null;
    let previousSentiment = null;
    (Array.isArray(sentimentRecords) ? sentimentRecords : []).forEach((sentiment) => {
      const price = prices.get(sentiment.time);
      if (!price || !Number.isFinite(price.close) || !Number.isFinite(sentiment.value)) return;
      const priceChange = Number.isFinite(previousPrice)
        ? ((price.close / previousPrice) - 1) * 100
        : "";
      const sentimentChange = Number.isFinite(previousSentiment)
        ? sentiment.value - previousSentiment
        : "";
      const classification = String(sentiment.classification || "").replaceAll('"', '""');
      lines.push([
        sentiment.time,
        Number(price.close).toFixed(4),
        priceChange === "" ? "" : priceChange.toFixed(4),
        Number(sentiment.value).toFixed(4),
        sentimentChange === "" ? "" : sentimentChange.toFixed(4),
        `"${classification}"`,
      ].join(","));
      previousPrice = price.close;
      previousSentiment = sentiment.value;
    });
    return `${lines.join("\n")}\n`;
  }

  return Object.freeze({
    aggregateRecords,
    aggregateSentimentRecords,
    buildMergedSentimentCsv,
    buildRangeComparison,
    buildVolumeProfile,
    lowerBoundByTime,
    normaliseRecords,
  });
});
