import React, { useEffect, useMemo, useRef, useState } from "react";

const SUPPLY_TRANSPORT_MODE_ITEMS = [
  {
    value: "rail",
    label: "Ж/д",
    description:
      "Только железнодорожный сценарий. Если станции совпадают, система подскажет рассмотреть авто.",
  },
  {
    value: "road",
    label: "Авто",
    description: "Прямой автодорожный маршрут без железной дороги.",
  },
  {
    value: "multimodal",
    label: "Ж/д + авто",
    description: "Смешанная доставка с авто-плечами и ж/д участком.",
  },
];

const RECOMMENDATION_MODE_ITEMS = [
  {
    value: "sell",
    label: "Куда продать",
    description: "Из вашей точки ищем лучшие рынки с высоким спросом.",
  },
  {
    value: "buy",
    label: "Откуда купить",
    description: "В вашу точку ищем рынки с избытком предложения.",
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
    description: "Система сама сравнивает авто, ж/д и мультимодал.",
  },
  {
    value: "road",
    label: "Только авто",
    description: "Только прямой автодорожный маршрут.",
  },
  {
    value: "rail",
    label: "Только ж/д",
    description: "Только чистый железнодорожный сценарий.",
  },
  {
    value: "multimodal",
    label: "Только ж/д + авто",
    description: "Только смешанная доставка.",
  },
];

const DECLARATION_QUICK_RANGES = [
  { label: "Сегодня", days: 0 },
  { label: "7 дней", days: 7 },
  { label: "30 дней", days: 30 },
  { label: "60 дней", days: 60 },
];

