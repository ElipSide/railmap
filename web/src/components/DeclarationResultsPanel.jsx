import React from "react";
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
}) {
  if (!declarationResult) return null;

  const items = Array.isArray(declarationResult.items) ? declarationResult.items : [];
  const selected =
    items.find((item) => String(item.declaration_id) === String(selectedDeclarationId)) ||
    items[0] ||
    null;
  const routeMode = declarationRouteResult?.route?.selected_mode || null;

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
        width: 560,
        maxHeight: "70vh",
        overflow: "auto",
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 16 }}>
        Декларации: {declarationResult.product || "Все продукты"}
      </div>

      <div style={{ fontSize: 13, color: "#444", marginBottom: 12, lineHeight: 1.45 }}>
        <div>
          Найдено: <b>{formatNum(declarationResult.total_count || items.length)}</b>
        </div>
        {declarationResult.min_volume_tons != null && Number(declarationResult.min_volume_tons) > 0 && (
          <div>
            Объём от: <b>{formatTons(declarationResult.min_volume_tons)}</b>
          </div>
        )}
        {(declarationResult.date_from || declarationResult.date_to) && (
          <div>
            Период: <b>{declarationResult.date_from || "…"}</b> —{" "}
            <b>{declarationResult.date_to || "…"}</b>
          </div>
        )}
      </div>

      {selected && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            background: "#f9fafb",
            border: "1px solid rgba(0,0,0,0.08)",
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 22 }}>
            {selected.product || "Декларация"}
          </div>

          <div style={{ fontSize: 14, color: "#333", lineHeight: 1.5 }}>
            <div style={{ marginBottom: 4 }}>
              <b>Компания:</b> {selected.declarer || "(без названия)"}
            </div>
            {selected.region && (
              <div style={{ marginBottom: 4 }}>
                <b>Регион:</b> {selected.region}
              </div>
            )}
            <div style={{ marginBottom: 4 }}>
              <b>Объём:</b> {formatTons(selected.volume_tons)}
            </div>
            {selected.publication_date && (
              <div style={{ marginBottom: 4 }}>
                <b>Дата публикации:</b> {selected.publication_date}
              </div>
            )}
            {selected.volume_bucket_idx != null && (
              <div style={{ marginBottom: 4 }}>
                <b>Категория:</b> {BUCKET_LABELS[selected.volume_bucket_idx] || "—"}
              </div>
            )}
          </div>
        </div>
      )}

      {declarationRouteResult && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            background: "#eff6ff",
            border: "1px solid rgba(37,99,235,0.15)",
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 16 }}>
            Маршрут от декларации
          </div>

          <div style={{ fontSize: 13, color: "#1f2937", lineHeight: 1.5 }}>
            <div>
              <b>Режим:</b>{" "}
              {MODE_LABELS[declarationRouteResult.route?.selected_mode] ||
                declarationRouteResult.route?.selected_mode ||
                "—"}
            </div>
            <div>
              <b>Итого:</b> {formatNum(declarationRouteResult.route?.total_route_km)} км
            </div>
            {routeMode === "road_only" ? (
              <div>
                <b>Авто:</b> {formatNum(declarationRouteResult.route?.total_route_km)} км
              </div>
            ) : routeMode === "rail_only" ? (
              <div>
                <b>Ж/д:</b> {formatNum(declarationRouteResult.route?.rail_km)} км
              </div>
            ) : (
              <div>
                <b>Авто до станции:</b> {formatNum(declarationRouteResult.route?.road_start_km)} км
                {" · "}
                <b>Ж/д:</b> {formatNum(declarationRouteResult.route?.rail_km)} км
                {" · "}
                <b>Авто до точки:</b> {formatNum(declarationRouteResult.route?.road_end_km)} км
              </div>
            )}
            {declarationRouteResult.origin_station?.name && (
              <div>
                <b>Станция отправления:</b> {declarationRouteResult.origin_station.name}
              </div>
            )}
            {declarationRouteResult.destination_station?.name && (
              <div>
                <b>Станция прибытия:</b> {declarationRouteResult.destination_station.name}
              </div>
            )}
            {declarationRouteResult.destination?.name && (
              <div>
                <b>Точка назначения:</b> {declarationRouteResult.destination.name}
              </div>
            )}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div style={{ color: "#666", fontSize: 13 }}>Ничего не найдено.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {items.slice(0, 100).map((item) => {
            const active = String(item.declaration_id) === String(selectedDeclarationId);
            return (
              <button
                key={item.declaration_id}
                type="button"
                onClick={() => onSelectDeclaration(item.declaration_id)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: active
                    ? "1px solid rgba(0,0,0,0.9)"
                    : "1px solid rgba(0,0,0,0.12)",
                  background: active ? "#111" : "#fff",
                  color: active ? "#fff" : "#111",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  {item.product || "Продукт"}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.45, opacity: active ? 0.92 : 0.8 }}>
                  <div>{item.declarer || "(без названия)"}</div>
                  {item.region && <div>{item.region}</div>}
                  <div>
                    {formatTons(item.volume_tons)}
                    {item.publication_date ? ` · ${item.publication_date}` : ""}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
