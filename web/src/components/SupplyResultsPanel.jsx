import React from "react";
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
}) {
  if (!supplyResult) return null;

  const selectedOption = supplyResult.options.find(
    (x) => x.option_no === selectedOptionNo
  );

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
        width: 560,
        maxHeight: "60vh",
        overflow: "auto",
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 8 }}>
        Варианты доставки: {supplyResult.product}
      </div>

      <div style={{ fontSize: 13, marginBottom: 8, color: "#444", lineHeight: 1.45 }}>
        <div>
          Конечный пункт: <b>{supplyResult.destination?.name || "—"}</b>
        </div>
        <div>
          Станция прибытия: <b>{supplyResult.arrival_station?.name || "—"}</b>
        </div>
        <div>
          Режим поиска: <b>{SEARCH_MODE_LABELS[supplyResult.search_mode] || supplyResult.search_mode || "—"}</b>
        </div>
        <div>
          Объём: <b>{formatTons(Number(needVolumeTons || supplyResult.need_volume_tons || 0))}</b>
        </div>
      </div>

      {Array.isArray(supplyResult.notices) && supplyResult.notices.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
          {supplyResult.notices.map((notice, idx) => (
            <div
              key={`${notice.code || notice.type || "notice"}-${idx}`}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                background: notice.type === "warning" ? "#fff7ed" : "#f3f4f6",
                border: "1px solid rgba(0,0,0,0.08)",
                color: "#222",
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {notice.type === "warning" ? "Обрати внимание" : "Подсказка"}
              </div>
              <div>{notice.text}</div>
              {Array.isArray(notice.examples) && notice.examples.length > 0 && (
                <div style={{ marginTop: 4, fontSize: 12, color: "#555" }}>
                  Например: {notice.examples.join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {supplyResult.options.map((opt) => (
          <button
            key={opt.option_no}
            onClick={() => onSelectOption(opt.option_no)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid rgba(0,0,0,0.15)",
              background: selectedOptionNo === opt.option_no ? "#111" : "white",
              color: selectedOptionNo === opt.option_no ? "#fff" : "#111",
              cursor: "pointer",
            }}
          >
            {`Вариант ${opt.option_no} · ${opt.sources_count} ист.`}
          </button>
        ))}
      </div>

      {!selectedOption ? (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            background: "#f9fafb",
            border: "1px solid rgba(0,0,0,0.08)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>
            {supplyResult.empty_state_reason || "Нет вариантов"}
          </div>
          <div style={{ color: "#555" }}>
            {supplyResult.empty_state_details || "Это означает, что для выбранного режима среди найденных поставщиков не удалось собрать подходящий маршрут."}
          </div>
          {supplyResult.search_radius_km != null && (
            <div style={{ marginTop: 6, color: "#666" }}>
              Проверенный радиус поиска: {formatNum(supplyResult.search_radius_km)} км.
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 8, fontSize: 13, lineHeight: 1.45 }}>
            <div>
              <b>Источников:</b> {selectedOption.sources_count}
            </div>
            <div>
              <b>Суммарно везём:</b> {formatTons(selectedOption.total_shipped_volume_tons)}
            </div>
            <div>
              <b>Авто до станции:</b> {formatNum(selectedOption.total_road_start_km)} км
              {" · "}
              <b>Ж/д:</b> {formatNum(selectedOption.total_rail_km)} км
              {" · "}
              <b>Авто до точки:</b> {formatNum(selectedOption.total_road_end_km)} км
            </div>
            <div>
              <b>Сумма плеч:</b> {formatNum(selectedOption.total_route_km)} км
              {" · "}
              <b>Score:</b> {formatNum(selectedOption.score)}
            </div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 4px", borderBottom: "1px solid #ddd" }}>
                  Поставщик и маршрут
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "6px 4px",
                    borderBottom: "1px solid #ddd",
                    width: 74,
                  }}
                >
                  Везём, т
                </th>
                <th style={{ textAlign: "right", padding: "6px 4px", borderBottom: "1px solid #ddd" }}>
                  Авто 1
                </th>
                <th style={{ textAlign: "right", padding: "6px 4px", borderBottom: "1px solid #ddd" }}>
                  Ж/д
                </th>
                <th style={{ textAlign: "right", padding: "6px 4px", borderBottom: "1px solid #ddd" }}>
                  Авто 2
                </th>
                <th style={{ textAlign: "right", padding: "6px 4px", borderBottom: "1px solid #ddd" }}>
                  Итого
                </th>
              </tr>
            </thead>
            <tbody>
              {selectedOption.sources
                .filter((s) => Number(s.shipped_volume_tons) > 0)
                .map((s, idx) => (
                  <tr key={`${s.declarer}-${idx}`}>
                    <td style={{ padding: "6px 4px", borderBottom: "1px solid #eee" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 700 }}>{s.declarer || "(без названия)"}</div>
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: "#f3f4f6",
                            color: "#111",
                            border: "1px solid rgba(0,0,0,0.08)",
                          }}
                        >
                          {RESULT_MODE_LABELS[s.transport_mode] || s.transport_mode || "Маршрут"}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "#555" }}>{s.region || ""}</div>
                      <div style={{ fontSize: 12, color: "#555" }}>
                        Станция отправления: {s.source_station?.name || "—"}
                      </div>
                      <div style={{ fontSize: 12, color: "#555" }}>
                        Станция прибытия: {s.demand_station?.name || "—"}
                      </div>
                      <div style={{ fontSize: 12, color: "#555" }}>
                        Конечный пункт: {supplyResult.destination?.name || "—"}
                      </div>
                    </td>

                    <td
                      style={{
                        padding: "6px 4px",
                        borderBottom: "1px solid #eee",
                        textAlign: "right",
                      }}
                    >
                      {formatNum(s.shipped_volume_tons)}
                    </td>

                    <td
                      style={{
                        padding: "6px 4px",
                        borderBottom: "1px solid #eee",
                        textAlign: "right",
                      }}
                    >
                      {formatNum(s.road_start_km)}
                    </td>

                    <td
                      style={{
                        padding: "6px 4px",
                        borderBottom: "1px solid #eee",
                        textAlign: "right",
                      }}
                    >
                      {formatNum(s.rail_km)}
                    </td>

                    <td
                      style={{
                        padding: "6px 4px",
                        borderBottom: "1px solid #eee",
                        textAlign: "right",
                      }}
                    >
                      {formatNum(s.road_end_km)}
                    </td>

                    <td
                      style={{
                        padding: "6px 4px",
                        borderBottom: "1px solid #eee",
                        textAlign: "right",
                        fontWeight: 700,
                      }}
                    >
                      {formatNum(s.total_route_km)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
