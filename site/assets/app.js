(() => {
  "use strict";

  const CHART_PALETTE = Object.freeze({
    candles: Object.freeze({
      up: "#2dd4bf",
      down: "#ff5b69",
      wickUp: "#3bd7c3",
      wickDown: "#ff6572",
      close: "#e64d5b",
    }),
    volume: Object.freeze({
      up: "rgba(45, 212, 191, 0.34)",
      down: "rgba(255, 91, 105, 0.32)",
    }),
    sentiment: Object.freeze({
      title: "Fear & Greed",
      color: "#f0b429",
      lineWidth: 2,
    }),
    indicators: Object.freeze({
      sma120: Object.freeze({
        field: "sma120",
        title: "SMA120",
        mobileTitle: "SMA120",
        color: "#f04438",
        lineWidth: 2,
      }),
      sma200: Object.freeze({
        field: "sma200",
        title: "SMA200",
        mobileTitle: "SMA200",
        color: "#3f6df6",
        lineWidth: 3,
      }),
      vwma100: Object.freeze({
        field: "vwma100",
        title: "VWMA100",
        mobileTitle: "VWMA",
        color: "#f47a2a",
        lineWidth: 2,
      }),
      bbBasis: Object.freeze({
        field: "bbBasis",
        title: "BB Basis",
        mobileTitle: "BB M",
        color: "#9b5de5",
        lineWidth: 1,
      }),
      bbUpper: Object.freeze({
        field: "bbUpper",
        title: "BB Upper",
        mobileTitle: "BB U",
        color: "#c43ee8",
        lineWidth: 1,
      }),
      bbLower: Object.freeze({
        field: "bbLower",
        title: "BB Lower",
        mobileTitle: "BB L",
        color: "#7048d7",
        lineWidth: 1,
      }),
    }),
  });

  const THEMES = Object.freeze({
    dark: Object.freeze({
      background: "#141823",
      text: "#aeb6c7",
      grid: "rgba(126, 139, 164, 0.13)",
      border: "#2a3040",
      crosshair: "rgba(174, 182, 199, 0.56)",
    }),
    light: Object.freeze({
      background: "#f8fafc",
      text: "#4f5b6f",
      grid: "rgba(79, 91, 111, 0.13)",
      border: "#d1d8e4",
      crosshair: "rgba(79, 91, 111, 0.48)",
    }),
  });

  const INDICATOR_STORAGE_KEY = "market-lens-indicator-settings-v1";
  const COMPARISON_STORAGE_KEY = "market-lens-comparison-symbols-v1";
  const SCALE_STORAGE_KEY = "market-lens-price-scale-mode-v1";
  const COMPARISON_BASE_SYMBOL = "PLTR";
  const COMPARISON_BASE_COLOUR = "#94a3b8";
  const COMPARISON_COLOURS = Object.freeze([
    "#22d3ee",
    "#facc15",
    "#fb7185",
    "#a78bfa",
    "#34d399",
    "#f97316",
    "#60a5fa",
  ]);
  const INTERVAL_LABELS = Object.freeze({
    "1D": "일봉",
    "1W": "주봉",
    "1M": "월봉",
  });
  const SCALE_MODE_LABELS = Object.freeze({
    normal: "일반",
    logarithmic: "로그",
    percentage: "퍼센트",
    indexed: "100 기준",
  });
  const HEX_COLOUR_PATTERN = /^#[0-9a-f]{6}$/i;
  const DEFAULT_INDICATOR_STATE = Object.freeze(
    Object.fromEntries(
      Object.entries(CHART_PALETTE.indicators).map(([key, config]) => [
        key,
        Object.freeze({
          visible: true,
          color: config.color,
          lineWidth: config.lineWidth,
        }),
      ])
    )
  );

  const PERIOD_OFFSETS = Object.freeze({
    "1M": Object.freeze({ months: 1 }),
    "3M": Object.freeze({ months: 3 }),
    "6M": Object.freeze({ months: 6 }),
    "1Y": Object.freeze({ years: 1 }),
    "3Y": Object.freeze({ years: 3 }),
    "5Y": Object.freeze({ years: 5 }),
  });

  const REQUIRED_RECORD_FIELDS = Object.freeze([
    "time",
    "open",
    "high",
    "low",
    "close",
    "volume",
  ]);

  const PRICE_FORMATTER = new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const INTEGER_FORMATTER = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

  class StockChartDashboard {
    constructor() {
      this.refs = this.collectElements();
      this.chart = null;
      this.series = {};
      this.priceLines = [];
      this.resizeObserver = null;
      this.summaryBySymbol = new Map();
      this.recordByDate = new Map();
      this.recordIndexByDate = new Map();
      this.sentimentByDate = new Map();
      this.sentimentRaw = [];
      this.sentimentAnalytics = null;
      this.sentimentMarkers = null;
      this.dataVersion = "";
      this.rawDataBySymbol = new Map();
      this.comparisonSeries = new Map();
      this.comparisonColours = new Map();
      this.initialComparisonSymbols = this.readComparisonPreferences();
      this.profileRenderFrame = null;
      this.loadSequence = 0;
      this.isMobile = window.innerWidth <= 760;
      this.pointerInteraction = null;
      this.shiftMeasurement = null;
      this.lastChartPoint = null;
      this.measurement = null;
      this.shiftKeyDown = false;
      this.selectedIndicatorKey = null;
      const indicatorPreferences = this.readIndicatorPreferences();
      this.state = {
        symbol: null,
        rawData: [],
        data: [],
        selectedPeriod: "1Y",
        selectedInterval: "1D",
        scaleMode: this.readScalePreference(),
        volumeProfileVisible: true,
        comparisonSymbols: [],
        theme: this.readThemePreference(),
        volumeVisible: indicatorPreferences.volumeVisible,
        indicators: indicatorPreferences.indicators,
        sentimentVisible: false,
        sentimentStyle: indicatorPreferences.sentiment,
        selectedFearThreshold: "25",
        fearMarkersVisible: true,
      };
    }

    collectElements() {
      const byId = (id) => {
        const element = document.getElementById(id);
        if (!element) {
          throw new Error(`필수 화면 요소를 찾을 수 없습니다: #${id}`);
        }
        return element;
      };

      return {
        chart: byId("stock-chart"),
        chartStatus: byId("chart-status"),
        statusTitle: byId("status-title"),
        statusMessage: byId("status-message"),
        retryButton: byId("retry-button"),
        stockSelect: byId("stock-select"),
        company: byId("stock-company"),
        currentPrice: byId("current-price"),
        priceChange: byId("price-change"),
        tradeDate: byId("trade-date"),
        generatedAt: byId("generated-at"),
        footerGeneratedAt: byId("footer-generated-at"),
        footerTradeDate: byId("footer-trade-date"),
        dataRange: byId("data-range"),
        themeToggle: byId("theme-toggle"),
        themeIcon: document.querySelector(".theme-icon"),
        themeText: document.querySelector(".theme-text"),
        autoFitButton: byId("auto-fit-button"),
        scaleModeSelect: byId("scale-mode-select"),
        volumeProfileToggle: byId("volume-profile-toggle"),
        volumeProfile: byId("volume-profile"),
        volumeProfileSummary: byId("volume-profile-summary"),
        compareSettingsToggle: byId("compare-settings-toggle"),
        compareSettings: byId("compare-settings"),
        compareSettingsClose: byId("compare-settings-close"),
        compareSymbolSelect: byId("compare-symbol-select"),
        compareAddButton: byId("compare-add-button"),
        compareSymbolList: byId("compare-symbol-list"),
        compareMessage: byId("compare-message"),
        compareCount: byId("compare-count"),
        comparisonLegend: byId("comparison-legend"),
        sentimentOverview: byId("sentiment-overview"),
        sentimentAnalysis: byId("sentiment-analysis"),
        sentimentCurrent: byId("sentiment-current"),
        sentimentClassification: byId("sentiment-classification"),
        sentimentAsOf: byId("sentiment-as-of"),
        sentimentPrevious: byId("sentiment-previous"),
        sentimentChange1D: byId("sentiment-change-1d"),
        sentimentChange5D: byId("sentiment-change-5d"),
        sentimentChange20D: byId("sentiment-change-20d"),
        sentimentAlert: byId("sentiment-alert"),
        sentimentChartToggle: byId("sentiment-chart-toggle"),
        sentimentLegendButton: byId("sentiment-legend-button"),
        legendSentiment: byId("legend-sentiment"),
        analysisPeriod: byId("analysis-period"),
        fearOccurrences: byId("fear-occurrences"),
        fearForwardReturns: byId("fear-forward-returns"),
        fearHistoryBody: byId("fear-history-body"),
        correlationTable: byId("correlation-table"),
        sentimentShockSummary: byId("sentiment-shock-summary"),
        sentimentCsvExport: byId("sentiment-csv-export"),
        fearMarkerToggle: byId("fear-marker-toggle"),
        crosshairPanel: byId("crosshair-panel"),
        indicatorSettingsToggle: byId("indicator-settings-toggle"),
        indicatorSettings: byId("indicator-settings"),
        indicatorSettingsClose: byId("indicator-settings-close"),
        indicatorSettingsReset: byId("indicator-settings-reset"),
        indicatorSettingsHelp: byId("indicator-settings-help"),
        interactionHint: byId("interaction-hint"),
        measurementLayer: byId("measurement-layer"),
        measurementBox: byId("measurement-box"),
        measurementLabel: byId("measurement-label"),
        measurementChange: byId("measurement-change"),
        measurementPrices: byId("measurement-prices"),
        measurementDates: byId("measurement-dates"),
        measurementSentiment: byId("measurement-sentiment"),
        measurementSummary: byId("measurement-summary"),
        cursorDate: byId("cursor-date"),
        cursorFields: {
          open: byId("cursor-open"),
          high: byId("cursor-high"),
          low: byId("cursor-low"),
          close: byId("cursor-close"),
          changeRate: byId("cursor-change-rate"),
          volume: byId("cursor-volume"),
          sentiment: byId("cursor-sentiment"),
          sma120: byId("cursor-sma120"),
          sma200: byId("cursor-sma200"),
          vwma100: byId("cursor-vwma100"),
          bbUpper: byId("cursor-bb-upper"),
          bbBasis: byId("cursor-bb-basis"),
          bbLower: byId("cursor-bb-lower"),
        },
        cursorSentimentField: byId("cursor-sentiment-field"),
        legend: {
          sma120: byId("legend-sma120"),
          sma200: byId("legend-sma200"),
          vwma100: byId("legend-vwma100"),
          bbUpper: byId("legend-bb-upper"),
          bbBasis: byId("legend-bb-basis"),
          bbLower: byId("legend-bb-lower"),
        },
      };
    }

    async initialise() {
      this.applyCssSeriesColours();
      this.applyDocumentTheme();
      this.syncIndicatorControls();
      this.bindControls();

      if (!window.LightweightCharts) {
        throw new Error(
          "Lightweight Charts 라이브러리를 불러오지 못했습니다. vendor 파일이 존재하는지 확인해 주세요."
        );
      }
      if (!window.MarketLensUtils) {
        throw new Error("차트 집계 도구를 불러오지 못했습니다.");
      }

      this.createChart();
      const metadata = await this.fetchJson("./data/metadata.json", { versioned: false });
      this.dataVersion = metadata?.dataVersion || metadata?.generatedAt || "";
      const summaries = await this.fetchJson("./data/stocks.json");

      if (!Array.isArray(summaries) || summaries.length === 0) {
        throw new Error("종목 요약 데이터가 비어 있습니다.");
      }

      this.summaryBySymbol = new Map(
        summaries
          .filter((summary) => summary && typeof summary.symbol === "string")
          .map((summary) => [summary.symbol, summary])
      );
      this.renderMetadata(metadata);
      this.populateStockSelector(summaries);
      this.populateComparisonSelector(summaries);
      await this.loadSentimentAssets(metadata);

      const firstAvailable = summaries.find((summary) => summary.dataPath);
      const defaultSummary = summaries.find(
        (summary) => summary.symbol === "PLTR" && summary.dataPath
      );
      const initialSymbol = (defaultSummary || firstAvailable)?.symbol;
      if (!initialSymbol) {
        throw new Error("표시할 수 있는 종목 데이터가 없습니다.");
      }

      this.refs.stockSelect.disabled = false;
      this.refs.compareSymbolSelect.disabled = false;
      this.refs.compareAddButton.disabled = true;
      this.refs.stockSelect.value = initialSymbol;
      await this.loadSymbol(initialSymbol);
      await this.restoreComparisons();
    }

    createChart() {
      const library = window.LightweightCharts;
      const theme = THEMES[this.state.theme];

      this.chart = library.createChart(this.refs.chart, {
        width: Math.max(320, this.refs.chart.clientWidth),
        height: Math.max(480, this.refs.chart.clientHeight),
        layout: {
          background: { type: library.ColorType.Solid, color: theme.background },
          textColor: theme.text,
          fontSize: this.isMobile ? 13 : 15,
          fontFamily:
            'Inter, Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          attributionLogo: true,
        },
        grid: {
          vertLines: { color: theme.grid },
          horzLines: { color: theme.grid },
        },
        crosshair: {
          mode: library.CrosshairMode.Normal,
          vertLine: {
            color: theme.crosshair,
            width: 1,
            style: library.LineStyle.Dashed,
            labelBackgroundColor: "#465169",
          },
          horzLine: {
            color: theme.crosshair,
            width: 1,
            style: library.LineStyle.Dashed,
            labelBackgroundColor: "#465169",
          },
        },
        rightPriceScale: {
          visible: true,
          alignLabels: true,
          entireTextOnly: true,
          minimumWidth: this.isMobile ? 84 : 124,
          borderVisible: false,
          scaleMargins: { top: 0.08, bottom: 0.24 },
        },
        leftPriceScale: {
          visible: false,
          alignLabels: true,
          entireTextOnly: true,
          minimumWidth: this.isMobile ? 62 : 92,
          borderVisible: false,
          scaleMargins: { top: 0.08, bottom: 0.24 },
        },
        timeScale: {
          borderVisible: false,
          timeVisible: false,
          secondsVisible: false,
          rightOffset: this.isMobile ? 4 : 8,
          barSpacing: this.isMobile ? 4 : 6,
          minBarSpacing: 1,
          fixLeftEdge: false,
          fixRightEdge: false,
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: false,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
        handleScale: {
          axisPressedMouseMove: { time: true, price: true },
          axisDoubleClickReset: { time: true, price: true },
          mouseWheel: true,
          pinch: true,
        },
        kineticScroll: { mouse: true, touch: true },
        localization: {
          locale: "ko-KR",
          priceFormatter: (price) => PRICE_FORMATTER.format(price),
        },
      });

      this.series.candles = this.chart.addSeries(library.CandlestickSeries, {
        upColor: CHART_PALETTE.candles.up,
        downColor: CHART_PALETTE.candles.down,
        borderUpColor: CHART_PALETTE.candles.up,
        borderDownColor: CHART_PALETTE.candles.down,
        wickUpColor: CHART_PALETTE.candles.wickUp,
        wickDownColor: CHART_PALETTE.candles.wickDown,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      });

      this.series.volume = this.chart.addSeries(library.HistogramSeries, {
        priceScaleId: "volume",
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: "volume" },
      });
      this.chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
      });

      Object.keys(CHART_PALETTE.indicators).forEach((key) => {
        const style = this.state.indicators[key];
        this.series[key] = this.chart.addSeries(library.LineSeries, {
          color: style.color,
          lineWidth: style.lineWidth,
          visible: style.visible,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        });
      });

      this.series.sentiment = this.chart.addSeries(library.LineSeries, {
        priceScaleId: "right",
        color: this.state.sentimentStyle.color,
        lineWidth: this.state.sentimentStyle.lineWidth,
        visible: false,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        priceFormat: {
          type: "custom",
          formatter: (value) => `${Math.round(value)}`,
          minMove: 0.01,
        },
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: 0, maxValue: 100 },
        }),
      });
      if (typeof library.createSeriesMarkers === "function") {
        this.sentimentMarkers = library.createSeriesMarkers(this.series.sentiment, []);
      }

      this.chart.subscribeCrosshairMove((parameter) => this.handleCrosshairMove(parameter));
      this.chart
        .timeScale()
        .subscribeVisibleLogicalRangeChange(() => this.scheduleVolumeProfileRender());
      this.setScaleMode(this.state.scaleMode, { persist: false, announce: false });
      this.installResponsiveSizing();
      this.installChartInteractions();
    }

    installResponsiveSizing() {
      const resize = () => {
        if (!this.chart) return;
        const width = Math.max(320, Math.floor(this.refs.chart.clientWidth));
        const height = Math.max(480, Math.floor(this.refs.chart.clientHeight));
        const nextIsMobile = width <= 760;
        const sentimentActive = this.state.sentimentVisible && this.state.symbol === "QQQ";
        const rightWidth = sentimentActive ? (nextIsMobile ? 58 : 76) : (nextIsMobile ? 84 : 124);
        const leftWidth = nextIsMobile ? 72 : 108;

        this.chart.resize(width, height);
        document.documentElement.style.setProperty(
          "--price-scale-width",
          `${rightWidth}px`
        );
        document.documentElement.style.setProperty(
          "--left-price-scale-width",
          `${leftWidth}px`
        );
        this.chart.priceScale("right").applyOptions({
          minimumWidth: rightWidth,
          alignLabels: true,
          entireTextOnly: true,
        });
        this.chart.priceScale("left").applyOptions({
          minimumWidth: leftWidth,
          alignLabels: true,
          entireTextOnly: true,
        });
        this.chart.timeScale().applyOptions({ rightOffset: nextIsMobile ? 4 : 8 });
        this.chart.applyOptions({ layout: { fontSize: nextIsMobile ? 13 : 15 } });

        if (nextIsMobile !== this.isMobile) {
          this.isMobile = nextIsMobile;
          this.rebuildPriceLines();
        }
        this.scheduleVolumeProfileRender();
      };

      if ("ResizeObserver" in window) {
        this.resizeObserver = new ResizeObserver(resize);
        this.resizeObserver.observe(this.refs.chart);
      } else {
        window.addEventListener("resize", resize, { passive: true });
      }
      resize();
    }

    installChartInteractions() {
      const capture = { capture: true };
      this.refs.chart.addEventListener(
        "wheel",
        (event) => this.handlePriceScaleWheel(event),
        { capture: true, passive: false }
      );
      this.refs.chart.addEventListener(
        "pointerdown",
        (event) => this.handleChartPointerDown(event),
        capture
      );
      this.refs.chart.addEventListener(
        "pointermove",
        (event) => this.handleChartPointerMove(event),
        capture
      );
      this.refs.chart.addEventListener(
        "pointerup",
        (event) => this.handleChartPointerUp(event),
        capture
      );
      this.refs.chart.addEventListener(
        "pointercancel",
        (event) => this.handleChartPointerUp(event),
        capture
      );
      this.refs.chart.addEventListener("pointerleave", () => {
        this.lastChartPoint = null;
        if (this.shiftMeasurement && !this.shiftKeyDown) {
          this.finishShiftMeasurement();
        }
      });
    }

    handlePriceScaleWheel(event) {
      if (!this.state.data.length || event.deltaY === 0) return;

      const rect = this.refs.chart.getBoundingClientRect();
      const plot = this.getPlotSize();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const isPriceScale = (
        x < plot.leftOffset || x > plot.leftOffset + plot.width
      ) && x >= 0 && x <= rect.width && y >= 0 && y <= plot.height;
      if (!isPriceScale) return;

      this.blockNativeChartGesture(event);

      const scale = this.series.candles.priceScale();
      let range = scale.getVisibleRange();
      if (!range) {
        const bottom = this.series.candles.coordinateToPrice(plot.height);
        const top = this.series.candles.coordinateToPrice(0);
        if (!Number.isFinite(bottom) || !Number.isFinite(top)) return;
        range = { from: Math.min(bottom, top), to: Math.max(bottom, top) };
      }

      const from = Math.min(range.from, range.to);
      const to = Math.max(range.from, range.to);
      const span = to - from;
      const anchorPrice = this.series.candles.coordinateToPrice(
        this.clamp(y, 0, plot.height)
      );
      if (
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        !Number.isFinite(span) ||
        span <= 0 ||
        !Number.isFinite(anchorPrice)
      ) {
        return;
      }

      const deltaModeMultiplier = event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? plot.height
          : 1;
      const wheelDelta = this.clamp(event.deltaY * deltaModeMultiplier, -120, 120);
      const zoomFactor = Math.exp(wheelDelta * 0.0018);
      const minimumSpan = Math.max(Math.abs(anchorPrice) * 0.0001, 0.01);
      const maximumSpan = 1_000_000_000;
      const nextSpan = this.clamp(span * zoomFactor, minimumSpan, maximumSpan);
      const anchorRatio = this.clamp((anchorPrice - from) / span, 0, 1);
      const nextFrom = anchorPrice - nextSpan * anchorRatio;

      scale.setAutoScale(false);
      scale.setVisibleRange({ from: nextFrom, to: nextFrom + nextSpan });
      this.scheduleVolumeProfileRender();
    }

    handleChartPointerDown(event) {
      if (event.button !== 0 || !this.state.data.length || this.pointerInteraction) return;
      if (event.pointerType === "touch") return;

      const point = this.getChartPoint(event);
      if (event.shiftKey || this.shiftKeyDown) {
        this.blockNativeChartGesture(event);
        if (point.insidePlot && !this.shiftMeasurement) {
          this.beginShiftMeasurement(point);
        }
        return;
      }

      if (!point.insidePlot) return;

      this.blockNativeChartGesture(event);
      this.beginChartPan(event, point);
    }

    handleChartPointerMove(event) {
      const rawPoint = this.getChartPoint(event);
      this.lastChartPoint = rawPoint.insidePlot ? rawPoint : null;
      this.scheduleVolumeProfileRender();

      if (this.shiftKeyDown || event.shiftKey) {
        if (event.buttons & 1) this.blockNativeChartGesture(event);
        if (!rawPoint.insidePlot) return;
        const point = this.getChartPoint(event, { clampToPlot: true });
        if (!this.shiftMeasurement) this.beginShiftMeasurement(point);
        else this.updateMeasurement(point);
        return;
      }

      if (this.shiftMeasurement) {
        this.finishShiftMeasurement();
      }

      if (!this.pointerInteraction || event.pointerId !== this.pointerInteraction.pointerId) return;
      this.blockNativeChartGesture(event);
      this.updateChartPan(this.getChartPoint(event, { clampToPlot: true }));
    }

    handleChartPointerUp(event) {
      if (this.shiftKeyDown || event.shiftKey) {
        this.blockNativeChartGesture(event);
        return;
      }
      if (this.shiftMeasurement) {
        this.finishShiftMeasurement();
      }
      if (!this.pointerInteraction || event.pointerId !== this.pointerInteraction.pointerId) return;
      this.blockNativeChartGesture(event);
      const point = this.getChartPoint(event, { clampToPlot: true });

      this.updateChartPan(point);
      this.finishPointerInteraction(event.pointerId);
    }

    beginShiftMeasurement(point) {
      const startIndex = this.getDataIndexAtCoordinate(point.x);
      const startPrice = this.state.sentimentVisible
        ? this.state.data[startIndex]?.close
        : this.series.candles.coordinateToPrice(point.y);
      if (startIndex === null || !Number.isFinite(startPrice)) return;

      this.clearMeasurement({ announce: false });
      this.shiftMeasurement = {
        startPoint: point,
        startIndex,
        startPrice,
      };
      this.refs.chart.classList.add("is-measuring");
      this.updateMeasurement(point);
    }

    updateMeasurement(point) {
      const interaction = this.shiftMeasurement;
      if (!interaction) return;

      const endIndex = this.getDataIndexAtCoordinate(point.x);
      const endPrice = this.state.sentimentVisible
        ? this.state.data[endIndex]?.close
        : this.series.candles.coordinateToPrice(point.y);
      if (endIndex === null || !Number.isFinite(endPrice)) return;

      const startRecord = this.state.data[interaction.startIndex];
      const endRecord = this.state.data[endIndex];
      const change = endPrice - interaction.startPrice;
      const changePercent = interaction.startPrice === 0 ? 0 : (change / interaction.startPrice) * 100;
      const isNegative = change < 0;
      const sign = isNegative ? "−" : "+";
      const barCount = Math.abs(endIndex - interaction.startIndex) + 1;

      const startScreenX = interaction.startPoint.screenX ?? interaction.startPoint.x;
      const endScreenX = point.screenX ?? point.x;
      const left = Math.min(startScreenX, endScreenX);
      const top = Math.min(interaction.startPoint.y, point.y);
      const width = Math.abs(endScreenX - startScreenX);
      const height = Math.abs(point.y - interaction.startPoint.y);
      Object.assign(this.refs.measurementBox.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${Math.max(1, width)}px`,
        height: `${Math.max(1, height)}px`,
      });

      this.refs.measurementLayer.hidden = false;
      this.refs.measurementLayer.setAttribute("aria-hidden", "false");
      this.refs.measurementLayer.classList.toggle("is-negative", isNegative);
      this.refs.measurementChange.textContent = `${sign}$${this.formatPrice(Math.abs(change))} (${sign}${this.formatPrice(Math.abs(changePercent))}%)`;
      this.refs.measurementPrices.textContent = `$${this.formatPrice(interaction.startPrice)} → $${this.formatPrice(endPrice)} · ${barCount}봉`;
      this.refs.measurementDates.textContent = `${startRecord.time} → ${endRecord.time}`;

      const comparison = this.state.sentimentVisible
        ? window.MarketLensUtils.buildRangeComparison(
            this.state.data,
            this.sentimentByDate,
            interaction.startIndex,
            endIndex
          )
        : null;
      if (comparison && Number.isFinite(comparison.sentimentChange)) {
        const sentimentSign = comparison.sentimentChange > 0 ? "+" : comparison.sentimentChange < 0 ? "−" : "";
        this.refs.measurementSentiment.textContent =
          `F&G ${this.formatSentiment(comparison.startSentiment)} → ${this.formatSentiment(comparison.endSentiment)} · ${sentimentSign}${this.formatPrice(Math.abs(comparison.sentimentChange))}pt`;
        this.refs.measurementSentiment.hidden = false;
      } else {
        this.refs.measurementSentiment.hidden = true;
      }

      const plot = this.getPlotSize();
      const labelWidth = Math.min(this.refs.measurementLabel.offsetWidth || 250, plot.width - 16);
      const labelHeight = this.refs.measurementLabel.offsetHeight || 72;
      const pointScreenX = point.screenX ?? point.x;
      const plotRight = plot.leftOffset + plot.width;
      const preferredLeft = pointScreenX + 12 + labelWidth <= plotRight
        ? pointScreenX + 12
        : pointScreenX - labelWidth - 12;
      const preferredTop = point.y - labelHeight - 12 >= 0
        ? point.y - labelHeight - 12
        : point.y + 12;
      Object.assign(this.refs.measurementLabel.style, {
        left: `${this.clamp(preferredLeft, plot.leftOffset + 8, Math.max(plot.leftOffset + 8, plotRight - labelWidth - 8))}px`,
        top: `${this.clamp(preferredTop, 8, Math.max(8, plot.height - labelHeight - 8))}px`,
      });

      this.measurement = {
        startDate: startRecord.time,
        endDate: endRecord.time,
        startPrice: interaction.startPrice,
        endPrice,
        change,
        changePercent,
        barCount,
        sentimentChange: comparison?.sentimentChange ?? null,
      };
      this.refs.measurementSummary.textContent = `${startRecord.time}부터 ${endRecord.time}까지 ${barCount}개 ${INTERVAL_LABELS[this.state.selectedInterval]}, ${sign}${this.formatPrice(Math.abs(changePercent))}퍼센트`;
    }

    beginChartPan(event, point) {
      const scale = this.series.candles.priceScale();
      let range = scale.getVisibleRange();
      if (!range) {
        const plot = this.getPlotSize();
        const bottom = this.series.candles.coordinateToPrice(plot.height);
        const top = this.series.candles.coordinateToPrice(0);
        if (!Number.isFinite(bottom) || !Number.isFinite(top)) return;
        range = { from: Math.min(bottom, top), to: Math.max(bottom, top) };
      }

      const from = Math.min(range.from, range.to);
      const to = Math.max(range.from, range.to);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;

      const logicalRange = this.chart.timeScale().getVisibleLogicalRange();
      if (
        !logicalRange ||
        !Number.isFinite(logicalRange.from) ||
        !Number.isFinite(logicalRange.to) ||
        logicalRange.to <= logicalRange.from
      ) {
        return;
      }

      scale.setAutoScale(false);
      this.pointerInteraction = {
        type: "chart-pan",
        pointerId: event.pointerId,
        startPoint: point,
        startPriceRange: { from, to },
        startLogicalRange: { from: logicalRange.from, to: logicalRange.to },
      };
      this.refs.chart.classList.add("is-chart-panning");
      this.capturePointer(event.pointerId);
    }

    updateChartPan(point) {
      const interaction = this.pointerInteraction;
      if (!interaction || interaction.type !== "chart-pan") return;

      const plot = this.getPlotSize();
      const priceSpan = interaction.startPriceRange.to - interaction.startPriceRange.from;
      const priceShift = ((point.y - interaction.startPoint.y) / plot.height) * priceSpan;
      this.series.candles.priceScale().setVisibleRange({
        from: interaction.startPriceRange.from + priceShift,
        to: interaction.startPriceRange.to + priceShift,
      });

      const logicalSpan =
        interaction.startLogicalRange.to - interaction.startLogicalRange.from;
      const logicalShift =
        ((point.x - interaction.startPoint.x) / plot.width) * logicalSpan;
      this.chart.timeScale().setVisibleLogicalRange({
        from: interaction.startLogicalRange.from - logicalShift,
        to: interaction.startLogicalRange.to - logicalShift,
      });
      this.scheduleVolumeProfileRender();
    }

    finishPointerInteraction(pointerId) {
      this.refs.chart.classList.remove("is-chart-panning");
      try {
        if (this.refs.chart.hasPointerCapture(pointerId)) {
          this.refs.chart.releasePointerCapture(pointerId);
        }
      } catch (error) {
        console.warn("포인터 캡처를 해제하지 못했습니다.", error);
      }
      this.pointerInteraction = null;
    }

    finishShiftMeasurement({ announce = true } = {}) {
      this.shiftMeasurement = null;
      this.refs.chart.classList.remove("is-measuring", "is-shift-measure");
      this.clearMeasurement({ announce: false });
      if (announce) {
        this.refs.measurementSummary.textContent = "Shift 키를 떼어 측정 박스를 삭제했습니다.";
      }
    }

    capturePointer(pointerId) {
      try {
        this.refs.chart.setPointerCapture(pointerId);
      } catch (error) {
        console.warn("포인터를 캡처하지 못했습니다.", error);
      }
    }

    blockNativeChartGesture(event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }

    getPlotSize() {
      const timeScale = this.chart?.timeScale();
      const width = timeScale?.width() || this.refs.chart.clientWidth;
      const height = this.refs.chart.clientHeight - (timeScale?.height() || 0);
      const rightWidth = this.chart?.priceScale("right")?.width?.() || 0;
      const leftOffset = this.state.sentimentVisible && this.state.symbol === "QQQ"
        ? Math.max(0, this.refs.chart.clientWidth - width - rightWidth)
        : 0;
      return {
        width: Math.max(1, width),
        height: Math.max(1, height),
        leftOffset,
        rightWidth,
      };
    }

    getChartPoint(event, { clampToPlot = false } = {}) {
      const rect = this.refs.chart.getBoundingClientRect();
      const plot = this.getPlotSize();
      const rawX = event.clientX - rect.left;
      const rawY = event.clientY - rect.top;
      const plotX = rawX - plot.leftOffset;
      return {
        x: clampToPlot ? this.clamp(plotX, 0, plot.width) : plotX,
        y: clampToPlot ? this.clamp(rawY, 0, plot.height) : rawY,
        screenX: clampToPlot
          ? plot.leftOffset + this.clamp(plotX, 0, plot.width)
          : rawX,
        insidePlot:
          plotX >= 0 && plotX <= plot.width && rawY >= 0 && rawY <= plot.height,
      };
    }

    getDataIndexAtCoordinate(x) {
      const logical = this.chart?.timeScale().coordinateToLogical(x);
      if (!Number.isFinite(logical) || !this.state.data.length) return null;
      return this.clamp(Math.round(logical), 0, this.state.data.length - 1);
    }

    clearMeasurement({ announce = true } = {}) {
      this.shiftMeasurement = null;
      this.measurement = null;
      this.refs.chart.classList.remove("is-measuring");
      this.refs.measurementLayer.hidden = true;
      this.refs.measurementLayer.setAttribute("aria-hidden", "true");
      this.refs.measurementLayer.classList.remove("is-negative");
      this.refs.measurementSentiment.hidden = true;
      if (announce) this.refs.measurementSummary.textContent = "측정값을 지웠습니다.";
    }

    restoreInteractionHint() {
      this.refs.interactionHint.textContent =
        "마우스 드래그 · 상하좌우 이동 · Shift 측정";
    }

    resetPriceScale({ announce = true } = {}) {
      if (!this.series.candles) return;
      this.series.candles.priceScale().setAutoScale(true);
      if (this.state.sentimentVisible) this.chart.priceScale("right").setAutoScale(true);
      this.scheduleVolumeProfileRender();
      if (announce) {
        this.refs.measurementSummary.textContent = "가격축을 자동 맞춤으로 복원했습니다.";
      }
    }

    handleGlobalKeyDown(event) {
      if (event.key === "Shift") {
        if (this.shiftKeyDown || event.repeat) return;
        this.shiftKeyDown = true;
        if (this.pointerInteraction) {
          this.finishPointerInteraction(this.pointerInteraction.pointerId);
        }
        this.refs.chart.classList.add("is-shift-measure");
        this.refs.interactionHint.textContent = "Shift 유지 중 · 마우스를 움직여 구간 측정";
        if (this.lastChartPoint && !this.pointerInteraction) {
          this.beginShiftMeasurement(this.lastChartPoint);
        }
      }
      if (event.key === "Escape") {
        this.shiftKeyDown = false;
        this.finishShiftMeasurement();
        this.setIndicatorSettingsOpen(false);
        this.setCompareSettingsOpen(false);
        this.restoreInteractionHint();
      }
    }

    handleGlobalKeyUp(event) {
      if (event.key !== "Shift") return;
      this.shiftKeyDown = false;
      this.finishShiftMeasurement();
      this.restoreInteractionHint();
    }

    clamp(value, minimum, maximum) {
      return Math.min(maximum, Math.max(minimum, value));
    }

    bindControls() {
      this.refs.stockSelect.addEventListener("change", () => {
        if (this.refs.stockSelect.value !== "QQQ" && this.state.sentimentVisible) {
          this.setSentimentVisible(false, { switchSymbol: false });
        }
        void this.loadSymbol(this.refs.stockSelect.value);
      });

      document.querySelectorAll("[data-period]").forEach((button) => {
        button.addEventListener("click", () => this.selectPeriod(button.dataset.period));
      });

      document.querySelectorAll("[data-interval]").forEach((button) => {
        button.addEventListener("click", () => this.selectInterval(button.dataset.interval));
      });

      this.refs.scaleModeSelect.addEventListener("change", () => {
        this.setScaleMode(this.refs.scaleModeSelect.value);
      });
      this.refs.volumeProfileToggle.addEventListener("click", () => {
        this.toggleVolumeProfile();
      });
      this.refs.compareSettingsToggle.addEventListener("click", () => {
        this.setCompareSettingsOpen(this.refs.compareSettings.hidden);
      });
      this.refs.compareSettingsClose.addEventListener("click", () => {
        this.setCompareSettingsOpen(false);
      });
      this.refs.compareAddButton.addEventListener("click", () => {
        void this.addComparisonSymbol(this.refs.compareSymbolSelect.value);
      });
      this.refs.compareSymbolSelect.addEventListener("change", () => {
        this.refs.compareAddButton.disabled = !this.refs.compareSymbolSelect.value;
      });

      document.querySelectorAll("[data-indicator-visible]").forEach((input) => {
        input.addEventListener("change", () => {
          this.updateIndicatorStyle(input.dataset.indicatorVisible, {
            visible: input.checked,
          });
        });
      });

      document.querySelectorAll("[data-indicator-color]").forEach((input) => {
        input.addEventListener("input", () => {
          this.updateIndicatorStyle(input.dataset.indicatorColor, {
            color: input.value,
          });
        });
      });

      document.querySelectorAll("[data-indicator-width]").forEach((select) => {
        select.addEventListener("change", () => {
          this.updateIndicatorStyle(select.dataset.indicatorWidth, {
            lineWidth: Number(select.value),
          });
        });
      });

      document.querySelector("[data-volume-visible]")?.addEventListener("change", (event) => {
        this.state.volumeVisible = event.currentTarget.checked;
        this.applyIndicatorStyles();
      });

      document.querySelector("[data-sentiment-visible]")?.addEventListener("change", (event) => {
        void this.setSentimentVisible(event.currentTarget.checked);
      });
      document.querySelector("[data-sentiment-color]")?.addEventListener("input", (event) => {
        this.updateSentimentStyle({ color: event.currentTarget.value });
      });
      document.querySelector("[data-sentiment-width]")?.addEventListener("change", (event) => {
        this.updateSentimentStyle({ lineWidth: Number(event.currentTarget.value) });
      });
      this.refs.sentimentChartToggle.addEventListener("click", () => {
        void this.setSentimentVisible(!this.state.sentimentVisible);
      });
      this.refs.sentimentLegendButton.addEventListener("click", () => {
        this.selectedIndicatorKey = "sentiment";
        this.refs.indicatorSettingsHelp.textContent =
          "Fear & Greed 선택됨 · 표시·색상·굵기를 조절합니다.";
        this.setIndicatorSettingsOpen(true);
      });
      document.querySelectorAll("[data-fear-threshold]").forEach((button) => {
        button.addEventListener("click", () => this.selectFearThreshold(button.dataset.fearThreshold));
      });
      this.refs.sentimentCsvExport.addEventListener("click", () => this.exportSentimentCsv());
      this.refs.fearMarkerToggle.addEventListener("change", () => {
        this.state.fearMarkersVisible = this.refs.fearMarkerToggle.checked;
        this.renderFearMarkers();
      });

      document.querySelectorAll("[data-legend-toggle]").forEach((button) => {
        button.addEventListener("click", () => this.openIndicatorEditor(button.dataset.legendToggle));
      });

      this.refs.autoFitButton.addEventListener("click", () => this.resetPriceScale());

      this.refs.indicatorSettingsToggle.addEventListener("click", () => {
        this.setIndicatorSettingsOpen(this.refs.indicatorSettings.hidden);
      });
      this.refs.indicatorSettingsClose.addEventListener("click", () => {
        this.setIndicatorSettingsOpen(false);
      });
      this.refs.indicatorSettingsReset.addEventListener("click", () => {
        this.resetIndicatorSettings();
      });

      document.addEventListener("pointerdown", (event) => {
        if (
          !this.refs.indicatorSettings.hidden &&
          !this.refs.indicatorSettings.contains(event.target) &&
          !this.refs.indicatorSettingsToggle.contains(event.target) &&
          !event.target.closest?.("[data-legend-toggle]")
        ) {
          this.setIndicatorSettingsOpen(false);
        }
        if (
          !this.refs.compareSettings.hidden &&
          !this.refs.compareSettings.contains(event.target) &&
          !this.refs.compareSettingsToggle.contains(event.target)
        ) {
          this.setCompareSettingsOpen(false);
        }
      });

      window.addEventListener("keydown", (event) => this.handleGlobalKeyDown(event));
      window.addEventListener("keyup", (event) => this.handleGlobalKeyUp(event));
      window.addEventListener("blur", () => {
        this.shiftKeyDown = false;
        this.finishShiftMeasurement({ announce: false });
        if (this.pointerInteraction) {
          this.finishPointerInteraction(this.pointerInteraction.pointerId);
        }
        this.restoreInteractionHint();
      });

      this.refs.themeToggle.addEventListener("click", () => this.toggleTheme());
      this.refs.retryButton.addEventListener("click", () => {
        if (this.state.symbol) void this.loadSymbol(this.state.symbol);
      });
    }

    async loadSymbol(symbol) {
      const summary = this.summaryBySymbol.get(symbol);
      if (!summary || !this.isSafeDataPath(summary.dataPath, symbol)) {
        this.showError("종목 데이터를 열 수 없습니다", `${symbol}의 데이터 경로가 유효하지 않습니다.`);
        return;
      }

      const sequence = ++this.loadSequence;
      this.state.symbol = symbol;
      this.refs.stockSelect.value = symbol;
      this.showLoading(`${symbol} 데이터를 불러오는 중입니다.`);

      try {
        const payload = await this.fetchJson(summary.dataPath);
        if (sequence !== this.loadSequence) return;

        const records = this.validateRecords(payload, symbol);
        this.state.rawData = records;
        this.rawDataBySymbol.set(symbol, records);
        this.clearMeasurement({ announce: false });
        this.renderQuote(summary, records[records.length - 1]);
        this.selectInterval(this.state.selectedInterval, { updateButtons: true });
        this.hideStatus();
      } catch (error) {
        if (sequence !== this.loadSequence) return;
        this.showError(
          `${symbol} 차트를 표시하지 못했습니다`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    setSeriesData(records) {
      this.series.candles.setData(
        records.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }))
      );
      this.series.volume.setData(
        records.map((record) => ({
          time: record.time,
          value: record.volume,
          color:
            record.close >= record.open
              ? CHART_PALETTE.volume.up
              : CHART_PALETTE.volume.down,
        }))
      );

      Object.entries(CHART_PALETTE.indicators).forEach(([key, config]) => {
        const lineData = records
          .filter((record) => Number.isFinite(record[config.field]))
          .map((record) => ({ time: record.time, value: record[config.field] }));
        this.series[key].setData(lineData);
      });
    }

    selectInterval(interval, { updateButtons = true } = {}) {
      if (!(interval in INTERVAL_LABELS) || !this.state.rawData.length) return;

      const records = window.MarketLensUtils.aggregateRecords(this.state.rawData, interval);
      if (!records.length) return;

      this.state.selectedInterval = interval;
      this.state.data = records;
      this.recordByDate = new Map(records.map((record) => [record.time, record]));
      this.recordIndexByDate = new Map(
        records.map((record, index) => [record.time, index])
      );

      if (updateButtons) {
        document.querySelectorAll("[data-interval]").forEach((button) => {
          const active = button.dataset.interval === interval;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", String(active));
        });
      }

      this.clearMeasurement({ announce: false });
      this.setSeriesData(records);
      this.refreshSentimentSeries(records);
      this.applySentimentScaleLayout();
      this.renderDataRange(records);
      this.renderLatestLegend(records[records.length - 1]);
      this.renderCrosshairInfo(records[records.length - 1], true);
      this.applyIndicatorStyles({ persist: false });
      this.resetPriceScale({ announce: false });
      this.selectPeriod(this.state.selectedPeriod, { updateButtons: true });
      this.refreshComparisonSeries();
      this.scheduleVolumeProfileRender();
    }

    rebuildPriceLines() {
      this.removeAllPriceLines();
      if (!this.state.data.length || !this.series.candles) return;

      const library = window.LightweightCharts;
      const latest = this.state.data[this.state.data.length - 1];
      this.addPriceLine(this.series.candles, {
        price: latest.close,
        color: "rgba(230, 77, 91, 0.76)",
        axisLabelColor: CHART_PALETTE.candles.close,
        axisLabelTextColor: "#ffffff",
        lineWidth: 1,
        lineStyle: library.LineStyle.Dotted,
        lineVisible: true,
        axisLabelVisible: true,
        title: this.state.sentimentVisible
          ? `${this.state.symbol || "QQQ"} USD`
          : this.state.symbol || "종가",
      });

      if (this.state.sentimentVisible) {
        [25, 45, 55, 75].forEach((value) => {
          this.addPriceLine(this.series.sentiment, {
            price: value,
            color: "rgba(240, 180, 41, 0.30)",
            lineWidth: 1,
            lineStyle: library.LineStyle.Dashed,
            lineVisible: true,
            axisLabelVisible: true,
            title: "",
          });
        });
      }

      if (this.isMobile) return;

      Object.entries(CHART_PALETTE.indicators).forEach(([key, config]) => {
        const value = latest[config.field];
        const style = this.state.indicators[key];
        if (!style.visible || !Number.isFinite(value)) return;

        this.addPriceLine(this.series[key], {
          price: value,
          color: style.color,
          axisLabelColor: style.color,
          axisLabelTextColor: this.getContrastingTextColour(style.color),
          lineWidth: 1,
          lineStyle: library.LineStyle.Dashed,
          lineVisible: false,
          axisLabelVisible: true,
          title: this.isMobile ? config.mobileTitle : config.title,
        });
      });
    }

    addPriceLine(series, options) {
      const priceLine = series.createPriceLine(options);
      this.priceLines.push({ series, priceLine });
    }

    removeAllPriceLines() {
      this.priceLines.forEach(({ series, priceLine }) => {
        try {
          series.removePriceLine(priceLine);
        } catch (error) {
          console.warn("기존 가격 라벨 제거 중 오류", error);
        }
      });
      this.priceLines = [];
    }

    openIndicatorEditor(key) {
      const config = CHART_PALETTE.indicators[key];
      if (!config || !(key in this.state.indicators)) return;

      this.selectedIndicatorKey = key;
      document.querySelectorAll("[data-indicator-row]").forEach((row) => {
        row.classList.toggle("is-selected", row.dataset.indicatorRow === key);
      });
      this.refs.indicatorSettingsHelp.textContent =
        `${config.title} 선택됨 · 표시·색상·굵기를 조절합니다.`;
      this.setIndicatorSettingsOpen(true);
    }

    updateIndicatorStyle(key, patch) {
      const current = this.state.indicators[key];
      if (!current) return;

      const next = { ...current };
      if (typeof patch.visible === "boolean") next.visible = patch.visible;
      if (typeof patch.color === "string" && HEX_COLOUR_PATTERN.test(patch.color)) {
        next.color = patch.color.toLowerCase();
      }
      if (Number.isFinite(patch.lineWidth)) {
        next.lineWidth = Math.min(4, Math.max(1, Math.round(patch.lineWidth)));
      }

      this.state.indicators[key] = next;
      this.applyIndicatorStyles();
    }

    updateSentimentStyle(patch) {
      const next = { ...this.state.sentimentStyle };
      if (typeof patch.color === "string" && HEX_COLOUR_PATTERN.test(patch.color)) {
        next.color = patch.color.toLowerCase();
      }
      if (Number.isFinite(patch.lineWidth)) {
        next.lineWidth = Math.min(4, Math.max(1, Math.round(patch.lineWidth)));
      }
      this.state.sentimentStyle = next;
      this.applyIndicatorStyles();
      this.renderFearMarkers();
    }

    async loadSentimentAssets(metadata) {
      const sentimentMetadata = metadata?.sentiment;
      const dataPath = sentimentMetadata?.dataPath;
      const analyticsPath = sentimentMetadata?.analyticsPath;
      if (
        dataPath !== "./data/sentiment/fear-greed.json" ||
        analyticsPath !== "./data/sentiment/analytics.json"
      ) {
        console.warn("Sentiment 데이터 경로가 없거나 안전하지 않습니다.");
        return;
      }

      try {
        const [payload, analytics] = await Promise.all([
          this.fetchJson(dataPath),
          this.fetchJson(analyticsPath),
        ]);
        this.sentimentRaw = this.validateSentimentRecords(payload?.records);
        if (!analytics || typeof analytics !== "object" || !analytics.commonPeriod) {
          throw new Error("Sentiment 분석 JSON이 올바르지 않습니다.");
        }
        this.sentimentAnalytics = analytics;
        this.refs.sentimentOverview.hidden = false;
        this.refs.sentimentAnalysis.hidden = false;
        this.renderSentimentOverview();
        this.renderSentimentAnalysis();
        if (sentimentMetadata.updateStatus === "error") {
          this.refs.sentimentAlert.hidden = false;
          this.refs.sentimentAlert.textContent =
            `최근 수집 실패 · 마지막 성공 ${sentimentMetadata.lastSuccessfulUpdate || payload.lastAvailableDate}`;
        }
      } catch (error) {
        console.error("Sentiment 데이터를 표시하지 못했습니다.", error);
        this.refs.sentimentOverview.hidden = false;
        this.refs.sentimentAlert.hidden = false;
        this.refs.sentimentAlert.textContent =
          `Market Sentiment 데이터를 불러오지 못했습니다. 기존 주가 차트는 계속 사용할 수 있습니다.`;
      }
    }

    validateSentimentRecords(payload) {
      if (!Array.isArray(payload) || payload.length < 2) {
        throw new Error("Fear & Greed 데이터는 2건 이상의 배열이어야 합니다.");
      }
      let previousTime = "";
      return payload.map((record, index) => {
        if (
          !record ||
          typeof record.time !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(record.time) ||
          record.time <= previousTime ||
          !Number.isFinite(record.value) ||
          record.value < 0 ||
          record.value > 100 ||
          typeof record.classification !== "string"
        ) {
          throw new Error(`Fear & Greed ${index + 1}번 항목이 유효하지 않습니다.`);
        }
        previousTime = record.time;
        return { ...record };
      });
    }

    async setSentimentVisible(visible, { switchSymbol = true } = {}) {
      const shouldShow = Boolean(visible) && this.sentimentRaw.length > 0;
      if (shouldShow && switchSymbol && this.state.symbol !== "QQQ") {
        await this.loadSymbol("QQQ");
      }
      this.state.sentimentVisible = shouldShow && this.state.symbol === "QQQ";
      this.applySentimentScaleLayout();
      this.refreshSentimentSeries();
      this.applyIndicatorStyles();
      this.refs.sentimentChartToggle.setAttribute(
        "aria-pressed",
        String(this.state.sentimentVisible)
      );
      this.refs.sentimentChartToggle.textContent = this.state.sentimentVisible
        ? "Fear & Greed 숨기기"
        : "QQQ와 차트 비교";
      this.refs.cursorSentimentField.hidden = !this.state.sentimentVisible;
      this.refs.sentimentLegendButton.hidden = !this.state.sentimentVisible;
      if (this.state.data.length) {
        this.renderCrosshairInfo(this.state.data[this.state.data.length - 1], true);
      }
      this.resetPriceScale({ announce: false });
      this.selectPeriod(this.state.selectedPeriod, { updateButtons: true });
      this.renderFearMarkers();
      this.scheduleVolumeProfileRender();
      this.refs.measurementSummary.textContent = this.state.sentimentVisible
        ? "QQQ는 왼쪽 USD축, Fear & Greed는 오른쪽 0~100축에 표시됩니다."
        : "Fear & Greed 비교를 숨겼습니다.";
    }

    applySentimentScaleLayout() {
      if (!this.chart || !this.series.candles) return;
      const active = this.state.sentimentVisible && this.state.symbol === "QQQ";
      const priceScaleId = active ? "left" : "right";
      ["candles", ...Object.keys(CHART_PALETTE.indicators)].forEach((key) => {
        this.series[key]?.applyOptions({ priceScaleId });
      });
      this.series.candles.applyOptions({
        priceFormat: active
          ? {
              type: "custom",
              formatter: (value) => `$${PRICE_FORMATTER.format(value)}`,
              minMove: 0.01,
            }
          : { type: "price", precision: 2, minMove: 0.01 },
      });
      this.chart.priceScale("left").applyOptions({
        visible: active,
        minimumWidth: this.isMobile ? 72 : 108,
        scaleMargins: { top: 0.08, bottom: 0.24 },
      });
      this.chart.priceScale("right").applyOptions({
        visible: true,
        minimumWidth: active ? (this.isMobile ? 58 : 76) : (this.isMobile ? 84 : 124),
        scaleMargins: active ? { top: 0.04, bottom: 0.04 } : { top: 0.08, bottom: 0.24 },
      });
      document.documentElement.style.setProperty(
        "--price-scale-width",
        `${active ? (this.isMobile ? 58 : 76) : (this.isMobile ? 84 : 124)}px`
      );
      document.documentElement.style.setProperty(
        "--left-price-scale-width",
        `${this.isMobile ? 72 : 108}px`
      );
      this.refs.chart.closest(".chart-shell")?.classList.toggle("has-sentiment", active);
      this.series.sentiment?.applyOptions({ visible: active, priceScaleId: "right" });
      this.chart.priceScale("right").setAutoScale(true);
      this.setScaleMode(this.state.scaleMode, { persist: false, announce: false });
    }

    refreshSentimentSeries(records = this.state.data) {
      if (!this.series.sentiment) return;
      const aligned = window.MarketLensUtils.aggregateSentimentRecords(
        this.sentimentRaw,
        records,
        this.state.selectedInterval
      );
      this.sentimentByDate = new Map(aligned.map((record) => [record.time, record]));
      this.series.sentiment.setData(
        aligned.map((record) => ({ time: record.time, value: record.value }))
      );
      const latest = aligned[aligned.length - 1];
      this.refs.legendSentiment.textContent = latest
        ? `${this.formatSentiment(latest.value)} · ${latest.classification}`
        : "—";
      this.renderFearMarkers();
    }

    renderSentimentOverview() {
      const current = this.sentimentAnalytics?.current;
      if (!current) return;
      this.refs.sentimentCurrent.textContent = this.formatSentiment(current.value);
      this.refs.sentimentClassification.textContent = current.classification || "—";
      this.refs.sentimentAsOf.textContent = `${current.date} 기준`;
      this.refs.sentimentPrevious.textContent = this.formatSentiment(current.previousClose);
      this.renderPointChange(this.refs.sentimentChange1D, current.changes?.["1D"]);
      this.renderPointChange(this.refs.sentimentChange5D, current.changes?.["5D"]);
      this.renderPointChange(this.refs.sentimentChange20D, current.changes?.["20D"]);
      this.refs.sentimentOverview.dataset.classification =
        String(current.classification || "").toLowerCase().replaceAll(" ", "-");
      if (current.rapidDrop) {
        this.refs.sentimentAlert.hidden = false;
        this.refs.sentimentAlert.textContent =
          `빠른 심리 하락 감지 · 최근 5거래일 ${this.formatSigned(current.changes?.["5D"], "pt")}`;
      }
    }

    renderPointChange(element, value) {
      element.textContent = this.formatSigned(value, "pt");
      element.classList.toggle("is-positive", Number(value) > 0);
      element.classList.toggle("is-negative", Number(value) < 0);
    }

    renderSentimentAnalysis() {
      const period = this.sentimentAnalytics?.commonPeriod;
      if (!period) return;
      this.refs.analysisPeriod.textContent =
        `공통 관측 ${period.from} ~ ${period.through} · ${INTEGER_FORMATTER.format(period.observations)}거래일`;
      this.selectFearThreshold(this.state.selectedFearThreshold);
      this.renderCorrelations();
      this.renderSentimentShocks();
    }

    selectFearThreshold(threshold) {
      const data = this.sentimentAnalytics?.thresholds?.[threshold];
      if (!data) return;
      this.state.selectedFearThreshold = threshold;
      document.querySelectorAll("[data-fear-threshold]").forEach((button) => {
        const active = button.dataset.fearThreshold === threshold;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      this.refs.fearOccurrences.textContent = `${INTEGER_FORMATTER.format(data.occurrences)}회`;
      const horizons = ["5D", "20D", "60D", "120D", "250D"];
      this.refs.fearForwardReturns.replaceChildren(
        ...horizons.map((horizon) => {
          const wrapper = document.createElement("div");
          const term = document.createElement("dt");
          const value = document.createElement("dd");
          term.textContent = horizon;
          value.textContent = this.formatSigned(data.averageReturns?.[horizon], "%");
          value.className = this.directionClass(data.averageReturns?.[horizon]);
          value.title = `완료 표본 ${data.completedSamples?.[horizon] ?? 0}건`;
          wrapper.append(term, value);
          return wrapper;
        })
      );
      this.renderFearHistory(data.events || []);
      this.renderFearMarkers();
    }

    renderFearHistory(events) {
      const rows = events.map((event) => {
        const row = document.createElement("tr");
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        row.setAttribute("aria-label", `${event.date} 차트로 이동`);
        const values = [
          event.date,
          this.formatSentiment(event.fearGreed),
          `$${this.formatPrice(event.qqqClose)}`,
          this.formatSigned(event.forwardReturns?.["20D"], "%"),
          this.formatSigned(event.forwardReturns?.["60D"], "%"),
          this.formatSigned(event.forwardReturns?.["120D"], "%"),
        ];
        values.forEach((text, index) => {
          const cell = document.createElement("td");
          cell.textContent = text;
          if (index >= 3) cell.className = this.directionClass(event.forwardReturns?.[["20D", "60D", "120D"][index - 3]]);
          row.append(cell);
        });
        const activate = () => void this.focusSentimentEvent(event.date);
        row.addEventListener("click", activate);
        row.addEventListener("keydown", (keyboardEvent) => {
          if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
            keyboardEvent.preventDefault();
            activate();
          }
        });
        return row;
      });
      this.refs.fearHistoryBody.replaceChildren(...rows);
    }

    renderCorrelations() {
      const correlations = this.sentimentAnalytics?.correlations;
      if (!correlations) return;
      const table = document.createElement("table");
      table.innerHTML = "<thead><tr><th>기간</th><th>점수↔가격</th><th>Δ점수↔수익률</th></tr></thead>";
      const body = document.createElement("tbody");
      ["30D", "90D", "1Y", "3Y", "MAX"].forEach((label) => {
        const row = document.createElement("tr");
        [
          label,
          this.formatCorrelation(correlations.levels?.[label]),
          this.formatCorrelation(correlations.changesVsReturns?.[label]),
        ].forEach((text) => {
          const cell = document.createElement("td");
          cell.textContent = text;
          row.append(cell);
        });
        body.append(row);
      });
      table.append(body);
      this.refs.correlationTable.replaceChildren(table);
    }

    renderSentimentShocks() {
      const shocks = this.sentimentAnalytics?.sentimentShocks;
      if (!shocks) return;
      const cards = [
        ["drop", "5D −15pt 이하"],
        ["rise", "5D +15pt 이상"],
      ].map(([key, label]) => {
        const data = shocks[key];
        const wrapper = document.createElement("div");
        wrapper.className = `shock-row ${key}`;
        const title = document.createElement("strong");
        title.textContent = `${label} · ${data?.occurrences ?? 0}회`;
        const metrics = document.createElement("span");
        metrics.textContent = ["5D", "20D", "60D"]
          .map((horizon) => `${horizon} ${this.formatSigned(data?.averageReturns?.[horizon], "%")}`)
          .join(" · ");
        wrapper.append(title, metrics);
        return wrapper;
      });
      this.refs.sentimentShockSummary.replaceChildren(...cards);
    }

    renderFearMarkers() {
      if (!this.sentimentMarkers) return;
      const active =
        this.state.sentimentVisible &&
        this.state.fearMarkersVisible &&
        this.state.selectedInterval === "1D";
      const events = active
        ? this.sentimentAnalytics?.thresholds?.[this.state.selectedFearThreshold]?.events || []
        : [];
      this.sentimentMarkers.setMarkers(
        events
          .filter((event) => this.sentimentByDate.has(event.date))
          .map((event) => ({
            time: event.date,
            position: "belowBar",
            color: this.state.sentimentStyle.color,
            shape: "arrowUp",
            text: `${Math.round(event.fearGreed)}`,
          }))
          .sort((left, right) => left.time.localeCompare(right.time))
      );
    }

    async focusSentimentEvent(date) {
      if (this.state.symbol !== "QQQ" || !this.state.sentimentVisible) {
        await this.setSentimentVisible(true);
      }
      if (this.state.selectedInterval !== "1D") this.selectInterval("1D");
      const index = window.MarketLensUtils.lowerBoundByTime(this.state.data, date);
      const record = this.state.data[index];
      if (!record || record.time !== date) return;
      const from = this.state.data[Math.max(0, index - 60)].time;
      const to = this.state.data[Math.min(this.state.data.length - 1, index + 60)].time;
      this.chart.timeScale().setVisibleRange({ from, to });
      this.chart.setCrosshairPosition(record.close, record.time, this.series.candles);
      this.renderCrosshairInfo(record, false);
      this.refs.chart.focus({ preventScroll: true });
      this.refs.chart.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    async exportSentimentCsv() {
      const qqq = await this.loadComparisonRecords("QQQ");
      if (!qqq?.length || !this.sentimentRaw.length) return;
      const csv = window.MarketLensUtils.buildMergedSentimentCsv(qqq, this.sentimentRaw);
      const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `qqq-fear-greed-${this.sentimentRaw.at(-1).time}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    applyIndicatorStyles({ persist = true } = {}) {
      this.series.volume?.applyOptions({ visible: this.state.volumeVisible });

      Object.entries(this.state.indicators).forEach(([key, style]) => {
        this.series[key]?.applyOptions({
          visible: style.visible,
          color: style.color,
          lineWidth: style.lineWidth,
        });
      });
      this.series.sentiment?.applyOptions({
        color: this.state.sentimentStyle.color,
        lineWidth: this.state.sentimentStyle.lineWidth,
        visible: this.state.sentimentVisible,
      });

      this.applyCssSeriesColours();
      this.syncIndicatorControls();
      this.rebuildPriceLines();
      if (persist) this.persistIndicatorPreferences();
    }

    syncIndicatorControls() {
      const volumeInput = document.querySelector("[data-volume-visible]");
      if (volumeInput) volumeInput.checked = this.state.volumeVisible;
      const sentimentVisibility = document.querySelector("[data-sentiment-visible]");
      const sentimentColour = document.querySelector("[data-sentiment-color]");
      const sentimentWidth = document.querySelector("[data-sentiment-width]");
      const sentimentRow = document.querySelector("[data-sentiment-row]");
      if (sentimentVisibility) sentimentVisibility.checked = this.state.sentimentVisible;
      if (sentimentColour) sentimentColour.value = this.state.sentimentStyle.color;
      if (sentimentWidth) sentimentWidth.value = String(this.state.sentimentStyle.lineWidth);
      sentimentRow?.classList.toggle("is-disabled", !this.state.sentimentVisible);
      sentimentRow?.style.setProperty("--indicator-accent", this.state.sentimentStyle.color);

      Object.entries(this.state.indicators).forEach(([key, style]) => {
        const visibilityInput = document.querySelector(`[data-indicator-visible="${key}"]`);
        const colourInput = document.querySelector(`[data-indicator-color="${key}"]`);
        const widthSelect = document.querySelector(`[data-indicator-width="${key}"]`);
        const settingsRow = document.querySelector(`[data-indicator-row="${key}"]`);

        if (visibilityInput) visibilityInput.checked = style.visible;
        if (colourInput) colourInput.value = style.color;
        if (widthSelect) widthSelect.value = String(style.lineWidth);
        settingsRow?.classList.toggle("is-disabled", !style.visible);
        settingsRow?.style.setProperty("--indicator-accent", style.color);

        document.querySelectorAll(`[data-legend-toggle="${key}"]`).forEach((button) => {
          button.classList.toggle("is-hidden", !style.visible);
          button.dataset.visible = String(style.visible);
          button.setAttribute(
            "aria-expanded",
            String(!this.refs.indicatorSettings.hidden && this.selectedIndicatorKey === key)
          );
        });
      });
    }

    setIndicatorSettingsOpen(open) {
      this.refs.indicatorSettings.hidden = !open;
      this.refs.indicatorSettingsToggle.setAttribute("aria-expanded", String(open));
      document.querySelectorAll("[data-legend-toggle]").forEach((button) => {
        button.setAttribute(
          "aria-expanded",
          String(open && button.dataset.legendToggle === this.selectedIndicatorKey)
        );
      });
      this.refs.sentimentLegendButton.setAttribute(
        "aria-expanded",
        String(open && this.selectedIndicatorKey === "sentiment")
      );
      if (open) {
        this.setCompareSettingsOpen(false);
        this.syncIndicatorControls();
      }
    }

    resetIndicatorSettings() {
      this.state.volumeVisible = true;
      this.state.indicators = this.createDefaultIndicatorState();
      this.state.sentimentStyle = {
        color: CHART_PALETTE.sentiment.color,
        lineWidth: CHART_PALETTE.sentiment.lineWidth,
      };
      this.applyIndicatorStyles();
    }

    createDefaultIndicatorState() {
      return Object.fromEntries(
        Object.entries(DEFAULT_INDICATOR_STATE).map(([key, value]) => [key, { ...value }])
      );
    }

    readIndicatorPreferences() {
      const fallback = {
        volumeVisible: true,
        indicators: this.createDefaultIndicatorState(),
        sentiment: {
          color: CHART_PALETTE.sentiment.color,
          lineWidth: CHART_PALETTE.sentiment.lineWidth,
        },
      };

      try {
        const raw = localStorage.getItem(INDICATOR_STORAGE_KEY);
        if (!raw) return fallback;
        const saved = JSON.parse(raw);
        if (!saved || typeof saved !== "object") return fallback;

        Object.keys(fallback.indicators).forEach((key) => {
          const candidate = saved.indicators?.[key];
          if (!candidate || typeof candidate !== "object") return;
          if (typeof candidate.visible === "boolean") {
            fallback.indicators[key].visible = candidate.visible;
          }
          if (typeof candidate.color === "string" && HEX_COLOUR_PATTERN.test(candidate.color)) {
            fallback.indicators[key].color = candidate.color.toLowerCase();
          }
          if (Number.isFinite(candidate.lineWidth)) {
            fallback.indicators[key].lineWidth = Math.min(
              4,
              Math.max(1, Math.round(candidate.lineWidth))
            );
          }
        });
        if (typeof saved.volumeVisible === "boolean") {
          fallback.volumeVisible = saved.volumeVisible;
        }
        if (typeof saved.sentiment?.color === "string" && HEX_COLOUR_PATTERN.test(saved.sentiment.color)) {
          fallback.sentiment.color = saved.sentiment.color.toLowerCase();
        }
        if (Number.isFinite(saved.sentiment?.lineWidth)) {
          fallback.sentiment.lineWidth = Math.min(4, Math.max(1, Math.round(saved.sentiment.lineWidth)));
        }
      } catch (error) {
        console.warn("지표 설정을 불러오지 못했습니다.", error);
      }
      return fallback;
    }

    persistIndicatorPreferences() {
      try {
        localStorage.setItem(
          INDICATOR_STORAGE_KEY,
          JSON.stringify({
            volumeVisible: this.state.volumeVisible,
            indicators: this.state.indicators,
            sentiment: this.state.sentimentStyle,
          })
        );
      } catch (error) {
        console.warn("지표 설정을 저장하지 못했습니다.", error);
      }
    }

    setScaleMode(mode, { persist = true, announce = true } = {}) {
      if (!(mode in SCALE_MODE_LABELS) || !this.series.candles) return;
      const library = window.LightweightCharts;
      const modes = {
        normal: library.PriceScaleMode.Normal,
        logarithmic: library.PriceScaleMode.Logarithmic,
        percentage: library.PriceScaleMode.Percentage,
        indexed: library.PriceScaleMode.IndexedTo100,
      };

      this.state.scaleMode = mode;
      this.refs.scaleModeSelect.value = mode;
      this.series.candles.priceScale().applyOptions({ mode: modes[mode] });
      this.series.candles.priceScale().setAutoScale(true);
      if (persist) {
        try {
          localStorage.setItem(SCALE_STORAGE_KEY, mode);
        } catch (error) {
          console.warn("가격축 형식 설정을 저장하지 못했습니다.", error);
        }
      }
      if (announce) {
        this.refs.measurementSummary.textContent =
          `가격축을 ${SCALE_MODE_LABELS[mode]} 형식으로 변경했습니다.`;
      }
      this.scheduleVolumeProfileRender();
    }

    readScalePreference() {
      try {
        const saved = localStorage.getItem(SCALE_STORAGE_KEY);
        return saved && saved in SCALE_MODE_LABELS ? saved : "normal";
      } catch (error) {
        return "normal";
      }
    }

    toggleVolumeProfile(force) {
      this.state.volumeProfileVisible =
        typeof force === "boolean" ? force : !this.state.volumeProfileVisible;
      const visible = this.state.volumeProfileVisible;
      this.refs.volumeProfileToggle.setAttribute("aria-pressed", String(visible));
      this.refs.volumeProfile.hidden = !visible;
      this.refs.volumeProfileSummary.hidden = !visible;
      this.refs.volumeProfile.setAttribute("aria-hidden", String(!visible));
      if (visible) this.scheduleVolumeProfileRender();
      else this.refs.volumeProfile.replaceChildren();
    }

    scheduleVolumeProfileRender() {
      if (!this.chart || this.profileRenderFrame !== null) return;
      this.profileRenderFrame = window.requestAnimationFrame(() => {
        this.profileRenderFrame = null;
        this.renderVolumeProfile();
      });
    }

    getVisibleRecords() {
      if (!this.chart || !this.state.data.length) return [];
      const logicalRange = this.chart.timeScale().getVisibleLogicalRange();
      if (!logicalRange) return this.state.data;
      const firstIndex = this.clamp(
        Math.floor(logicalRange.from),
        0,
        this.state.data.length - 1
      );
      const lastIndex = this.clamp(
        Math.ceil(logicalRange.to),
        firstIndex,
        this.state.data.length - 1
      );
      return this.state.data.slice(firstIndex, lastIndex + 1);
    }

    renderVolumeProfile() {
      if (!this.state.volumeProfileVisible || !this.series.candles) return;
      const records = this.getVisibleRecords();
      const profile = window.MarketLensUtils.buildVolumeProfile(records, {
        binCount: this.isMobile ? 20 : 30,
      });
      const plot = this.getPlotSize();
      const fragment = document.createDocumentFragment();

      profile.bins.forEach((bin) => {
        if (!Number.isFinite(profile.maxVolume) || profile.maxVolume <= 0) return;
        const topCoordinate = this.series.candles.priceToCoordinate(bin.high);
        const bottomCoordinate = this.series.candles.priceToCoordinate(bin.low);
        if (!Number.isFinite(topCoordinate) || !Number.isFinite(bottomCoordinate)) return;

        const top = this.clamp(Math.min(topCoordinate, bottomCoordinate), 0, plot.height);
        const bottom = this.clamp(Math.max(topCoordinate, bottomCoordinate), 0, plot.height);
        if (bottom <= 0 || top >= plot.height) return;

        const bar = document.createElement("div");
        bar.className = "volume-profile-bar";
        if (bin.isValueArea) bar.classList.add("is-value-area");
        if (bin.isPoc) bar.classList.add("is-poc");
        Object.assign(bar.style, {
          top: `${top}px`,
          height: `${Math.max(2, bottom - top)}px`,
          width: `${Math.max(1.5, (bin.volume / profile.maxVolume) * 100)}%`,
        });

        const down = document.createElement("span");
        const up = document.createElement("span");
        down.className = "volume-profile-down";
        up.className = "volume-profile-up";
        const total = bin.volume || 1;
        down.style.width = `${(bin.downVolume / total) * 100}%`;
        up.style.width = `${(bin.upVolume / total) * 100}%`;
        bar.append(down, up);
        fragment.append(bar);
      });

      this.refs.volumeProfile.replaceChildren(fragment);
      this.refs.volumeProfileSummary.textContent = profile.bins.length
        ? `POC $${this.formatPrice(profile.poc)} · VAH $${this.formatPrice(profile.vah)} · VAL $${this.formatPrice(profile.val)} · ${INTEGER_FORMATTER.format(records.length)}봉 근사`
        : "표시 구간의 매물대 데이터 없음";
    }

    populateComparisonSelector(summaries) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "종목을 선택하세요";
      const options = summaries
        .filter((summary) => summary.symbol !== COMPARISON_BASE_SYMBOL)
        .map((summary) => {
          const option = document.createElement("option");
          option.value = summary.symbol;
          option.textContent = `${summary.symbol} · ${summary.companyName || summary.symbol}`;
          option.disabled = !summary.dataPath;
          return option;
        });
      this.refs.compareSymbolSelect.replaceChildren(placeholder, ...options);
      this.renderComparisonControls();
    }

    setCompareSettingsOpen(open) {
      this.refs.compareSettings.hidden = !open;
      this.refs.compareSettingsToggle.setAttribute("aria-expanded", String(open));
      if (open) {
        this.setIndicatorSettingsOpen(false);
        this.renderComparisonControls();
      }
    }

    async restoreComparisons() {
      const symbols = this.initialComparisonSymbols.filter(
        (symbol) => this.summaryBySymbol.has(symbol) && symbol !== COMPARISON_BASE_SYMBOL
      );
      this.initialComparisonSymbols = [];
      for (const symbol of symbols) {
        await this.addComparisonSymbol(symbol, { persist: false, announce: false });
      }
      this.persistComparisonPreferences();
      this.renderComparisonControls();
    }

    async addComparisonSymbol(symbol, { persist = true, announce = true } = {}) {
      const normalisedSymbol = String(symbol || "").trim().toUpperCase();
      if (!normalisedSymbol || normalisedSymbol === COMPARISON_BASE_SYMBOL) return;
      if (this.state.comparisonSymbols.includes(normalisedSymbol)) {
        if (announce) this.refs.compareMessage.textContent = `${normalisedSymbol}은 이미 비교 중입니다.`;
        return;
      }
      const summary = this.summaryBySymbol.get(normalisedSymbol);
      if (!summary || !this.isSafeDataPath(summary.dataPath, normalisedSymbol)) {
        if (announce) this.refs.compareMessage.textContent = `${normalisedSymbol} 데이터를 사용할 수 없습니다.`;
        return;
      }

      this.refs.compareAddButton.disabled = true;
      if (announce) this.refs.compareMessage.textContent = `${normalisedSymbol} 비교 데이터를 불러오는 중입니다.`;
      try {
        await Promise.all([
          this.loadComparisonRecords(COMPARISON_BASE_SYMBOL),
          this.loadComparisonRecords(normalisedSymbol),
        ]);
        this.state.comparisonSymbols.push(normalisedSymbol);
        this.ensureComparisonSeries(COMPARISON_BASE_SYMBOL, { isBase: true });
        this.ensureComparisonSeries(normalisedSymbol);
        this.refreshComparisonSeries();
        this.renderComparisonControls();
        if (persist) this.persistComparisonPreferences();
        if (announce) {
          this.refs.compareMessage.textContent =
            `${normalisedSymbol} 비교를 PLTR 기준으로 추가했습니다.`;
        }
      } catch (error) {
        this.refs.compareMessage.textContent =
          `${normalisedSymbol} 비교 추가 실패: ${error instanceof Error ? error.message : error}`;
      } finally {
        this.refs.compareSymbolSelect.value = "";
        this.refs.compareAddButton.disabled = true;
      }
    }

    async loadComparisonRecords(symbol) {
      if (this.rawDataBySymbol.has(symbol)) return this.rawDataBySymbol.get(symbol);
      const summary = this.summaryBySymbol.get(symbol);
      if (!summary || !this.isSafeDataPath(summary.dataPath, symbol)) {
        throw new Error(`${symbol} 데이터 경로가 유효하지 않습니다.`);
      }
      const payload = await this.fetchJson(summary.dataPath);
      const records = this.validateRecords(payload, symbol);
      this.rawDataBySymbol.set(symbol, records);
      return records;
    }

    ensureComparisonSeries(symbol, { isBase = false } = {}) {
      if (this.comparisonSeries.has(symbol)) return this.comparisonSeries.get(symbol);
      const library = window.LightweightCharts;
      const colour = isBase ? COMPARISON_BASE_COLOUR : this.getComparisonColour(symbol);
      const series = this.chart.addSeries(library.LineSeries, {
        priceScaleId: "comparison",
        color: colour,
        lineWidth: isBase ? 2 : 3,
        lineStyle: isBase ? library.LineStyle.Dashed : library.LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        priceFormat: { type: "percent", precision: 2, minMove: 0.01 },
      });
      this.chart.priceScale("comparison").applyOptions({
        autoScale: true,
        scaleMargins: { top: 0.08, bottom: 0.24 },
      });
      this.comparisonSeries.set(symbol, series);
      return series;
    }

    refreshComparisonSeries() {
      if (!this.chart) return;
      if (!this.state.comparisonSymbols.length) {
        this.clearComparisonSeries();
        this.renderComparisonLegend([]);
        return;
      }

      const baseDailyRecords = this.rawDataBySymbol.get(COMPARISON_BASE_SYMBOL);
      if (!baseDailyRecords?.length) return;
      const baseRecords = window.MarketLensUtils.aggregateRecords(
        baseDailyRecords,
        this.state.selectedInterval
      );
      const startTime = this.getPeriodStartTime(baseRecords);
      const legendEntries = [];

      [COMPARISON_BASE_SYMBOL, ...this.state.comparisonSymbols].forEach((symbol) => {
        const dailyRecords = this.rawDataBySymbol.get(symbol);
        if (!dailyRecords?.length) return;
        const records = window.MarketLensUtils.aggregateRecords(
          dailyRecords,
          this.state.selectedInterval
        );
        const data = window.MarketLensUtils.normaliseRecords(records, startTime);
        const series = this.ensureComparisonSeries(symbol, {
          isBase: symbol === COMPARISON_BASE_SYMBOL,
        });
        series.setData(data);
        if (data.length) {
          legendEntries.push({
            symbol,
            colour: symbol === COMPARISON_BASE_SYMBOL
              ? COMPARISON_BASE_COLOUR
              : this.getComparisonColour(symbol),
            value: data[data.length - 1].value,
          });
        }
      });
      this.chart.priceScale("comparison").applyOptions({ autoScale: true });
      this.renderComparisonLegend(legendEntries);
    }

    getPeriodStartTime(records) {
      if (!records.length) return "";
      if (this.state.selectedPeriod === "MAX") return records[0].time;
      const latestTime = records[records.length - 1].time;
      const target = new Date(`${latestTime}T00:00:00Z`);
      const offset = PERIOD_OFFSETS[this.state.selectedPeriod];
      if (offset?.months) target.setUTCMonth(target.getUTCMonth() - offset.months);
      if (offset?.years) target.setUTCFullYear(target.getUTCFullYear() - offset.years);
      const targetText = target.toISOString().slice(0, 10);
      return records.find((record) => record.time >= targetText)?.time || records[0].time;
    }

    removeComparisonSymbol(symbol) {
      const index = this.state.comparisonSymbols.indexOf(symbol);
      if (index < 0) return;
      this.state.comparisonSymbols.splice(index, 1);
      const series = this.comparisonSeries.get(symbol);
      if (series) {
        this.chart.removeSeries(series);
        this.comparisonSeries.delete(symbol);
      }
      this.refreshComparisonSeries();
      this.renderComparisonControls();
      this.persistComparisonPreferences();
      this.refs.compareMessage.textContent = `${symbol} 비교를 삭제했습니다.`;
    }

    clearComparisonSeries() {
      this.comparisonSeries.forEach((series) => {
        try {
          this.chart.removeSeries(series);
        } catch (error) {
          console.warn("비교 선 제거 중 오류", error);
        }
      });
      this.comparisonSeries.clear();
    }

    renderComparisonControls() {
      const fragment = document.createDocumentFragment();
      if (!this.state.comparisonSymbols.length) {
        const empty = document.createElement("p");
        empty.className = "compare-empty";
        empty.textContent = "추가한 비교 종목이 없습니다.";
        fragment.append(empty);
      } else {
        this.state.comparisonSymbols.forEach((symbol) => {
          const chip = document.createElement("span");
          chip.className = "compare-symbol-chip";
          chip.style.setProperty("--compare-colour", this.getComparisonColour(symbol));
          chip.append(document.createTextNode(symbol));
          const removeButton = document.createElement("button");
          removeButton.type = "button";
          removeButton.textContent = "×";
          removeButton.setAttribute("aria-label", `${symbol} 비교 삭제`);
          removeButton.addEventListener("click", () => this.removeComparisonSymbol(symbol));
          chip.append(removeButton);
          fragment.append(chip);
        });
      }
      this.refs.compareSymbolList.replaceChildren(fragment);
      this.refs.compareCount.textContent = String(this.state.comparisonSymbols.length);
      Array.from(this.refs.compareSymbolSelect.options).forEach((option) => {
        if (!option.value) return;
        const summary = this.summaryBySymbol.get(option.value);
        option.disabled = !summary?.dataPath || this.state.comparisonSymbols.includes(option.value);
      });
      this.refs.compareSymbolSelect.value = "";
      this.refs.compareAddButton.disabled = true;
    }

    renderComparisonLegend(entries) {
      if (!entries.length) {
        this.refs.comparisonLegend.hidden = true;
        this.refs.comparisonLegend.replaceChildren();
        return;
      }
      const items = entries.map((entry) => {
        const item = document.createElement("span");
        item.style.setProperty("--compare-colour", entry.colour);
        const sign = entry.value > 0 ? "+" : entry.value < 0 ? "−" : "";
        item.textContent = `${entry.symbol} ${sign}${this.formatPrice(Math.abs(entry.value))}%`;
        return item;
      });
      this.refs.comparisonLegend.replaceChildren(...items);
      this.refs.comparisonLegend.hidden = false;
    }

    getComparisonColour(symbol) {
      if (this.comparisonColours.has(symbol)) return this.comparisonColours.get(symbol);
      const symbols = Array.from(this.summaryBySymbol.keys()).filter(
        (candidate) => candidate !== COMPARISON_BASE_SYMBOL
      );
      const index = Math.max(0, symbols.indexOf(symbol));
      const colour = COMPARISON_COLOURS[index % COMPARISON_COLOURS.length];
      this.comparisonColours.set(symbol, colour);
      return colour;
    }

    readComparisonPreferences() {
      try {
        const saved = JSON.parse(localStorage.getItem(COMPARISON_STORAGE_KEY) || "[]");
        if (!Array.isArray(saved)) return [];
        return [...new Set(saved)]
          .filter((symbol) => typeof symbol === "string")
          .map((symbol) => symbol.trim().toUpperCase())
          .filter((symbol) => symbol && symbol !== COMPARISON_BASE_SYMBOL)
          .slice(0, COMPARISON_COLOURS.length);
      } catch (error) {
        return [];
      }
    }

    persistComparisonPreferences() {
      try {
        localStorage.setItem(
          COMPARISON_STORAGE_KEY,
          JSON.stringify(this.state.comparisonSymbols)
        );
      } catch (error) {
        console.warn("종목 비교 설정을 저장하지 못했습니다.", error);
      }
    }

    selectPeriod(period, { updateButtons = true } = {}) {
      if (!this.chart || !this.state.data.length) return;
      if (period !== "MAX" && !(period in PERIOD_OFFSETS)) return;

      this.state.selectedPeriod = period;
      if (updateButtons) {
        document.querySelectorAll("[data-period]").forEach((button) => {
          const active = button.dataset.period === period;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", String(active));
        });
      }

      this.refreshComparisonSeries();

      window.requestAnimationFrame(() => {
        if (period === "MAX") {
          this.chart.timeScale().fitContent();
          this.scheduleVolumeProfileRender();
          return;
        }

        const latestTime = this.state.data[this.state.data.length - 1].time;
        const target = new Date(`${latestTime}T00:00:00Z`);
        const offset = PERIOD_OFFSETS[period];
        if (offset.months) target.setUTCMonth(target.getUTCMonth() - offset.months);
        if (offset.years) target.setUTCFullYear(target.getUTCFullYear() - offset.years);
        const targetText = target.toISOString().slice(0, 10);
        const firstVisible =
          this.state.data.find((record) => record.time >= targetText) || this.state.data[0];

        this.chart.timeScale().setVisibleRange({ from: firstVisible.time, to: latestTime });
        this.scheduleVolumeProfileRender();
      });
    }

    handleCrosshairMove(parameter) {
      if (!this.state.data.length) return;
      const point = parameter.point;
      if (
        !parameter.time ||
        !point ||
        point.x < 0 ||
        point.y < 0 ||
        point.x > this.refs.chart.clientWidth ||
        point.y > this.refs.chart.clientHeight
      ) {
        this.renderCrosshairInfo(this.state.data[this.state.data.length - 1], true);
        return;
      }

      const dateKey = this.normaliseChartTime(parameter.time);
      const record = this.recordByDate.get(dateKey);
      if (record) this.renderCrosshairInfo(record, false);
    }

    normaliseChartTime(time) {
      if (typeof time === "string") return time;
      if (typeof time === "number") return new Date(time * 1000).toISOString().slice(0, 10);
      if (time && typeof time === "object" && "year" in time) {
        return `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
      }
      return "";
    }

    renderCrosshairInfo(record, isLatest) {
      this.refs.crosshairPanel.classList.toggle("is-latest", isLatest);
      this.refs.cursorDate.textContent = isLatest
        ? `최근 거래일 · ${this.formatTradeDate(record.time)}`
        : this.formatTradeDate(record.time);

      const fields = this.refs.cursorFields;
      fields.open.textContent = this.formatPrice(record.open);
      fields.high.textContent = this.formatPrice(record.high);
      fields.low.textContent = this.formatPrice(record.low);
      fields.close.textContent = this.formatPrice(record.close);
      this.renderCursorChangeRate(record);
      fields.volume.textContent = this.formatVolume(record.volume);
      if (this.state.sentimentVisible) {
        const sentiment = this.sentimentByDate.get(record.time);
        const index = this.recordIndexByDate.get(record.time);
        const previousRecord = Number.isInteger(index) && index > 0 ? this.state.data[index - 1] : null;
        const previousSentiment = previousRecord
          ? this.sentimentByDate.get(previousRecord.time)
          : null;
        const change = sentiment && previousSentiment
          ? sentiment.value - previousSentiment.value
          : null;
        fields.sentiment.textContent = sentiment
          ? `${this.formatSentiment(sentiment.value)} · ${sentiment.classification} · ${this.formatSigned(change, "pt")}`
          : "관측값 없음";
        fields.sentiment.className = this.directionClass(change);
      } else {
        fields.sentiment.textContent = "—";
        fields.sentiment.className = "";
      }
      fields.sma120.textContent = this.formatPrice(record.sma120);
      fields.sma200.textContent = this.formatPrice(record.sma200);
      fields.vwma100.textContent = this.formatPrice(record.vwma100);
      fields.bbUpper.textContent = this.formatPrice(record.bbUpper);
      fields.bbBasis.textContent = this.formatPrice(record.bbBasis);
      fields.bbLower.textContent = this.formatPrice(record.bbLower);
    }

    renderCursorChangeRate(record) {
      const field = this.refs.cursorFields.changeRate;
      const index = this.recordIndexByDate.get(record.time);
      const previousRecord = Number.isInteger(index) && index > 0 ? this.state.data[index - 1] : null;
      const previousClose = Number(previousRecord?.close);
      const currentClose = Number(record.close);

      field.classList.remove("is-positive", "is-negative", "is-flat");
      field.removeAttribute("title");

      if (!Number.isFinite(previousClose) || previousClose === 0 || !Number.isFinite(currentClose)) {
        field.textContent = "—";
        return;
      }

      const changeRate = ((currentClose - previousClose) / previousClose) * 100;
      const sign = changeRate > 0 ? "+" : changeRate < 0 ? "−" : "";
      const directionClass =
        changeRate > 0 ? "is-positive" : changeRate < 0 ? "is-negative" : "is-flat";

      field.textContent = `${sign}${this.formatPrice(Math.abs(changeRate))}%`;
      field.classList.add(directionClass);
      field.title = `이전 ${INTERVAL_LABELS[this.state.selectedInterval]} 종가 $${this.formatPrice(previousClose)} 대비`;
    }

    renderLatestLegend(record) {
      this.refs.legend.sma120.textContent = this.formatPrice(record.sma120);
      this.refs.legend.sma200.textContent = this.formatPrice(record.sma200);
      this.refs.legend.vwma100.textContent = this.formatPrice(record.vwma100);
      this.refs.legend.bbUpper.textContent = this.formatPrice(record.bbUpper);
      this.refs.legend.bbBasis.textContent = this.formatPrice(record.bbBasis);
      this.refs.legend.bbLower.textContent = this.formatPrice(record.bbLower);
    }

    renderDataRange(records) {
      if (!records.length) {
        this.refs.dataRange.textContent =
          `${this.state.selectedInterval} ${INTERVAL_LABELS[this.state.selectedInterval]} 데이터 없음`;
        return;
      }
      const first = records[0].time;
      const latest = records[records.length - 1].time;
      this.refs.dataRange.textContent =
        `${this.state.selectedInterval} ${INTERVAL_LABELS[this.state.selectedInterval]} ${INTEGER_FORMATTER.format(records.length)}개 · ${first} ~ ${latest}`;
    }

    renderQuote(summary, latest) {
      this.refs.company.textContent = summary.companyName || summary.symbol;
      this.refs.company.title =
        summary.updateStatus === "error" && summary.errorMessage
          ? `최근 갱신 실패: ${summary.errorMessage}`
          : summary.companyName || summary.symbol;
      this.refs.currentPrice.textContent = `$${this.formatPrice(latest.close)}`;

      const change = Number(summary.change);
      const changePercent = Number(summary.changePercent);
      const hasChange = Number.isFinite(change) && Number.isFinite(changePercent);
      const sign = change >= 0 ? "+" : "-";
      this.refs.priceChange.textContent = hasChange
        ? `${sign}${this.formatPrice(Math.abs(change))} (${sign}${this.formatPrice(Math.abs(changePercent))}%)`
        : "등락 정보 없음";
      this.refs.priceChange.classList.toggle("is-positive", hasChange && change >= 0);
      this.refs.priceChange.classList.toggle("is-negative", hasChange && change < 0);

      const tradeDateText = this.formatTradeDate(latest.time);
      this.refs.tradeDate.textContent = `최근 거래일 ${tradeDateText}`;
      this.refs.footerTradeDate.textContent = `${summary.symbol} · ${tradeDateText}`;
    }

    renderMetadata(metadata) {
      const generated = metadata?.generatedAt
        ? this.formatGeneratedAt(metadata.generatedAt)
        : "생성 시각 정보 없음";
      this.refs.generatedAt.textContent = `업데이트 ${generated}`;
      this.refs.footerGeneratedAt.textContent = generated;
    }

    populateStockSelector(summaries) {
      const options = summaries.map((summary) => {
        const option = document.createElement("option");
        option.value = summary.symbol;
        option.textContent = summary.dataPath
          ? `${summary.symbol}${summary.updateStatus === "error" ? " ⚠" : ""}`
          : `${summary.symbol} (데이터 없음)`;
        option.disabled = !summary.dataPath;
        return option;
      });
      this.refs.stockSelect.replaceChildren(...options);
    }

    toggleTheme() {
      this.state.theme = this.state.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("market-lens-theme", this.state.theme);
      } catch (error) {
        console.warn("테마 설정을 저장하지 못했습니다.", error);
      }
      this.applyDocumentTheme();
      this.applyChartTheme();
      this.scheduleVolumeProfileRender();
    }

    applyDocumentTheme() {
      const isDark = this.state.theme === "dark";
      document.documentElement.dataset.theme = this.state.theme;
      this.refs.themeToggle.setAttribute(
        "aria-label",
        isDark ? "밝은 테마로 전환" : "어두운 테마로 전환"
      );
      if (this.refs.themeIcon) this.refs.themeIcon.textContent = isDark ? "☼" : "☾";
      if (this.refs.themeText) this.refs.themeText.textContent = isDark ? "라이트" : "다크";
    }

    applyChartTheme() {
      if (!this.chart) return;
      const library = window.LightweightCharts;
      const theme = THEMES[this.state.theme];
      this.chart.applyOptions({
        layout: {
          background: { type: library.ColorType.Solid, color: theme.background },
          textColor: theme.text,
        },
        grid: {
          vertLines: { color: theme.grid },
          horzLines: { color: theme.grid },
        },
        crosshair: {
          vertLine: { color: theme.crosshair },
          horzLine: { color: theme.crosshair },
        },
      });
    }

    applyCssSeriesColours() {
      const root = document.documentElement.style;
      root.setProperty("--sma120", this.state.indicators.sma120.color);
      root.setProperty("--sma200", this.state.indicators.sma200.color);
      root.setProperty("--vwma100", this.state.indicators.vwma100.color);
      root.setProperty("--bb-upper", this.state.indicators.bbUpper.color);
      root.setProperty("--bb-basis", this.state.indicators.bbBasis.color);
      root.setProperty("--bb-lower", this.state.indicators.bbLower.color);
      root.setProperty("--sentiment", this.state.sentimentStyle.color);
    }

    readThemePreference() {
      try {
        return localStorage.getItem("market-lens-theme") === "light" ? "light" : "dark";
      } catch (error) {
        return "dark";
      }
    }

    async fetchJson(path, { versioned = true } = {}) {
      let response;
      const requestPath = versioned && this.dataVersion
        ? `${path}${path.includes("?") ? "&" : "?"}v=${encodeURIComponent(this.dataVersion)}`
        : path;
      try {
        response = await fetch(requestPath, {
          cache: versioned ? "default" : "no-store",
        });
      } catch (error) {
        throw new Error(
          `데이터 요청에 실패했습니다. file:// 대신 로컬 HTTP 서버로 실행했는지 확인해 주세요. (${error})`
        );
      }
      if (!response.ok) {
        throw new Error(`${path} 요청 실패: HTTP ${response.status}`);
      }
      try {
        return await response.json();
      } catch (error) {
        throw new Error(`${path}의 JSON 형식이 올바르지 않습니다. (${error})`);
      }
    }

    validateRecords(payload, symbol) {
      if (!Array.isArray(payload) || payload.length < 2) {
        throw new Error(`${symbol} 차트 데이터는 2건 이상의 배열이어야 합니다.`);
      }

      const records = payload.map((record, index) => {
        if (!record || typeof record !== "object") {
          throw new Error(`${symbol} 데이터 ${index + 1}번째 항목이 객체가 아닙니다.`);
        }
        REQUIRED_RECORD_FIELDS.forEach((field) => {
          if (!(field in record)) {
            throw new Error(`${symbol} 데이터에 ${field} 필드가 없습니다.`);
          }
        });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(record.time)) {
          throw new Error(`${symbol} 데이터의 날짜 형식이 올바르지 않습니다: ${record.time}`);
        }
        ["open", "high", "low", "close", "volume"].forEach((field) => {
          if (!Number.isFinite(record[field])) {
            throw new Error(`${symbol} ${record.time}의 ${field} 값이 유효하지 않습니다.`);
          }
        });
        return record;
      });

      records.sort((left, right) => left.time.localeCompare(right.time));
      return records;
    }

    isSafeDataPath(path, symbol) {
      if (typeof path !== "string") return false;
      const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`^\\./data/${escapedSymbol}\\.json$`).test(path);
    }

    formatPrice(value) {
      return Number.isFinite(value) ? PRICE_FORMATTER.format(value) : "—";
    }

    formatSentiment(value) {
      return Number.isFinite(value) ? String(Math.round(value)) : "—";
    }

    formatSigned(value, suffix = "") {
      if (!Number.isFinite(value)) return "—";
      const sign = value > 0 ? "+" : value < 0 ? "−" : "";
      return `${sign}${this.formatPrice(Math.abs(value))}${suffix}`;
    }

    formatCorrelation(value) {
      return Number.isFinite(value) ? Number(value).toFixed(2) : "—";
    }

    directionClass(value) {
      return Number(value) > 0 ? "is-positive" : Number(value) < 0 ? "is-negative" : "is-flat";
    }

    getContrastingTextColour(hexColour) {
      if (!HEX_COLOUR_PATTERN.test(hexColour)) return "#ffffff";
      const red = Number.parseInt(hexColour.slice(1, 3), 16);
      const green = Number.parseInt(hexColour.slice(3, 5), 16);
      const blue = Number.parseInt(hexColour.slice(5, 7), 16);
      const luminance = (red * 299 + green * 587 + blue * 114) / 255000;
      return luminance > 0.58 ? "#111827" : "#ffffff";
    }

    formatVolume(value) {
      return Number.isFinite(value) ? INTEGER_FORMATTER.format(value) : "—";
    }

    formatTradeDate(value) {
      const date = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) return value || "—";
      return new Intl.DateTimeFormat("ko-KR", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
    }

    formatGeneratedAt(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
    }

    showLoading(message) {
      this.refs.chart.setAttribute("aria-busy", "true");
      this.refs.chartStatus.hidden = false;
      this.refs.chartStatus.classList.remove("is-error");
      this.refs.statusTitle.textContent = "차트 데이터를 불러오고 있습니다";
      this.refs.statusMessage.textContent = message;
      this.refs.retryButton.hidden = true;
    }

    showError(title, message) {
      this.refs.chart.setAttribute("aria-busy", "false");
      this.refs.chartStatus.hidden = false;
      this.refs.chartStatus.classList.add("is-error");
      this.refs.statusTitle.textContent = title;
      this.refs.statusMessage.textContent = message;
      this.refs.retryButton.hidden = false;
    }

    hideStatus() {
      this.refs.chart.setAttribute("aria-busy", "false");
      this.refs.chartStatus.hidden = true;
      this.refs.chartStatus.classList.remove("is-error");
      this.refs.retryButton.hidden = true;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    let dashboard;
    try {
      dashboard = new StockChartDashboard();
      window.marketLensDashboard = dashboard;
    } catch (error) {
      console.error(error);
      return;
    }

    dashboard.initialise().catch((error) => {
      console.error(error);
      dashboard.showError(
        "차트를 시작하지 못했습니다",
        error instanceof Error ? error.message : String(error)
      );
    });
  });
})();
