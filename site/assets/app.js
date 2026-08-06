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
    "3M": Object.freeze({ months: 3 }),
    "6M": Object.freeze({ months: 6 }),
    "1Y": Object.freeze({ years: 1 }),
    "2Y": Object.freeze({ years: 2 }),
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
      this.loadSequence = 0;
      this.isMobile = window.innerWidth <= 760;
      this.pointerInteraction = null;
      this.measurement = null;
      this.shiftKeyDown = false;
      const indicatorPreferences = this.readIndicatorPreferences();
      this.state = {
        symbol: null,
        data: [],
        selectedPeriod: "1Y",
        theme: this.readThemePreference(),
        volumeVisible: indicatorPreferences.volumeVisible,
        activeTool: "navigate",
        indicators: indicatorPreferences.indicators,
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
        verticalPanButton: byId("vertical-pan-button"),
        measureButton: byId("measure-button"),
        autoFitButton: byId("auto-fit-button"),
        indicatorSettingsToggle: byId("indicator-settings-toggle"),
        indicatorSettings: byId("indicator-settings"),
        indicatorSettingsClose: byId("indicator-settings-close"),
        indicatorSettingsReset: byId("indicator-settings-reset"),
        interactionHint: byId("interaction-hint"),
        clearMeasurementButton: byId("clear-measurement-button"),
        measurementLayer: byId("measurement-layer"),
        measurementBox: byId("measurement-box"),
        measurementLabel: byId("measurement-label"),
        measurementChange: byId("measurement-change"),
        measurementPrices: byId("measurement-prices"),
        measurementDates: byId("measurement-dates"),
        measurementSummary: byId("measurement-summary"),
        cursorDate: byId("cursor-date"),
        cursorFields: {
          open: byId("cursor-open"),
          high: byId("cursor-high"),
          low: byId("cursor-low"),
          close: byId("cursor-close"),
          volume: byId("cursor-volume"),
          sma120: byId("cursor-sma120"),
          sma200: byId("cursor-sma200"),
          vwma100: byId("cursor-vwma100"),
          bbUpper: byId("cursor-bb-upper"),
          bbBasis: byId("cursor-bb-basis"),
          bbLower: byId("cursor-bb-lower"),
        },
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
      this.setActiveTool("navigate");

      if (!window.LightweightCharts) {
        throw new Error(
          "Lightweight Charts 라이브러리를 불러오지 못했습니다. vendor 파일이 존재하는지 확인해 주세요."
        );
      }

      this.createChart();
      const [summaries, metadata] = await Promise.all([
        this.fetchJson("./data/stocks.json"),
        this.fetchJson("./data/metadata.json"),
      ]);

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

      const firstAvailable = summaries.find((summary) => summary.dataPath);
      const defaultSummary = summaries.find(
        (summary) => summary.symbol === "PLTR" && summary.dataPath
      );
      const initialSymbol = (defaultSummary || firstAvailable)?.symbol;
      if (!initialSymbol) {
        throw new Error("표시할 수 있는 종목 데이터가 없습니다.");
      }

      this.refs.stockSelect.disabled = false;
      this.refs.stockSelect.value = initialSymbol;
      await this.loadSymbol(initialSymbol);
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
          fontSize: this.isMobile ? 12 : 14,
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
          minimumWidth: this.isMobile ? 88 : 116,
          borderVisible: false,
          scaleMargins: { top: 0.08, bottom: 0.24 },
        },
        leftPriceScale: { visible: false },
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
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
        handleScale: {
          axisPressedMouseMove: true,
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

      this.chart.subscribeCrosshairMove((parameter) => this.handleCrosshairMove(parameter));
      this.installResponsiveSizing();
      this.installChartInteractions();
    }

    installResponsiveSizing() {
      const resize = () => {
        if (!this.chart) return;
        const width = Math.max(320, Math.floor(this.refs.chart.clientWidth));
        const height = Math.max(480, Math.floor(this.refs.chart.clientHeight));
        const nextIsMobile = width <= 760;

        this.chart.resize(width, height);
        this.chart.priceScale("right").applyOptions({
          minimumWidth: nextIsMobile ? 88 : 116,
          alignLabels: true,
          entireTextOnly: true,
        });
        this.chart.timeScale().applyOptions({ rightOffset: nextIsMobile ? 4 : 8 });
        this.chart.applyOptions({ layout: { fontSize: nextIsMobile ? 12 : 14 } });

        if (nextIsMobile !== this.isMobile) {
          this.isMobile = nextIsMobile;
          this.rebuildPriceLines();
        }
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
    }

    handleChartPointerDown(event) {
      if (event.button !== 0 || !this.state.data.length || this.pointerInteraction) return;

      const wantsMeasurement = event.shiftKey || this.state.activeTool === "measure";
      const wantsVerticalPan = this.state.activeTool === "pan-y";
      if (!wantsMeasurement && !wantsVerticalPan) return;

      const point = this.getChartPoint(event);
      if (!point.insidePlot) return;

      this.blockNativeChartGesture(event);
      if (wantsMeasurement) {
        this.beginMeasurement(event, point);
      } else {
        this.beginVerticalPan(event, point);
      }
    }

    handleChartPointerMove(event) {
      if (!this.pointerInteraction || event.pointerId !== this.pointerInteraction.pointerId) return;
      this.blockNativeChartGesture(event);
      const point = this.getChartPoint(event, { clampToPlot: true });

      if (this.pointerInteraction.type === "measure") {
        this.updateMeasurement(point);
      } else if (this.pointerInteraction.type === "pan-y") {
        this.updateVerticalPan(point);
      }
    }

    handleChartPointerUp(event) {
      if (!this.pointerInteraction || event.pointerId !== this.pointerInteraction.pointerId) return;
      this.blockNativeChartGesture(event);
      const point = this.getChartPoint(event, { clampToPlot: true });

      if (this.pointerInteraction.type === "measure") {
        this.updateMeasurement(point);
      } else if (this.pointerInteraction.type === "pan-y") {
        this.updateVerticalPan(point);
      }
      this.finishPointerInteraction(event.pointerId);
    }

    beginMeasurement(event, point) {
      const startIndex = this.getDataIndexAtCoordinate(point.x);
      const startPrice = this.series.candles.coordinateToPrice(point.y);
      if (startIndex === null || !Number.isFinite(startPrice)) return;

      this.clearMeasurement({ announce: false });
      this.pointerInteraction = {
        type: "measure",
        pointerId: event.pointerId,
        startPoint: point,
        startIndex,
        startPrice,
      };
      this.refs.chart.classList.add("is-measuring");
      this.capturePointer(event.pointerId);
      this.updateMeasurement(point);
    }

    updateMeasurement(point) {
      const interaction = this.pointerInteraction;
      if (!interaction || interaction.type !== "measure") return;

      const endIndex = this.getDataIndexAtCoordinate(point.x);
      const endPrice = this.series.candles.coordinateToPrice(point.y);
      if (endIndex === null || !Number.isFinite(endPrice)) return;

      const startRecord = this.state.data[interaction.startIndex];
      const endRecord = this.state.data[endIndex];
      const change = endPrice - interaction.startPrice;
      const changePercent = interaction.startPrice === 0 ? 0 : (change / interaction.startPrice) * 100;
      const isNegative = change < 0;
      const sign = isNegative ? "−" : "+";
      const barCount = Math.abs(endIndex - interaction.startIndex) + 1;

      const left = Math.min(interaction.startPoint.x, point.x);
      const top = Math.min(interaction.startPoint.y, point.y);
      const width = Math.abs(point.x - interaction.startPoint.x);
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
      this.refs.clearMeasurementButton.hidden = false;

      const plot = this.getPlotSize();
      const labelWidth = Math.min(this.refs.measurementLabel.offsetWidth || 250, plot.width - 16);
      const labelHeight = this.refs.measurementLabel.offsetHeight || 72;
      const preferredLeft = point.x + 12 + labelWidth <= plot.width
        ? point.x + 12
        : point.x - labelWidth - 12;
      const preferredTop = point.y - labelHeight - 12 >= 0
        ? point.y - labelHeight - 12
        : point.y + 12;
      Object.assign(this.refs.measurementLabel.style, {
        left: `${this.clamp(preferredLeft, 8, Math.max(8, plot.width - labelWidth - 8))}px`,
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
      };
      this.refs.measurementSummary.textContent = `${startRecord.time}부터 ${endRecord.time}까지 ${barCount}개 일봉, ${sign}${this.formatPrice(Math.abs(changePercent))}퍼센트`;
    }

    beginVerticalPan(event, point) {
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

      scale.setAutoScale(false);
      this.pointerInteraction = {
        type: "pan-y",
        pointerId: event.pointerId,
        startPoint: point,
        startRange: { from, to },
      };
      this.refs.chart.classList.add("is-price-panning");
      this.capturePointer(event.pointerId);
    }

    updateVerticalPan(point) {
      const interaction = this.pointerInteraction;
      if (!interaction || interaction.type !== "pan-y") return;

      const plot = this.getPlotSize();
      const span = interaction.startRange.to - interaction.startRange.from;
      const shift = ((point.y - interaction.startPoint.y) / plot.height) * span;
      this.series.candles.priceScale().setVisibleRange({
        from: interaction.startRange.from + shift,
        to: interaction.startRange.to + shift,
      });
    }

    finishPointerInteraction(pointerId) {
      this.refs.chart.classList.remove("is-measuring", "is-price-panning");
      try {
        if (this.refs.chart.hasPointerCapture(pointerId)) {
          this.refs.chart.releasePointerCapture(pointerId);
        }
      } catch (error) {
        console.warn("포인터 캡처를 해제하지 못했습니다.", error);
      }
      this.pointerInteraction = null;
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
      return {
        width: Math.max(1, width),
        height: Math.max(1, height),
      };
    }

    getChartPoint(event, { clampToPlot = false } = {}) {
      const rect = this.refs.chart.getBoundingClientRect();
      const plot = this.getPlotSize();
      const rawX = event.clientX - rect.left;
      const rawY = event.clientY - rect.top;
      return {
        x: clampToPlot ? this.clamp(rawX, 0, plot.width) : rawX,
        y: clampToPlot ? this.clamp(rawY, 0, plot.height) : rawY,
        insidePlot: rawX >= 0 && rawX <= plot.width && rawY >= 0 && rawY <= plot.height,
      };
    }

    getDataIndexAtCoordinate(x) {
      const logical = this.chart?.timeScale().coordinateToLogical(x);
      if (!Number.isFinite(logical) || !this.state.data.length) return null;
      return this.clamp(Math.round(logical), 0, this.state.data.length - 1);
    }

    clearMeasurement({ announce = true } = {}) {
      this.measurement = null;
      this.refs.measurementLayer.hidden = true;
      this.refs.measurementLayer.setAttribute("aria-hidden", "true");
      this.refs.measurementLayer.classList.remove("is-negative");
      this.refs.clearMeasurementButton.hidden = true;
      if (announce) this.refs.measurementSummary.textContent = "측정값을 지웠습니다.";
    }

    toggleTool(tool) {
      this.setActiveTool(this.state.activeTool === tool ? "navigate" : tool);
    }

    setActiveTool(tool) {
      this.state.activeTool = ["navigate", "pan-y", "measure"].includes(tool)
        ? tool
        : "navigate";
      this.refs.verticalPanButton.setAttribute(
        "aria-pressed",
        String(this.state.activeTool === "pan-y")
      );
      this.refs.measureButton.setAttribute(
        "aria-pressed",
        String(this.state.activeTool === "measure")
      );
      this.refs.chart.dataset.tool = this.state.activeTool;

      if (this.state.activeTool === "pan-y") {
        this.refs.interactionHint.textContent = "차트를 위아래로 드래그해 가격축 이동";
      } else if (this.state.activeTool === "measure") {
        this.refs.interactionHint.textContent = "차트에서 드래그해 등락폭·등락률 측정";
      } else {
        this.refs.interactionHint.textContent = "Shift + 드래그로 등락률 측정";
      }
    }

    resetPriceScale({ announce = true } = {}) {
      if (!this.series.candles) return;
      this.series.candles.priceScale().setAutoScale(true);
      if (announce) {
        this.refs.measurementSummary.textContent = "가격축을 자동 맞춤으로 복원했습니다.";
      }
    }

    handleGlobalKeyDown(event) {
      if (event.key === "Shift") {
        this.shiftKeyDown = true;
        this.refs.chart.classList.add("is-shift-measure");
      }
      if (event.key === "Escape") {
        this.clearMeasurement();
        this.setIndicatorSettingsOpen(false);
        this.setActiveTool("navigate");
      }
    }

    handleGlobalKeyUp(event) {
      if (event.key !== "Shift") return;
      this.shiftKeyDown = false;
      this.refs.chart.classList.remove("is-shift-measure");
    }

    clamp(value, minimum, maximum) {
      return Math.min(maximum, Math.max(minimum, value));
    }

    bindControls() {
      this.refs.stockSelect.addEventListener("change", () => {
        void this.loadSymbol(this.refs.stockSelect.value);
      });

      document.querySelectorAll("[data-period]").forEach((button) => {
        button.addEventListener("click", () => this.selectPeriod(button.dataset.period));
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

      document.querySelectorAll("[data-legend-toggle]").forEach((button) => {
        button.addEventListener("click", () => this.toggleIndicator(button.dataset.legendToggle));
      });

      this.refs.verticalPanButton.addEventListener("click", () => this.toggleTool("pan-y"));
      this.refs.measureButton.addEventListener("click", () => this.toggleTool("measure"));
      this.refs.autoFitButton.addEventListener("click", () => this.resetPriceScale());
      this.refs.clearMeasurementButton.addEventListener("click", () => this.clearMeasurement());

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
        if (this.refs.indicatorSettings.hidden) return;
        if (
          this.refs.indicatorSettings.contains(event.target) ||
          this.refs.indicatorSettingsToggle.contains(event.target)
        ) {
          return;
        }
        this.setIndicatorSettingsOpen(false);
      });

      window.addEventListener("keydown", (event) => this.handleGlobalKeyDown(event));
      window.addEventListener("keyup", (event) => this.handleGlobalKeyUp(event));
      window.addEventListener("blur", () => {
        this.shiftKeyDown = false;
        this.refs.chart.classList.remove("is-shift-measure");
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
        this.state.data = records;
        this.recordByDate = new Map(records.map((record) => [record.time, record]));
        this.clearMeasurement({ announce: false });
        this.setSeriesData(records);
        this.renderQuote(summary, records[records.length - 1]);
        this.renderDataRange(records);
        this.renderLatestLegend(records[records.length - 1]);
        this.renderCrosshairInfo(records[records.length - 1], true);
        this.applyIndicatorStyles({ persist: false });
        this.resetPriceScale({ announce: false });
        this.selectPeriod(this.state.selectedPeriod, { updateButtons: true });
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
        title: this.state.symbol || "종가",
      });

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

    toggleIndicator(key) {
      if (!(key in this.state.indicators)) return;
      this.updateIndicatorStyle(key, {
        visible: !this.state.indicators[key].visible,
      });
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

    applyIndicatorStyles({ persist = true } = {}) {
      this.series.volume?.applyOptions({ visible: this.state.volumeVisible });

      Object.entries(this.state.indicators).forEach(([key, style]) => {
        this.series[key]?.applyOptions({
          visible: style.visible,
          color: style.color,
          lineWidth: style.lineWidth,
        });
      });

      this.applyCssSeriesColours();
      this.syncIndicatorControls();
      this.rebuildPriceLines();
      if (persist) this.persistIndicatorPreferences();
    }

    syncIndicatorControls() {
      const volumeInput = document.querySelector("[data-volume-visible]");
      if (volumeInput) volumeInput.checked = this.state.volumeVisible;

      Object.entries(this.state.indicators).forEach(([key, style]) => {
        const visibilityInput = document.querySelector(`[data-indicator-visible="${key}"]`);
        const colourInput = document.querySelector(`[data-indicator-color="${key}"]`);
        const widthSelect = document.querySelector(`[data-indicator-width="${key}"]`);
        const settingsRow = document.querySelector(`[data-indicator-row="${key}"]`);

        if (visibilityInput) visibilityInput.checked = style.visible;
        if (colourInput) colourInput.value = style.color;
        if (widthSelect) widthSelect.value = String(style.lineWidth);
        settingsRow?.classList.toggle("is-disabled", !style.visible);

        document.querySelectorAll(`[data-legend-toggle="${key}"]`).forEach((button) => {
          button.classList.toggle("is-hidden", !style.visible);
          button.setAttribute("aria-pressed", String(style.visible));
        });
      });
    }

    setIndicatorSettingsOpen(open) {
      this.refs.indicatorSettings.hidden = !open;
      this.refs.indicatorSettingsToggle.setAttribute("aria-expanded", String(open));
      if (open) this.syncIndicatorControls();
    }

    resetIndicatorSettings() {
      this.state.volumeVisible = true;
      this.state.indicators = this.createDefaultIndicatorState();
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
          })
        );
      } catch (error) {
        console.warn("지표 설정을 저장하지 못했습니다.", error);
      }
    }

    selectPeriod(period, { updateButtons = true } = {}) {
      if (!this.chart || !this.state.data.length) return;
      if (period !== "ALL" && !(period in PERIOD_OFFSETS)) return;

      this.state.selectedPeriod = period;
      if (updateButtons) {
        document.querySelectorAll("[data-period]").forEach((button) => {
          const active = button.dataset.period === period;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", String(active));
        });
      }

      window.requestAnimationFrame(() => {
        if (period === "ALL") {
          this.chart.timeScale().fitContent();
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
      this.refs.cursorDate.textContent = isLatest
        ? `최근 거래일 · ${this.formatTradeDate(record.time)}`
        : this.formatTradeDate(record.time);

      const fields = this.refs.cursorFields;
      fields.open.textContent = this.formatPrice(record.open);
      fields.high.textContent = this.formatPrice(record.high);
      fields.low.textContent = this.formatPrice(record.low);
      fields.close.textContent = this.formatPrice(record.close);
      fields.volume.textContent = this.formatVolume(record.volume);
      fields.sma120.textContent = this.formatPrice(record.sma120);
      fields.sma200.textContent = this.formatPrice(record.sma200);
      fields.vwma100.textContent = this.formatPrice(record.vwma100);
      fields.bbUpper.textContent = this.formatPrice(record.bbUpper);
      fields.bbBasis.textContent = this.formatPrice(record.bbBasis);
      fields.bbLower.textContent = this.formatPrice(record.bbLower);
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
        this.refs.dataRange.textContent = "1D 일봉 데이터 없음";
        return;
      }
      const first = records[0].time;
      const latest = records[records.length - 1].time;
      this.refs.dataRange.textContent = `1D 일봉 ${INTEGER_FORMATTER.format(records.length)}개 · ${first} ~ ${latest}`;
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
    }

    readThemePreference() {
      try {
        return localStorage.getItem("market-lens-theme") === "light" ? "light" : "dark";
      } catch (error) {
        return "dark";
      }
    }

    async fetchJson(path) {
      let response;
      try {
        response = await fetch(path, { cache: "no-cache" });
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
