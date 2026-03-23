import React from "react";

const SUPPLY_TRANSPORT_MODE_ITEMS = [
  {
    value: "rail",
    label: "Ж/д",
    description:
      "Ищем ближайших поставщиков к месту назначения, для каждого берём ближайшую станцию и строим только путь станция → станция. Если станции совпадают, рекомендуем режим «Авто».",
  },
  {
    value: "road",
    label: "Авто",
    description: "Только прямой автодорожный маршрут без железной дороги.",
  },
  {
    value: "multimodal",
    label: "Ж/д + авто",
    description:
      "Только мультимодальные маршруты, где используются и ж/д, и авто.",
  },
];

const RECOMMENDATION_MODE_ITEMS = [
  {
    value: "sell",
    label: "Куда продать",
    description: "Из вашей точки строим рейтинг направлений с высоким спросом.",
  },
  {
    value: "buy",
    label: "Откуда купить",
    description: "В вашу точку ищем рынки с избытком предложения и строим подвоз.",
  },
  {
    value: "trader",
    label: "Трейдер",
    description: "Строим связки где купить и куда продать.",
  },
];

const RECOMMENDATION_TRANSPORT_MODE_ITEMS = [
  {
    value: "best",
    label: "Лучший режим",
    description: "Система сама сравнит авто, ж/д и мультимодал и выберет лучший вариант.",
  },
  {
    value: "road",
    label: "Только авто",
    description: "Считается только прямой автодорожный маршрут.",
  },
  {
    value: "rail",
    label: "Только ж/д",
    description: "Только чистый железнодорожный сценарий без авто-плеч.",
  },
  {
    value: "multimodal",
    label: "Только ж/д + авто",
    description: "Только смешанная доставка с авто-плечами и ж/д участком.",
  },
];

