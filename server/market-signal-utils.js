export const RECOMMENDATION_MODE_SELL = "sell";
export const RECOMMENDATION_MODE_BUY = "buy";
export const RECOMMENDATION_MODE_TRADER = "trader";

export const ROUTE_PREF_BEST = "best";
export const ROUTE_PREF_ROAD = "road";
export const ROUTE_PREF_RAIL = "rail";
export const ROUTE_PREF_MULTIMODAL = "multimodal";

export function asNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeRecommendationMode(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === RECOMMENDATION_MODE_BUY || v === RECOMMENDATION_MODE_TRADER) {
    return v;
  }
  return RECOMMENDATION_MODE_SELL;
}

export function normalizeRoutePreferenceMode(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === ROUTE_PREF_ROAD || v === ROUTE_PREF_RAIL || v === ROUTE_PREF_MULTIMODAL) {
    return v;
  }
  return ROUTE_PREF_BEST;
}

export function normalizeMarketRole(value, fallbackMode = RECOMMENDATION_MODE_SELL) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "buy" || v === "sell") {
    return v;
  }
  return fallbackMode === RECOMMENDATION_MODE_BUY ? "buy" : "sell";
}

export function pickPreferredPointType(signal) {
  const raw = `${signal?.market_type || ""} ${signal?.anchor_name || ""}`.toLowerCase();
  if (raw.includes("порт") || raw.includes("port") || raw.includes("export")) {
    return "port";
  }
  if (raw.includes("элеватор") || raw.includes("elevator") || raw.includes("mill") || raw.includes("processor") || raw.includes("переработ")) {
    return "elevator";
  }
  return "station";
}

export function signalDisplayName(signal) {
  return String(
    signal?.anchor_name || signal?.city || signal?.region || "Рынок"
  ).trim();
}

export function normalizeMarketSignals(input) {
  const arr = Array.isArray(input) ? input : [];

  return arr
    .map((item) => {
      const region = String(item?.region || "").trim();
      const city = String(item?.city || "").trim();

      const roleRaw = String(item?.role || "").trim().toLowerCase();
      const role =
        roleRaw === "buy" || roleRaw === "sell" ? roleRaw : "sell";

      const marketTypeRaw = String(item?.market_type || "city").trim().toLowerCase();
      const marketType = marketTypeRaw || "city";

      const signalScore = Number(item?.signal_score || 0);
      const confidence = Number(item?.confidence || 0);
      const priceEdgeRubPerTon = Number(item?.price_edge_rub_per_ton || 0);
      const priceEdgePct = Number(item?.price_edge_pct || 0);
      const timeHorizon = String(item?.time_horizon || "").trim() || "1-2 weeks";
      const reason = String(item?.reason || "").trim();

      if (!region || !city) return null;

      return {
        region,
        city,
        market_type: marketType,
        role,
        signal_score: Number.isFinite(signalScore) ? signalScore : 0,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        price_edge_rub_per_ton: Number.isFinite(priceEdgeRubPerTon) ? priceEdgeRubPerTon : 0,
        price_edge_pct: Number.isFinite(priceEdgePct) ? priceEdgePct : 0,
        time_horizon: timeHorizon,
        reason,

        // для совместимости с текущим кодом
        anchor_name: city,
      };
    })
    .filter(Boolean);
}