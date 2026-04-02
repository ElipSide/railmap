import React, { useState } from "react";
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
    const buyCity = item?.buy_signal?.city || item?.buy_signal?.anchor_name || "Покупка";
    const sellCity = item?.sell_signal?.city || item?.sell_signal?.anchor_name || "Продажа";
    return `${buyCity} → ${sellCity}`;
  }
  return item?.market_signal?.city || item?.market_signal?.anchor_name || item?.market_signal?.region || item?.explanation?.headline || "Направление";
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
  collapsed,
  onCollapsedChange,
}) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isControlled = typeof collapsed === "boolean";
  const isCollapsed = isControlled ? collapsed : internalCollapsed;
  const setCollapsed = (next) => {
    if (!isControlled) setInternalCollapsed(next);
    onCollapsedChange?.(next);
  };

  if (!recommendationResult) return null;

  const results = Array.isArray(recommendationResult.results) ? recommendationResult.results : [];
  const selected =
    results.find((x) => x._ui_id === selectedRecommendationId || x.id === selectedRecommendationId) || results[0] || null;

  return (
    <aside className={`floating-panel result-panel ${isCollapsed ? "is-collapsed" : ""}`}>
      <div className="panel-header panel-header--sticky">
        <div className="panel-title-wrap">
          <div className="badge-row" style={{ marginBottom: 8 }}>
            <span className="badge badge--primary">Рекомендации</span>
            <span className="badge">{results.length} вариантов</span>
          </div>
          <h3 className="panel-title panel-title--lg">{MODE_LABELS[recommendationResult.mode] || recommendationResult.mode} · {recommendationResult.product}</h3>
          <div className="panel-subtitle">Выбранный вариант, список альтернатив и рыночные сигналы в одной панели.</div>
        </div>
        <div className="panel-header-actions">
          <button type="button" className="icon-btn" onClick={() => setCollapsed(!isCollapsed)} aria-label={isCollapsed ? "Развернуть" : "Свернуть"}>
            {isCollapsed ? "↑" : "↓"}
          </button>
        </div>
      </div>

      <div className="panel-scroll">
        <div className="panel-stack">
          <section className="panel-section">
            <div className="metric-grid">
              <div className="metric-card"><div className="metric-label">Объём</div><div className="metric-value">{formatNum(recommendationResult.volume_tons)} т</div></div>
              <div className="metric-card"><div className="metric-label">Сигналов сопоставлено</div><div className="metric-value">{formatNum(recommendationResult.resolved_market_signals)} / {formatNum(recommendationResult.total_market_signals)}</div></div>
            </div>
            <div className="summary-pills">
              {recommendationResult.base_point?.name && <span className="summary-pill">Базовая точка: {recommendationResult.base_point.name}</span>}
              {Array.isArray(recommendationResult.unresolved_market_signals) && recommendationResult.unresolved_market_signals.length > 0 && (
                <span className="summary-pill">Не сопоставлены: {recommendationResult.unresolved_market_signals.map((x) => x.city || x.anchor_name || x.region).filter(Boolean).join(", ")}</span>
              )}
            </div>
          </section>

          <section className="panel-section">
            <div>
              <h3 className="section-title">Варианты</h3>
              <div className="section-subtitle">Переключение варианта сразу перестраивает отображение на карте.</div>
            </div>
            <div className="option-list">
              {results.map((item, index) => {
                const itemKey = item._ui_id || `${item.id ?? "rec"}-${index}`;
                const active = selected?._ui_id ? selected._ui_id === itemKey : selected?.id === item.id && index === 0;
                return (
                  <button key={itemKey} type="button" className={`option-card ${active ? "is-active" : ""}`} onClick={() => onSelectRecommendation(itemKey)}>
                    <div className="option-card-top">
                      <div>
                        <div className="option-card-title">{renderTitle(item)}</div>
                        <div className="option-card-meta">
                          <div>{renderLocation(item)}</div>
                          <div>Маршрут: {ROUTE_LABELS[item.route?.selected_mode] || item.route?.selected_mode || "—"}</div>
                        </div>
                      </div>
                      <span className="inline-chip inline-chip--primary">#{index + 1}</span>
                    </div>
                    <div className="option-card-meta">
                      <div>Рейтинг: {formatNum(item.score)}</div>
                      <div>Длина: {formatNum(item.route?.total_route_km)} км</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {!selected ? (
            <section className="panel-section"><div className="empty-state">Нет выбранной рекомендации.</div></section>
          ) : (
            <>
              <section className="panel-section">
                <div>
                  <h3 className="section-title">Выбранный вариант</h3>
                  <div className="section-subtitle">Детали по активному направлению и его логике.</div>
                </div>
                <div className="result-detail-card">
                  <div className="result-detail-title">{renderTitle(selected)}</div>
                  <div className="result-detail-text">
                    <div className="meta-line"><b>Локация:</b> {renderLocation(selected)}</div>
                    <div className="meta-line"><b>Маршрут:</b> {ROUTE_LABELS[selected.route?.selected_mode] || selected.route?.selected_mode || "—"}</div>
                    <div className="meta-line"><b>Длина:</b> {formatNum(selected.route?.total_route_km)} км</div>
                    <div className="meta-line"><b>Рейтинг:</b> {formatNum(selected.score)}</div>
                    {renderComment(selected) ? <div className="meta-line">{renderComment(selected)}</div> : null}
                  </div>
                </div>
              </section>

              {selected.market_signal && (
                <section className="panel-section">
                  <div>
                    <h3 className="section-title">Сигнал по рынку</h3>
                    <div className="section-subtitle">Ключевые числовые показатели текущего направления.</div>
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Рынок</th>
                          <th className="is-right">Сигнал</th>
                          <th className="is-right">Увер.</th>
                          <th className="is-right">Эдж, ₽/т</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>
                            <div style={{ fontWeight: 800, marginBottom: 6 }}>{selected.market_signal.city || selected.market_signal.anchor_name || "—"}</div>
                            <div className="result-list-meta">
                              <div>{selected.market_signal.region || ""}</div>
                              <div>{selected.market_signal.reason || ""}</div>
                            </div>
                          </td>
                          <td className="is-right">{formatNum(selected.market_signal.signal_score)}</td>
                          <td className="is-right">{formatNum(selected.market_signal.confidence)}</td>
                          <td className="is-right">{formatNum(selected.market_signal.price_edge_rub_per_ton)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {selected.type === "trader_pair" && (
                <section className="panel-section">
                  <div>
                    <h3 className="section-title">Связка трейдера</h3>
                    <div className="section-subtitle">Покупка и продажа разбиты на две стороны для быстрого сравнения.</div>
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Сторона</th>
                          <th>Рынок</th>
                          <th className="is-right">Сигнал</th>
                          <th className="is-right">Эдж, ₽/т</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[selected.buy_signal, selected.sell_signal].map((signal, idx) => (
                          <tr key={`${selected._ui_id || "pair"}-${idx}`}>
                            <td>{idx === 0 ? "Покупка" : "Продажа"}</td>
                            <td>
                              <div style={{ fontWeight: 800, marginBottom: 6 }}>{signal?.city || signal?.anchor_name || "—"}</div>
                              <div className="result-list-meta">
                                <div>{signal?.region || ""}</div>
                                <div>{signal?.reason || ""}</div>
                              </div>
                            </td>
                            <td className="is-right">{formatNum(signal?.signal_score)}</td>
                            <td className="is-right">{formatNum(signal?.price_edge_rub_per_ton)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
