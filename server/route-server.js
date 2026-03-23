import express from "express";
import cors from "cors";
import pg from "pg";
import { buildNotebookLmPrompt, getNotebookLmJsonSchema } from "./notebooklm-prompts.js";
import {
  getNotebookLmConfig,
  queryNotebookLm,
  extractNotebookLmJson,
} from "./notebooklm-client.js";
import {
  normalizeMarketSignals,
  normalizeRecommendationMode,
  normalizeRoutePreferenceMode,
  pickPreferredPointType,
  signalDisplayName,
  RECOMMENDATION_MODE_SELL,
  RECOMMENDATION_MODE_BUY,
  RECOMMENDATION_MODE_TRADER,
  ROUTE_PREF_BEST,
  ROUTE_PREF_ROAD,
  ROUTE_PREF_RAIL,
  ROUTE_PREF_MULTIMODAL,
} from "./market-signal-utils.js";
import {
  scoreSellDirection,
  scoreBuySource,
  scoreTraderOpportunity,
  compareRankedResults,
} from "./recommendation-scoring.js";

const { Pool } = pg;

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const railPool = new Pool({
  host: process.env.PGHOST ?? "postgis",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "osm",
  user: process.env.PGUSER ?? "osm",
  password: process.env.PGPASSWORD ?? "osm",
  ssl: false,
});

const declPool = new Pool({
  host: process.env.DECL_DB_HOST,
  port: Number(process.env.DECL_DB_PORT ?? 5432),
  database: process.env.DECL_DB_NAME,
  user: process.env.DECL_DB_USER,
  password: process.env.DECL_DB_PASSWORD,
  ssl:
    String(process.env.DECL_DB_SSL ?? "false").toLowerCase() === "true"
      ? { rejectUnauthorized: false }
      : false,
});

railPool.on("error", (err) => {
  console.error("Unexpected railPool error:", err);
});

declPool.on("error", (err) => {
  console.error("Unexpected declPool error:", err);
});

const SUPPLY_WAVES_KM = [100, 250, 500, 1000, 2000, 4000, 8000, 20000];
const SUPPLY_OPTIONS_LIMIT = 6;
const DECL_ROWS_PER_WAVE = 12;
const ROUTE_CONCURRENCY = 4;
const FAST_PRESELECT_PER_WAVE = 8;
const MAIN_ROAD_COMPONENT = Number(process.env.MAIN_ROAD_COMPONENT ?? 87282);
const ROAD_ONLY_PENALTY_KM = Number(process.env.ROAD_ONLY_PENALTY_KM ?? 120);
const STRICT_ROAD_GEOMETRY =
  String(process.env.STRICT_ROAD_GEOMETRY ?? "false").toLowerCase() ===
  "true";
const RAIL_ONLY_MAX_SOURCE_STATION_DIST_M = Number(
  process.env.RAIL_ONLY_MAX_SOURCE_STATION_DIST_M ?? 10000
);
const RAIL_ONLY_MAX_DEST_STATION_DIST_M = Number(
  process.env.RAIL_ONLY_MAX_DEST_STATION_DIST_M ?? 10000
);

const SEARCH_MODE_RAIL = "rail";
const SEARCH_MODE_ROAD = "road";
const SEARCH_MODE_MULTIMODAL = "multimodal";
const SEARCH_MODES = new Set([
  SEARCH_MODE_RAIL,
  SEARCH_MODE_ROAD,
  SEARCH_MODE_MULTIMODAL,
]);

const RECOMMENDATION_OPTIONS_LIMIT = 10;
const RECOMMENDATION_RESOLVE_CONCURRENCY = Number(
  process.env.RECOMMENDATION_RESOLVE_CONCURRENCY ?? 6
);
const RECOMMENDATION_ROUTE_CONCURRENCY = Number(
  process.env.RECOMMENDATION_ROUTE_CONCURRENCY ?? 4
);
const RECOMMENDATION_SIGNAL_LIMIT = Number(
  process.env.RECOMMENDATION_SIGNAL_LIMIT ?? 6
);
const RECOMMENDATION_TRADER_SIDE_LIMIT = Number(
  process.env.RECOMMENDATION_TRADER_SIDE_LIMIT ?? 4
);
const RECOMMENDATION_LOCAL_DISTANCE_KM = Number(
  process.env.RECOMMENDATION_LOCAL_DISTANCE_KM ?? 900
);
const RECOMMENDATION_TRADER_MAX_PAIR_DISTANCE_KM = Number(
  process.env.RECOMMENDATION_TRADER_MAX_PAIR_DISTANCE_KM ?? 1600
);
const MAX_HYDRATED_POINT_CACHE = Number(process.env.MAX_HYDRATED_POINT_CACHE ?? 1000);
const MAX_RESOLVED_ANCHOR_CACHE = Number(process.env.MAX_RESOLVED_ANCHOR_CACHE ?? 1000);
const MAX_DELIVERY_ROUTE_CACHE = Number(process.env.MAX_DELIVERY_ROUTE_CACHE ?? 400);
const ROAD_PREF_SHORT_KM = Number(process.env.ROAD_PREF_SHORT_KM ?? 280);
const ROAD_PREF_ADVANTAGE_KM = Number(process.env.ROAD_PREF_ADVANTAGE_KM ?? 60);
const ROAD_PREF_MULTIMODAL_RATIO = Number(
  process.env.ROAD_PREF_MULTIMODAL_RATIO ?? 1.08
);
const ROAD_PREF_AUTOPART_SHARE = Number(
  process.env.ROAD_PREF_AUTOPART_SHARE ?? 0.65
);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function asNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizeSearchMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return SEARCH_MODES.has(normalized) ? normalized : SEARCH_MODE_MULTIMODAL;
}

function buildRailRejectedCandidate(reason, payload = {}) {
  return {
    __kind: "rail_rejected",
    reason,
    ...payload,
  };
}

function isRailRejectedCandidate(value) {
  return value?.__kind === "rail_rejected";
}

function pushUniqueExample(list, value, limit = 3) {
  if (!value || !Array.isArray(list) || list.includes(value) || list.length >= limit) {
    return;
  }
  list.push(value);
}

function buildSearchFeedback({
  searchMode,
  options,
  candidates,
  needVolumeTons,
  usedSearchRadiusKm,
  demandStation,
  stats,
}) {
  const notices = [];
  const searchRadiusLabel =
    usedSearchRadiusKm != null ? ` до ${round2(usedSearchRadiusKm)} км` : "";

  if (searchMode === SEARCH_MODE_RAIL && stats.same_station > 0) {
    notices.push({
      type: "warning",
      code: "same_station_better_by_road",
      text:
        stats.same_station === 1
          ? `У одного ближайшего поставщика станция отправления совпадает со станцией прибытия (${demandStation?.name || "станция прибытия"}). В таком случае лучше воспользоваться автотранспортом.`
          : `У ${stats.same_station} ближайших поставщиков станция отправления совпадает со станцией прибытия (${demandStation?.name || "станция прибытия"}). Для таких случаев лучше воспользоваться автотранспортом.`,
      examples: stats.same_station_examples,
    });
  }

  if (options.length > 0) {
    return { notices, emptyStateReason: null, emptyStateDetails: null };
  }

  const validVolume = round2(
    (candidates || []).reduce((sum, item) => sum + Number(item?.available_volume_tons ?? 0), 0)
  );

  if (searchMode === SEARCH_MODE_RAIL) {
    if (stats.same_station > 0 && candidates.length === 0 && stats.rail_route_not_found === 0) {
      return {
        notices,
        emptyStateReason: "Нет вариантов по ЖД: у ближайших поставщиков станция отправления совпадает со станцией прибытия.",
        emptyStateDetails: "Для таких поставщиков лучше использовать режим «Авто». Переключитесь на него, чтобы увидеть подходящие варианты.",
      };
    }

    if (stats.rail_route_not_found > 0 && candidates.length === 0) {
      return {
        notices,
        emptyStateReason: "Нет вариантов по ЖД: не найден железнодорожный маршрут от станций ближайших поставщиков до станции прибытия.",
        emptyStateDetails: `Проверены ближайшие поставщики в радиусе поиска${searchRadiusLabel}.`,
      };
    }

    if (stats.source_station_too_far > 0 && candidates.length === 0) {
      return {
        notices,
        emptyStateReason: "Нет вариантов по ЖД: ближайшие поставщики слишком далеко от железнодорожных станций.",
        emptyStateDetails: "Для строгого режима ЖД показываются только поставщики, у которых рядом есть станция отправления.",
      };
    }

    if (stats.destination_station_too_far > 0 && candidates.length === 0) {
      return {
        notices,
        emptyStateReason: "Нет вариантов по ЖД: пункт назначения слишком далеко от станции прибытия.",
        emptyStateDetails: "Для режима ЖД конечная точка должна быть достаточно близко к станции, иначе лучше использовать режим «Ж/д + авто» или «Авто».",
      };
    }
  }

  if (validVolume > 0 && validVolume < needVolumeTons) {
    return {
      notices,
      emptyStateReason: `Нет вариантов: подходящие поставщики суммарно дают только ${formatTons(validVolume)} при потребности ${formatTons(needVolumeTons)}.`,
      emptyStateDetails: "Маршруты найдены, но их общего объёма недостаточно, чтобы закрыть спрос.",
    };
  }

  return {
    notices,
    emptyStateReason: "Нет вариантов: не удалось собрать подходящий маршрут для выбранного режима поиска.",
    emptyStateDetails:
      searchMode === SEARCH_MODE_RAIL
        ? "Для строгого режима ЖД это обычно означает, что нет чистого железнодорожного пути без автоплеч или рядом со станциями недостаточно объёма."
        : "Это означает, что среди найденных поставщиков не удалось построить маршрут, удовлетворяющий выбранному режиму.",
  };
}

function calcLineWidth(shippedVolumeTons, needVolumeTons) {
  const ratio = needVolumeTons > 0 ? shippedVolumeTons / needVolumeTons : 0;
  return clamp(2 + ratio * 10, 2, 12);
}

function featureFromGeometry(geometry, properties = {}) {
  return {
    type: "Feature",
    properties,
    geometry,
  };
}

function geometryHasCoordinates(geometry) {
  if (!geometry || typeof geometry !== "object") return false;

  if (geometry.type === "LineString") {
    return Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2;
  }

  if (geometry.type === "MultiLineString") {
    return (
      Array.isArray(geometry.coordinates) &&
      geometry.coordinates.some(
        (line) => Array.isArray(line) && line.length >= 2
      )
    );
  }

  return false;
}

function buildRailFirstPreferenceScore(row, sourceStation, demandStation) {
  const sourceStationDistKm = Number(sourceStation?.dist_m ?? 0) / 1000;
  const demandStationDistKm = Number(demandStation?.dist_m ?? 0) / 1000;
  const sameStationPenalty =
    Number(sourceStation?.osm_id) === Number(demandStation?.osm_id) ? 500 : 0;
  const directKm = Number(row.direct_distance_km ?? 0);

  return (
    sourceStationDistKm * 5 +
    demandStationDistKm * 3 +
    directKm * 0.05 +
    sameStationPenalty
  );
}

function buildRoadPreferenceScore(row) {
  return Number(row?.direct_distance_km ?? Number.POSITIVE_INFINITY);
}

function buildCandidateKey(item) {
  return [
    item.declarer,
    item.source_station?.osm_id ?? "",
    item.point?.lon ?? "",
    item.point?.lat ?? "",
    Array.isArray(item.declaration_ids)
      ? [...item.declaration_ids].sort().join(",")
      : "",
  ].join("|");
}

function buildDirectLineRoute(fromLon, fromLat, toLon, toLat) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;

  const dLat = toRad(toLat - fromLat);
  const dLon = toRad(toLon - fromLon);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(fromLat)) *
      Math.cos(toRad(toLat)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const meters = R * c;

  return {
    meters,
    km: round2(meters / 1000),
    geometry: {
      type: "LineString",
      coordinates: [
        [Number(fromLon), Number(fromLat)],
        [Number(toLon), Number(toLat)],
      ],
    },
  };
}

const roadNodeGeomCache = new Map();
const roadRouteByNodesCache = new Map();
const hydratedPointCache = new Map();
const resolvedAnchorCache = new Map();
const deliveryRouteCache = new Map();

function getCachedValue(cache, key) {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function setCachedValue(cache, key, value, maxSize) {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= maxSize) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, value);
  return value;
}

function buildZeroRoute() {
  return {
    meters: 0,
    km: 0,
    geometry: { type: "LineString", coordinates: [] },
  };
}

function buildRoadOnlySummary(route, sameStation = false) {
  const zeroRoute = buildZeroRoute();
  return {
    selected_mode: "road_only",
    road_start_route: route,
    rail_route: zeroRoute,
    road_end_route: zeroRoute,
    road_start_km: Number(route?.km ?? 0),
    rail_km: 0,
    road_end_km: 0,
    road_total_km: Number(route?.km ?? 0),
    total_route_km: round2(Number(route?.km ?? 0)),
    same_station: Boolean(sameStation),
  };
}

