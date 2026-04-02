import React, { useState } from "react";

export default function RouteInfoPanel({ routeInfo, collapsed, onCollapsedChange }) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isControlled = typeof collapsed === "boolean";
  const isCollapsed = isControlled ? collapsed : internalCollapsed;
  const setCollapsed = (next) => {
    if (!isControlled) setInternalCollapsed(next);
    onCollapsedChange?.(next);
  };

  if (!routeInfo) return null;

  return (
    <aside className={`floating-panel result-panel result-panel--narrow ${isCollapsed ? "is-collapsed" : ""}`}>
      <div className="panel-header panel-header--sticky">
        <div className="panel-title-wrap">
          <div className="badge-row" style={{ marginBottom: 8 }}>
            <span className="badge badge--primary">Станция → станция</span>
            <span className="badge">{routeInfo.stations.length} станций</span>
          </div>
          <h3 className="panel-title panel-title--lg">Маршрут {routeInfo.km} км</h3>
          <div className="panel-subtitle">Чистый список станций по рассчитанному маршруту.</div>
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
              <div className="metric-card"><div className="metric-label">Расстояние</div><div className="metric-value">{routeInfo.km} км</div></div>
              <div className="metric-card"><div className="metric-label">Станций</div><div className="metric-value">{routeInfo.stations.length}</div></div>
            </div>
          </section>

          <section className="panel-section">
            <div>
              <h3 className="section-title">Последовательность станций</h3>
              <div className="section-subtitle">Весь путь в читабельной таблице.</div>
            </div>
            <div className="table-wrap">
              <table className="table" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>№</th>
                    <th>Станция</th>
                  </tr>
                </thead>
                <tbody>
                  {routeInfo.stations.map((s) => (
                    <tr key={s.osm_id}>
                      <td>{s.index}</td>
                      <td>{s.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </aside>
  );
}
