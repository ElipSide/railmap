const COMMON_SCHEMA = `[
  {
    "region": "string",
    "city": "string",
    "market_type": "city|port|elevator|station|processor|export_hub|mill|feed|unknown",
    "role": "buy|sell",
    "signal_score": 1,
    "confidence": 1,
    "price_edge_rub_per_ton": 0,
    "price_edge_pct": 0,
    "time_horizon": "now|1-2 weeks|1 month",
    "reason": "short reason"
  }
]`;

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeProduct(value) {
  return normalizeText(value);
}

function normalizeVolume(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normalizeLimit(value, fallback = 10) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(30, Math.round(n)));
}

function locationBiasBlock(baseCity, baseRegion) {
  const city = normalizeText(baseCity);
  const region = normalizeText(baseRegion);

  if (!city && !region) return "";

  return `
Контекст базовой точки:
- базовый город: ${city || "не указан"}
- базовый регион: ${region || "не указан"}

Приоритет выбора рынков:
1. Сначала ищи варианты в том же регионе.
2. Потом в ближайших соседних или логистически близких регионах.
3. Дальние рынки включай только если сигнал заметно сильнее и это может оправдать длинную логистику.
4. Если есть два похожих сигнала, выбирай более близкий рынок.
`;
}

function commonRules(limit) {
  return `
Правила:
1. Верни только JSON-массив без markdown и без пояснений.
2. Верни не больше ${limit} объектов.
3. Для каждого объекта обязательно заполни поля по схеме ниже.
4. region — обязательно регион РФ.
5. city — обязательно город или населённый пункт РФ.
6. role — только "buy" или "sell".
7. market_type — только одно из:
   "city", "port", "elevator", "station", "processor", "export_hub", "mill", "feed", "unknown".
8. НЕЛЬЗЯ возвращать в качестве основной точки маршрута:
   - название компании,
   - название холдинга,
   - юрлицо,
   - бренд,
   - группу компаний,
   - только название терминала или предприятия без города/региона.
9. Если в источнике фигурирует компания-покупатель, переработчик, терминал, экспортёр или иной участник рынка,
   ты обязан преобразовать сигнал в географический рынок:
   - указать city,
   - указать region,
   - в reason кратко описать, какая компания или событие стоит за сигналом.
10. Если точный город неочевиден, укажи наиболее логичный город или узел данного рынка и снизь confidence.
11. signal_score и confidence — числа от 1 до 10.
12. Для зон покупки price_edge_rub_per_ton обычно отрицательный или около нуля, если виден дисконт.
13. Для зон продажи price_edge_rub_per_ton обычно положительный или около нуля, если видна премия.
14. price_edge_pct можно ставить 0, если в источниках нет надёжной оценки.
15. reason — коротко, в 1 предложении.
16. Только РФ.
17. Если информации мало, всё равно верни лучшие доступные варианты с пониженной confidence.

Схема JSON:
${COMMON_SCHEMA}
`;
}

function buildSellPrompt({ product, volumeTons, limit = 10, baseCity = "", baseRegion = "" }) {
  return `
Проанализируй все загруженные источники и найди лучшие направления ВНУТРИ РФ, куда можно ПРОДАТЬ продукт «${product}» объёмом около ${volumeTons} т.

Нужны именно географические рынки сбыта: регион и город.
Не возвращай компанию как точку маршрута.
Если спрос связан с конкретной компанией, переработчиком, экспортёром, терминалом или агрохолдингом, укажи это только в поле reason.

Ищи рынки, где есть:
- дефицит предложения,
- высокий неудовлетворённый спрос,
- локальная премия,
- экспортное окно,
- активность переработчиков,
- сильный спрос со стороны кормового, мукомольного или перерабатывающего сектора.

${locationBiasBlock(baseCity, baseRegion)}

${commonRules(limit).replace(
  '6. role — только "buy" или "sell".',
  '6. role всегда ставь "sell".'
)}
`;
}

function buildBuyPrompt({ product, volumeTons, limit = 10, baseCity = "", baseRegion = "" }) {
  return `
Проанализируй все загруженные источники и найди лучшие направления ВНУТРИ РФ, где можно КУПИТЬ продукт «${product}» объёмом около ${volumeTons} т.

Нужны именно географические рынки закупки: регион и город.
Не возвращай компанию как точку маршрута.
Если предложение связано с конкретной компанией, хозяйством, элеватором, терминалом или продавцом, укажи это только в поле reason.

Ищи рынки, где есть:
- избыток предложения,
- давление на цену,
- слабый локальный спрос,
- скидка или дисконт,
- крупные остатки,
- признаки более выгодной закупки.

${locationBiasBlock(baseCity, baseRegion)}

${commonRules(limit).replace(
  '6. role — только "buy" или "sell".',
  '6. role всегда ставь "buy".'
)}
`;
}

function buildTraderPrompt({ product, volumeTons, limit = 8, baseCity = "", baseRegion = "" }) {
  const totalLimit = Math.max(4, limit * 2);

  return `
Проанализируй все загруженные источники и найди лучшие возможности для ТРЕЙДИНГА по продукту «${product}» объёмом около ${volumeTons} т внутри РФ.

Нужно вернуть и зоны покупки, и зоны продажи.
Нужны именно географические рынки: регион и город.
Не возвращай компании как точку маршрута.
Если сигнал основан на действиях компании, терминала, переработчика, экспортёра или крупного покупателя, укажи это только в reason.

Для каждой зоны:
- если это выгодный рынок закупки, ставь role="buy";
- если это выгодный рынок сбыта, ставь role="sell".

${locationBiasBlock(baseCity, baseRegion)}

${commonRules(totalLimit)}
`;
}

export function buildNotebookLmPrompt({
  mode,
  product,
  volumeTons,
  limit = 10,
  baseCity = "",
  baseRegion = "",
}) {
  const normalizedMode = normalizeText(mode || "sell").toLowerCase();
  const normalizedProduct = normalizeProduct(product);
  const normalizedVolume = normalizeVolume(volumeTons);
  const normalizedLimit = normalizeLimit(limit, 10);
  const normalizedBaseCity = normalizeText(baseCity);
  const normalizedBaseRegion = normalizeText(baseRegion);

  if (!normalizedProduct) {
    throw new Error("product is required");
  }

  if (!normalizedVolume) {
    throw new Error("volumeTons must be > 0");
  }

  if (normalizedMode === "buy") {
    return buildBuyPrompt({
      product: normalizedProduct,
      volumeTons: normalizedVolume,
      limit: normalizedLimit,
      baseCity: normalizedBaseCity,
      baseRegion: normalizedBaseRegion,
    });
  }

  if (normalizedMode === "trader") {
    return buildTraderPrompt({
      product: normalizedProduct,
      volumeTons: normalizedVolume,
      limit: Math.max(4, Math.floor(normalizedLimit / 2) || 8),
      baseCity: normalizedBaseCity,
      baseRegion: normalizedBaseRegion,
    });
  }

  return buildSellPrompt({
    product: normalizedProduct,
    volumeTons: normalizedVolume,
    limit: normalizedLimit,
    baseCity: normalizedBaseCity,
    baseRegion: normalizedBaseRegion,
  });
}

export function getNotebookLmJsonSchema() {
  return COMMON_SCHEMA;
}