export default function LeftPanel({
  ready,
  status,
  isSearchingSupply,
  isSearchingRecommendations,
  isQueryingNotebookLm,
  isStationRouteMode,
  isProductSearchMode,
  isRecommendationMode,
  onSwitchToStationRoute,
  onSwitchToProductSearch,
  onSwitchToRecommendations,
  showLines,
  showStations,
  showPorts,
  showElevators,
  setShowLines,
  setShowStations,
  setShowPorts,
  setShowElevators,
  onResetSelection,
  products,
  selectedProduct,
  onProductChange,
  needVolumeTons,
  onNeedVolumeChange,
  supplyTransportMode,
  onSupplyTransportModeChange,
  pickSupplyDestinationMode,
  onToggleDestinationPick,
  onClearSupply,
  supplyResult,
  marketRecommendationMode,
  onMarketRecommendationModeChange,
  marketTransportMode,
  onMarketTransportModeChange,
  recommendationBasePoint,
  pickRecommendationBasePointMode,
  onToggleRecommendationBasePointPick,
  notebookLmStatus,
  notebookLmPrompt,
  notebookLmRawAnswer,
  marketSignalsText,
  onSearchRecommendations,
  onClearRecommendations,
  recommendationResult,
}) {
  const busy = isSearchingSupply || isSearchingRecommendations || isQueryingNotebookLm;
  const notebookLmDirectEnabled = Boolean(notebookLmStatus?.direct_query_enabled);
  const provider = String(notebookLmStatus?.provider || notebookLmStatus?.mode || "manual");
  const notebookLmModeLabel = notebookLmDirectEnabled
    ? provider === "python"
      ? "Прямой запрос через notebooklm-py"
      : "Прямой запрос через backend"
    : "Ручной режим по prompt";

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 10,
        padding: 10,
        background: "rgba(255,255,255,0.92)",
        borderRadius: 10,
        boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        minWidth: 360,
        maxWidth: 520,
        maxHeight: "86vh",
        overflow: "auto",
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Статус</div>
      <div style={{ fontSize: 12, color: "#555", marginBottom: 10 }}>{status}</div>

      <div style={{ fontWeight: 800, marginBottom: 8 }}>Слои карты</div>

      <div style={{ marginTop: 8, display: "grid", gap: 6, opacity: ready ? 1 : 0.6 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            disabled={!ready || busy}
            checked={showLines}
            onChange={(e) => setShowLines(e.target.checked)}
          />
          Ж/д линии
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            disabled={!ready || busy}
            checked={showStations}
            onChange={(e) => setShowStations(e.target.checked)}
          />
          Станции
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            disabled={!ready || busy}
            checked={showPorts}
            onChange={(e) => setShowPorts(e.target.checked)}
          />
          Порты
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            disabled={!ready || busy}
            checked={showElevators}
            onChange={(e) => setShowElevators(e.target.checked)}
          />
          Элеваторы
        </label>
      </div>

      <div style={{ marginTop: 12, borderTop: "1px solid #ddd", paddingTop: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Режим работы</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
          <button
            onClick={onSwitchToStationRoute}
            disabled={busy}
            style={buttonStyle(isStationRouteMode, busy)}
          >
            Между двумя станциями
          </button>

          <button
            onClick={onSwitchToProductSearch}
            disabled={busy}
            style={buttonStyle(isProductSearchMode, busy)}
          >
            Поиск продукта
          </button>

          <button
            onClick={onSwitchToRecommendations}
            disabled={busy}
            style={buttonStyle(isRecommendationMode, busy)}
          >
            Рыночные рекомендации
          </button>
        </div>
      </div>

      {(isProductSearchMode || isRecommendationMode) && (
        <div style={{ marginTop: 12, borderTop: "1px solid #ddd", paddingTop: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Продукт и объём</div>

          <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>Продукт</label>
          <select
            value={selectedProduct}
            disabled={busy}
            onChange={(e) => onProductChange(e.target.value)}
            style={selectStyle}
          >
            {products.length === 0 ? (
              <option value={selectedProduct}>Нет данных</option>
            ) : (
              products.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))
            )}
          </select>

          <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
            Объём, тонн
          </label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={needVolumeTons}
            disabled={busy}
            onChange={(e) => onNeedVolumeChange(e.target.value)}
            style={inputStyle}
          />
        </div>
      )}

      {isStationRouteMode && (
        <div style={{ marginTop: 12, borderTop: "1px solid #ddd", paddingTop: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Маршрут между станциями</div>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 8 }}>
            Выбери на карте первую и вторую станцию.
          </div>

          <button
            onClick={onResetSelection}
            disabled={!ready || busy}
            style={secondaryButtonStyle(!ready || busy)}
          >
            Сброс маршрута станций
          </button>
        </div>
      )}

      {isProductSearchMode && (
        <div style={{ marginTop: 12, borderTop: "1px solid #ddd", paddingTop: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Поиск продукта</div>

          <ModeButtons
            items={SUPPLY_TRANSPORT_MODE_ITEMS}
            value={supplyTransportMode}
            disabled={busy}
            onChange={onSupplyTransportModeChange}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
            <button
              onClick={onToggleDestinationPick}
              disabled={!ready || busy}
              style={buttonStyle(pickSupplyDestinationMode, !ready || busy)}
            >
              {pickSupplyDestinationMode
                ? "Кликни по станции/порту/элеватору"
                : "Указать назначение"}
            </button>

            <button
              onClick={onClearSupply}
              disabled={!ready}
              style={secondaryButtonStyle(!ready)}
            >
              {isSearchingSupply ? "Отменить поиск" : "Сброс поиска"}
            </button>
          </div>

          {supplyResult?.search_mode && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#555", lineHeight: 1.45 }}>
              Последний поиск выполнен в режиме: <b>{supplyResult.search_mode}</b>
            </div>
          )}
        </div>
      )}

      {isRecommendationMode && (
        <div style={{ marginTop: 12, borderTop: "1px solid #ddd", paddingTop: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Рыночные рекомендации</div>

          <ModeButtons
            items={RECOMMENDATION_MODE_ITEMS}
            value={marketRecommendationMode}
            disabled={busy}
            onChange={onMarketRecommendationModeChange}
          />

          <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
            Режим маршрута
          </div>
          <ModeButtons
            items={RECOMMENDATION_TRANSPORT_MODE_ITEMS}
            value={marketTransportMode}
            disabled={busy}
            onChange={onMarketTransportModeChange}
          />

          {marketRecommendationMode !== "trader" && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                Базовая точка
              </div>
              <div style={{ fontSize: 12, color: "#555", lineHeight: 1.45, marginBottom: 6 }}>
                {marketRecommendationMode === "sell"
                  ? "Точка, из которой вы хотите продавать и отправлять груз."
                  : "Точка, в которую вы хотите купить и привезти груз."}
              </div>

              {recommendationBasePoint?.name ? (
                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "#f3f4f6",
                    border: "1px solid rgba(0,0,0,0.08)",
                    fontSize: 13,
                    marginBottom: 8,
                  }}
                >
                  Выбрано: <b>{recommendationBasePoint.name}</b>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#777", marginBottom: 8 }}>
                  Пока не выбрано.
                </div>
              )}

              <button
                onClick={onToggleRecommendationBasePointPick}
                disabled={!ready || busy}
                style={buttonStyle(pickRecommendationBasePointMode, !ready || busy)}
              >
                {pickRecommendationBasePointMode
                  ? "Кликни по станции/порту/элеватору"
                  : "Указать базовую точку"}
              </button>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
              Интеграция NotebookLM
            </div>

            <div
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                background: notebookLmDirectEnabled ? "#ecfeff" : "#fff7ed",
                border: "1px solid rgba(0,0,0,0.08)",
                fontSize: 12,
                lineHeight: 1.45,
                color: "#334155",
                marginBottom: 8,
              }}
            >
              <div>
                Режим: <b>{notebookLmModeLabel}</b>
              </div>
              {notebookLmStatus?.notebook_id && (
                <div>
                  Notebook ID: <b>{notebookLmStatus.notebook_id}</b>
                </div>
              )}
              {notebookLmStatus?.storage_path && (
                <div>
                  Storage: <b>{notebookLmStatus.storage_path}</b>
                </div>
              )}
              {notebookLmDirectEnabled ? (
                <div style={{ marginTop: 4 }}>
                  После нажатия «Построить рекомендации» система сама отправит запрос в NotebookLM, заберёт JSON-сигналы и сразу посчитает маршруты и рейтинг направлений.
                </div>
              ) : (
                <div style={{ marginTop: 4 }}>
                  Прямой запрос к NotebookLM сейчас не настроен. Проверь NOTEBOOKLM_MODE=python, NOTEBOOKLM_NOTEBOOK_ID и storage_state.json на backend.
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
            <button
              onClick={onSearchRecommendations}
              disabled={busy || !notebookLmDirectEnabled}
              style={buttonStyle(false, busy || !notebookLmDirectEnabled)}
            >
              Построить рекомендации
            </button>

            <button
              onClick={onClearRecommendations}
              disabled={busy && !recommendationResult}
              style={secondaryButtonStyle(false)}
            >
              Очистить
            </button>
          </div>

          {(notebookLmPrompt || notebookLmRawAnswer || marketSignalsText) && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                Диагностика NotebookLM
              </summary>

              {notebookLmPrompt && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                    Prompt, который был отправлен
                  </div>
                  <textarea
                    readOnly
                    value={notebookLmPrompt}
                    style={{ ...textareaStyle, minHeight: 120, background: "#f9fafb" }}
                  />
                </div>
              )}

              {notebookLmRawAnswer && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                    Raw answer от NotebookLM
                  </div>
                  <textarea
                    readOnly
                    value={notebookLmRawAnswer}
                    style={{ ...textareaStyle, minHeight: 150, background: "#f9fafb" }}
                  />
                </div>
              )}

              {marketSignalsText && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                    Распознанные рыночные сигналы
                  </div>
                  <textarea
                    readOnly
                    value={marketSignalsText}
                    style={{ ...textareaStyle, minHeight: 160, background: "#f9fafb" }}
                  />
                </div>
              )}
            </details>
          )}

          {recommendationResult?.results?.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
              Найдено рекомендаций: <b>{recommendationResult.results.length}</b>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModeButtons({ items, value, disabled, onChange }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {items.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(item.value)}
            style={{
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: 10,
              border: active
                ? "1px solid rgba(0,0,0,0.9)"
                : "1px solid rgba(0,0,0,0.15)",
              background: active ? "#111" : "white",
              color: active ? "#fff" : "#111",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 2 }}>{item.label}</div>
            <div style={{ fontSize: 12, lineHeight: 1.4, opacity: active ? 0.9 : 0.75 }}>
              {item.description}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function buttonStyle(active, disabled) {
  return {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(0,0,0,0.15)",
    background: active ? "#111" : "white",
    color: active ? "#fff" : "#111",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.7 : 1,
  };
}

function secondaryButtonStyle(disabled) {
  return {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(0,0,0,0.15)",
    background: "white",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.75 : 1,
  };
}

const selectStyle = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(0,0,0,0.15)",
  marginBottom: 8,
  background: "white",
};

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(0,0,0,0.15)",
  marginBottom: 8,
};

const textareaStyle = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(0,0,0,0.15)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
  lineHeight: 1.5,
  resize: "vertical",
  boxSizing: "border-box",
};