function buildRailOnlySummary(route, sameStation = false) {
  const zeroRoute = buildZeroRoute();
  return {
    selected_mode: "rail_only",
    road_start_route: zeroRoute,
    rail_route: route,
    road_end_route: zeroRoute,
    road_start_km: 0,
    rail_km: Number(route?.km ?? 0),
    road_end_km: 0,
    road_total_km: 0,
    total_route_km: round2(Number(route?.km ?? 0)),
    same_station: Boolean(sameStation),
  };
}

function buildMultimodalSummary({ roadStartRoute, railRoute, roadEndRoute, sameStation = false }) {
  const roadStartKm = Number(roadStartRoute?.km ?? 0);
  const railKm = Number(railRoute?.km ?? 0);
  const roadEndKm = Number(roadEndRoute?.km ?? 0);
  const roadTotalKm = round2(roadStartKm + roadEndKm);
  const totalRouteKm = round2(roadTotalKm + railKm);
  const hasAutoLeg = roadStartKm > 0 || roadEndKm > 0;

  return {
    selected_mode: hasAutoLeg ? "multimodal" : "rail_only",
    road_start_route: roadStartRoute,
    rail_route: railRoute,
    road_end_route: roadEndRoute,
    road_start_km: roadStartKm,
    rail_km: railKm,
    road_end_km: roadEndKm,
    road_total_km: roadTotalKm,
    total_route_km: totalRouteKm,
    same_station: Boolean(sameStation),
  };
}

function shouldPreferRoadOverMultimodal(roadOnly, multimodal, sameStation = false) {
  if (!roadOnly) return false;
  if (!multimodal) return true;
  if (sameStation) return true;

  const roadKm = Number(roadOnly?.total_route_km ?? Number.POSITIVE_INFINITY);
  const multimodalKm = Number(multimodal?.total_route_km ?? Number.POSITIVE_INFINITY);
  const multimodalRoadKm = Number(multimodal?.road_total_km ?? 0);
  const multimodalRailKm = Number(multimodal?.rail_km ?? 0);

  if (!Number.isFinite(roadKm)) return false;
  if (!Number.isFinite(multimodalKm)) return true;

  if (roadKm <= ROAD_PREF_SHORT_KM) return true;
  if (roadKm + ROAD_PREF_ADVANTAGE_KM <= multimodalKm) return true;
  if (roadKm <= multimodalKm * 0.98) return true;

  const autoShare = multimodalKm > 0 ? multimodalRoadKm / multimodalKm : 1;
  if (roadKm <= multimodalKm * ROAD_PREF_MULTIMODAL_RATIO && autoShare >= ROAD_PREF_AUTOPART_SHARE) {
    return true;
  }

  if (multimodalRailKm <= 120 && roadKm <= multimodalKm * 1.1) {
    return true;
  }

  return false;
}

function routeDecisionScore(summary) {
  if (!summary) return Number.POSITIVE_INFINITY;

  const totalKm = Number(summary.total_route_km ?? Number.POSITIVE_INFINITY);
  const roadKm = Number(summary.road_total_km ?? 0);
  const railKm = Number(summary.rail_km ?? 0);
  const mode = String(summary.selected_mode || "");

  let penalty = 0;
  if (mode === "multimodal") penalty += 22;
  if (mode === "rail_only") penalty += 18;
  penalty += roadKm * 0.03;
  penalty += railKm * 0.01;

  return totalKm + penalty;
}

function chooseRouteSummary({ roadOnly, multimodal, railOnly, preference = ROUTE_PREF_BEST, sameStation = false }) {
  if (preference === ROUTE_PREF_ROAD) return roadOnly ?? null;
  if (preference === ROUTE_PREF_RAIL) return railOnly ?? multimodal ?? null;
  if (preference === ROUTE_PREF_MULTIMODAL) {
    if (multimodal && !shouldPreferRoadOverMultimodal(roadOnly, multimodal, sameStation)) {
      return multimodal;
    }
    return roadOnly ?? multimodal ?? railOnly ?? null;
  }

  if (sameStation && roadOnly) return roadOnly;
  if (shouldPreferRoadOverMultimodal(roadOnly, multimodal, sameStation)) return roadOnly;

  const variants = [roadOnly, multimodal, railOnly].filter(Boolean);
  if (!variants.length) return null;
  variants.sort((a, b) => routeDecisionScore(a) - routeDecisionScore(b));
  return variants[0];
}

async function getNearestStationByLonLat(client, lon, lat) {
  const sql = `
    SELECT
      s.osm_id,
      COALESCE(s.name, '(без названия)') AS name,
      sn.node_id,
      ST_Distance(
        s.geom,
        ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3857)
      ) AS dist_m
    FROM rail.stations s
    JOIN rail.station_nodes sn
      ON sn.osm_id = s.osm_id
    ORDER BY
      s.geom <-> ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3857)
    LIMIT 1;
  `;

  const r = await client.query(sql, [lon, lat]);
  return r.rows?.[0] ?? null;
}

async function getStationByOsmId(client, osmId) {
  const sql = `
    SELECT
      s.osm_id,
      COALESCE(s.name, '(без названия)') AS name,
      sn.node_id,
      0::double precision AS dist_m
    FROM rail.stations s
    JOIN rail.station_nodes sn
      ON sn.osm_id = s.osm_id
    WHERE s.osm_id = $1
    LIMIT 1;
  `;

  const r = await client.query(sql, [osmId]);
  return r.rows?.[0] ?? null;
}

async function getRoadNodeForStation(client, stationOsmId) {
  const sqlMain = `
    SELECT
      srn.station_osm_id,
      srn.road_node_id AS id,
      srn.dist_m,
      ST_X(ST_Transform(n.geom, 4326)) AS lon,
      ST_Y(ST_Transform(n.geom, 4326)) AS lat
    FROM road.station_road_nodes srn
    JOIN road.nodes n
      ON n.id = srn.road_node_id
    JOIN road.node_components nc
      ON nc.node = n.id
    WHERE srn.station_osm_id = $1
      AND nc.component = $2
    ORDER BY srn.dist_m ASC
    LIMIT 1;
  `;

  const r1 = await client.query(sqlMain, [stationOsmId, MAIN_ROAD_COMPONENT]);
  if (r1.rows?.[0]) {
    return r1.rows[0];
  }

  const sqlAny = `
    SELECT
      srn.station_osm_id,
      srn.road_node_id AS id,
      srn.dist_m,
      ST_X(ST_Transform(n.geom, 4326)) AS lon,
      ST_Y(ST_Transform(n.geom, 4326)) AS lat
    FROM road.station_road_nodes srn
    JOIN road.nodes n
      ON n.id = srn.road_node_id
    WHERE srn.station_osm_id = $1
    ORDER BY srn.dist_m ASC
    LIMIT 1;
  `;

  const r2 = await client.query(sqlAny, [stationOsmId]);
  return r2.rows?.[0] ?? null;
}

async function buildRailRouteByNodes(client, fromNodeId, toNodeId) {
  if (!Number.isFinite(Number(fromNodeId)) || !Number.isFinite(Number(toNodeId))) {
    return null;
  }

  if (Number(fromNodeId) === Number(toNodeId)) {
    return {
      meters: 0,
      km: 0,
      geometry: { type: "LineString", coordinates: [] },
    };
  }

  const sql = `
    WITH route AS (
      SELECT * FROM pgr_dijkstra(
        'SELECT id, source, target, cost, cost AS reverse_cost FROM rail.track_segments'::text,
        $1::bigint,
        $2::bigint,
        true::boolean
      )
    ),
    geom AS (
      SELECT
        ST_LineMerge(ST_Union(ts.geom)) AS geom3857,
        SUM(ts.cost) AS meters
      FROM route r
      JOIN rail.track_segments ts
        ON ts.id = r.edge
      WHERE r.edge <> -1
    )
    SELECT
      meters,
      ST_AsGeoJSON(ST_Transform(geom3857, 4326)) AS geojson
    FROM geom;
  `;

  const r = await client.query(sql, [Number(fromNodeId), Number(toNodeId)]);
  const row = r.rows?.[0];

  if (!row || row.meters == null || row.geojson == null) {
    return null;
  }

  const meters = Number(row.meters);

  return {
    meters,
    km: round2(meters / 1000),
    geometry: JSON.parse(row.geojson),
  };
}

async function getRoadNodeGeom4326(client, nodeId) {
  const key = Number(nodeId);
  if (!Number.isFinite(key)) {
    return null;
  }

  if (roadNodeGeomCache.has(key)) {
    return roadNodeGeomCache.get(key);
  }

  const sql = `
    SELECT
      id,
      ST_X(ST_Transform(geom, 4326)) AS lon,
      ST_Y(ST_Transform(geom, 4326)) AS lat,
      ST_X(geom) AS x3857,
      ST_Y(geom) AS y3857
    FROM road.nodes
    WHERE id = $1
    LIMIT 1;
  `;

  const r = await client.query(sql, [key]);
  const row = r.rows?.[0] ?? null;
  roadNodeGeomCache.set(key, row);
  return row;
}

async function getNearestRoadSnapByLonLat(client, lon, lat) {
  const sqlMain = `
    WITH p AS (
      SELECT ST_Transform(ST_SetSRID(ST_MakePoint($1,$2),4326),3857) AS geom
    )
    SELECT
      s.id AS segment_id,
      s.source,
      s.target,
      ST_Distance(s.geom, p.geom) AS dist_m,
      ST_X(ST_Transform(ST_ClosestPoint(s.geom, p.geom),4326)) AS snap_lon,
      ST_Y(ST_Transform(ST_ClosestPoint(s.geom, p.geom),4326)) AS snap_lat
    FROM road.segments s
    JOIN road.node_components c1
      ON c1.node = s.source
    JOIN road.node_components c2
      ON c2.node = s.target
    CROSS JOIN p
    WHERE c1.component = $3
      AND c2.component = $3
    ORDER BY s.geom <-> p.geom
    LIMIT 1;
  `;

  const r1 = await client.query(sqlMain, [lon, lat, MAIN_ROAD_COMPONENT]);
  if (r1.rows?.[0]) {
    return r1.rows[0];
  }

  const sqlAny = `
    WITH p AS (
      SELECT ST_Transform(ST_SetSRID(ST_MakePoint($1,$2),4326),3857) AS geom
    )
    SELECT
      s.id AS segment_id,
      s.source,
      s.target,
      ST_Distance(s.geom, p.geom) AS dist_m,
      ST_X(ST_Transform(ST_ClosestPoint(s.geom, p.geom),4326)) AS snap_lon,
      ST_Y(ST_Transform(ST_ClosestPoint(s.geom, p.geom),4326)) AS snap_lat
    FROM road.segments s
    CROSS JOIN p
    ORDER BY s.geom <-> p.geom
    LIMIT 1;
  `;

  const r2 = await client.query(sqlAny, [lon, lat]);
  return r2.rows?.[0] ?? null;
}