export default function LeftPanel({
  ready,
  status,
  isSearchingSupply,
  isSearchingRecommendations,
  isQueryingNotebookLm,
  isSearchingDeclarations,
  isBuildingDeclarationRoute,
  isStationRouteMode,
  isDeclarationMode,
  isProductSearchMode,
  isRecommendationMode,
  onSwitchToStationRoute,
  onSwitchToDeclarations,
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
  declarationDateFrom,
  declarationDateTo,
  activeDeclarationQuickRange,
  onDeclarationDateFromChange,
  onDeclarationDateToChange,
  onApplyDeclarationQuickRange,
  onSearchDeclarations,
  onClearDeclarations,
  declarationResult,
  selectedDeclaration,
  pickDeclarationDestinationMode,
  onToggleDeclarationDestinationPick,
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
  focusRequest,
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

  const panelScrollRef = useRef(null);
  const declarationRouteButtonRef = useRef(null);
  const recommendationActionsRef = useRef(null);

  useEffect(() => {
    if (!focusRequest || isCollapsed) return;

    const targetMap = {
      "declaration-route": declarationRouteButtonRef.current,
      "recommendation-actions": recommendationActionsRef.current,
    };

    const targetNode = targetMap[focusRequest.target];
    if (!targetNode) return;

    const frame = window.requestAnimationFrame(() => {
      targetNode.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest, isCollapsed]);

  const busy =
    isSearchingSupply ||
    isSearchingRecommendations ||
    isQueryingNotebookLm ||
    isSearchingDeclarations ||
    isBuildingDeclarationRoute;

  const notebookLmDirectEnabled = Boolean(notebookLmStatus?.direct_query_enabled);
  const provider = String(notebookLmStatus?.provider || notebookLmStatus?.mode || "manual");
  const notebookLmModeLabel = notebookLmDirectEnabled
    ? provider === "python"
      ? "Прямой запрос через notebooklm-py"
      : "Прямой запрос через backend"
    : "Ручной режим по prompt";

  const activeModeLabel = useMemo(() => {
    if (isDeclarationMode) return "Декларации";
    if (isStationRouteMode) return "Маршрут между станциями";
    if (isProductSearchMode) return "Поиск продукта";
    return "Рыночные рекомендации";
  }, [isDeclarationMode, isStationRouteMode, isProductSearchMode]);

  if (isCollapsed) {
    return (
      <aside style={{ position: "absolute", top: 16, left: 16, zIndex: 20 }}>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Открыть настройки"
          title="Открыть настройки"
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            border: "1px solid rgba(148, 163, 184, 0.35)",
            background: "rgba(255,255,255,0.96)",
            boxShadow: "0 16px 40px rgba(15, 23, 42, 0.16)",
            backdropFilter: "blur(14px)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            lineHeight: 1,
            color: "#0f172a",
          }}
        >
          ⚙
        </button>
      </aside>
    );
  }

  return (
    <aside className="floating-panel control-panel">
      <div className="panel-header panel-header--sticky">
        <div className="panel-title-wrap">
          <div className="badge-row">
            <span className="badge badge--primary">Railmap</span>
            <span className={`badge ${ready ? "badge--success" : "badge--warning"}`}>
              {ready ? "Карта готова" : "Загрузка карты"}
            </span>
          </div>
          <div className="panel-subtitle" style={{ marginTop: 8 }}>
            {activeModeLabel} · {status}
          </div>
        </div>

        <div className="panel-header-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setCollapsed(true)}
            aria-label="Скрыть панель"
            title="Скрыть панель"
          >
            ⚙
          </button>
        </div>
      </div>

      <div ref={panelScrollRef} className="panel-scroll">
        <div className="panel-stack">
          <section className="panel-section">
            <div className="status-card">
              <div className="status-line">
                <strong>{activeModeLabel}</strong>
                <span className={`badge ${busy ? "badge--warning" : "badge--success"}`}>
                  {busy ? "В процессе" : "Готово"}
                </span>
              </div>
              <div className="status-text">{status}</div>
            </div>
          </section>

          <section className="panel-section">
            <h3 className="section-title">Слои карты</h3>
            <div className="toggle-grid" style={{ opacity: ready ? 1 : 0.7 }}>
              <ToggleChip checked={showLines} disabled={!ready || busy} label="Ж/д линии" onChange={setShowLines} />
              <ToggleChip checked={showStations} disabled={!ready || busy} label="Станции" onChange={setShowStations} />
              <ToggleChip checked={showPorts} disabled={!ready || busy} label="Порты" onChange={setShowPorts} />
              <ToggleChip checked={showElevators} disabled={!ready || busy} label="Элеваторы" onChange={setShowElevators} />
            </div>
          </section>

          <section className="panel-section">
            <h3 className="section-title">Режим работы</h3>
            <div className="mode-grid">
              <ModeCard active={isDeclarationMode} disabled={busy} title="Декларации" description="Фильтр по датам, объёму и построение маршрута от выбранной декларации." onClick={onSwitchToDeclarations} />
              <ModeCard active={isStationRouteMode} disabled={busy} title="Станция → станция" description="Пошаговый выбор двух станций на карте и просмотр цепочки маршрута." onClick={onSwitchToStationRoute} />
              <ModeCard active={isProductSearchMode} disabled={busy} title="Поиск продукта" description="Подбор поставщиков и маршрута под выбранную точку назначения." onClick={onSwitchToProductSearch} />
              <ModeCard active={isRecommendationMode} disabled={busy} title="Рекомендации рынка" description="Маршруты и рейтинг направлений с учётом NotebookLM и сигналов рынка." onClick={onSwitchToRecommendations} />
            </div>
          </section>

          {(isDeclarationMode || isProductSearchMode || isRecommendationMode) && (
            <section className="panel-section">
              <h3 className="section-title">Базовые параметры</h3>
              <div className="control-grid">
                <div className="field-group">
                  <label className="field-label">Продукт</label>
                  <select className="select-control" value={selectedProduct} disabled={busy} onChange={(e) => onProductChange(e.target.value)}>
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
                </div>

                <div className="field-group">
                  <label className="field-label">Объём, тонн</label>
                  <input className="input-control" type="number" min="0" step="1" value={needVolumeTons} disabled={busy} onChange={(e) => onNeedVolumeChange(e.target.value)} placeholder="Например, 100" />
                </div>
              </div>
            </section>
          )}

          {isDeclarationMode && (
            <section className="panel-section">
              <h3 className="section-title">Поиск деклараций</h3>

              <div className="data-card">
                <div className="field-label">Быстрый выбор периода</div>
                <div className="quick-range-grid">
                  {DECLARATION_QUICK_RANGES.map((item) => (
                    <button
                      key={item.days}
                      type="button"
                      disabled={busy}
                      onClick={() => onApplyDeclarationQuickRange(item.days)}
                      className={`quick-range ${activeDeclarationQuickRange === item.days ? "is-active" : ""} ${busy ? "is-disabled" : ""}`}
                      style={{ padding: "12px 14px" }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-grid form-grid--2">
                <div className="field-group">
                  <label className="field-label">Дата от</label>
                  <input className="input-control" type="date" value={declarationDateFrom} disabled={busy} onChange={(e) => onDeclarationDateFromChange(e.target.value)} />
                </div>
                <div className="field-group">
                  <label className="field-label">Дата до</label>
                  <input className="input-control" type="date" value={declarationDateTo} disabled={busy} onChange={(e) => onDeclarationDateToChange(e.target.value)} />
                </div>
              </div>

              <div className="action-row">
                <button type="button" className="btn btn--primary" onClick={onSearchDeclarations} disabled={!ready || busy}>
                  Показать декларации
                </button>
                <button type="button" className="btn btn--secondary" onClick={onClearDeclarations} disabled={!ready || busy}>
                  Очистить
                </button>
              </div>

              <button
                ref={declarationRouteButtonRef}
                type="button"
                className={`btn ${pickDeclarationDestinationMode ? "btn--soft" : "btn--secondary"} btn--full`}
                onClick={onToggleDeclarationDestinationPick}
                disabled={!ready || busy || !selectedDeclaration}
              >
                {pickDeclarationDestinationMode ? "Кликни по карте, станции, порту или элеватору" : "Построить маршрут от выбранной декларации"}
              </button>

              {selectedDeclaration ? (
                <div className="selection-card">
                  <div className="selection-card-line">Выбрана декларация: <b>{selectedDeclaration.declarer || "(без названия)"}</b></div>
                  <div className="selection-card-line">Объём: <b>{formatTons(selectedDeclaration.volume_tons)}</b></div>
                  {selectedDeclaration.publication_date && (
                    <div className="selection-card-line">Дата: <b>{selectedDeclaration.publication_date}</b></div>
                  )}
                </div>
              ) : declarationResult ? (
                <div className="empty-card">
                  <div className="empty-card-text">Выбери декларацию на карте или в панели результатов.</div>
                </div>
              ) : null}
            </section>
          )}

          {isStationRouteMode && (
            <section className="panel-section">
              <h3 className="section-title">Маршрут между станциями</h3>
              <button type="button" className="btn btn--secondary btn--full" onClick={onResetSelection} disabled={!ready || busy}>
                Сбросить выбор станций
              </button>
            </section>
          )}

          {isProductSearchMode && (
            <section className="panel-section">
              <h3 className="section-title">Поиск продукта</h3>
              <ModeButtons items={SUPPLY_TRANSPORT_MODE_ITEMS} value={supplyTransportMode} disabled={busy} onChange={onSupplyTransportModeChange} />
              <div className="action-row">
                <button type="button" className={`btn ${pickSupplyDestinationMode ? "btn--soft" : "btn--primary"}`} onClick={onToggleDestinationPick} disabled={!ready || busy}>
                  {pickSupplyDestinationMode ? "Кликни по точке назначения" : "Указать назначение"}
                </button>
                <button type="button" className="btn btn--secondary" onClick={onClearSupply} disabled={!ready || busy}>
                  {isSearchingSupply ? "Отменить поиск" : "Сбросить"}
                </button>
              </div>
              {supplyResult?.search_mode && (
                <div className="summary-pills">
                  <span className="summary-pill">Режим: {supplyResult.search_mode}</span>
                  <span className="summary-pill">Вариантов: {supplyResult.options?.length || 0}</span>
                </div>
              )}
            </section>
          )}

          {isRecommendationMode && (
            <section className="panel-section">
              <h3 className="section-title">Рыночные рекомендации</h3>

              <div className="control-grid">
                <div>
                  <div className="field-label">Сценарий</div>
                  <ModeButtons items={RECOMMENDATION_MODE_ITEMS} value={marketRecommendationMode} disabled={busy} onChange={onMarketRecommendationModeChange} />
                </div>

                <div>
                  <div className="field-label">Режим маршрута</div>
                  <ModeButtons items={RECOMMENDATION_TRANSPORT_MODE_ITEMS} value={marketTransportMode} disabled={busy} onChange={onMarketTransportModeChange} />
                </div>
              </div>

              {marketRecommendationMode !== "trader" && (
                <div className="selection-card">
                  <div className="selection-card-line">
                    {marketRecommendationMode === "sell"
                      ? "Точка, из которой вы продаёте и отгружаете товар."
                      : "Точка, в которую вы хотите купить и привезти товар."}
                  </div>
                  <div className="selection-card-line">Выбрано: <b>{recommendationBasePoint?.name || "пока не задано"}</b></div>
                  <button
                    type="button"
                    className={`btn ${pickRecommendationBasePointMode ? "btn--soft" : "btn--secondary"} btn--full`}
                    onClick={onToggleRecommendationBasePointPick}
                    disabled={!ready || busy}
                    style={{ marginTop: 6 }}
                  >
                    {pickRecommendationBasePointMode ? "Кликни по станции, порту или элеватору" : "Указать базовую точку"}
                  </button>
                </div>
              )}

              <div className="notice-card">
                <div className="notice-card-title">Интеграция NotebookLM</div>
                <div className="meta-line">Режим: <b>{notebookLmModeLabel}</b></div>
                {notebookLmStatus?.notebook_id && <div className="meta-line">Notebook ID: <b>{notebookLmStatus.notebook_id}</b></div>}
                {notebookLmStatus?.storage_path && <div className="meta-line">Storage: <b>{notebookLmStatus.storage_path}</b></div>}
                <div className="meta-line">
                  {notebookLmDirectEnabled
                    ? "После запуска система сама запрашивает сигналы и сразу считает маршруты."
                    : "Прямой запрос сейчас не настроен. Нужны NOTEBOOKLM_MODE=python и корректный storage_state.json."}
                </div>
              </div>

              <div ref={recommendationActionsRef} className="action-row">
                <button type="button" className="btn btn--primary" onClick={onSearchRecommendations} disabled={busy || !notebookLmDirectEnabled}>
                  Построить рекомендации
                </button>
                <button type="button" className="btn btn--secondary" onClick={onClearRecommendations} disabled={busy && !recommendationResult}>
                  Очистить
                </button>
              </div>

              {(notebookLmPrompt || notebookLmRawAnswer || marketSignalsText) && (
                <details className="details-block">
                  <summary>Диагностика NotebookLM</summary>
                  {notebookLmPrompt && (
                    <div className="field-group" style={{ marginTop: 12 }}>
                      <label className="field-label">Prompt</label>
                      <textarea className="textarea-control" readOnly value={notebookLmPrompt} />
                    </div>
                  )}
                  {notebookLmRawAnswer && (
                    <div className="field-group" style={{ marginTop: 12 }}>
                      <label className="field-label">Raw answer</label>
                      <textarea className="textarea-control" readOnly value={notebookLmRawAnswer} />
                    </div>
                  )}
                  {marketSignalsText && (
                    <div className="field-group" style={{ marginTop: 12 }}>
                      <label className="field-label">Распознанные сигналы</label>
                      <textarea className="textarea-control" readOnly value={marketSignalsText} />
                    </div>
                  )}
                </details>
              )}
            </section>
          )}
        </div>
      </div>
    </aside>
  );
}

function ModeButtons({ items, value, disabled, onChange }) {
  return (
    <div className={`mode-grid ${items.length === 1 ? "mode-grid--single" : ""}`}>
      {items.map((item) => (
        <ModeCard
          key={item.value}
          active={value === item.value}
          disabled={disabled}
          title={item.label}
          description={item.description}
          onClick={() => onChange(item.value)}
        />
      ))}
    </div>
  );
}

function ModeCard({ active, disabled, title, description, onClick }) {
  return (
    <button
      type="button"
      className={`mode-card ${active ? "is-active" : ""} ${disabled ? "is-disabled" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      <div className="mode-title">{title}</div>
      <div className="mode-description">{description}</div>
    </button>
  );
}

function ToggleChip({ checked, disabled, label, onChange }) {
  return (
    <label className="toggle-chip">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function formatTons(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0 т";
  return `${Math.round(n * 100) / 100} т`;
}
