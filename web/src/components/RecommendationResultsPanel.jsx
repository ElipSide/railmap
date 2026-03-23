import React from "react";
import { formatNum } from "../lib/format";

const MODE_LABELS = {
  sell: "Куда продать",
  buy: "Откуда купить",
  trader: "Трейдер",
};

const ROUTE_LABELS = {
  road_only: "Авто",
  rail_only: "Ж/д",
  multimodal: "Ж/д + авто",
};

function renderTitle(item) {
  if (item?.type === "trader_pair") {
    const buyCity =
      item?.buy_signal?.city || item?.buy_signal?.anchor_name || "Покупка";
    const sellCity =
      item?.sell_signal?.city || item?.sell_signal?.anchor_name || "Продажа";
    return `${buyCity} → ${sellCity}`;
  }

  return (
    item?.market_signal?.city ||
    item?.market_signal?.anchor_name ||
    item?.market_signal?.region ||
    item?.explanation?.headline ||
    "Направление"
  );
}

function renderLocation(item) {
  if (item?.type === "trader_pair") {
    const buyRegion = item?.buy_signal?.region ? `, ${item.buy_signal.region}` : "";
    const sellRegion = item?.sell_signal?.region ? `, ${item.sell_signal.region}` : "";
    const buyCity = item?.buy_signal?.city || item?.buy_signal?.anchor_name || "Покупка";
    const sellCity = item?.sell_signal?.city || item?.sell_signal?.anchor_name || "Продажа";
    return `${buyCity}${buyRegion} → ${sellCity}${sellRegion}`;
  }

  const city = item?.market_signal?.city || item?.market_signal?.anchor_name || "—";
  const region = item?.market_signal?.region ? `, ${item.market_signal.region}` : "";
  return `${city}${region}`;
}

function renderComment(item) {
  if (item?.type === "trader_pair") {
    const buyReason = item?.buy_signal?.reason || "";
    const sellReason = item?.sell_signal?.reason || "";
    return [buyReason, sellReason].filter(Boolean).join(" • ");
  }

  return item?.market_signal?.reason || item?.explanation?.comment || "";
}