async function buildRoadRouteByNodes(client, fromNodeId, toNodeId, opts = {}) {
  if (!Number.isFinite(Number(fromNodeId)) || !Number.isFinite(Number(toNodeId))) {
    return null;
  }

  const fromId = Number(fromNodeId);
  const toId = Number(toNodeId);
  const allowWideSearch = opts.allowWideSearch !== false;
  const cacheKey = `${fromId}->${toId}|wide:${allowWideSearch}`;

  if (roadRouteByNodesCache.has(cacheKey)) {
    return roadRouteByNodesCache.get(cacheKey);
  }

  if (fromId === toId) {
    const node = await getRoadNodeGeom4326(client, fromId);
    const sameNodeRoute = {
      meters: 0,
      km: 0,
      geometry: {
        type: "LineString",
        coordinates: node ? [[Number(node.lon), Number(node.lat)]] : [],
      },
    };
    roadRouteByNodesCache.set(cacheKey, sameNodeRoute);
    return sameNodeRoute;
  }

  const fromNode = await getRoadNodeGeom4326(client, fromId);
  const toNode = await getRoadNodeGeom4326(client, toId);

  if (!fromNode || !toNode) {
    roadRouteByNodesCache.set(cacheKey, null);
    return null;
  }

  const minX = Math.min(Number(fromNode.x3857), Number(toNode.x3857));
  const minY = Math.min(Number(fromNode.y3857), Number(toNode.y3857));
  const maxX = Math.max(Number(fromNode.x3857), Number(toNode.x3857));
  const maxY = Math.max(Number(fromNode.y3857), Number(toNode.y3857));

  const dx = maxX - minX;
  const dy = maxY - minY;
  const straightMeters = Math.sqrt(dx * dx + dy * dy);

  const narrowBuffers = [
    Math.max(15000, straightMeters * 0.35),
    Math.max(40000, straightMeters * 0.8),
  ];

  const wideBuffers = allowWideSearch
    ? [
        Math.max(90000, straightMeters * 1.6),
        Math.max(180000, straightMeters * 2.6),
      ]
    : [];

  const buffers = [...narrowBuffers, ...wideBuffers];

  console.log("ROAD ROUTE TRY", {
    fromNodeId: fromId,
    toNodeId: toId,
    fromLon: Number(fromNode.lon),
    fromLat: Number(fromNode.lat),
    toLon: Number(toNode.lon),
    toLat: Number(toNode.lat),
    straightMeters: Math.round(straightMeters),
    buffers: buffers.map((x) => Math.round(x)),
    allowWideSearch,
  });

  for (const buffer of buffers) {
    const edgeSql = `
      SELECT id, source, target, cost, reverse_cost
      FROM road.segments
      WHERE geom && ST_MakeEnvelope(
        ${minX - buffer},
        ${minY - buffer},
        ${maxX + buffer},
        ${maxY + buffer},
        3857
      )
    `;

    const sql = `
      WITH route AS (
        SELECT * FROM pgr_dijkstra(
          $1::text,
          $2::bigint,
          $3::bigint,
          true::boolean
        )
      ),
      geom AS (
        SELECT
          ST_LineMerge(ST_Union(ts.geom)) AS geom3857,
          SUM(ts.cost) AS meters
        FROM route r
        JOIN road.segments ts
          ON ts.id = r.edge
        WHERE r.edge <> -1
      )
      SELECT
        meters,
        ST_AsGeoJSON(ST_Transform(geom3857, 4326)) AS geojson
      FROM geom;
    `;

    try {
      const r = await client.query(sql, [edgeSql, fromId, toId]);
      const row = r.rows?.[0];

      if (row && row.meters != null && row.geojson != null) {
        const meters = Number(row.meters);
        const result = {
          meters,
          km: round2(meters / 1000),
          geometry: JSON.parse(row.geojson),
        };

        console.log("ROAD ROUTE OK", {
          fromNodeId: fromId,
          toNodeId: toId,
          buffer: Math.round(buffer),
          meters: Math.round(meters),
          allowWideSearch,
        });

        roadRouteByNodesCache.set(cacheKey, result);
        return result;
      }
    } catch (e) {
      console.error(
        `ROAD ROUTE ERROR ${fromId}->${toId} buffer=${Math.round(buffer)}:`,
        e.message
      );
    }
  }

  console.log("ROAD ROUTE FALLBACK", {
    fromNodeId: fromId,
    toNodeId: toId,
    allowWideSearch,
  });

  roadRouteByNodesCache.set(cacheKey, null);
  return null;
}

async function buildRoadRouteFromSnapToNode(client, snap, targetNodeId, opts = {}) {
  if (!snap || !Number.isFinite(Number(targetNodeId))) {
    return null;
  }

  const candidates = [];

  for (const startNodeId of [snap.source, snap.target]) {
    const route = await buildRoadRouteByNodes(
      client,
      Number(startNodeId),
      Number(targetNodeId),
      opts
    );

    if (!route) continue;

    const startNode = await getRoadNodeGeom4326(client, Number(startNodeId));
    if (!startNode) continue;

    const connector = buildDirectLineRoute(
      Number(snap.snap_lon),
      Number(snap.snap_lat),
      Number(startNode.lon),
      Number(startNode.lat)
    );

    candidates.push({
      meters: Number(route.meters) + Number(connector.meters),
      km: round2(Number(route.km) + Number(connector.km)),
      geometry: {
        type: "MultiLineString",
        coordinates: [
          connector.geometry.coordinates,
          route.geometry.type === "LineString" ? route.geometry.coordinates : [],
        ].filter((x) => Array.isArray(x) && x.length > 0),
      },
    });
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => a.meters - b.meters);
  return candidates[0];
}

async function buildRoadRouteFromNodeToSnap(client, startNodeId, snap, opts = {}) {
  if (!snap || !Number.isFinite(Number(startNodeId))) {
    return null;
  }

  const candidates = [];

  for (const endNodeId of [snap.source, snap.target]) {
    const route = await buildRoadRouteByNodes(
      client,
      Number(startNodeId),
      Number(endNodeId),
      opts
    );

    if (!route) continue;

    const endNode = await getRoadNodeGeom4326(client, Number(endNodeId));
    if (!endNode) continue;

    const connector = buildDirectLineRoute(
      Number(endNode.lon),
      Number(endNode.lat),
      Number(snap.snap_lon),
      Number(snap.snap_lat)
    );

    candidates.push({
      meters: Number(route.meters) + Number(connector.meters),
      km: round2(Number(route.km) + Number(connector.km)),
      geometry: {
        type: "MultiLineString",
        coordinates: [
          route.geometry.type === "LineString" ? route.geometry.coordinates : [],
          connector.geometry.coordinates,
        ].filter((x) => Array.isArray(x) && x.length > 0),
      },
    });
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => a.meters - b.meters);
  return candidates[0];
}

async function buildRoadRouteSnapToSnap(client, startSnap, endSnap, opts = {}) {
  if (!startSnap || !endSnap) {
    return null;
  }

  const candidates = [];

  for (const startNodeId of [startSnap.source, startSnap.target]) {
    const startNode = await getRoadNodeGeom4326(client, Number(startNodeId));
    if (!startNode) continue;

    const startConnector = buildDirectLineRoute(
      Number(startSnap.snap_lon),
      Number(startSnap.snap_lat),
      Number(startNode.lon),
      Number(startNode.lat)
    );

    for (const endNodeId of [endSnap.source, endSnap.target]) {
      const route = await buildRoadRouteByNodes(
        client,
        Number(startNodeId),
        Number(endNodeId),
        opts
      );
      if (!route) continue;

      const endNode = await getRoadNodeGeom4326(client, Number(endNodeId));
      if (!endNode) continue;

      const endConnector = buildDirectLineRoute(
        Number(endNode.lon),
        Number(endNode.lat),
        Number(endSnap.snap_lon),
        Number(endSnap.snap_lat)
      );

      candidates.push({
        meters:
          Number(startConnector.meters) +
          Number(route.meters) +
          Number(endConnector.meters),
        km: round2(
          Number(startConnector.km) + Number(route.km) + Number(endConnector.km)
        ),
        geometry: {
          type: "MultiLineString",
          coordinates: [
            startConnector.geometry.coordinates,
            route.geometry.type === "LineString" ? route.geometry.coordinates : [],
            endConnector.geometry.coordinates,
          ].filter((x) => Array.isArray(x) && x.length > 0),
        },
      });
    }
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => a.meters - b.meters);
  return candidates[0];
}

function sortCandidates(candidates) {
  candidates.sort((a, b) => {
    if (a.total_route_km !== b.total_route_km) {
      return a.total_route_km - b.total_route_km;
    }
    if (a.rail_km !== b.rail_km) {
      return b.rail_km - a.rail_km;
    }
    if (a.road_start_km !== b.road_start_km) {
      return a.road_start_km - b.road_start_km;
    }
    if (a.road_end_km !== b.road_end_km) {
      return a.road_end_km - b.road_end_km;
    }
    if (a.direct_distance_km !== b.direct_distance_km) {
      return a.direct_distance_km - b.direct_distance_km;
    }
    return b.available_volume_tons - a.available_volume_tons;
  });
}

function buildOptionKey(option) {
  return option.sources
    .map((s) => {
      const stationId = s.source_station?.osm_id ?? "";
      const ids = Array.isArray(s.declaration_ids)
        ? [...s.declaration_ids].sort().join(",")
        : "";
      return `${s.declarer}|${stationId}|${ids}`;
    })
    .sort()
    .join("||");
}

function buildOptionFromCombination(picked, needVolumeTons, searchMode = SEARCH_MODE_MULTIMODAL) {
  if (!picked?.length) return null;

  const totalAvailable = picked.reduce(
    (sum, x) => sum + x.available_volume_tons,
    0
  );

  if (totalAvailable < needVolumeTons) {
    return null;
  }

  let remaining = needVolumeTons;
  const sources = [];

  for (const src of picked) {
    if (remaining <= 0) break;

    const shippedVolumeTons = Math.min(src.available_volume_tons, remaining);
    if (shippedVolumeTons <= 0) continue;

    remaining -= shippedVolumeTons;

    const lineWidth = calcLineWidth(shippedVolumeTons, needVolumeTons);
    const isSufficient = shippedVolumeTons >= needVolumeTons;

    const routeSegments = [
      featureFromGeometry(src.road_start_route.geometry, {
        mode: "road_start",
        declarer: src.declarer,
        shipped_volume_tons: shippedVolumeTons,
        line_width: lineWidth,
        is_sufficient: isSufficient,
        total_route_km: src.total_route_km,
        rail_km: src.rail_km,
        road_start_km: src.road_start_km,
        road_end_km: src.road_end_km,
        transport_mode: src.transport_mode ?? "multimodal",
      }),
      featureFromGeometry(src.rail_route.geometry, {
        mode: "rail",
        declarer: src.declarer,
        shipped_volume_tons: shippedVolumeTons,
        line_width: lineWidth,
        is_sufficient: isSufficient,
        total_route_km: src.total_route_km,
        rail_km: src.rail_km,
        road_start_km: src.road_start_km,
        road_end_km: src.road_end_km,
        transport_mode: src.transport_mode ?? "multimodal",
      }),
      featureFromGeometry(src.road_end_route.geometry, {
        mode: "road_end",
        declarer: src.declarer,
        shipped_volume_tons: shippedVolumeTons,
        line_width: lineWidth,
        is_sufficient: isSufficient,
        total_route_km: src.total_route_km,
        rail_km: src.rail_km,
        road_start_km: src.road_start_km,
        road_end_km: src.road_end_km,
        transport_mode: src.transport_mode ?? "multimodal",
      }),
    ].filter((x) => geometryHasCoordinates(x?.geometry));

    sources.push({
      declarer: src.declarer,
      manufacturer: src.manufacturer,
      region: src.region,
      country: src.country,
      product: src.product,
      available_volume_tons: src.available_volume_tons,
      shipped_volume_tons: shippedVolumeTons,
      need_volume_tons: needVolumeTons,
      search_mode: searchMode,
      is_sufficient: isSufficient,
      declaration_ids: src.declaration_ids,
      matched_products: src.matched_products,
      point: src.point,
      direct_distance_km: src.direct_distance_km,
      source_station: src.source_station,
      demand_station: src.demand_station,
      road_start_node: src.road_start_node,
      road_end_node: src.road_end_node,
      road_start_km: src.road_start_km,
      rail_km: src.rail_km,
      road_end_km: src.road_end_km,
      total_route_km: src.total_route_km,
      transport_mode: src.transport_mode ?? "multimodal",
      result_mode: src.result_mode ?? src.transport_mode ?? "multimodal",
      line_width: lineWidth,
      route_segments: routeSegments,
    });
  }

  if (remaining > 0) {
    return null;
  }

  const totalShipped = sources.reduce(
    (sum, x) => sum + x.shipped_volume_tons,
    0
  );

  const weightedRouteScore = sources.reduce((sum, x) => {
    const modePenalty =
      searchMode !== SEARCH_MODE_ROAD && x.transport_mode === "road_only"
        ? ROAD_ONLY_PENALTY_KM
        : 0;
    return sum + (x.total_route_km + modePenalty) * x.shipped_volume_tons;
  }, 0);

  return {
    sources_count: sources.length,
    total_available_volume_tons: round2(totalAvailable),
    total_shipped_volume_tons: round2(totalShipped),
    covers_full_demand: true,
    score: round2(weightedRouteScore),
    total_route_km: round2(
      sources.reduce((sum, x) => sum + x.total_route_km, 0)
    ),
    total_rail_km: round2(sources.reduce((sum, x) => sum + x.rail_km, 0)),
    total_road_start_km: round2(
      sources.reduce((sum, x) => sum + x.road_start_km, 0)
    ),
    total_road_end_km: round2(
      sources.reduce((sum, x) => sum + x.road_end_km, 0)
    ),
    search_mode: searchMode,
    sources,
  };
}

function buildSupplyOptions(candidates, needVolumeTons, maxOptions = 6, searchMode = SEARCH_MODE_MULTIMODAL) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return [];
  }

  const pool = candidates.slice(0, 12);
  const options = [];
  const seen = new Set();

  function pushOption(picked) {
    const option = buildOptionFromCombination(picked, needVolumeTons, searchMode);
    if (!option) return;

    const key = buildOptionKey(option);
    if (seen.has(key)) return;
    seen.add(key);
    options.push(option);
  }

  for (const c of pool) {
    pushOption([c]);
  }

  for (let i = 0; i < Math.min(pool.length, 10); i += 1) {
    for (let j = i + 1; j < Math.min(pool.length, 10); j += 1) {
      pushOption([pool[i], pool[j]]);
    }
  }

  for (let i = 0; i < Math.min(pool.length, 8); i += 1) {
    for (let j = i + 1; j < Math.min(pool.length, 8); j += 1) {
      for (let k = j + 1; k < Math.min(pool.length, 8); k += 1) {
        pushOption([pool[i], pool[j], pool[k]]);
      }
    }
  }

  options.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.sources_count !== b.sources_count) return a.sources_count - b.sources_count;
    return a.total_route_km - b.total_route_km;
  });

  return options.slice(0, maxOptions).map((x, idx) => ({
    option_no: idx + 1,
    ...x,
  }));
}

