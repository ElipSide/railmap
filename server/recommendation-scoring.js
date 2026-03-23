function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normText(value) {
  return String(value || "").trim().toLowerCase();
}

export function buildRouteLogisticsMetrics(routeSummary, volumeTons) {
  const totalKm = Number(routeSummary?.total_route_km ?? 0);
  const roadKm = Number(routeSummary?.road_total_km ?? 0);
  const railKm = Number(routeSummary?.rail_km ?? 0);
  const tons = Math.max(1, Number(volumeTons || 1));

  const proxyRubPerTon = round2(roadKm * 2.0 + railKm * 0.75 + totalKm * 0.04);
  const proxyTotalRub = round2(proxyRubPerTon * tons);

  return {
    total_km: round2(totalKm),
    road_km: round2(roadKm),
    rail_km: round2(railKm),
    logistics_proxy_rub_per_ton: proxyRubPerTon,
    logistics_proxy_total_rub: proxyTotalRub,
  };
}

function transportBonus(routeSummary) {
  const mode = String(routeSummary?.selected_mode || "").toLowerCase();
  if (mode === "road_only") return 10;
  if (mode === "rail_only") return 7;
  if (mode === "multimodal") return 5;
  return 0;
}

function confidenceBonus(signal) {
  return Number(signal?.confidence ?? 0) * 2.2;
}

function signalBonus(signal) {
  return Number(signal?.signal_score ?? 0) * 4.5;
}

function priceBonus(signal) {
  const rub = Number(signal?.price_edge_rub_per_ton ?? 0) / 250;
  const pct = Number(signal?.price_edge_pct ?? 0) * 2.5;
  return rub + pct;
}

function proximityBonus(routeSummary) {
  const totalKm = Number(routeSummary?.total_route_km ?? 0);

  if (totalKm <= 120) return 28;
  if (totalKm <= 250) return 22;
  if (totalKm <= 400) return 16;
  if (totalKm <= 700) return 10;
  if (totalKm <= 1000) return 4;
  return 0;
}

function logisticsPenalty(logistics) {
  const totalKm = Number(logistics?.total_km ?? 0);
  const roadKm = Number(logistics?.road_km ?? 0);
  const railKm = Number(logistics?.rail_km ?? 0);

  const penalty =
    totalKm / 70 +
    roadKm / 45 +
    railKm / 140;

  return Math.min(38, round2(penalty));
}

function sameRegionBonus(basePoint, signal) {
  const baseRegion = normText(basePoint?.region);
  const signalRegion = normText(signal?.region);

  if (!baseRegion || !signalRegion) return 0;
  if (baseRegion === signalRegion) return 16;
  return 0;
}

function buildPositiveScore({
  signal,
  routeSummary,
  logistics,
  basePoint,
  edgeBonus = 0,
}) {
  const raw =
    18 +
    signalBonus(signal) +
    confidenceBonus(signal) +
    transportBonus(routeSummary) +
    proximityBonus(routeSummary) +
    sameRegionBonus(basePoint, signal) +
    edgeBonus -
    logisticsPenalty(logistics);

  return round2(clamp(raw, 0, 100));
}

export function scoreSellDirection({ signal, routeSummary, volumeTons, basePoint = null }) {
  const logistics = buildRouteLogisticsMetrics(routeSummary, volumeTons);
  const edgeBonus = Math.max(0, priceBonus(signal));

  const score = buildPositiveScore({
    signal,
    routeSummary,
    logistics,
    basePoint,
    edgeBonus,
  });

  return {
    score,
    logistics,
    summary: {
      headline: `Продажа в ${signal.city || signal.anchor_name || signal.region}`,
      comment: signal.reason || "Сильный локальный спрос",
    },
  };
}

export function scoreBuySource({ signal, routeSummary, volumeTons, basePoint = null }) {
  const logistics = buildRouteLogisticsMetrics(routeSummary, volumeTons);
  const discountBonus =
    Math.max(0, -Number(signal?.price_edge_rub_per_ton ?? 0) / 250) +
    Math.max(0, -Number(signal?.price_edge_pct ?? 0) * 2.5);

  const score = buildPositiveScore({
    signal,
    routeSummary,
    logistics,
    basePoint,
    edgeBonus: discountBonus,
  });

  return {
    score,
    logistics,
    summary: {
      headline: `Покупка из ${signal.city || signal.anchor_name || signal.region}`,
      comment: signal.reason || "Есть признаки избытка предложения",
    },
  };
}

export function scoreTraderOpportunity({ buySignal, sellSignal, routeSummary, volumeTons }) {
  const logistics = buildRouteLogisticsMetrics(routeSummary, volumeTons);

  const buyEdge = Number(buySignal?.price_edge_rub_per_ton ?? 0);
  const sellEdge = Number(sellSignal?.price_edge_rub_per_ton ?? 0);
  const grossEdgeRubPerTon = round2(Math.max(0, sellEdge - buyEdge));
  const netEdgeRubPerTon = round2(grossEdgeRubPerTon - logistics.logistics_proxy_rub_per_ton);

  const raw =
    15 +
    Number(buySignal?.signal_score ?? 0) * 3 +
    Number(sellSignal?.signal_score ?? 0) * 3 +
    Number(buySignal?.confidence ?? 0) * 1.5 +
    Number(sellSignal?.confidence ?? 0) * 1.5 +
    transportBonus(routeSummary) +
    proximityBonus(routeSummary) +
    Math.max(0, grossEdgeRubPerTon / 300) -
    logisticsPenalty(logistics);

  const score = round2(clamp(raw, 0, 100));

  return {
    score,
    logistics,
    margin_proxy: {
      gross_edge_rub_per_ton: grossEdgeRubPerTon,
      net_edge_rub_per_ton: netEdgeRubPerTon,
      gross_edge_total_rub: round2(grossEdgeRubPerTon * Number(volumeTons || 0)),
      net_edge_total_rub: round2(netEdgeRubPerTon * Number(volumeTons || 0)),
    },
    summary: {
      headline: `${buySignal.city || buySignal.anchor_name} → ${sellSignal.city || sellSignal.anchor_name}`,
      comment: `${buySignal.reason || "Зона покупки"}; ${sellSignal.reason || "Зона продажи"}`,
    },
  };
}

export function compareRankedResults(a, b) {
  if (Number(b?.score ?? 0) !== Number(a?.score ?? 0)) {
    return Number(b?.score ?? 0) - Number(a?.score ?? 0);
  }
  return Number(a?.route?.total_route_km ?? 0) - Number(b?.route?.total_route_km ?? 0);
}