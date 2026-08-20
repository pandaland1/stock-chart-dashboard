"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregateRecords,
  aggregateSentimentRecords,
  buildMergedSentimentCsv,
  buildRangeComparison,
  buildVolumeProfile,
  lowerBoundByTime,
  normaliseRecords,
} = require("../site/assets/chart-utils.js");

function record(time, open, high, low, close, volume) {
  return { time, open, high, low, close, volume, sma120: close };
}

test("주봉은 월요일 기준으로 OHLCV를 집계한다", () => {
  const result = aggregateRecords(
    [
      record("2026-07-31", 10, 13, 9, 12, 100),
      record("2026-08-03", 12, 14, 11, 13, 200),
      record("2026-08-04", 13, 16, 12, 15, 300),
    ],
    "1W"
  );

  assert.equal(result.length, 2);
  assert.deepEqual(
    { time: result[1].time, open: result[1].open, high: result[1].high, low: result[1].low, close: result[1].close, volume: result[1].volume },
    { time: "2026-08-04", open: 12, high: 16, low: 11, close: 15, volume: 500 }
  );
  assert.equal(result[1].sma120, 15);
});

test("월봉은 월별 첫 시가와 마지막 종가를 사용한다", () => {
  const result = aggregateRecords(
    [
      record("2026-08-03", 10, 12, 9, 11, 100),
      record("2026-08-31", 11, 15, 10, 14, 250),
    ],
    "1M"
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].open, 10);
  assert.equal(result[0].close, 14);
  assert.equal(result[0].volume, 350);
});

test("매물대는 전체 거래량을 가격 구간에 보존한다", () => {
  const source = [
    record("2026-08-03", 10, 12, 10, 12, 100),
    record("2026-08-04", 12, 14, 11, 11, 200),
  ];
  const profile = buildVolumeProfile(source, { binCount: 8 });

  assert.equal(profile.bins.length, 8);
  assert.ok(Math.abs(profile.totalVolume - 300) < 1e-8);
  assert.ok(profile.poc >= 10 && profile.poc <= 14);
  assert.ok(profile.val <= profile.poc);
  assert.ok(profile.vah >= profile.poc);
});

test("종목 비교 값은 시작 종가를 0퍼센트로 정규화한다", () => {
  const result = normaliseRecords(
    [
      record("2026-08-01", 90, 100, 90, 100, 100),
      record("2026-08-02", 100, 112, 99, 110, 100),
    ],
    "2026-08-01"
  );

  assert.equal(result[0].value, 0);
  assert.ok(Math.abs(result[1].value - 10) < 1e-8);
});

test("주봉 Fear & Greed는 QQQ 봉의 같은 주 마지막 관측값에 맞춘다", () => {
  const prices = aggregateRecords(
    [
      record("2026-08-03", 10, 12, 9, 11, 100),
      record("2026-08-04", 11, 13, 10, 12, 100),
    ],
    "1W"
  );
  const result = aggregateSentimentRecords(
    [
      { time: "2026-08-03", value: 30, classification: "Fear" },
      { time: "2026-08-04", value: 45, classification: "Neutral" },
    ],
    prices,
    "1W"
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].time, "2026-08-04");
  assert.equal(result[0].value, 45);
  assert.equal(result[0].sourceTime, "2026-08-04");
});

test("이진 탐색은 긴 데이터에서 목표 날짜의 첫 위치를 찾는다", () => {
  const records = ["2026-01-01", "2026-01-03", "2026-01-05"].map((time) => ({ time }));
  assert.equal(lowerBoundByTime(records, "2026-01-03"), 1);
  assert.equal(lowerBoundByTime(records, "2026-01-04"), 2);
});

test("Shift 구간 비교는 QQQ 실제 종가와 심리 점수 차이를 계산한다", () => {
  const prices = [
    record("2026-08-01", 100, 100, 100, 100, 100),
    record("2026-08-02", 110, 110, 110, 110, 100),
  ];
  const sentiment = new Map([
    ["2026-08-01", { value: 10 }],
    ["2026-08-02", { value: 25 }],
  ]);
  const result = buildRangeComparison(prices, sentiment, 0, 1);

  assert.ok(Math.abs(result.priceReturn - 10) < 1e-8);
  assert.equal(result.sentimentChange, 15);
});

test("CSV 내보내기는 같은 날짜의 QQQ와 Fear & Greed만 결합한다", () => {
  const csv = buildMergedSentimentCsv(
    [record("2026-08-01", 100, 100, 100, 100, 100)],
    [{ time: "2026-08-01", value: 10, classification: "Extreme Fear" }]
  );
  assert.match(csv, /2026-08-01,100\.0000,,10\.0000,,"Extreme Fear"/);
});