async function fetchSupplyCandidatesByWave(
  product,
  destLon,
  destLat,
  minDistanceKm,
  maxDistanceKm,
  limit,
  needVolumeTons
) {
  const sql = `
    WITH grouped AS (
      SELECT
        COALESCE(NULLIF(trim(d.declarer), ''), '(без названия)') AS declarer,
        COALESCE(NULLIF(trim(d.manufacturer), ''), '') AS manufacturer,
        COALESCE(NULLIF(trim(d.region), ''), '') AS region,
        COALESCE(NULLIF(trim(d.country), ''), '') AS country,
        d.geom,
        $6::double precision AS available_volume_tons,
        ARRAY_AGG(DISTINCT d.declaration_id) FILTER (WHERE d.declaration_id IS NOT NULL) AS declaration_ids,
        ARRAY[$1::text] AS matched_products,
        ST_Distance(
          d.geom::geography,
          ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
        ) / 1000.0 AS direct_distance_km
      FROM declarations d
      WHERE d.geom IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM unnest(COALESCE(d.product_name, ARRAY[]::text[])) AS pn(val)
          WHERE lower(trim(COALESCE(pn.val, ''))) = lower(trim($1))
        )
      GROUP BY
        COALESCE(NULLIF(trim(d.declarer), ''), '(без названия)'),
        COALESCE(NULLIF(trim(d.manufacturer), ''), ''),
        COALESCE(NULLIF(trim(d.region), ''), ''),
        COALESCE(NULLIF(trim(d.country), ''), ''),
        d.geom
    )
    SELECT
      declarer,
      manufacturer,
      region,
      country,
      available_volume_tons,
      declaration_ids,
      matched_products,
      ST_Y(geom) AS lat,
      ST_X(geom) AS lon,
      direct_distance_km
    FROM grouped
    WHERE direct_distance_km > $4
      AND direct_distance_km <= $5
    ORDER BY direct_distance_km ASC
    LIMIT $7;
  `;

  const r = await declPool.query(sql, [
    product,
    destLon,
    destLat,
    minDistanceKm,
    maxDistanceKm,
    needVolumeTons,
    limit,
  ]);

  return r.rows ?? [];
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;

      if (current >= items.length) {
        return;
      }

      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => run()
  );

  await Promise.all(workers);
  return results;
}

async function preselectRowsForWave(
  rows,
  demandStation,
  nearestStationCache,
  searchMode = SEARCH_MODE_MULTIMODAL
) {
  if (!Array.isArray(rows) || rows.length <= FAST_PRESELECT_PER_WAVE) {
    return rows;
  }

  if (searchMode === SEARCH_MODE_ROAD) {
    return rows
      .slice()
      .sort((a, b) => buildRoadPreferenceScore(a) - buildRoadPreferenceScore(b))
      .slice(0, FAST_PRESELECT_PER_WAVE);
  }

  const scored = [];

  for (const row of rows) {
    const sourceLon = Number(row.lon);
    const sourceLat = Number(row.lat);
    const sourceStationCacheKey = `${sourceLon}|${sourceLat}`;

    let sourceStation = nearestStationCache.get(sourceStationCacheKey) ?? null;
    if (!sourceStation) {
      sourceStation = await getNearestStationByLonLat(railPool, sourceLon, sourceLat);
      nearestStationCache.set(sourceStationCacheKey, sourceStation ?? null);
    }
    if (!sourceStation) continue;

    scored.push({
      row,
      score: buildRailFirstPreferenceScore(row, sourceStation, demandStation),
    });
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, FAST_PRESELECT_PER_WAVE).map((x) => x.row);
}


async function enrichSupplyCandidateMultimodal(
  row,
  product,
  destination,
  demandStation,
  nearestStationCache,
  nearestRoadNodeCache,
  stationRoadNodeCache,
  routeCache,
  searchMode = SEARCH_MODE_MULTIMODAL
) {
  const sourceLon = Number(row.lon);
  const sourceLat = Number(row.lat);
  const destLon = Number(destination.lon);
  const destLat = Number(destination.lat);

  const zeroRoute = {
    meters: 0,
    km: 0,
    geometry: { type: "LineString", coordinates: [] },
  };

  const sourceStationCacheKey = `${sourceLon}|${sourceLat}`;
  let sourceStation = nearestStationCache.get(sourceStationCacheKey) ?? null;

  if (!sourceStation) {
    sourceStation = await getNearestStationByLonLat(railPool, sourceLon, sourceLat);
    nearestStationCache.set(sourceStationCacheKey, sourceStation ?? null);
  }

  if (searchMode === SEARCH_MODE_RAIL) {
    if (!sourceStation) {
      return buildRailRejectedCandidate("source_station_not_found", {
        declarer: row.declarer,
      });
    }

    const sourceStationDistM = Number(sourceStation.dist_m ?? 0);
    const demandStationDistM = Number(demandStation.dist_m ?? 0);

    if (
      Number.isFinite(RAIL_ONLY_MAX_SOURCE_STATION_DIST_M) &&
      RAIL_ONLY_MAX_SOURCE_STATION_DIST_M >= 0 &&
      sourceStationDistM > RAIL_ONLY_MAX_SOURCE_STATION_DIST_M
    ) {
      return buildRailRejectedCandidate("source_station_too_far", {
        declarer: row.declarer,
        source_station_name: sourceStation.name,
        source_station_dist_m: sourceStationDistM,
      });
    }

    const destinationIsExactStation =
      destination.type === "station" &&
      Number.isFinite(Number(destination.osm_id)) &&
      Number(destination.osm_id) === Number(demandStation.osm_id);

    if (
      !destinationIsExactStation &&
      Number.isFinite(RAIL_ONLY_MAX_DEST_STATION_DIST_M) &&
      RAIL_ONLY_MAX_DEST_STATION_DIST_M >= 0 &&
      demandStationDistM > RAIL_ONLY_MAX_DEST_STATION_DIST_M
    ) {
      return buildRailRejectedCandidate("destination_station_too_far", {
        declarer: row.declarer,
        demand_station_name: demandStation.name,
        demand_station_dist_m: demandStationDistM,
      });
    }

    if (Number(sourceStation.osm_id) === Number(demandStation.osm_id)) {
      return buildRailRejectedCandidate("same_station", {
        declarer: row.declarer,
        source_station_name: sourceStation.name,
        demand_station_name: demandStation.name,
      });
    }

    const railKey = `rail:${sourceStation.node_id}->${demandStation.node_id}`;
    let railRoute = routeCache.get(railKey) ?? null;
    if (!railRoute) {
      railRoute = await buildRailRouteByNodes(
        railPool,
        Number(sourceStation.node_id),
        Number(demandStation.node_id)
      );
      routeCache.set(railKey, railRoute ?? null);
    }

    if (!railRoute || Number(railRoute.km) <= 0) {
      return buildRailRejectedCandidate("rail_route_not_found", {
        declarer: row.declarer,
        source_station_name: sourceStation.name,
        demand_station_name: demandStation.name,
      });
    }

    return {
      declarer: row.declarer,
      manufacturer: row.manufacturer,
      region: row.region,
      country: row.country,
      product,
      available_volume_tons: Number(row.available_volume_tons),
      declaration_ids: row.declaration_ids ?? [],
      matched_products: row.matched_products ?? [],
      point: {
        lat: sourceLat,
        lon: sourceLon,
      },
      direct_distance_km: Number(row.direct_distance_km),
      source_station: {
        osm_id: Number(sourceStation.osm_id),
        name: sourceStation.name,
        dist_m: sourceStationDistM,
      },
      demand_station: {
        osm_id: Number(demandStation.osm_id),
        name: demandStation.name,
        dist_m: demandStationDistM,
      },
      road_start_node: null,
      road_end_node: null,
      road_start_km: 0,
      rail_km: Number(railRoute.km),
      road_end_km: 0,
      total_route_km: round2(Number(railRoute.km)),
      transport_mode: "rail_only",
      result_mode: SEARCH_MODE_RAIL,
      road_start_route: zeroRoute,
      rail_route: railRoute,
      road_end_route: zeroRoute,
    };
  }

  const sourceRoadSnapKey = `srcsnap|${sourceLon}|${sourceLat}`;
  let sourceRoadSnap = nearestRoadNodeCache.get(sourceRoadSnapKey) ?? null;
  if (!sourceRoadSnap) {
    sourceRoadSnap = await getNearestRoadSnapByLonLat(railPool, sourceLon, sourceLat);
    nearestRoadNodeCache.set(sourceRoadSnapKey, sourceRoadSnap ?? null);
  }
  if (!sourceRoadSnap) {
    return null;
  }

  const destRoadSnapKey = `destsnap|${destLon}|${destLat}`;
  let destRoadSnap = nearestRoadNodeCache.get(destRoadSnapKey) ?? null;
  if (!destRoadSnap) {
    destRoadSnap = await getNearestRoadSnapByLonLat(railPool, destLon, destLat);
    nearestRoadNodeCache.set(destRoadSnapKey, destRoadSnap ?? null);
  }
  if (!destRoadSnap) {
    return null;
  }

  const directRoadKey = `road_direct:${sourceRoadSnap.segment_id}:${sourceRoadSnap.source}:${sourceRoadSnap.target}->${destRoadSnap.segment_id}:${destRoadSnap.source}:${destRoadSnap.target}`;
  let directRoadRoute = routeCache.get(directRoadKey) ?? null;
  if (!directRoadRoute) {
    directRoadRoute = await buildRoadRouteSnapToSnap(railPool, sourceRoadSnap, destRoadSnap, {
      allowWideSearch: true,
    });

    if (!directRoadRoute && !STRICT_ROAD_GEOMETRY) {
      directRoadRoute = buildDirectLineRoute(sourceLon, sourceLat, destLon, destLat);
    }

    routeCache.set(directRoadKey, directRoadRoute ?? null);
  }

  if (searchMode === SEARCH_MODE_ROAD) {
    if (!directRoadRoute) {
      return null;
    }

    return {
      declarer: row.declarer,
      manufacturer: row.manufacturer,
      region: row.region,
      country: row.country,
      product,
      available_volume_tons: Number(row.available_volume_tons),
      declaration_ids: row.declaration_ids ?? [],
      matched_products: row.matched_products ?? [],
      point: {
        lat: sourceLat,
        lon: sourceLon,
      },
      direct_distance_km: Number(row.direct_distance_km),
      source_station: sourceStation
        ? {
            osm_id: Number(sourceStation.osm_id),
            name: sourceStation.name,
            dist_m: Number(sourceStation.dist_m),
          }
        : null,
      demand_station: {
        osm_id: Number(demandStation.osm_id),
        name: demandStation.name,
        dist_m: Number(demandStation.dist_m),
      },
      road_start_node: {
        id: Number(sourceRoadSnap.segment_id),
        lon: Number(sourceRoadSnap.snap_lon),
        lat: Number(sourceRoadSnap.snap_lat),
      },
      road_end_node: {
        id: Number(destRoadSnap.segment_id),
        lon: Number(destRoadSnap.snap_lon),
        lat: Number(destRoadSnap.snap_lat),
      },
      road_start_km: Number(directRoadRoute.km),
      rail_km: 0,
      road_end_km: 0,
      total_route_km: round2(Number(directRoadRoute.km)),
      transport_mode: "road_only",
      result_mode: SEARCH_MODE_ROAD,
      road_start_route: directRoadRoute,
      rail_route: zeroRoute,
      road_end_route: zeroRoute,
    };
  }

  if (!sourceStation) {
    return null;
  }

  const sourceStationRoadNodeKey = `station|${sourceStation.osm_id}`;
  let sourceStationRoadNode = stationRoadNodeCache.get(sourceStationRoadNodeKey) ?? null;
  if (!sourceStationRoadNode) {
    sourceStationRoadNode = await getRoadNodeForStation(railPool, Number(sourceStation.osm_id));
    stationRoadNodeCache.set(sourceStationRoadNodeKey, sourceStationRoadNode ?? null);
  }
  if (!sourceStationRoadNode) {
    return null;
  }

  const demandStationRoadNodeKey = `station|${demandStation.osm_id}`;
  let demandStationRoadNode = stationRoadNodeCache.get(demandStationRoadNodeKey) ?? null;
  if (!demandStationRoadNode) {
    demandStationRoadNode = await getRoadNodeForStation(railPool, Number(demandStation.osm_id));
    stationRoadNodeCache.set(demandStationRoadNodeKey, demandStationRoadNode ?? null);
  }
  if (!demandStationRoadNode) {
    return null;
  }

  const roadStartKey = `road_snap:${sourceRoadSnap.segment_id}:${sourceRoadSnap.source}:${sourceRoadSnap.target}->${sourceStationRoadNode.id}`;
  let roadStartRoute = routeCache.get(roadStartKey) ?? null;
  if (!roadStartRoute) {
    roadStartRoute = await buildRoadRouteFromSnapToNode(
      railPool,
      sourceRoadSnap,
      Number(sourceStationRoadNode.id),
      { allowWideSearch: false }
    );

    if (!roadStartRoute && !STRICT_ROAD_GEOMETRY) {
      roadStartRoute = buildDirectLineRoute(
        sourceLon,
        sourceLat,
        Number(sourceStationRoadNode.lon),
        Number(sourceStationRoadNode.lat)
      );
    }

    routeCache.set(roadStartKey, roadStartRoute ?? null);
  }

  const railKey = `rail:${sourceStation.node_id}->${demandStation.node_id}`;
  let railRoute = routeCache.get(railKey) ?? null;
  if (!railRoute) {
    railRoute = await buildRailRouteByNodes(
      railPool,
      Number(sourceStation.node_id),
      Number(demandStation.node_id)
    );
    routeCache.set(railKey, railRoute ?? null);
  }

  let roadEndRoute = null;
  if (
    destination.type === "station" &&
    Number.isFinite(Number(destination.osm_id)) &&
    Number(destination.osm_id) === Number(demandStation.osm_id)
  ) {
    roadEndRoute = zeroRoute;
  } else {
    const roadEndKey = `road_node:${demandStationRoadNode.id}->snap:${destRoadSnap.segment_id}:${destRoadSnap.source}:${destRoadSnap.target}`;
    roadEndRoute = routeCache.get(roadEndKey) ?? null;

    if (!roadEndRoute) {
      roadEndRoute = await buildRoadRouteFromNodeToSnap(
        railPool,
        Number(demandStationRoadNode.id),
        destRoadSnap,
        { allowWideSearch: false }
      );

      if (!roadEndRoute && !STRICT_ROAD_GEOMETRY) {
        roadEndRoute = buildDirectLineRoute(
          Number(demandStationRoadNode.lon),
          Number(demandStationRoadNode.lat),
          destLon,
          destLat
        );
      }

      routeCache.set(roadEndKey, roadEndRoute ?? null);
    }
  }

  const roadOnlySummary = directRoadRoute ? buildRoadOnlySummary(directRoadRoute, false) : null;
  const railOnlySummary = railRoute && Number(railRoute.km) > 0 ? buildRailOnlySummary(railRoute, false) : null;
  const multimodalSummary =
    roadStartRoute && railRoute && roadEndRoute && Number(railRoute.km) > 0
      ? buildMultimodalSummary({
          roadStartRoute,
          railRoute,
          roadEndRoute,
          sameStation: false,
        })
      : null;

  let selectedSummary = null;
  if (searchMode === SEARCH_MODE_ROAD) {
    selectedSummary = roadOnlySummary;
  } else if (searchMode === SEARCH_MODE_RAIL) {
    selectedSummary = railOnlySummary;
  } else {
    selectedSummary = chooseRouteSummary({
      roadOnly: roadOnlySummary,
      multimodal: multimodalSummary,
      railOnly: railOnlySummary,
      preference: ROUTE_PREF_BEST,
      sameStation: false,
    });
  }

  if (!selectedSummary) {
    return null;
  }

  return {
    declarer: row.declarer,
    manufacturer: row.manufacturer,
    region: row.region,
    country: row.country,
    product,
    available_volume_tons: Number(row.available_volume_tons),
    declaration_ids: row.declaration_ids ?? [],
    matched_products: row.matched_products ?? [],
    point: {
      lat: sourceLat,
      lon: sourceLon,
    },
    direct_distance_km: Number(row.direct_distance_km),
    source_station: {
      osm_id: Number(sourceStation.osm_id),
      name: sourceStation.name,
      dist_m: Number(sourceStation.dist_m),
    },
    demand_station: {
      osm_id: Number(demandStation.osm_id),
      name: demandStation.name,
      dist_m: Number(demandStation.dist_m),
    },
    road_start_node: {
      id: Number(sourceRoadSnap.segment_id),
      lon: Number(sourceRoadSnap.snap_lon),
      lat: Number(sourceRoadSnap.snap_lat),
    },
    road_end_node: {
      id: Number(destRoadSnap.segment_id),
      lon: Number(destRoadSnap.snap_lon),
      lat: Number(destRoadSnap.snap_lat),
    },
    road_start_km: Number(selectedSummary.road_start_km),
    rail_km: Number(selectedSummary.rail_km),
    road_end_km: Number(selectedSummary.road_end_km),
    total_route_km: round2(Number(selectedSummary.total_route_km)),
    transport_mode: selectedSummary.selected_mode,
    result_mode:
      selectedSummary.selected_mode === "road_only"
        ? SEARCH_MODE_ROAD
        : selectedSummary.selected_mode === "rail_only"
        ? SEARCH_MODE_RAIL
        : SEARCH_MODE_MULTIMODAL,
    road_start_route: selectedSummary.road_start_route,
    rail_route: selectedSummary.rail_route,
    road_end_route: selectedSummary.road_end_route,
  };
}