export default function RecommendationResultsPanel({
  recommendationResult,
  selectedRecommendationId,
  onSelectRecommendation,
}) {
  if (!recommendationResult) return null;

  const results = Array.isArray(recommendationResult.results)
    ? recommendationResult.results
    : [];

  const selected =
    results.find((x) => x._ui_id === selectedRecommendationId || x.id === selectedRecommendationId) ||
    results[0] ||
    null;

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 10,
        padding: 12,
        background: "rgba(255,255,255,0.95)",
        borderRadius: 12,
        boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        width: 620,
        maxHeight: "60vh",
        overflow: "auto",
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 16 }}>
        Рекомендации: {MODE_LABELS[recommendationResult.mode] || recommendationResult.mode} · {recommendationResult.product}
      </div>

      <div style={{ fontSize: 13, color: "#444", marginBottom: 12, lineHeight: 1.45 }}>
        <div>
          Объём: <b>{formatNum(recommendationResult.volume_tons)} т</b>
        </div>
        {recommendationResult.base_point?.name && (
          <div>
            Базовая точка: <b>{recommendationResult.base_point.name}</b>
          </div>
        )}
        <div>
          Разрешено сигналов: <b>{recommendationResult.resolved_market_signals}</b> из {recommendationResult.total_market_signals}
        </div>
        {Array.isArray(recommendationResult.unresolved_market_signals) &&
          recommendationResult.unresolved_market_signals.length > 0 && (
            <div>
              Не удалось сопоставить:{" "}
              <b>
                {recommendationResult.unresolved_market_signals
                  .map((x) => x.city || x.anchor_name || x.region)
                  .filter(Boolean)
                  .join(", ")}
              </b>
            </div>
          )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Варианты</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {results.map((item, index) => {
            const itemKey = item._ui_id || `${item.id ?? "rec"}-${index}`;
            const active = selected?._ui_id
              ? selected._ui_id === itemKey
              : selected?.id === item.id && index === 0;
            return (
              <button
                key={itemKey}
                onClick={() => onSelectRecommendation(itemKey)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: active
                    ? "1px solid rgba(0,0,0,0.9)"
                    : "1px solid rgba(0,0,0,0.15)",
                  background: active ? "#111" : "#fff",
                  color: active ? "#fff" : "#111",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Вариант {index + 1}
              </button>
            );
          })}
        </div>
      </div>

      {!selected ? (
        <div style={{ color: "#666", fontSize: 13 }}>Нет выбранной рекомендации.</div>
      ) : (
        <>
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              background: "#f9fafb",
              border: "1px solid rgba(0,0,0,0.08)",
              marginBottom: 12,
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 24 }}>
              {renderTitle(selected)}
            </div>

            <div style={{ fontSize: 14, color: "#333", lineHeight: 1.5 }}>
              <div style={{ marginBottom: 4 }}>
                <b>Локация:</b> {renderLocation(selected)}
              </div>
              <div style={{ marginBottom: 4 }}>
                <b>Маршрут:</b>{" "}
                {ROUTE_LABELS[selected.route?.selected_mode] ||
                  selected.route?.selected_mode ||
                  "—"}
              </div>
              <div style={{ marginBottom: 4 }}>
                <b>Длина маршрута:</b> {formatNum(selected.route?.total_route_km)} км
              </div>
              <div style={{ marginBottom: 4 }}>
                <b>Рейтинг:</b> {formatNum(selected.score)}
              </div>
              {renderComment(selected) ? (
                <div style={{ marginTop: 8 }}>{renderComment(selected)}</div>
              ) : null}
            </div>
          </div>

          {selected.market_signal && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thLeft}>Рынок</th>
                  <th style={thRight}>Сигнал</th>
                  <th style={thRight}>Увер.</th>
                  <th style={thRight}>Эдж, ₽/т</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={tdLeft}>
                    <div style={{ fontWeight: 700 }}>
                      {selected.market_signal.city ||
                        selected.market_signal.anchor_name ||
                        "—"}
                    </div>
                    <div style={{ color: "#555" }}>
                      {selected.market_signal.region || ""}
                    </div>
                    <div style={{ color: "#555" }}>
                      {selected.market_signal.reason || ""}
                    </div>
                  </td>
                  <td style={tdRight}>
                    {formatNum(selected.market_signal.signal_score)}
                  </td>
                  <td style={tdRight}>
                    {formatNum(selected.market_signal.confidence)}
                  </td>
                  <td style={tdRight}>
                    {formatNum(selected.market_signal.price_edge_rub_per_ton)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}

          {selected.type === "trader_pair" && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thLeft}>Сторона</th>
                  <th style={thLeft}>Рынок</th>
                  <th style={thRight}>Сигнал</th>
                  <th style={thRight}>Эдж, ₽/т</th>
                </tr>
              </thead>
              <tbody>
                {[selected.buy_signal, selected.sell_signal].map((signal, idx) => (
                  <tr key={`${selected._ui_id || "pair"}-${idx}`}>
                    <td style={tdLeft}>{idx === 0 ? "Покупка" : "Продажа"}</td>
                    <td style={tdLeft}>
                      <div style={{ fontWeight: 700 }}>
                        {signal?.city || signal?.anchor_name || "—"}
                      </div>
                      <div style={{ color: "#555" }}>{signal?.region || ""}</div>
                      <div style={{ color: "#555" }}>{signal?.reason || ""}</div>
                    </td>
                    <td style={tdRight}>{formatNum(signal?.signal_score)}</td>
                    <td style={tdRight}>
                      {formatNum(signal?.price_edge_rub_per_ton)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

const thLeft = {
  textAlign: "left",
  padding: "6px 4px",
  borderBottom: "1px solid #ddd",
};

const thRight = {
  textAlign: "right",
  padding: "6px 4px",
  borderBottom: "1px solid #ddd",
};

const tdLeft = {
  padding: "6px 4px",
  borderBottom: "1px solid #eee",
  verticalAlign: "top",
};

const tdRight = {
  padding: "6px 4px",
  borderBottom: "1px solid #eee",
  textAlign: "right",
  verticalAlign: "top",
};
