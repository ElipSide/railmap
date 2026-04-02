import React, { useState } from "react";
import { formatNum, formatTons } from "../lib/format";

const BUCKET_LABELS = {
  0: "< 100 т",
  1: "100 – 500 т",
  2: "500 – 1 000 т",
  3: "1 000 – 10 000 т",
  4: "> 10 000 т",
};

const MODE_LABELS = {
  road_only: "Авто",
  rail_only: "Ж/д",
  multimodal: "Ж/д + авто",
};

export default function DeclarationResultsPanel({
  declarationResult,
  selectedDeclarationId,
  onSelectDeclaration,
  declarationRouteResult,
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

  if (!declarationResult) return null;

  const items = Array.isArray(declarationResult.items) ? declarationResult.items : [];
  const selected =
    items.find((item) => String(item.declaration_id) === String(selectedDeclarationId)) ||
    items[0] ||
    null;
  const routeMode = declarationRouteResult?.route?.selected_mode || null;

  return (
    <aside className={`floating-panel result-panel ${isCollapsed ? "is-collapsed" : ""}`}>
      <div className="panel-header panel-header--sticky">
        <div className="panel-title-wrap">
          <div className="badge-row" style={{ marginBottom: 8 }}>
            <span className="badge badge--primary">Декларации</span>
            <span className="badge">{formatNum(declarationResult.total_count || items.length)} найдено</span>
          </div>
          <h3 className="panel-title panel-title--lg">{declarationResult.product || "Все продукты"}</h3>
          <div className="panel-subtitle">Список найденных деклараций и детали по выбранной записи.</div>
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
                <div className="metric-label">Найдено</div>
                <div className="metric-value">{formatNum(declarationResult.total_count || items.length)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Минимальный объём</div>
                <div className="metric-value">
                  {declarationResult.min_volume_tons != null && Number(declarationResult.min_volume_tons) > 0
                    ? formatTons(declarationResult.min_volume_tons)
                    : "—"}
                </div>
              </div>
            </div>

            {(declarationResult.date_from || declarationResult.date_to) && (
              <div className="selection-card">
                <div className="selection-card-line">
                  Период: <b>{declarationResult.date_from || "…"}</b> → <b>{declarationResult.date_to || "…"}</b>
                </div>
              </div>
            )}
          </section>

          {selected && (
            <section className="panel-section">
              <div>
                <h3 className="section-title">Выбранная декларация</h3>
                <div className="section-subtitle">Ключевые данные по активной записи.</div>
              </div>

              <div className="result-detail-card">
                <div className="result-detail-title">{selected.product || "Декларация"}</div>
                <div className="result-detail-text">
                  <div className="meta-line"><b>Компания:</b> {selected.declarer || "(без названия)"}</div>
                  {selected.region && <div className="meta-line"><b>Регион:</b> {selected.region}</div>}
                  <div className="meta-line"><b>Объём:</b> {formatTons(selected.volume_tons)}</div>
                  {selected.publication_date && <div className="meta-line"><b>Дата публикации:</b> {selected.publication_date}</div>}
                  {selected.volume_bucket_idx != null && <div className="meta-line"><b>Категория:</b> {BUCKET_LABELS[selected.volume_bucket_idx] || "—"}</div>}
                </div>
              </div>
            </section>
          )}

          {declarationRouteResult && (
            <section className="panel-section">
              <div>
                <h3 className="section-title">Маршрут от декларации</h3>
                <div className="section-subtitle">Появляется после выбора точки назначения на карте.</div>
              </div>

              <div className="data-card">
                <div className="compact-grid">
                  <div className="metric-card">
                    <div className="metric-label">Режим</div>
                    <div className="metric-value">
                      {MODE_LABELS[declarationRouteResult.route?.selected_mode] || declarationRouteResult.route?.selected_mode || "—"}
                    </div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Итого</div>
                    <div className="metric-value">{formatNum(declarationRouteResult.route?.total_route_km)} км</div>
                  </div>
                </div>

                <div className="result-detail-text">
                  {routeMode === "road_only" ? (
                    <div className="meta-line"><b>Авто:</b> {formatNum(declarationRouteResult.route?.total_route_km)} км</div>
                  ) : routeMode === "rail_only" ? (
                    <div className="meta-line"><b>Ж/д:</b> {formatNum(declarationRouteResult.route?.rail_km)} км</div>
                  ) : (
                    <div className="meta-line">
                      <b>Авто до станции:</b> {formatNum(declarationRouteResult.route?.road_start_km)} км · <b>Ж/д:</b> {formatNum(declarationRouteResult.route?.rail_km)} км · <b>Авто до точки:</b> {formatNum(declarationRouteResult.route?.road_end_km)} км
                    </div>
                  )}
                  {declarationRouteResult.origin_station?.name && <div className="meta-line"><b>Станция отправления:</b> {declarationRouteResult.origin_station.name}</div>}
                  {declarationRouteResult.destination_station?.name && <div className="meta-line"><b>Станция прибытия:</b> {declarationRouteResult.destination_station.name}</div>}
                  {declarationRouteResult.destination?.name && <div className="meta-line"><b>Точка назначения:</b> {declarationRouteResult.destination.name}</div>}
                </div>
              </div>
            </section>
          )}

         
        </div>
      </div>
    </aside>
  );
}