function getOptionsSignature(options) {
  return JSON.stringify(
    (options || []).map((x) => ({
      key: buildOptionKey(x),
      score: x.score,
      shipped: x.total_shipped_volume_tons,
    }))
  );
}


function formatTons(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0 т";
  return `${round2(n)} т`;
}

function normalizeMapPointType(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "station" || normalized === "port" || normalized === "elevator") {
    return normalized;
  }
  return "station";
}

function normalizeMapPointInput(raw) {
  if (!raw || typeof raw !== "object") return null;

  const pointType = normalizeMapPointType(raw.type);
  const lon = asNum(raw.lon, NaN);
  const lat = asNum(raw.lat, NaN);
  const osmId = raw.osm_id == null ? null : Number(raw.osm_id);

  return {
    type: pointType,
    osm_id: Number.isFinite(osmId) ? osmId : null,
    name: String(raw.name ?? "").trim(),
    lon: Number.isFinite(lon) ? lon : null,
    lat: Number.isFinite(lat) ? lat : null,
  };
}

function buildPointFeature(point, properties = {}) {
  if (!point || point.lon == null || point.lat == null) {
    return null;
  }

  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [Number(point.lon), Number(point.lat)],
    },
    properties,
  };
}

function normalizeNotebookLmParsedPayload(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.market_signals)) return parsed.market_signals;
  if (Array.isArray(parsed?.signals)) return parsed.signals;
  return parsed;
}

function buildRouteSegmentsFromSummary(routeSummary, properties = {}) {
  if (!routeSummary) return [];

  const features = [];

  const pushFeature = (geometry, mode, extra = {}) => {
    if (!geometryHasCoordinates(geometry)) return;
    features.push(
      featureFromGeometry(geometry, {
        mode,
        ...properties,
        ...extra,
      })
    );
  };

  pushFeature(routeSummary.road_start_route?.geometry, "road_start");
  pushFeature(routeSummary.rail_route?.geometry, "rail");
  pushFeature(routeSummary.road_end_route?.geometry, "road_end");

  return features;
}

async function queryOptional(client, sql, params = []) {
  try {
    return await client.query(sql, params);
  } catch (e) {
    if (e?.code === "42P01") {
      return null;
    }
    throw e;
  }
}

async function getPointByTypeAndOsmId(client, type, osmId) {
  const normalizedType = normalizeMapPointType(type);

  if (!Number.isFinite(Number(osmId))) {
    return null;
  }

  if (normalizedType === "station") {
    const sql = `
      SELECT
        'station'::text AS type,
        s.osm_id,
        COALESCE(s.name, '(без названия)') AS name,
        ST_X(ST_Transform(s.geom, 4326)) AS lon,
        ST_Y(ST_Transform(s.geom, 4326)) AS lat
      FROM rail.stations s
      WHERE s.osm_id = $1
      LIMIT 1;
    `;
    const r = await client.query(sql, [Number(osmId)]);
    return r.rows?.[0] ?? null;
  }

  if (normalizedType === "port") {
    const sql = `
      SELECT
        'port'::text AS type,
        p.osm_id,
        COALESCE(p.name, 'Порт') AS name,
        ST_X(ST_Transform(p.geom, 4326)) AS lon,
        ST_Y(ST_Transform(p.geom, 4326)) AS lat
      FROM rail.port_terminals p
      WHERE p.osm_id = $1
      LIMIT 1;
    `;
    const r = await client.query(sql, [Number(osmId)]);
    return r.rows?.[0] ?? null;
  }

  const sql = `
    SELECT
      'elevator'::text AS type,
      e.osm_id,
      COALESCE(e.name, 'Элеватор') AS name,
      ST_X(ST_Transform(e.geom, 4326)) AS lon,
      ST_Y(ST_Transform(e.geom, 4326)) AS lat
    FROM rail.elevators e
    WHERE e.osm_id = $1
    LIMIT 1;
  `;
  const r = await client.query(sql, [Number(osmId)]);
  return r.rows?.[0] ?? null;
}

