"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregateRecords,
  buildVolumeProfile,
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
