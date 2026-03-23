import React from "react";

export default function RouteInfoPanel({ routeInfo }) {
  if (!routeInfo) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 10,
        padding: 10,
        background: "rgba(255,255,255,0.92)",
        borderRadius: 10,
        boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        width: 320,
        maxHeight: "34vh",
        overflow: "auto",
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 6 }}>
        Маршрут станция-станция ({routeInfo.km} км)
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "6px 4px", borderBottom: "1px solid #ddd" }}>
              №
            </th>
            <th style={{ textAlign: "left", padding: "6px 4px", borderBottom: "1px solid #ddd" }}>
              Станция
            </th>
          </tr>
        </thead>
        <tbody>
          {routeInfo.stations.map((s) => (
            <tr key={s.osm_id}>
              <td style={{ padding: "6px 4px", borderBottom: "1px solid #eee", width: 32 }}>
                {s.index}
              </td>
              <td style={{ padding: "6px 4px", borderBottom: "1px solid #eee" }}>{s.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}