async function hydrateMapPoint(client, pointInput) {
  const point = normalizeMapPointInput(pointInput);
  if (!point) return null;

  const cacheKey = JSON.stringify([
    point.type,
    point.osm_id,
    point.lon != null ? Number(point.lon).toFixed(6) : null,
    point.lat != null ? Number(point.lat).toFixed(6) : null,
  ]);
  const cached = getCachedValue(hydratedPointCache, cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let result = null;

  if (point.osm_id != null) {
    const hydrated = await getPointByTypeAndOsmId(client, point.type, point.osm_id);
    if (hydrated) {
      result = {
        type: hydrated.type,
        osm_id: Number(hydrated.osm_id),
        name: hydrated.name,
        lon: Number(hydrated.lon),
        lat: Number(hydrated.lat),
      };
    }
  }

  if (!result && point.lon != null && point.lat != null) {
    result = point;
  }

  setCachedValue(hydratedPointCache, cacheKey, result, MAX_HYDRATED_POINT_CACHE);
  return result;
}


function normalizeAnchorSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/["«»']/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(
      /\b(ооо|ао|пао|зао|оао|ип|гк|апх|холдинг|группа компаний|терминал|зерновой|комбинат|хлебопродуктов|пккз|нкхп)\b/gi,
      " "
    )
    .replace(/[^a-zа-яё0-9\- ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}


async function resolveMarketAnchor(client, signal) {
  const preferredType = pickPreferredPointType(signal);
  const city = String(signal?.city || "").trim();
  const region = String(signal?.region || "").trim();
  const anchorName = String(signal?.anchor_name || "").trim();

  const searchTerms = [
    city,
    normalizeAnchorSearchText(anchorName),
    anchorName,
    region,
  ].filter(Boolean);
  if (!searchTerms.length) return null;

  const cacheKey = JSON.stringify([preferredType, city, region, anchorName]);
  const cached = getCachedValue(resolvedAnchorCache, cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  for (const term of searchTerms) {
    const candidates = [];

    const stationRows = await queryOptional(
      client,
      `
      SELECT
        'station'::text AS point_type,
        s.osm_id,
        COALESCE(s.name, '(без названия)') AS name,
        ST_X(ST_Transform(s.geom, 4326)) AS lon,
        ST_Y(ST_Transform(s.geom, 4326)) AS lat,
        CASE
          WHEN lower(COALESCE(s.name, '')) = lower($1) THEN 0
          WHEN lower(COALESCE(s.name, '')) LIKE lower($1 || '%') THEN 1
          WHEN lower(COALESCE(s.name, '')) LIKE lower('%' || $1 || '%') THEN 2
          ELSE 9
        END AS name_rank
      FROM rail.stations s
      WHERE lower(COALESCE(s.name, '')) LIKE lower('%' || $1 || '%')
      LIMIT 12
      `,
      [term]
    );
    if (stationRows?.rows?.length) candidates.push(...stationRows.rows);

    for (const rel of ["rail.port_terminals", "public.port_terminals"]) {
      const r = await queryOptional(
        client,
        `
        SELECT
          'port'::text AS point_type,
          p.osm_id,
          COALESCE(p.name, 'Порт') AS name,
          ST_X(ST_Transform(p.geom, 4326)) AS lon,
          ST_Y(ST_Transform(p.geom, 4326)) AS lat,
          CASE
            WHEN lower(COALESCE(p.name, '')) = lower($1) THEN 0
            WHEN lower(COALESCE(p.name, '')) LIKE lower($1 || '%') THEN 1
            WHEN lower(COALESCE(p.name, '')) LIKE lower('%' || $1 || '%') THEN 2
            ELSE 9
          END AS name_rank
        FROM ${rel} p
        WHERE lower(COALESCE(p.name, '')) LIKE lower('%' || $1 || '%')
        LIMIT 8
        `,
        [term]
      );
      if (r?.rows?.length) candidates.push(...r.rows);
    }

    for (const rel of ["rail.elevators", "public.elevators"]) {
      const r = await queryOptional(
        client,
        `
        SELECT
          'elevator'::text AS point_type,
          e.osm_id,
          COALESCE(e.name, 'Элеватор') AS name,
          ST_X(ST_Transform(e.geom, 4326)) AS lon,
          ST_Y(ST_Transform(e.geom, 4326)) AS lat,
          CASE
            WHEN lower(COALESCE(e.name, '')) = lower($1) THEN 0
            WHEN lower(COALESCE(e.name, '')) LIKE lower($1 || '%') THEN 1
            WHEN lower(COALESCE(e.name, '')) LIKE lower('%' || $1 || '%') THEN 2
            ELSE 9
          END AS name_rank
        FROM ${rel} e
        WHERE lower(COALESCE(e.name, '')) LIKE lower('%' || $1 || '%')
        LIMIT 8
        `,
        [term]
      );
      if (r?.rows?.length) candidates.push(...r.rows);
    }

    if (!candidates.length) continue;

    candidates.sort((a, b) => {
      const prefA = a.point_type === preferredType ? 0 : 5;
      const prefB = b.point_type === preferredType ? 0 : 5;
      return (
        prefA - prefB ||
        Number(a.name_rank || 9) - Number(b.name_rank || 9) ||
        String(a.name || "").length - String(b.name || "").length
      );
    });

    const row = candidates[0];
    const result = {
      type: row.point_type,
      osm_id: Number(row.osm_id),
      name: row.name,
      lon: Number(row.lon),
      lat: Number(row.lat),
    };
    setCachedValue(resolvedAnchorCache, cacheKey, result, MAX_RESOLVED_ANCHOR_CACHE);
    return result;
  }

  setCachedValue(resolvedAnchorCache, cacheKey, null, MAX_RESOLVED_ANCHOR_CACHE);
  return null;
}

async function resolveDemandStationForPoint(client, point) {
  if (!point) return null;

  if (point.type === "station" && Number.isFinite(Number(point.osm_id))) {
    return getStationByOsmId(client, Number(point.osm_id));
  }

  if (point.lon != null && point.lat != null) {
    return getNearestStationByLonLat(client, Number(point.lon), Number(point.lat));
  }

  return null;
}

function toRad(value) {
  return (Number(value) * Math.PI) / 180;
}

function roughDistanceKm(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const lat1 = Number(a.lat);
  const lon1 = Number(a.lon);
  const lat2 = Number(b.lat);
  const lon2 = Number(b.lon);

  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) {
    return Number.POSITIVE_INFINITY;
  }

  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return round2(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

function sortSignalsByBaseProximity(signals, basePoint, role, limit = RECOMMENDATION_SIGNAL_LIMIT) {
  const sorted = signals
    .filter((x) => x.resolved && x.role === role)
    .map((x) => ({
      ...x,
      base_distance_km: roughDistanceKm(basePoint, x.resolved_point),
    }))
    .sort((a, b) => {
      if (a.base_distance_km !== b.base_distance_km) {
        return a.base_distance_km - b.base_distance_km;
      }
      if (Number(b.signal_score || 0) !== Number(a.signal_score || 0)) {
        return Number(b.signal_score || 0) - Number(a.signal_score || 0);
      }
      return Number(b.confidence || 0) - Number(a.confidence || 0);
    });

  const local = sorted.filter(
    (x) => Number.isFinite(x.base_distance_km) && x.base_distance_km <= RECOMMENDATION_LOCAL_DISTANCE_KM
  );

  if (local.length >= Math.min(3, limit)) {
    return local.slice(0, limit);
  }

  return sorted.slice(0, limit);
}

function sortSignalsForTrader(signals, role, limit = RECOMMENDATION_TRADER_SIDE_LIMIT) {
  return signals
    .filter((x) => x.resolved && x.role === role)
    .sort((a, b) => {
      if (Number(b.signal_score || 0) !== Number(a.signal_score || 0)) {
        return Number(b.signal_score || 0) - Number(a.signal_score || 0);
      }
      return Number(b.confidence || 0) - Number(a.confidence || 0);
    })
    .slice(0, limit);
}

async function evaluateDeliveryRoute({
  origin,
  destination,
  routePreference = ROUTE_PREF_BEST,
  nearestStationCache,
  nearestRoadNodeCache,
  stationRoadNodeCache,
  routeCache,
}) {
  const normalizedOrigin = await hydrateMapPoint(railPool, origin);
  const normalizedDestination = await hydrateMapPoint(railPool, destination);

  if (!normalizedOrigin || !normalizedDestination) {
    return null;
  }

  const cacheKey = JSON.stringify({
    origin: [normalizedOrigin.type, normalizedOrigin.osm_id, normalizedOrigin.lon, normalizedOrigin.lat],
    destination: [normalizedDestination.type, normalizedDestination.osm_id, normalizedDestination.lon, normalizedDestination.lat],
    routePreference,
  });
  const cached = getCachedValue(deliveryRouteCache, cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const originLon = Number(normalizedOrigin.lon);
  const originLat = Number(normalizedOrigin.lat);
  const destLon = Number(normalizedDestination.lon);
  const destLat = Number(normalizedDestination.lat);

  const originStation =
    normalizedOrigin.type === "station" && normalizedOrigin.osm_id != null
      ? await getStationByOsmId(railPool, Number(normalizedOrigin.osm_id))
      : await resolveDemandStationForPoint(railPool, normalizedOrigin);

  const destinationStation =
    normalizedDestination.type === "station" && normalizedDestination.osm_id != null
      ? await getStationByOsmId(railPool, Number(normalizedDestination.osm_id))
      : await resolveDemandStationForPoint(railPool, normalizedDestination);

  const originRoadSnapKey = `origin-road-snap|${originLon}|${originLat}`;
  let originRoadSnap = nearestRoadNodeCache.get(originRoadSnapKey) ?? null;
  if (!originRoadSnap) {
    originRoadSnap = await getNearestRoadSnapByLonLat(railPool, originLon, originLat);
    nearestRoadNodeCache.set(originRoadSnapKey, originRoadSnap ?? null);
  }

  const destinationRoadSnapKey = `destination-road-snap|${destLon}|${destLat}`;
  let destinationRoadSnap = nearestRoadNodeCache.get(destinationRoadSnapKey) ?? null;
  if (!destinationRoadSnap) {
    destinationRoadSnap = await getNearestRoadSnapByLonLat(railPool, destLon, destLat);
    nearestRoadNodeCache.set(destinationRoadSnapKey, destinationRoadSnap ?? null);
  }

  let roadOnlySummary = null;
  if (originRoadSnap && destinationRoadSnap) {
    const directRoadKey = `generic-road:${originRoadSnap.segment_id}:${originRoadSnap.source}:${originRoadSnap.target}->${destinationRoadSnap.segment_id}:${destinationRoadSnap.source}:${destinationRoadSnap.target}`;
    let directRoadRoute = routeCache.get(directRoadKey) ?? null;

    if (!directRoadRoute) {
      directRoadRoute = await buildRoadRouteSnapToSnap(railPool, originRoadSnap, destinationRoadSnap, {
        allowWideSearch: true,
      });

      if (!directRoadRoute && !STRICT_ROAD_GEOMETRY) {
        directRoadRoute = buildDirectLineRoute(originLon, originLat, destLon, destLat);
      }

      routeCache.set(directRoadKey, directRoadRoute ?? null);
    }

    if (directRoadRoute) {
      roadOnlySummary = buildRoadOnlySummary(directRoadRoute, false);
    }
  }

  let railOnlySummary = null;
  let multimodalSummary = null;
  let sameStation = false;

  if (originStation && destinationStation) {
    sameStation = Number(originStation.osm_id) === Number(destinationStation.osm_id);

    let railRoute = null;
    if (!sameStation) {
      const railKey = `generic-rail:${originStation.node_id}->${destinationStation.node_id}`;
      railRoute = routeCache.get(railKey) ?? null;
      if (!railRoute) {
        railRoute = await buildRailRouteByNodes(
          railPool,
          Number(originStation.node_id),
          Number(destinationStation.node_id)
        );
        routeCache.set(railKey, railRoute ?? null);
      }
    }

    if (railRoute && Number(railRoute.km) > 0) {
      railOnlySummary = buildRailOnlySummary(railRoute, sameStation);
    }

    const originStationRoadNodeKey = `generic-station-road|${originStation.osm_id}`;
    let originStationRoadNode = stationRoadNodeCache.get(originStationRoadNodeKey) ?? null;
    if (!originStationRoadNode) {
      originStationRoadNode = await getRoadNodeForStation(railPool, Number(originStation.osm_id));
      stationRoadNodeCache.set(originStationRoadNodeKey, originStationRoadNode ?? null);
    }

    const destinationStationRoadNodeKey = `generic-station-road|${destinationStation.osm_id}`;
    let destinationStationRoadNode = stationRoadNodeCache.get(destinationStationRoadNodeKey) ?? null;
    if (!destinationStationRoadNode) {
      destinationStationRoadNode = await getRoadNodeForStation(railPool, Number(destinationStation.osm_id));
      stationRoadNodeCache.set(destinationStationRoadNodeKey, destinationStationRoadNode ?? null);
    }

    if (
      originRoadSnap &&
      destinationRoadSnap &&
      originStationRoadNode &&
      destinationStationRoadNode &&
      railRoute &&
      Number(railRoute.km) > 0
    ) {
      const roadStartKey = `generic-road-start:${originRoadSnap.segment_id}:${originRoadSnap.source}:${originRoadSnap.target}->${originStationRoadNode.id}`;
      let roadStartRoute = routeCache.get(roadStartKey) ?? null;
      if (!roadStartRoute) {
        roadStartRoute = await buildRoadRouteFromSnapToNode(
          railPool,
          originRoadSnap,
          Number(originStationRoadNode.id),
          { allowWideSearch: false }
        );

        if (!roadStartRoute && !STRICT_ROAD_GEOMETRY) {
          roadStartRoute = buildDirectLineRoute(
            originLon,
            originLat,
            Number(originStationRoadNode.lon),
            Number(originStationRoadNode.lat)
          );
        }

        routeCache.set(roadStartKey, roadStartRoute ?? null);
      }

      const roadEndKey = `generic-road-end:${destinationStationRoadNode.id}->${destinationRoadSnap.segment_id}:${destinationRoadSnap.source}:${destinationRoadSnap.target}`;
      let roadEndRoute = routeCache.get(roadEndKey) ?? null;
      if (!roadEndRoute) {
        roadEndRoute = await buildRoadRouteFromNodeToSnap(
          railPool,
          Number(destinationStationRoadNode.id),
          destinationRoadSnap,
          { allowWideSearch: false }
        );

        if (!roadEndRoute && !STRICT_ROAD_GEOMETRY) {
          roadEndRoute = buildDirectLineRoute(
            Number(destinationStationRoadNode.lon),
            Number(destinationStationRoadNode.lat),
            destLon,
            destLat
          );
        }

        routeCache.set(roadEndKey, roadEndRoute ?? null);
      }

      if (roadStartRoute && roadEndRoute) {
        multimodalSummary = buildMultimodalSummary({
          roadStartRoute,
          railRoute,
          roadEndRoute,
          sameStation,
        });
      }
    }
  }

  if (roadOnlySummary) roadOnlySummary.same_station = sameStation;
  if (railOnlySummary) railOnlySummary.same_station = sameStation;
  if (multimodalSummary) multimodalSummary.same_station = sameStation;

  const selected = chooseRouteSummary({
    roadOnly: roadOnlySummary,
    multimodal: multimodalSummary,
    railOnly: railOnlySummary,
    preference: routePreference,
    sameStation,
  });

  if (!selected) {
    setCachedValue(deliveryRouteCache, cacheKey, null, MAX_DELIVERY_ROUTE_CACHE);
    return null;
  }

  const result = {
    origin: normalizedOrigin,
    destination: normalizedDestination,
    origin_station: originStation
      ? {
          osm_id: Number(originStation.osm_id),
          name: originStation.name,
          dist_m: Number(originStation.dist_m ?? 0),
        }
      : null,
    destination_station: destinationStation
      ? {
          osm_id: Number(destinationStation.osm_id),
          name: destinationStation.name,
          dist_m: Number(destinationStation.dist_m ?? 0),
        }
      : null,
    selected_mode: selected.selected_mode,
    road_start_route: selected.road_start_route,
    rail_route: selected.rail_route,
    road_end_route: selected.road_end_route,
    road_start_km: round2(selected.road_start_km),
    rail_km: round2(selected.rail_km),
    road_end_km: round2(selected.road_end_km),
    road_total_km: round2(selected.road_total_km),
    total_route_km: round2(selected.total_route_km),
    same_station: Boolean(selected.same_station),
  };

  setCachedValue(deliveryRouteCache, cacheKey, result, MAX_DELIVERY_ROUTE_CACHE);
  return result;
}

app.get("/health", async (_req, res) => {
  try {
    const rail = await railPool.query(
      "select current_user as u, current_database() as d"
    );

    let decl = null;
    if (process.env.DECL_DB_HOST) {
      const r = await declPool.query(
        "select current_user as u, current_database() as d"
      );
      decl = r.rows?.[0] ?? null;
    }

    const roadCheck = await railPool.query(`
      SELECT
        (SELECT COUNT(*) FROM road.nodes) AS road_nodes_count,
        (SELECT COUNT(*) FROM road.segments) AS road_segments_count,
        (SELECT COUNT(*) FROM road.station_road_nodes) AS station_road_links_count,
        (
          SELECT percentile_cont(0.5) within group (order by dist_m)
          FROM road.station_road_nodes
        ) AS station_road_p50_m,
        (
          SELECT percentile_cont(0.9) within group (order by dist_m)
          FROM road.station_road_nodes
        ) AS station_road_p90_m,
        (
          SELECT max(dist_m)
          FROM road.station_road_nodes
        ) AS station_road_max_m
    `);

    res.json({
      ok: true,
      rail: rail.rows?.[0] ?? null,
      declarations: decl,
      road: roadCheck.rows?.[0] ?? null,
      strict_road_geometry: STRICT_ROAD_GEOMETRY,
      main_road_component: MAIN_ROAD_COMPONENT,
      road_only_penalty_km: ROAD_ONLY_PENALTY_KM,
      rail_only_max_source_station_dist_m: RAIL_ONLY_MAX_SOURCE_STATION_DIST_M,
      rail_only_max_dest_station_dist_m: RAIL_ONLY_MAX_DEST_STATION_DIST_M,
      fast_preselect_per_wave: FAST_PRESELECT_PER_WAVE,
      search_modes: Array.from(SEARCH_MODES),
    });
  } catch (e) {
    console.error("DB ERROR:", e);
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

app.get("/route", async (req, res) => {
  const from = Number(req.query.from);
  const to = Number(req.query.to);

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    res.status(400).send("from/to must be numeric osm_id");
    return;
  }

  const sqlRoute = `
WITH a AS (
  SELECT node_id::bigint AS node_id
  FROM rail.station_nodes
  WHERE osm_id = $1
  LIMIT 1
),
b AS (
  SELECT node_id::bigint AS node_id
  FROM rail.station_nodes
  WHERE osm_id = $2
  LIMIT 1
),
route AS (
  SELECT * FROM pgr_dijkstra(
    'SELECT id, source, target, cost, cost AS reverse_cost FROM rail.track_segments'::text,
    (SELECT node_id FROM a),
    (SELECT node_id FROM b),
    true::boolean
  )
),
geom AS (
  SELECT
    ST_LineMerge(ST_Union(ts.geom)) AS geom3857,
    SUM(ts.cost) AS meters
  FROM route r
  JOIN rail.track_segments ts ON ts.id = r.edge
  WHERE r.edge <> -1
)
SELECT
  meters,
  ST_AsGeoJSON(ST_Transform(geom3857, 4326)) AS geojson
FROM geom;
`;

  const sqlStations = `
WITH a AS (
  SELECT node_id FROM rail.station_nodes WHERE osm_id = $1 LIMIT 1
),
b AS (
  SELECT node_id FROM rail.station_nodes WHERE osm_id = $2 LIMIT 1
),
route AS (
  SELECT * FROM pgr_dijkstra(
    'SELECT id, source, target, cost, cost AS reverse_cost FROM rail.track_segments',
    (SELECT node_id FROM a),
    (SELECT node_id FROM b),
    true
  )
),
route_edges AS (
  SELECT ts.id, ts.geom, r.path_seq
  FROM route r
  JOIN rail.track_segments ts ON ts.id = r.edge
  WHERE r.edge <> -1
),
hits AS (
  SELECT
    s.osm_id,
    COALESCE(s.name,'(без названия)') AS name,
    MIN(re.path_seq) AS ord
  FROM route_edges re
  JOIN rail.stations s
    ON ST_DWithin(s.geom, re.geom, 60)
  GROUP BY s.osm_id, s.name
)
SELECT osm_id, name, ord
FROM hits
ORDER BY ord, name;
`;

  try {
    const r1 = await railPool.query(sqlRoute, [from, to]);
    const row = r1.rows?.[0];

    if (!row || row.meters == null || row.geojson == null) {
      res.status(404).send("route not found");
      return;
    }

    const meters = Number(row.meters);
    const km = round2(meters / 1000);

    const r2 = await railPool.query(sqlStations, [from, to]);
    const stations = r2.rows.map((x, i) => ({
      index: i + 1,
      osm_id: Number(x.osm_id),
      name: x.name,
    }));

    res.json({
      ok: true,
      from,
      to,
      meters,
      km,
      route: {
        type: "Feature",
        properties: { meters, km },
        geometry: JSON.parse(row.geojson),
      },
      stations,
    });
  } catch (e) {
    console.error(e);
    res.status(500).send(String(e?.message ?? e));
  }
});

app.get("/api/products", async (_req, res) => {
  if (!process.env.DECL_DB_HOST) {
    res.status(500).json({ error: "DECL_DB_HOST is not configured" });
    return;
  }

  const sql = `
    SELECT DISTINCT trim(x.product_name) AS product_name
    FROM declarations d
    CROSS JOIN LATERAL unnest(d.product_name) AS x(product_name)
    WHERE x.product_name IS NOT NULL
      AND trim(x.product_name) <> ''
    ORDER BY 1;
  `;

  try {
    const r = await declPool.query(sql);
    res.json(r.rows.map((row) => row.product_name));
  } catch (e) {
    console.error("GET /api/products:", e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.post("/api/supply/search", async (req, res) => {
  if (!process.env.DECL_DB_HOST) {
    res.status(500).json({ error: "DECL_DB_HOST is not configured" });
    return;
  }

  console.log("SUPPLY SEARCH REQUEST:", JSON.stringify(req.body, null, 2));

  const product = String(req.body.product ?? "").trim();
  const needVolumeTons = asNum(
    req.body.need_volume_tons ?? req.body.need_volume ?? req.body.volume,
    0
  );
  const requestedLimit = clamp(
    asNum(req.body.options_limit ?? req.body.limit, SUPPLY_OPTIONS_LIMIT),
    1,
    20
  );
  const destination = req.body.destination ?? null;
  const searchMode = normalizeSearchMode(
    req.body.search_mode ?? req.body.transport_mode
  );

  if (!product) {
    res.status(400).json({ error: "product is required" });
    return;
  }

  if (!Number.isFinite(needVolumeTons) || needVolumeTons <= 0) {
    res.status(400).json({ error: "need_volume_tons must be > 0" });
    return;
  }

  if (!destination || !destination.type) {
    res.status(400).json({ error: "destination is required" });
    return;
  }

  const destLon = asNum(destination.lon, NaN);
  const destLat = asNum(destination.lat, NaN);

  if (!Number.isFinite(destLon) || !Number.isFinite(destLat)) {
    res.status(400).json({ error: "destination lon/lat are invalid" });
    return;
  }

  try {
    let demandStation = null;

    if (
      destination.type === "station" &&
      Number.isFinite(Number(destination.osm_id))
    ) {
      demandStation = await getStationByOsmId(
        railPool,
        Number(destination.osm_id)
      );
    }

    if (!demandStation) {
      demandStation = await getNearestStationByLonLat(
        railPool,
        destLon,
        destLat
      );
    }

    if (!demandStation) {
      res.status(404).json({ error: "Не найдена станция прибытия" });
      return;
    }

    const nearestStationCache = new Map();
    const nearestRoadNodeCache = new Map();
    const stationRoadNodeCache = new Map();
    const routeCache = new Map();
    const candidates = [];
    const seenCandidateKeys = new Set();
    const railStats = {
      wave_rows_seen: 0,
      preselected_rows_seen: 0,
      source_station_not_found: 0,
      source_station_too_far: 0,
      destination_station_too_far: 0,
      same_station: 0,
      rail_route_not_found: 0,
      same_station_examples: [],
    };

    let options = [];
    let prevSignature = "";
    let stableWaveCount = 0;
    let usedSearchRadiusKm = null;
    let prevWaveKm = 0;

    for (const waveKm of SUPPLY_WAVES_KM) {
      const waveRows = await fetchSupplyCandidatesByWave(
        product,
        destLon,
        destLat,
        prevWaveKm,
        waveKm,
        DECL_ROWS_PER_WAVE,
        needVolumeTons
      );
      railStats.wave_rows_seen += waveRows.length;

      const rows = await preselectRowsForWave(
        waveRows,
        demandStation,
        nearestStationCache,
        searchMode
      );
      railStats.preselected_rows_seen += rows.length;

      usedSearchRadiusKm = waveKm;

      const enriched = await mapLimit(
        rows,
        ROUTE_CONCURRENCY,
        async (row) =>
          enrichSupplyCandidateMultimodal(
            row,
            product,
            destination,
            demandStation,
            nearestStationCache,
            nearestRoadNodeCache,
            stationRoadNodeCache,
            routeCache,
            searchMode
          )
      );

      for (const item of enriched) {
        if (!item) continue;

        if (isRailRejectedCandidate(item)) {
          railStats[item.reason] = (railStats[item.reason] ?? 0) + 1;
          if (item.reason === "same_station") {
            pushUniqueExample(railStats.same_station_examples, item.declarer);
          }
          continue;
        }

        const key = buildCandidateKey(item);
        if (seenCandidateKeys.has(key)) continue;
        seenCandidateKeys.add(key);
        candidates.push(item);
      }

      sortCandidates(candidates);
      options = buildSupplyOptions(candidates, needVolumeTons, requestedLimit, searchMode);

      const sig = getOptionsSignature(options);
      if (sig === prevSignature) {
        stableWaveCount += 1;
      } else {
        stableWaveCount = 0;
        prevSignature = sig;
      }

      if (options.length >= requestedLimit && stableWaveCount >= 1) {
        break;
      }

      prevWaveKm = waveKm;
    }

    const feedback = buildSearchFeedback({
      searchMode,
      options,
      candidates,
      needVolumeTons,
      usedSearchRadiusKm,
      demandStation,
      stats: railStats,
    });

    res.json({
      ok: true,
      product,
      need_volume_tons: needVolumeTons,
      search_mode: searchMode,
      destination: {
        type: destination.type,
        name: destination.name ?? "",
        osm_id: destination.osm_id ?? null,
        lon: destLon,
        lat: destLat,
      },
      arrival_station: {
        osm_id: Number(demandStation.osm_id),
        name: demandStation.name,
        dist_m: Number(demandStation.dist_m),
      },
      candidates_count: candidates.length,
      shown_options_count: options.length,
      search_radius_km: usedSearchRadiusKm,
      search_completed_countrywide:
        usedSearchRadiusKm >= SUPPLY_WAVES_KM[SUPPLY_WAVES_KM.length - 1],
      notices: feedback.notices,
      empty_state_reason: feedback.emptyStateReason,
      empty_state_details: feedback.emptyStateDetails,
      diagnostics: {
        rail_stats: railStats,
      },
      options,
    });
  } catch (e) {
    console.error("POST /api/supply/search:", e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});



app.get("/api/notebooklm/status", async (_req, res) => {
  try {
    const config = getNotebookLmConfig();
    res.json({
      ok: true,
      ...config,
      json_schema: getNotebookLmJsonSchema(),
    });
  } catch (e) {
    console.error("GET /api/notebooklm/status:", e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.post("/api/notebooklm/query", async (req, res) => {
  try {
    const mode = normalizeRecommendationMode(req.body.mode);
    const product = String(req.body.product ?? "").trim();
    const volumeTons = asNum(
      req.body.volume_tons ?? req.body.need_volume_tons ?? req.body.volume,
      0
    );
    const limit = clamp(asNum(req.body.limit, RECOMMENDATION_OPTIONS_LIMIT), 1, 20);

    if (!product) {
      res.status(400).json({ error: "product is required" });
      return;
    }

    if (!Number.isFinite(volumeTons) || volumeTons <= 0) {
      res.status(400).json({ error: "volume_tons must be > 0" });
      return;
    }

    const basePoint = normalizeMapPointInput(req.body.base_point);
    const hydratedBasePoint = basePoint ? await hydrateMapPoint(railPool, basePoint) : null;

    const prompt =
      String(req.body.prompt ?? "").trim() ||
      buildNotebookLmPrompt({
        mode,
        product,
        volumeTons,
        limit,
        baseCity: String(req.body.base_city ?? hydratedBasePoint?.name ?? "").trim(),
        baseRegion: String(req.body.base_region ?? "").trim(),
      });

    const notebookResult = await queryNotebookLm({
      prompt,
      notebookId: req.body.notebook_id,
      mode,
      product,
      volumeTons,
      limit,
      extra: {
        route_preference: normalizeRoutePreferenceMode(
          req.body.transport_mode ?? req.body.route_preference
        ),
      },
    });

    const extracted = extractNotebookLmJson(
      notebookResult.parsed_json ?? notebookResult.raw_text
    );
    const parsed = extracted.parsed_json ?? notebookResult.parsed_json ?? null;
    const normalizedPayload = normalizeNotebookLmParsedPayload(parsed);

    res.json({
      ok: true,
      integration_mode: notebookResult.integration_mode,
      direct_query_enabled: notebookResult.direct_query_enabled,
      notebook_id: notebookResult.notebook_id,
      prompt,
      raw_text: notebookResult.raw_text,
      parse_ok: Boolean(extracted.parse_ok || notebookResult.parse_ok),
      parsed_json: parsed,
      normalized_market_signals: normalizedPayload,
      json_schema: getNotebookLmJsonSchema(),
      proxy_payload: notebookResult.proxy_payload ?? null,
      base_point: hydratedBasePoint,
    });
  } catch (e) {
    console.error("POST /api/notebooklm/query:", e);
    const config = getNotebookLmConfig();
    const status =
      e?.code === "NOTEBOOKLM_NOT_CONFIGURED"
        ? 400
        : Number.isFinite(Number(e?.status))
        ? Number(e.status)
        : 500;

    res.status(status).json({
      error: String(e?.message ?? e),
      integration_mode: config.mode,
      direct_query_enabled: config.direct_query_enabled,
      notebook_id: config.notebook_id,
      response_text: e?.response_text ?? null,
      json_schema: getNotebookLmJsonSchema(),
    });
  }
});

app.post("/api/notebooklm/prompt", async (req, res) => {
  try {
    const mode = normalizeRecommendationMode(req.body.mode);
    const product = String(req.body.product ?? "").trim();
    const volumeTons = asNum(
      req.body.volume_tons ?? req.body.need_volume_tons ?? req.body.volume,
      0
    );

    if (!product) {
      res.status(400).json({ error: "product is required" });
      return;
    }

    if (!Number.isFinite(volumeTons) || volumeTons <= 0) {
      res.status(400).json({ error: "volume_tons must be > 0" });
      return;
    }

    const limit = clamp(asNum(req.body.limit, RECOMMENDATION_OPTIONS_LIMIT), 1, 20);
    const basePoint = normalizeMapPointInput(req.body.base_point);
    const hydratedBasePoint = basePoint ? await hydrateMapPoint(railPool, basePoint) : null;

    const prompt = buildNotebookLmPrompt({
      mode,
      product,
      volumeTons,
      limit,
      baseCity: String(req.body.base_city ?? hydratedBasePoint?.name ?? "").trim(),
      baseRegion: String(req.body.base_region ?? "").trim(),
    });

    const notebookLmConfig = getNotebookLmConfig();

    res.json({
      ok: true,
      mode,
      product,
      volume_tons: volumeTons,
      prompt,
      json_schema: getNotebookLmJsonSchema(),
      integration_mode: notebookLmConfig.mode,
      direct_query_enabled: notebookLmConfig.direct_query_enabled,
      notebook_id: notebookLmConfig.notebook_id,
      base_point: hydratedBasePoint,
    });
  } catch (e) {
    console.error("POST /api/notebooklm/prompt:", e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.post("/api/recommendations/search", async (req, res) => {
  try {
    const mode = normalizeRecommendationMode(req.body.mode);
    const routePreference = normalizeRoutePreferenceMode(
      req.body.transport_mode ?? req.body.route_preference
    );
    const product = String(req.body.product ?? "").trim();
    const volumeTons = asNum(
      req.body.volume_tons ?? req.body.need_volume_tons ?? req.body.volume,
      0
    );
    const limit = clamp(asNum(req.body.limit, RECOMMENDATION_OPTIONS_LIMIT), 1, 20);
    const basePoint = normalizeMapPointInput(req.body.base_point);
    const marketSignals = normalizeMarketSignals(
      req.body.market_signals ?? req.body.signals ?? req.body.notebooklm_result,
      mode
    );

    if (!product) {
      res.status(400).json({ error: "product is required" });
      return;
    }

    if (!Number.isFinite(volumeTons) || volumeTons <= 0) {
      res.status(400).json({ error: "volume_tons must be > 0" });
      return;
    }

    if (!marketSignals.length) {
      res.status(400).json({ error: "market_signals is empty or invalid" });
      return;
    }

    if ((mode === RECOMMENDATION_MODE_SELL || mode === RECOMMENDATION_MODE_BUY) && !basePoint) {
      res.status(400).json({ error: "base_point is required for sell and buy modes" });
      return;
    }

    const hydratedBasePoint = basePoint ? await hydrateMapPoint(railPool, basePoint) : null;

    if ((mode === RECOMMENDATION_MODE_SELL || mode === RECOMMENDATION_MODE_BUY) && !hydratedBasePoint) {
      res.status(400).json({ error: "base_point could not be resolved" });
      return;
    }

    const nearestStationCache = new Map();
    const nearestRoadNodeCache = new Map();
    const stationRoadNodeCache = new Map();
    const routeCache = new Map();

    const resolvedSignals = await mapLimit(
      marketSignals,
      RECOMMENDATION_RESOLVE_CONCURRENCY,
      async (signal) => {
        const resolvedPoint = await resolveMarketAnchor(railPool, signal);
        return {
          ...signal,
          resolved_point: resolvedPoint,
          resolved: Boolean(resolvedPoint),
        };
      }
    );

    const unresolvedSignals = resolvedSignals
      .filter((x) => !x.resolved)
      .map((x) => ({
        id: x.id,
        role: x.role,
        anchor_name: signalDisplayName(x),
      }));

    const results = [];

    if (mode === RECOMMENDATION_MODE_SELL) {
      const candidates = sortSignalsByBaseProximity(
        resolvedSignals,
        hydratedBasePoint,
        "sell",
        RECOMMENDATION_SIGNAL_LIMIT
      );

      const evaluated = await mapLimit(
        candidates,
        RECOMMENDATION_ROUTE_CONCURRENCY,
        async (signal) => {
          const route = await evaluateDeliveryRoute({
            origin: hydratedBasePoint,
            destination: signal.resolved_point,
            routePreference,
            nearestStationCache,
            nearestRoadNodeCache,
            stationRoadNodeCache,
            routeCache,
          });

          if (!route) return null;

          const scoring = scoreSellDirection({
            signal,
            routeSummary: route,
            volumeTons,
            basePoint: hydratedBasePoint,
          });

          const resultId = `sell-${signal.id}`;
          return {
            id: resultId,
            type: "sell_direction",
            product,
            volume_tons: volumeTons,
            score: scoring.score,
            base_point: hydratedBasePoint,
            base_distance_km: signal.base_distance_km,
            market_signal: signal,
            route,
            route_segments: buildRouteSegmentsFromSummary(route, {
              recommendation_id: resultId,
            }),
            points: [
              buildPointFeature(hydratedBasePoint, { point_role: "base", recommendation_id: resultId }),
              buildPointFeature(signal.resolved_point, { point_role: "market", recommendation_id: resultId }),
            ].filter(Boolean),
            explanation: scoring.summary,
            logistics: scoring.logistics,
          };
        }
      );

      results.push(...evaluated.filter(Boolean));
    } else if (mode === RECOMMENDATION_MODE_BUY) {
      const candidates = sortSignalsByBaseProximity(
        resolvedSignals,
        hydratedBasePoint,
        "buy",
        RECOMMENDATION_SIGNAL_LIMIT
      );

      const evaluated = await mapLimit(
        candidates,
        RECOMMENDATION_ROUTE_CONCURRENCY,
        async (signal) => {
          const route = await evaluateDeliveryRoute({
            origin: signal.resolved_point,
            destination: hydratedBasePoint,
            routePreference,
            nearestStationCache,
            nearestRoadNodeCache,
            stationRoadNodeCache,
            routeCache,
          });

          if (!route) return null;

          const scoring = scoreBuySource({
            signal,
            routeSummary: route,
            volumeTons,
            basePoint: hydratedBasePoint,
          });

          const resultId = `buy-${signal.id}`;
          return {
            id: resultId,
            type: "buy_source",
            product,
            volume_tons: volumeTons,
            score: scoring.score,
            base_point: hydratedBasePoint,
            base_distance_km: signal.base_distance_km,
            market_signal: signal,
            route,
            route_segments: buildRouteSegmentsFromSummary(route, {
              recommendation_id: resultId,
            }),
            points: [
              buildPointFeature(signal.resolved_point, { point_role: "market", recommendation_id: resultId }),
              buildPointFeature(hydratedBasePoint, { point_role: "base", recommendation_id: resultId }),
            ].filter(Boolean),
            explanation: scoring.summary,
            logistics: scoring.logistics,
          };
        }
      );

      results.push(...evaluated.filter(Boolean));
    } else {
      const buySignals = sortSignalsForTrader(
        resolvedSignals,
        "buy",
        RECOMMENDATION_TRADER_SIDE_LIMIT
      );

      const sellSignals = sortSignalsForTrader(
        resolvedSignals,
        "sell",
        RECOMMENDATION_TRADER_SIDE_LIMIT
      );

      const pairs = [];
      for (const buySignal of buySignals) {
        for (const sellSignal of sellSignals) {
          if (buySignal.id === sellSignal.id) continue;
          const pairDistanceKm = roughDistanceKm(
            buySignal.resolved_point,
            sellSignal.resolved_point
          );
          if (
            Number.isFinite(pairDistanceKm) &&
            pairDistanceKm > RECOMMENDATION_TRADER_MAX_PAIR_DISTANCE_KM &&
            Number(buySignal.signal_score || 0) + Number(sellSignal.signal_score || 0) < 17
          ) {
            continue;
          }
          pairs.push({ buySignal, sellSignal, pairDistanceKm });
        }
      }

      pairs.sort((a, b) => {
        if (a.pairDistanceKm !== b.pairDistanceKm) {
          return a.pairDistanceKm - b.pairDistanceKm;
        }
        const aScore = Number(a.buySignal.signal_score || 0) + Number(a.sellSignal.signal_score || 0);
        const bScore = Number(b.buySignal.signal_score || 0) + Number(b.sellSignal.signal_score || 0);
        return bScore - aScore;
      });

      const evaluated = await mapLimit(
        pairs.slice(0, RECOMMENDATION_TRADER_SIDE_LIMIT * RECOMMENDATION_TRADER_SIDE_LIMIT),
        RECOMMENDATION_ROUTE_CONCURRENCY,
        async ({ buySignal, sellSignal, pairDistanceKm }) => {
          const route = await evaluateDeliveryRoute({
            origin: buySignal.resolved_point,
            destination: sellSignal.resolved_point,
            routePreference,
            nearestStationCache,
            nearestRoadNodeCache,
            stationRoadNodeCache,
            routeCache,
          });

          if (!route) return null;

          const scoring = scoreTraderOpportunity({
            buySignal,
            sellSignal,
            routeSummary: route,
            volumeTons,
          });

          const resultId = `trader-${buySignal.id}-${sellSignal.id}`;
          return {
            id: resultId,
            type: "trader_pair",
            product,
            volume_tons: volumeTons,
            score: scoring.score,
            pair_distance_km: pairDistanceKm,
            buy_signal: buySignal,
            sell_signal: sellSignal,
            route,
            route_segments: buildRouteSegmentsFromSummary(route, {
              recommendation_id: resultId,
            }),
            points: [
              buildPointFeature(buySignal.resolved_point, { point_role: "buy", recommendation_id: resultId }),
              buildPointFeature(sellSignal.resolved_point, { point_role: "sell", recommendation_id: resultId }),
            ].filter(Boolean),
            explanation: scoring.summary,
            logistics: scoring.logistics,
            margin_proxy: scoring.margin_proxy,
          };
        }
      );

      results.push(...evaluated.filter(Boolean));
    }

    results.sort(compareRankedResults);

    res.json({
      ok: true,
      mode,
      product,
      volume_tons: volumeTons,
      route_preference: routePreference,
      base_point: hydratedBasePoint,
      total_market_signals: marketSignals.length,
      resolved_market_signals: resolvedSignals.filter((x) => x.resolved).length,
      unresolved_market_signals: unresolvedSignals,
      results: results.slice(0, limit),
    });
  } catch (e) {
    console.error("POST /api/recommendations/search:", e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});


const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Route API listening on http://localhost:${port}`);
});
