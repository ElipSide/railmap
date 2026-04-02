import React, { useState } from "react";
import { formatNum, formatTons } from "../lib/format";

const SEARCH_MODE_LABELS = {
  rail: "Ж/д без авто",
  road: "Авто",
  multimodal: "Ж/д + авто",
};

const RESULT_MODE_LABELS = {
  road_only: "Авто",
  rail_only: "Ж/д",
  multimodal: "Ж/д + авто",
};

export default function SupplyResultsPanel({
  supplyResult,
  selectedOptionNo,
  onSelectOption,
  needVolumeTons,
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

  if (!supplyResult) return null;

  const selectedOption = supplyResult.options.find((x) => x.option_no === selectedOptionNo);

  return (
    <aside className={`floating-panel result-panel ${isCollapsed ? "is-collapsed" : ""}`}>
      <div className="panel-header panel-header--sticky">
        <div className="panel-title-wrap">
          <div className="badge-row" style={{ marginBottom: 8 }}>
            <span className="badge badge--primary">Поставка</span>
            <span className="badge">{selectedOption ? `Вариант ${selectedOption.option_no}` : "Нет активного варианта"}</span>
          </div>
          <h3 className="panel-title panel-title--lg">Варианты доставки: {supplyResult.product}</h3>
          <div className="panel-subtitle">Компактный обзор, выбранный вариант и таблица источников.</div>
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
              <div className="metric-card">
                <div className="metric-label">Конечный пункт</div>
                <div className="metric-value">{supplyResult.destination?.name || "—"}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Станция прибытия</div>
                <div className="metric-value">{supplyResult.arrival_station?.name || "—"}</div>
              </div>
            </div>
            <div className="summary-pills">
              <span className="summary-pill">Режим: {SEARCH_MODE_LABELS[supplyResult.search_mode] || supplyResult.search_mode || "—"}</span>
              <span className="summary-pill">Объём: {formatTons(Number(needVolumeTons || supplyResult.need_volume_tons || 0))}</span>
            </div>
          </section>

          {Array.isArray(supplyResult.notices) && supplyResult.notices.length > 0 && (
            <section className="panel-section">
              <div>
                <h3 className="section-title">Подсказки и замечания</h3>
                <div className="section-subtitle">Система объясняет ограничения и спорные моменты маршрута.</div>
              </div>
              <div className="panel-stack">
                {supplyResult.notices.map((notice, idx) => (
                  <div key={`${notice.code || notice.type || "notice"}-${idx}`} className={`notice-card ${notice.type === "warning" ? "notice-card--warning" : ""}`}>
                    <div className="notice-card-title">{notice.type === "warning" ? "Обрати внимание" : "Подсказка"}</div>
                    <div className="meta-line">{notice.text}</div>
                    {Array.isArray(notice.examples) && notice.examples.length > 0 && (
                      <div className="table-note">Например: {notice.examples.join(", ")}</div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="panel-section">
            <div>
              <h3 className="section-title">Варианты</h3>
              <div className="section-subtitle">Выбери лучший вариант, и карта сразу обновит отображение маршрутов.</div>
            </div>
            <div className="option-list">
              {supplyResult.options.map((opt) => (
                <button key={opt.option_no} type="button" className={`option-card ${selectedOptionNo === opt.option_no ? "is-active" : ""}`} onClick={() => onSelectOption(opt.option_no)}>
                  <div className="option-card-top">
                    <div>
                      <div className="option-card-title">Вариант {opt.option_no}</div>
                      <div className="option-card-meta">
                        <div>{opt.sources_count} источников</div>
                        <div>Score: {formatNum(opt.score)}</div>
                      </div>
                    </div>
                    <span className="inline-chip inline-chip--primary">{formatTons(opt.total_shipped_volume_tons)}</span>
                  </div>
                  <div className="option-card-meta">
                    <div>Авто 1: {formatNum(opt.total_road_start_km)} км · Ж/д: {formatNum(opt.total_rail_km)} км · Авто 2: {formatNum(opt.total_road_end_km)} км</div>
                    <div>Сумма плеч: {formatNum(opt.total_route_km)} км</div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {!selectedOption ? (
            <section className="panel-section">
              <div className="empty-card">
                <div className="empty-card-title">{supplyResult.empty_state_reason || "Нет вариантов"}</div>
                <div className="empty-card-text">{supplyResult.empty_state_details || "Для выбранного режима не удалось собрать подходящий маршрут среди найденных поставщиков."}</div>
                {supplyResult.search_radius_km != null && <div className="table-note">Проверенный радиус поиска: {formatNum(supplyResult.search_radius_km)} км.</div>}
              </div>
            </section>
          ) : (
            <>
              <section className="panel-section">
                <div>
                  <h3 className="section-title">Выбранный вариант</h3>
                  <div className="section-subtitle">Основные итоги по активному варианту доставки.</div>
                </div>
                <div className="metric-grid">
                  <div className="metric-card"><div className="metric-label">Источников</div><div className="metric-value">{selectedOption.sources_count}</div></div>
                  <div className="metric-card"><div className="metric-label">Суммарно везём</div><div className="metric-value">{formatTons(selectedOption.total_shipped_volume_tons)}</div></div>
                  <div className="metric-card"><div className="metric-label">Сумма плеч</div><div className="metric-value">{formatNum(selectedOption.total_route_km)} км</div></div>
                  <div className="metric-card"><div className="metric-label">Score</div><div className="metric-value">{formatNum(selectedOption.score)}</div></div>
                </div>
              </section>

              <section className="panel-section">
                <div>
                  <h3 className="section-title">Источники внутри варианта</h3>
                  <div className="section-subtitle">Сначала поставщик и режим, затем все плечи маршрута.</div>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Поставщик и маршрут</th>
                        <th className="is-right">Везём, т</th>
                        <th className="is-right">Авто 1</th>
                        <th className="is-right">Ж/д</th>
                        <th className="is-right">Авто 2</th>
                        <th className="is-right">Итого</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOption.sources.filter((s) => Number(s.shipped_volume_tons) > 0).map((s, idx) => (
                        <tr key={`${s.declarer}-${idx}`}>
                          <td>
                            <div style={{ fontWeight: 800, marginBottom: 6 }}>{s.declarer || "(без названия)"}</div>
                            <div className="result-list-meta">
                              <div><span className="inline-chip">{RESULT_MODE_LABELS[s.transport_mode] || s.transport_mode || "Маршрут"}</span></div>
                              <div>{s.region || ""}</div>
                              <div>Станция отправления: {s.source_station?.name || "—"}</div>
                              <div>Станция прибытия: {s.demand_station?.name || "—"}</div>
                              <div>Конечный пункт: {supplyResult.destination?.name || "—"}</div>
                            </div>
                          </td>
                          <td className="is-right">{formatNum(s.shipped_volume_tons)}</td>
                          <td className="is-right">{formatNum(s.road_start_km)}</td>
                          <td className="is-right">{formatNum(s.rail_km)}</td>
                          <td className="is-right">{formatNum(s.road_end_km)}</td>
                          <td className="is-right"><b>{formatNum(s.total_route_km)}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
