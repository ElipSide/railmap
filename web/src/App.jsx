import React, { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import LeftPanel from "./components/LeftPanel";
import LoadingOverlay from "./components/LoadingOverlay";
import RouteInfoPanel from "./components/RouteInfoPanel";
import SupplyResultsPanel from "./components/SupplyResultsPanel";
import RecommendationResultsPanel from "./components/RecommendationResultsPanel";
import DeclarationResultsPanel from "./components/DeclarationResultsPanel";

import { formatNum, formatTons, escapeHtml } from "./lib/format";
import { applyVisibility, clearHoverState, clearRoute } from "./lib/mapHelpers";
import {
  apiGetNotebookLmStatus,
  apiGetProducts,
  apiQueryNotebookLm,
  apiSearchRecommendations,
  apiSearchSupply,
} from "./lib/api";

const DEFAULT_PRODUCT = "Пшеница";
const MODE_DECLARATIONS = "declarations";
const MODE_STATION_ROUTE = "station-route";
const MODE_PRODUCT_SEARCH = "product-search";
const MODE_MARKET_RECOMMENDATIONS = "market-recommendations";

const SUPPLY_TRANSPORT_MODE_RAIL = "rail";
const SUPPLY_TRANSPORT_MODE_ROAD = "road";
const SUPPLY_TRANSPORT_MODE_MULTIMODAL = "multimodal";

const RECOMMENDATION_MODE_SELL = "sell";
const RECOMMENDATION_MODE_BUY = "buy";
const RECOMMENDATION_MODE_TRADER = "trader";

const ROUTE_PREF_BEST = "best";

const SEARCH_MESSAGES_BY_MODE = {
  [SUPPLY_TRANSPORT_MODE_RAIL]: [
    "Ищем только чистые железнодорожные маршруты…",
    "Автодороги в этом режиме не рассчитываются…",
    "Оставляем только поставщиков и назначения рядом со станцией…",
  ],
  [SUPPLY_TRANSPORT_MODE_ROAD]: [
    "Ищем поставщиков поблизости…",
    "Строим прямые автодорожные маршруты…",
    "Сравниваем лучшие автомобильные варианты…",
  ],
  [SUPPLY_TRANSPORT_MODE_MULTIMODAL]: [
    "Ищем поставщиков в ближайших волнах поиска…",
    "Подбираем подъезд по автодорогам…",
    "Строим железнодорожные плечи…",
    "Собираем лучшие мультимодальные варианты…",
  ],
};

const RECOMMENDATION_MESSAGES = [
  "Сопоставляем рыночные сигналы с узлами на карте…",
  "Считаем маршруты и рейтинг направлений…",
  "Собираем лучшие варианты продажи, покупки или трейдинга…",
];

const DECLARATION_SEARCH_MESSAGES = [
  "Ищем декларации по выбранным фильтрам…",
  "Готовим точки и кластеризацию для карты…",
  "Обновляем список найденных деклараций…",
];

const DECLARATION_ROUTE_MESSAGES = [
  "Определяем ближайшие ж/д станции…",
  "Строим авто- и железнодорожные плечи…",
  "Рисуем маршрут от декларации до выбранной точки…",
];

const NOTEBOOK_QUERY_MESSAGES = [
  "Готовим запрос к NotebookLM…",
  "Отправляем prompt в notebooklm-py…",
  "Разбираем ответ NotebookLM и вытаскиваем JSON-сигналы…",
];

function normalizeRecommendationResult(result) {
  if (!result || !Array.isArray(result.results)) {
    return result;
  }

  return {
    ...result,
    results: result.results.map((item, index) => ({
      ...item,
      _ui_id: `${item?.id ?? item?.type ?? "rec"}-${index}`,
      _ui_rank: index + 1,
    })),
  };
}


export default function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const supplyAbortRef = useRef(null);
  const recommendationAbortRef = useRef(null);
  const notebookLmAbortRef = useRef(null);
  const declarationAbortRef = useRef(null);
  const declarationRouteAbortRef = useRef(null);

  const [status, setStatus] = useState("init");
  const [ready, setReady] = useState(false);
  const [activeMode, setActiveMode] = useState(MODE_DECLARATIONS);

  const [showLines, setShowLines] = useState(false);
  const [showStations, setShowStations] = useState(false);
  const [showPorts, setShowPorts] = useState(false);
  const [showElevators, setShowElevators] = useState(false);

  const [routeInfo, setRouteInfo] = useState(null);

  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(DEFAULT_PRODUCT);
  const [needVolumeTons, setNeedVolumeTons] = useState("100");

  const [declarationDateFrom, setDeclarationDateFrom] = useState(() =>
    shiftDateIso(todayIso(), -7)
  );
  const [declarationDateTo, setDeclarationDateTo] = useState(() => todayIso());
  const [declarationResult, setDeclarationResult] = useState(null);
  const [selectedDeclarationId, setSelectedDeclarationId] = useState(null);
  const [declarationRouteResult, setDeclarationRouteResult] = useState(null);
  const [pickDeclarationDestinationMode, setPickDeclarationDestinationMode] =
    useState(false);
  const [isSearchingDeclarations, setIsSearchingDeclarations] = useState(false);
  const [isBuildingDeclarationRoute, setIsBuildingDeclarationRoute] =
    useState(false);

  const [supplyTransportMode, setSupplyTransportMode] = useState(
    SUPPLY_TRANSPORT_MODE_MULTIMODAL
  );
  const [pickSupplyDestinationMode, setPickSupplyDestinationMode] = useState(false);
  const [supplyResult, setSupplyResult] = useState(null);
  const [selectedOptionNo, setSelectedOptionNo] = useState(null);

  const [isSearchingSupply, setIsSearchingSupply] = useState(false);
  const [isSearchingRecommendations, setIsSearchingRecommendations] = useState(false);
  const [searchMessageIndex, setSearchMessageIndex] = useState(0);

  const [recommendationMode, setRecommendationMode] = useState(RECOMMENDATION_MODE_SELL);
  const [recommendationTransportMode, setRecommendationTransportMode] =
    useState(ROUTE_PREF_BEST);
  const [pickRecommendationBasePointMode, setPickRecommendationBasePointMode] =
    useState(false);
  const [recommendationBasePoint, setRecommendationBasePoint] = useState(null);
  const [notebookLmPrompt, setNotebookLmPrompt] = useState("");
  const [notebookLmStatus, setNotebookLmStatus] = useState(null);
  const [notebookLmRawAnswer, setNotebookLmRawAnswer] = useState("");
  const [marketSignalsText, setMarketSignalsText] = useState("");
  const [recommendationResult, setRecommendationResult] = useState(null);
  const [selectedRecommendationId, setSelectedRecommendationId] = useState(null);
  const [isQueryingNotebookLm, setIsQueryingNotebookLm] = useState(false);

  const selectedDeclaration = useMemo(() => {
    const items = Array.isArray(declarationResult?.items) ? declarationResult.items : [];
    return (
      items.find((item) => String(item.declaration_id) === String(selectedDeclarationId)) ||
      null
    );
  }, [declarationResult, selectedDeclarationId]);

  const selectedRef = useRef([]);
  const selectedIdsRef = useRef({ a: null, b: null });
  const hoverIdRef = useRef(null);
  const mapClickHandledRef = useRef(false);
  const pickDeclarationDestinationModeRef = useRef(false);
  const pickSupplyDestinationModeRef = useRef(false);
  const pickRecommendationBasePointModeRef = useRef(false);
  const activeModeRef = useRef(activeMode);
  const isSearchingDeclarationsRef = useRef(false);
  const isBuildingDeclarationRouteRef = useRef(false);
  const isSearchingSupplyRef = useRef(false);
  const isSearchingRecommendationsRef = useRef(false);
  const isQueryingNotebookLmRef = useRef(false);

  const selectedProductRef = useRef(selectedProduct);
  const needVolumeTonsRef = useRef(needVolumeTons);
  const declarationResultRef = useRef(declarationResult);
  const selectedDeclarationRef = useRef(selectedDeclaration);
  const supplyTransportModeRef = useRef(supplyTransportMode);
  const recommendationModeRef = useRef(recommendationMode);
  const recommendationTransportModeRef = useRef(recommendationTransportMode);
  const productsRef = useRef(products);

  
const isRailmapSubpath = import.meta.env.VITE_USE_RAILMAP_SUBPATH === "1";

const railTiles = useMemo(() => {
  if (typeof window !== "undefined") {
    if (isRailmapSubpath) {
      return `${window.location.origin}/railmap/maps/rail/{z}/{x}/{y}.pbf`;
    }
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:8085/maps/rail/{z}/{x}/{y}.pbf`;
  }

  return isRailmapSubpath
    ? "https://csort-news.ru/railmap/maps/rail/{z}/{x}/{y}.pbf"
    : "http://localhost:8085/maps/rail/{z}/{x}/{y}.pbf";
}, [isRailmapSubpath]);

const routeApiBase = useMemo(() => {
  return isRailmapSubpath ? "/railmap" : "";
}, [isRailmapSubpath]);

  const activeSupplyMessages =
    SEARCH_MESSAGES_BY_MODE[supplyTransportMode] ||
    SEARCH_MESSAGES_BY_MODE[SUPPLY_TRANSPORT_MODE_MULTIMODAL];

  const activeLoaderMessages = isBuildingDeclarationRoute
    ? DECLARATION_ROUTE_MESSAGES
    : isSearchingDeclarations
    ? DECLARATION_SEARCH_MESSAGES
    : isQueryingNotebookLm
    ? NOTEBOOK_QUERY_MESSAGES
    : isSearchingRecommendations
    ? RECOMMENDATION_MESSAGES
    : activeSupplyMessages;

  useEffect(() => {
    pickDeclarationDestinationModeRef.current = pickDeclarationDestinationMode;
  }, [pickDeclarationDestinationMode]);

  useEffect(() => {
    pickSupplyDestinationModeRef.current = pickSupplyDestinationMode;
  }, [pickSupplyDestinationMode]);

  useEffect(() => {
    pickRecommendationBasePointModeRef.current = pickRecommendationBasePointMode;
  }, [pickRecommendationBasePointMode]);

  useEffect(() => {
    activeModeRef.current = activeMode;
  }, [activeMode]);

  useEffect(() => {
    isSearchingDeclarationsRef.current = isSearchingDeclarations;
  }, [isSearchingDeclarations]);

  useEffect(() => {
    isBuildingDeclarationRouteRef.current = isBuildingDeclarationRoute;
  }, [isBuildingDeclarationRoute]);

  useEffect(() => {
    isSearchingSupplyRef.current = isSearchingSupply;
  }, [isSearchingSupply]);

  useEffect(() => {
    isSearchingRecommendationsRef.current = isSearchingRecommendations;
  }, [isSearchingRecommendations]);

  useEffect(() => {
    isQueryingNotebookLmRef.current = isQueryingNotebookLm;
  }, [isQueryingNotebookLm]);

  useEffect(() => {
    selectedProductRef.current = selectedProduct;
  }, [selectedProduct]);

  useEffect(() => {
    needVolumeTonsRef.current = needVolumeTons;
  }, [needVolumeTons]);

  useEffect(() => {
    declarationResultRef.current = declarationResult;
  }, [declarationResult]);

  useEffect(() => {
    selectedDeclarationRef.current = selectedDeclaration;
  }, [selectedDeclaration]);

  useEffect(() => {
    supplyTransportModeRef.current = supplyTransportMode;
  }, [supplyTransportMode]);

  useEffect(() => {
    recommendationModeRef.current = recommendationMode;
  }, [recommendationMode]);

  useEffect(() => {
    recommendationTransportModeRef.current = recommendationTransportMode;
  }, [recommendationTransportMode]);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    loadProducts();
    loadNotebookLmStatus();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    applyVisibility(map, { showLines, showStations, showPorts, showElevators });
  }, [showLines, showStations, showPorts, showElevators, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const shouldUseCrosshair =
      (activeMode === MODE_DECLARATIONS &&
        pickDeclarationDestinationMode &&
        !isSearchingDeclarations &&
        !isBuildingDeclarationRoute) ||
      (activeMode === MODE_PRODUCT_SEARCH && pickSupplyDestinationMode && !isSearchingSupply) ||
      (activeMode === MODE_MARKET_RECOMMENDATIONS &&
        pickRecommendationBasePointMode &&
        !isSearchingRecommendations &&
        !isQueryingNotebookLm);

    map.getCanvas().style.cursor = shouldUseCrosshair ? "crosshair" : "";

    if (
      activeMode !== MODE_STATION_ROUTE ||
      pickDeclarationDestinationMode ||
      pickSupplyDestinationMode ||
      pickRecommendationBasePointMode
    ) {
      clearHoverState(map, hoverIdRef);
    }
  }, [
    activeMode,
    pickDeclarationDestinationMode,
    pickSupplyDestinationMode,
    pickRecommendationBasePointMode,
    isSearchingDeclarations,
    isBuildingDeclarationRoute,
    isSearchingSupply,
    isSearchingRecommendations,
    isQueryingNotebookLm,
  ]);

  useEffect(() => {
    if (
      !isSearchingDeclarations &&
      !isBuildingDeclarationRoute &&
      !isSearchingSupply &&
      !isSearchingRecommendations &&
      !isQueryingNotebookLm
    ) {
      setSearchMessageIndex(0);
      return;
    }

    const timer = window.setInterval(() => {
      setSearchMessageIndex((prev) => (prev + 1) % activeLoaderMessages.length);
    }, 1400);

    return () => window.clearInterval(timer);
  }, [
    isSearchingDeclarations,
    isBuildingDeclarationRoute,
    isSearchingSupply,
    isSearchingRecommendations,
    isQueryingNotebookLm,
    activeLoaderMessages.length,
  ]);

  useEffect(() => {
    return () => {
      if (declarationAbortRef.current) declarationAbortRef.current.abort();
      if (declarationRouteAbortRef.current) declarationRouteAbortRef.current.abort();
      if (supplyAbortRef.current) supplyAbortRef.current.abort();
      if (recommendationAbortRef.current) recommendationAbortRef.current.abort();
      if (notebookLmAbortRef.current) notebookLmAbortRef.current.abort();
    };
  }, []);

  async function loadProducts() {
    try {
      setStatus("loading products...");
      const data = await apiGetProducts(routeApiBase);
      const safeProducts = Array.isArray(data) ? data : [];
      setProducts(safeProducts);
      productsRef.current = safeProducts;

      const wheat =
        safeProducts.find(
          (x) => String(x).trim().toLowerCase() === DEFAULT_PRODUCT.toLowerCase()
        ) ?? null;

      const nextProduct = wheat ?? safeProducts[0] ?? DEFAULT_PRODUCT;
      setSelectedProduct(nextProduct);
      selectedProductRef.current = nextProduct;
      setStatus(`products loaded: ${nextProduct}`);
    } catch (err) {
      console.error("Products load error:", err);
      setProducts([]);
      productsRef.current = [];
      setStatus(`products error: ${err.message}`);
    }
  }


  async function loadNotebookLmStatus() {
    try {
      const data = await apiGetNotebookLmStatus(routeApiBase);
      setNotebookLmStatus(data);
    } catch (err) {
      console.error("NotebookLM status error:", err);
      setNotebookLmStatus({
        ok: false,
        integration_mode: "manual",
        direct_query_enabled: false,
        error: err.message,
      });
    }
  }

  useEffect(() => {
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      center: [37.62, 55.75],
      zoom: 7,
      maxZoom: 14,
      hash: true,
      style: {
        version: 8,
        glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
          rail: {
            type: "vector",
            tiles: [railTiles],
            minzoom: 0,
            maxzoom: 14,
            promoteId: { rail_stations: "osm_id" },
          },
        },
        layers: [
          { id: "osm", type: "raster", source: "osm" },
          {
            id: "rail-lines-shadow",
            type: "line",
            source: "rail",
            "source-layer": "rail_lines",
            layout: {
              "line-join": "round",
              "line-cap": "round",
              visibility: "none",
            },
            paint: {
              "line-color": "#6a4a00",
              "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.0, 8, 4.0, 12, 7.5, 14, 11.0],
              "line-opacity": 0.9,
            },
          },
          {
            id: "rail-lines-casing",
            type: "line",
            source: "rail",
            "source-layer": "rail_lines",
            layout: {
              "line-join": "round",
              "line-cap": "round",
              visibility: "none",
            },
            paint: {
              "line-color": "#9a6a00",
              "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.6, 8, 3.2, 12, 6.0, 14, 9.0],
              "line-opacity": 0.95,
            },
          },
          {
            id: "rail-lines",
            type: "line",
            source: "rail",
            "source-layer": "rail_lines",
            layout: {
              "line-join": "round",
              "line-cap": "round",
              visibility: "none",
            },
            paint: {
              "line-color": "#ffd400",
              "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.1, 8, 2.4, 12, 4.8, 14, 7.2],
              "line-opacity": 0.98,
            },
          },
          {
            id: "rail-stations",
            type: "circle",
            source: "rail",
            "source-layer": "rail_stations",
            layout: {
              visibility: "none",
            },
            
            paint: {
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                6,
                [
                  "case",
                  ["boolean", ["feature-state", "selectedA"], false],
                  5.0,
                  ["boolean", ["feature-state", "selectedB"], false],
                  5.0,
                  ["boolean", ["feature-state", "hover"], false],
                  4.2,
                  2.2,
                ],
                10,
                [
                  "case",
                  ["boolean", ["feature-state", "selectedA"], false],
                  7.0,
                  ["boolean", ["feature-state", "selectedB"], false],
                  7.0,
                  ["boolean", ["feature-state", "hover"], false],
                  6.0,
                  3.0,
                ],
                14,
                [
                  "case",
                  ["boolean", ["feature-state", "selectedA"], false],
                  10.0,
                  ["boolean", ["feature-state", "selectedB"], false],
                  10.0,
                  ["boolean", ["feature-state", "hover"], false],
                  8.0,
                  5.2,
                ],
              ],
              "circle-color": [
                "case",
                ["boolean", ["feature-state", "selectedA"], false],
                "#0066ff",
                ["boolean", ["feature-state", "selectedB"], false],
                "#7b2cff",
                ["boolean", ["feature-state", "hover"], false],
                "#ff7a00",
                "#d11",
              ],
              "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 6, 0.8, 14, 2.0],
              "circle-stroke-color": "#fff",
              "circle-opacity": 0.95,
            },
          },
          {
            id: "rail-station-labels",
            type: "symbol",
            source: "rail",
            "source-layer": "rail_stations",
            minzoom: 11,
            layout: {
              "text-field": ["coalesce", ["get", "name"], ""],
              "text-size": ["interpolate", ["linear"], ["zoom"], 11, 11, 13, 14],
              "text-offset": [0, 1.0],
              "text-anchor": "top",
              "text-optional": true,
              "text-allow-overlap": false,
                  visibility: "none",

            },
            paint: {
              "text-color": "#101010",
              "text-halo-color": "rgba(255,255,255,0.95)",
              "text-halo-width": 1.6,
              "text-halo-blur": 0.4,
            },
          },
          {
            id: "port-terminals",
            type: "circle",
            source: "rail",
            "source-layer": "port_terminals",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 2.0, 6, 3.0, 10, 5.0, 14, 8.0],
              "circle-color": "#0066ff",
              "circle-opacity": 0.9,
              "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 14, 2.0],
              "circle-stroke-color": "#ffffff",
            },
          },
          {
            id: "elevators",
            type: "circle",
            source: "rail",
            "source-layer": "elevators",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 2.0, 6, 3.0, 10, 5.0, 14, 8.0],
              "circle-color": "#00aa33",
              "circle-opacity": 0.9,
              "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 14, 2.0],
              "circle-stroke-color": "#ffffff",
            },
          },
        ],
      },
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      map.addSource("route", { type: "geojson", data: emptyFeatureCollection() });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#0066ff",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.4, 8, 4.2, 12, 7.0, 14, 10.0],
          "line-opacity": 0.9,
        },
      });

      map.addSource("selectedStations", { type: "geojson", data: emptyFeatureCollection() });
      map.addLayer({
        id: "selectedStations-labels",
        type: "symbol",
        source: "selectedStations",
        layout: {
          "text-field": ["get", "name"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 12, 10, 14, 14, 16],
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#111",
          "text-halo-color": "rgba(255,255,255,0.98)",
          "text-halo-width": 2.0,
          "text-halo-blur": 0.6,
        },
      });

      map.addSource("supplyRoutes", { type: "geojson", data: emptyFeatureCollection() });
      map.addLayer({
        id: "supply-routes-road",
        type: "line",
        source: "supplyRoutes",
        filter: ["in", ["get", "mode"], ["literal", ["road_start", "road_end"]]],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#4b5563",
          "line-width": ["coalesce", ["get", "line_width"], 3],
          "line-dasharray": [2, 2],
          "line-opacity": 0.85,
        },
      });
      map.addLayer({
        id: "supply-routes-rail",
        type: "line",
        source: "supplyRoutes",
        filter: ["==", ["get", "mode"], "rail"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["case", ["boolean", ["get", "is_sufficient"], false], "#16a34a", "#ff7a00"],
          "line-width": ["coalesce", ["get", "line_width"], 4],
          "line-opacity": 0.9,
        },
      });
      map.addSource("supplyPoints", { type: "geojson", data: emptyFeatureCollection() });
      map.addLayer({
        id: "supply-points",
        type: "circle",
        source: "supplyPoints",
        paint: {
          "circle-radius": 6,
          "circle-color": ["case", ["boolean", ["get", "is_sufficient"], false], "#16a34a", "#ff7a00"],
          "circle-opacity": 0.95,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff",
        },
      });
      map.addSource("demandPoint", { type: "geojson", data: emptyFeatureCollection() });
      map.addLayer({
        id: "demand-point",
        type: "circle",
        source: "demandPoint",
        paint: {
          "circle-radius": 7,
          "circle-color": "#111",
          "circle-opacity": 0.95,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });

      map.addSource("recommendationRoutes", { type: "geojson", data: emptyFeatureCollection() });
      map.addLayer({
        id: "recommendation-routes-road",
        type: "line",
        source: "recommendationRoutes",
        filter: ["in", ["get", "mode"], ["literal", ["road_start", "road_end"]]],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#0f766e",
          "line-width": 4,
          "line-dasharray": [2, 2],
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "recommendation-routes-rail",
        type: "line",
        source: "recommendationRoutes",
        filter: ["==", ["get", "mode"], "rail"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#0ea5e9",
          "line-width": 5,
          "line-opacity": 0.9,
        },
      });
      map.addSource("recommendationPoints", { type: "geojson", data: emptyFeatureCollection() });
      map.addLayer({
        id: "recommendation-points",
        type: "circle",
        source: "recommendationPoints",
        paint: {
          "circle-radius": 7,
          "circle-color": [
            "case",
            ["==", ["get", "point_role"], "buy"],
            "#16a34a",
            ["==", ["get", "point_role"], "sell"],
            "#2563eb",
            ["==", ["get", "point_role"], "base"],
            "#111827",
            "#7c3aed",
          ],
          "circle-opacity": 0.95,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff",
        },
      });

      map.addSource("declarations", {
        type: "geojson",
        data: emptyFeatureCollection(),
        cluster: true,
        clusterRadius: 72,
        clusterMaxZoom: 15,
        clusterProperties: {
          max_bucket: ["max", ["get", "volume_bucket_idx"]],
        },
      });
      map.addLayer({
        id: "declarations-clusters",
        type: "circle",
        source: "declarations",
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": [
            "step",
            ["get", "point_count"],
            20,
            10,
            24,
            30,
            30,
            100,
            36,
          ],
          "circle-color": [
            "case",
            ["==", ["coalesce", ["get", "max_bucket"], 0], 4],
            "#ef4444",
            ["==", ["coalesce", ["get", "max_bucket"], 0], 3],
            "#f97316",
            ["==", ["coalesce", ["get", "max_bucket"], 0], 2],
            "#eab308",
            ["==", ["coalesce", ["get", "max_bucket"], 0], 1],
            "#8b5cf6",
            "#84cc16",
          ],
          "circle-opacity": 0.9,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });
      map.addLayer({
        id: "declarations-cluster-count",
        type: "symbol",
        source: "declarations",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 12,
          "text-font": ["Open Sans Bold"],
        },
        paint: {
          "text-color": "#111",
        },
      });
      map.addLayer({
        id: "declarations-points",
        type: "circle",
        source: "declarations",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "volume_bucket_idx"], 4],
            16,
            ["==", ["get", "volume_bucket_idx"], 3],
            13,
            ["==", ["get", "volume_bucket_idx"], 2],
            11,
            ["==", ["get", "volume_bucket_idx"], 1],
            9,
            7,
          ],
          "circle-color": [
            "case",
            ["==", ["get", "volume_bucket_idx"], 4],
            "#ef4444",
            ["==", ["get", "volume_bucket_idx"], 3],
            "#f97316",
            ["==", ["get", "volume_bucket_idx"], 2],
            "#eab308",
            ["==", ["get", "volume_bucket_idx"], 1],
            "#8b5cf6",
            "#84cc16",
          ],
          "circle-opacity": 0.9,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });
      map.addSource("selectedDeclaration", {
        type: "geojson",
        data: emptyFeatureCollection(),
      });
      map.addLayer({
        id: "selected-declaration-point",
        type: "circle",
        source: "selectedDeclaration",
        paint: {
          "circle-radius": 18,
          "circle-color": "rgba(255,255,255,0.05)",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#111827",
        },
      });

      map.addSource("declarationRoute", { type: "geojson", data: emptyFeatureCollection() });
      map.addLayer({
        id: "declaration-route-road",
        type: "line",
        source: "declarationRoute",
        filter: ["in", ["get", "mode"], ["literal", ["road_start", "road_end"]]],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#4b5563",
          "line-width": 4,
          "line-dasharray": [2, 2],
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "declaration-route-rail",
        type: "line",
        source: "declarationRoute",
        filter: ["==", ["get", "mode"], "rail"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#2563eb",
          "line-width": 5,
          "line-opacity": 0.9,
        },
      });
      map.addSource("declarationRoutePoints", {
        type: "geojson",
        data: emptyFeatureCollection(),
      });
      map.addLayer({
        id: "declaration-route-points",
        type: "circle",
        source: "declarationRoutePoints",
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "point_role"], "origin"],
            9,
            ["==", ["get", "point_role"], "destination"],
            9,
            7,
          ],
          "circle-color": [
            "case",
            ["==", ["get", "point_role"], "origin"],
            "#dc2626",
            ["==", ["get", "point_role"], "destination"],
            "#111827",
            ["==", ["get", "point_role"], "origin_station"],
            "#f59e0b",
            ["==", ["get", "point_role"], "destination_station"],
            "#16a34a",
            "#2563eb",
          ],
          "circle-opacity": 0.95,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });

      setReady(true);
      setStatus("ok");
      applyVisibility(map, { showLines, showStations, showPorts, showElevators });
    });

    map.on("mousemove", "rail-stations", (e) => {
      const declarationPick =
        activeModeRef.current === MODE_DECLARATIONS &&
        pickDeclarationDestinationModeRef.current;
      const recommendationPick =
        activeModeRef.current === MODE_MARKET_RECOMMENDATIONS &&
        pickRecommendationBasePointModeRef.current;
      const supplyPick =
        activeModeRef.current === MODE_PRODUCT_SEARCH &&
        pickSupplyDestinationModeRef.current;

      if (declarationPick || recommendationPick || supplyPick) {
        map.getCanvas().style.cursor =
          isSearchingDeclarationsRef.current ||
          isBuildingDeclarationRouteRef.current ||
          isSearchingSupplyRef.current ||
          isSearchingRecommendationsRef.current
            ? ""
            : "crosshair";
        return;
      }

      if (
        activeModeRef.current !== MODE_STATION_ROUTE ||
        isSearchingDeclarationsRef.current ||
        isBuildingDeclarationRouteRef.current ||
        isSearchingSupplyRef.current ||
        isSearchingRecommendationsRef.current
      ) {
        map.getCanvas().style.cursor = "";
        clearHoverState(map, hoverIdRef);
        return;
      }

      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (!f) return;
      const osmId = Number(f.properties?.osm_id);
      if (!Number.isFinite(osmId)) return;

      const prev = hoverIdRef.current;
      if (prev === osmId) return;

      if (prev != null) {
        try {
          map.setFeatureState(
            { source: "rail", sourceLayer: "rail_stations", id: prev },
            { hover: false }
          );
        } catch {}
      }

      hoverIdRef.current = osmId;
      try {
        map.setFeatureState(
          { source: "rail", sourceLayer: "rail_stations", id: osmId },
          { hover: true }
        );
      } catch {}
    });

    map.on("mouseleave", "rail-stations", () => {
      const shouldUseCrosshair =
        (activeModeRef.current === MODE_DECLARATIONS &&
          pickDeclarationDestinationModeRef.current &&
          !isSearchingDeclarationsRef.current &&
          !isBuildingDeclarationRouteRef.current) ||
        (activeModeRef.current === MODE_PRODUCT_SEARCH &&
          pickSupplyDestinationModeRef.current &&
          !isSearchingSupplyRef.current) ||
        (activeModeRef.current === MODE_MARKET_RECOMMENDATIONS &&
          pickRecommendationBasePointModeRef.current &&
          !isSearchingRecommendationsRef.current);

      map.getCanvas().style.cursor = shouldUseCrosshair ? "crosshair" : "";
      clearHoverState(map, hoverIdRef);
    });

    map.on("click", "rail-stations", async (e) => {
      if (
        isSearchingDeclarationsRef.current ||
        isBuildingDeclarationRouteRef.current ||
        isSearchingSupplyRef.current ||
        isSearchingRecommendationsRef.current
      ) {
        return;
      }

      const f = e.features?.[0];
      if (!f) return;
      mapClickHandledRef.current = true;

      if (activeModeRef.current === MODE_DECLARATIONS && pickDeclarationDestinationModeRef.current) {
        await handleDeclarationDestinationClick({
          type: "station",
          osm_id: Number(f.properties?.osm_id),
          name: f.properties?.name || "Станция",
          lon: e.lngLat.lng,
          lat: e.lngLat.lat,
        });
        return;
      }

      if (activeModeRef.current === MODE_MARKET_RECOMMENDATIONS && pickRecommendationBasePointModeRef.current) {
        handleRecommendationBasePointClick({
          type: "station",
          osm_id: Number(f.properties?.osm_id),
          name: f.properties?.name || "Станция",
          lon: e.lngLat.lng,
          lat: e.lngLat.lat,
        });
        return;
      }

      if (activeModeRef.current === MODE_PRODUCT_SEARCH && pickSupplyDestinationModeRef.current) {
        await handleSupplyDestinationClick({
          type: "station",
          osm_id: Number(f.properties?.osm_id),
          name: f.properties?.name || "(без названия)",
          lon: e.lngLat.lng,
          lat: e.lngLat.lat,
        });
        return;
      }

      if (activeModeRef.current !== MODE_STATION_ROUTE) return;

      clearSupplyState(map);
      clearRecommendationState(map);

      const name = f.properties?.name || "(без названия)";
      const osmId = Number(f.properties?.osm_id);
      if (!Number.isFinite(osmId)) return;

      if (selectedRef.current.length >= 2) {
        resetSelectionInternal(map);
      }

      selectedRef.current.push({ osmId, name, lngLat: e.lngLat });
      setSelectedLabels(map, selectedRef.current);

      if (selectedRef.current.length === 1) {
        setSelectedFeature(map, "A", osmId);
        selectedIdsRef.current.a = osmId;
        setStatus("pick second");
        return;
      }

      if (selectedRef.current.length === 2) {
        const a = selectedRef.current[0];
        const b = selectedRef.current[1];

        if (a.osmId === b.osmId) {
          selectedRef.current = [a];
          setSelectedLabels(map, selectedRef.current);
          selectedIdsRef.current.b = null;
          setStatus("Выбрана та же станция. Укажи другую конечную станцию.");
          return;
        }

        setSelectedFeature(map, "B", osmId);
        selectedIdsRef.current.b = osmId;

        try {
          setStatus("routing...");
          const url = `${routeApiBase}/route?from=${encodeURIComponent(a.osmId)}&to=${encodeURIComponent(b.osmId)}`;
          const res = await fetch(url);
          const txt = await res.text().catch(() => "");

          if (res.status === 404) {
            clearRoute(map);
            setRouteInfo(null);
            selectedIdsRef.current.b = null;
            selectedRef.current = [a];
            setSelectedLabels(map, selectedRef.current);
            setStatus("Маршрут между выбранными станциями не найден. Выбери другую конечную станцию.");
            return;
          }

          if (!res.ok) {
            throw new Error(`route api ${res.status}: ${txt || res.statusText}`);
          }

          const data = JSON.parse(txt);
          map.getSource("route").setData({ type: "FeatureCollection", features: [data.route] });
          setRouteInfo({ km: data.km, stations: data.stations });
          setStatus("ok");
        } catch (err) {
          console.error("Station route error:", err);
          clearRoute(map);
          setRouteInfo(null);
          selectedIdsRef.current.b = null;
          selectedRef.current = [a];
          setSelectedLabels(map, selectedRef.current);
          setStatus("Ошибка построения маршрута. Выбери другую конечную станцию.");
        }
      }
    });

    map.on("click", "port-terminals", async (e) => {
      if (
        isSearchingDeclarationsRef.current ||
        isBuildingDeclarationRouteRef.current ||
        isSearchingSupplyRef.current ||
        isSearchingRecommendationsRef.current
      ) {
        return;
      }
      const f = e.features?.[0];
      if (!f) return;
      mapClickHandledRef.current = true;

      if (activeModeRef.current === MODE_DECLARATIONS && pickDeclarationDestinationModeRef.current) {
        await handleDeclarationDestinationClick({
          type: "port",
          osm_id: Number(f.properties?.osm_id) || null,
          name: f.properties?.name || "Порт",
          lon: e.lngLat.lng,
          lat: e.lngLat.lat,
        });
        return;
      }

      if (activeModeRef.current === MODE_MARKET_RECOMMENDATIONS && pickRecommendationBasePointModeRef.current) {
        handleRecommendationBasePointClick({
          type: "port",
          osm_id: Number(f.properties?.osm_id) || null,
          name: f.properties?.name || "Порт",
          lon: e.lngLat.lng,
          lat: e.lngLat.lat,
        });
        return;
      }

      if (activeModeRef.current === MODE_PRODUCT_SEARCH && pickSupplyDestinationModeRef.current) {
        await handleSupplyDestinationClick({
          type: "port",
          osm_id: Number(f.properties?.osm_id) || null,
          name: f.properties?.name || "Порт",
          lon: e.lngLat.lng,
          lat: e.lngLat.lat,
        });
      }
    });

    map.on("click", "elevators", async (e) => {
      if (
        isSearchingDeclarationsRef.current ||
        isBuildingDeclarationRouteRef.current ||
        isSearchingSupplyRef.current ||
        isSearchingRecommendationsRef.current
      ) {
        return;
      }
      const f = e.features?.[0];
      if (!f) return;
      mapClickHandledRef.current = true;

      if (activeModeRef.current === MODE_DECLARATIONS && pickDeclarationDestinationModeRef.current) {
        await handleDeclarationDestinationClick({
          type: "elevator",
          osm_id: Number(f.properties?.osm_id) || null,
          name: f.properties?.name || "Элеватор",
          lon: e.lngLat.lng,
          lat: e.lngLat.lat,
        });
        return;
      }

      if (activeModeRef.current === MODE_MARKET_RECOMMENDATIONS && pickRecommendationBasePointModeRef.current) {
        handleRecommendationBasePointClick({
          type: "elevator",
          osm_id: Number(f.properties?.osm_id) || null,
          name: f.properties?.name || "Элеватор",
          lon: e.lngLat.lng,
          lat: e.lngLat.lat,
        });
        return;
      }

      if (activeModeRef.current === MODE_PRODUCT_SEARCH && pickSupplyDestinationModeRef.current) {
        await handleSupplyDestinationClick({
          type: "elevator",
          osm_id: Number(f.properties?.osm_id) || null,
          name: f.properties?.name || "Элеватор",
          lon: e.lngLat.lng,
          lat: e.lngLat.lat,
        });
      }
    });


    map.on("click", "declarations-clusters", (e) => {
      if (activeModeRef.current !== MODE_DECLARATIONS) return;
      mapClickHandledRef.current = true;

      const feature = e.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      if (clusterId == null) return;

      map.getSource("declarations")?.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        const coordinates = feature.geometry?.coordinates;
        if (!coordinates) return;
        map.easeTo({
          center: coordinates,
          zoom,
          duration: 400,
        });
      });
    });

    map.on("click", "declarations-points", (e) => {
      if (activeModeRef.current !== MODE_DECLARATIONS) return;
      mapClickHandledRef.current = true;

      const feature = e.features?.[0];
      if (!feature) return;

      const declarationId = String(feature.properties?.declaration_id ?? "");
      if (!declarationId) return;

      selectDeclarationById(declarationId, {
        centerOnSelection: false,
        popupLngLat: feature.geometry?.coordinates,
      });
    });

    map.on("mouseenter", "declarations-clusters", () => {
      if (activeModeRef.current === MODE_DECLARATIONS && !pickDeclarationDestinationModeRef.current) {
        map.getCanvas().style.cursor = "pointer";
      }
    });

    map.on("mouseleave", "declarations-clusters", () => {
      if (
        activeModeRef.current === MODE_DECLARATIONS &&
        pickDeclarationDestinationModeRef.current &&
        !isSearchingDeclarationsRef.current &&
        !isBuildingDeclarationRouteRef.current
      ) {
        map.getCanvas().style.cursor = "crosshair";
      } else {
        map.getCanvas().style.cursor = "";
      }
    });

    map.on("mouseenter", "declarations-points", () => {
      if (activeModeRef.current === MODE_DECLARATIONS && !pickDeclarationDestinationModeRef.current) {
        map.getCanvas().style.cursor = "pointer";
      }
    });

    map.on("mouseleave", "declarations-points", () => {
      if (
        activeModeRef.current === MODE_DECLARATIONS &&
        pickDeclarationDestinationModeRef.current &&
        !isSearchingDeclarationsRef.current &&
        !isBuildingDeclarationRouteRef.current
      ) {
        map.getCanvas().style.cursor = "crosshair";
      } else {
        map.getCanvas().style.cursor = "";
      }
    });

    map.on("click", async (e) => {
      if (mapClickHandledRef.current) {
        mapClickHandledRef.current = false;
        return;
      }

      if (
        activeModeRef.current === MODE_DECLARATIONS &&
        pickDeclarationDestinationModeRef.current &&
        !isSearchingDeclarationsRef.current &&
        !isBuildingDeclarationRouteRef.current
      ) {
        await handleDeclarationDestinationClick({
          type: "point",
          name: `Точка ${round2(e.lngLat.lng)}, ${round2(e.lngLat.lat)}`,
          lon: e.lngLat.lng,
          lat: e.lngLat.lat,
        });
      }
    });

    map.on("click", "supply-points", (e) => {
      if (activeModeRef.current !== MODE_PRODUCT_SEARCH) return;
      const feature = e.features?.[0];
      if (!feature) return;
      const p = feature.properties ?? {};

      new maplibregl.Popup()
        .setLngLat(feature.geometry.coordinates)
        .setHTML(`
          <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(p.declarer || "Источник")}</div>
          <div><b>Продукт:</b> ${escapeHtml(p.product || "")}</div>
          <div><b>Доступно:</b> ${formatTons(p.available_volume_tons)}</div>
          <div><b>Везём:</b> ${formatTons(p.shipped_volume_tons)}</div>
          <div><b>Нужно:</b> ${formatTons(p.need_volume_tons)}</div>
          <div><b>Регион:</b> ${escapeHtml(p.region || "")}</div>
          <div><b>Станция отправления:</b> ${escapeHtml(p.source_station_name || "")}</div>
          <div><b>Пункт назначения:</b> ${escapeHtml(p.destination_name || "")}</div>
          <div><b>Станция прибытия:</b> ${escapeHtml(p.arrival_station_name || "")}</div>
          <div><b>Маршрут:</b> ${formatNum(p.route_km)} км</div>
        `)
        .addTo(map);
    });

    map.on("click", "recommendation-points", (e) => {
      if (activeModeRef.current !== MODE_MARKET_RECOMMENDATIONS) return;
      const feature = e.features?.[0];
      if (!feature) return;
      const p = feature.properties ?? {};

      new maplibregl.Popup()
        .setLngLat(feature.geometry.coordinates)
        .setHTML(`
          <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(p.name || p.point_role || "Точка")}</div>
          <div><b>Роль:</b> ${escapeHtml(p.point_role || "")}</div>
        `)
        .addTo(map);
    });

    mapRef.current = map;
    return () => {
      try {
        map.remove();
      } catch {}
      mapRef.current = null;
      setReady(false);
    };
  }, [railTiles, routeApiBase]);


  function cancelDeclarationSearch(nextStatus) {
    if (declarationAbortRef.current) {
      declarationAbortRef.current.abort();
      declarationAbortRef.current = null;
    }
    setIsSearchingDeclarations(false);
    if (nextStatus) setStatus(nextStatus);
  }

  function cancelDeclarationRoute(nextStatus) {
    if (declarationRouteAbortRef.current) {
      declarationRouteAbortRef.current.abort();
      declarationRouteAbortRef.current = null;
    }
    setIsBuildingDeclarationRoute(false);
    if (nextStatus) setStatus(nextStatus);
  }

  function setDeclarationSourceData(map, result) {
    const src = map?.getSource("declarations");
    if (!src) return;
    src.setData(result?.feature_collection ?? emptyFeatureCollection());
  }

  function clearDeclarationRouteLayers(map) {
    map?.getSource("declarationRoute")?.setData(emptyFeatureCollection());
    map?.getSource("declarationRoutePoints")?.setData(emptyFeatureCollection());
  }

  function drawSelectedDeclaration(map, declaration) {
    const src = map?.getSource("selectedDeclaration");
    if (!src) return;

    if (!declaration || declaration.lon == null || declaration.lat == null) {
      src.setData(emptyFeatureCollection());
      return;
    }

    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [Number(declaration.lon), Number(declaration.lat)],
          },
          properties: {
            declaration_id: declaration.declaration_id,
            declarer: declaration.declarer,
          },
        },
      ],
    });
  }

  function drawDeclarationRoute(map, payload) {
    if (!map) return;
    map.getSource("declarationRoute")?.setData({
      type: "FeatureCollection",
      features: Array.isArray(payload?.route_segments) ? payload.route_segments : [],
    });
    map.getSource("declarationRoutePoints")?.setData({
      type: "FeatureCollection",
      features: Array.isArray(payload?.points) ? payload.points : [],
    });

    const features = [
      ...(payload?.route_segments || []),
      ...(payload?.points || []),
    ].filter(Boolean);
    fitToFeatures(map, features, payload?.destination);
  }

  function clearDeclarationState(map, { keepSearchResult = false } = {}) {
    setPickDeclarationDestinationMode(false);
    cancelDeclarationSearch();
    cancelDeclarationRoute();
    clearDeclarationRouteLayers(map);
    drawSelectedDeclaration(
      map,
      keepSearchResult ? selectedDeclarationRef.current : null
    );
    setDeclarationRouteResult(null);

    if (!keepSearchResult) {
      setDeclarationResult(null);
      setSelectedDeclarationId(null);
      setDeclarationRouteResult(null);
      setDeclarationSourceData(map, null);
      drawSelectedDeclaration(map, null);
    }
  }

  function openDeclarationPopup(map, declaration, lngLatOrCoords) {
    if (!map || !declaration || !lngLatOrCoords) return;

    new maplibregl.Popup({ closeButton: true, closeOnClick: true })
      .setLngLat(lngLatOrCoords)
      .setHTML(buildDeclarationPopupHtml(declaration))
      .addTo(map);
  }

  function selectDeclarationById(
    declarationId,
    { centerOnSelection = false, popupLngLat = null } = {}
  ) {
    const map = mapRef.current;
    const currentResult = declarationResultRef.current;
    const items = Array.isArray(currentResult?.items) ? currentResult.items : [];
    const declaration =
      items.find((item) => String(item.declaration_id) === String(declarationId)) || null;

    if (!declaration) return;

    cancelDeclarationRoute();
    setPickDeclarationDestinationMode(false);
    setSelectedDeclarationId(String(declarationId));
    setDeclarationRouteResult(null);
    if (map) {
      clearDeclarationRouteLayers(map);
      drawSelectedDeclaration(map, declaration);
      if (centerOnSelection && declaration.lon != null && declaration.lat != null) {
        map.easeTo({
          center: [Number(declaration.lon), Number(declaration.lat)],
          zoom: Math.max(map.getZoom(), 6),
          duration: 400,
        });
      }
      if (popupLngLat) {
        openDeclarationPopup(map, declaration, popupLngLat);
      }
    }
    setStatus(`Выбрана декларация: ${declaration.declarer || "(без названия)"}`);
  }

  function applyDeclarationQuickRange(days) {
    const end = todayIso();
    const start = shiftDateIso(end, -days);
    setDeclarationDateFrom(start);
    setDeclarationDateTo(end);
  }

  async function searchDeclarations() {
    const map = mapRef.current;
    if (!map) return;

    cancelSupplySearch();
    cancelRecommendationSearch();
    cancelNotebookLmQuery();
    resetSelectionInternal(map);
    clearDeclarationState(map);
    clearSupplyState(map);
    clearRecommendationState(map);

    const payload = {
      product: resolveProductToUse(),
      min_volume_tons: Number(needVolumeTonsRef.current) || 0,
      date_from: declarationDateFrom || null,
      date_to: declarationDateTo || null,
      limit: 4000,
    };

    const controller = new AbortController();
    if (declarationAbortRef.current) declarationAbortRef.current.abort();
    declarationAbortRef.current = controller;

    try {
      setIsSearchingDeclarations(true);
      setStatus("Ищем декларации…");
      const response = await fetch(`${routeApiBase}/api/declarations/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || response.statusText || "declarations search failed");
      }

      setDeclarationResult(data);
      setDeclarationRouteResult(null);
      setDeclarationSourceData(map, data);

      const firstId = data?.items?.[0]?.declaration_id ?? null;
      setSelectedDeclarationId(firstId ? String(firstId) : null);

      if (firstId) {
        const first = data.items.find(
          (item) => String(item.declaration_id) === String(firstId)
        );
        drawSelectedDeclaration(map, first);
      } else {
        drawSelectedDeclaration(map, null);
      }

      if (Array.isArray(data?.feature_collection?.features) && data.feature_collection.features.length) {
        fitToFeatures(map, data.feature_collection.features);
      }

      setStatus(
        data?.total_count
          ? `Найдено деклараций: ${data.total_count}`
          : "По выбранным фильтрам декларации не найдены"
      );
    } catch (err) {
      if (err?.name === "AbortError") {
        setStatus("Поиск деклараций отменён");
        return;
      }
      console.error("Declaration search error:", err);
      setStatus(`declarations error: ${err.message}`);
    } finally {
      if (declarationAbortRef.current === controller) declarationAbortRef.current = null;
      setIsSearchingDeclarations(false);
    }
  }

 async function handleDeclarationDestinationClick(destination) {
  const map = mapRef.current;
  const declaration = selectedDeclarationRef.current;

  if (!map || !declaration) {
    setStatus("Сначала выбери декларацию");
    return;
  }

  if (declaration.lon == null || declaration.lat == null) {
    setStatus("У выбранной декларации нет координат");
    return;
  }

  const payload = {
    declaration: {
      declaration_id: declaration.declaration_id,
      registration_number: declaration.registration_number,
      declarer: declaration.declarer,
      manufacturer: declaration.manufacturer,
      region: declaration.region,
      country: declaration.country,
      product: declaration.product,
      product_name: declaration.product_name,
      volume_tons: declaration.volume_tons,
      publication_date: declaration.publication_date,
      lon: declaration.lon,
      lat: declaration.lat,
    },
    destination,
  };

  const controller = new AbortController();
  if (declarationRouteAbortRef.current) declarationRouteAbortRef.current.abort();
  declarationRouteAbortRef.current = controller;

  try {
    setIsBuildingDeclarationRoute(true);
    setPickDeclarationDestinationMode(false);
    setStatus("Строим маршрут от декларации…");

    const response = await fetch(`${routeApiBase}/api/declarations/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data?.error || `route api ${response.status}: ${response.statusText}`);
    }

    setDeclarationRouteResult(data);
    drawDeclarationRoute(map, data);
    setStatus(`Маршрут построен: ${data?.route?.selected_mode || "ok"}`);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error("Declaration route error:", err);
    setDeclarationRouteResult(null);
    clearDeclarationRouteLayers(map);
    setStatus(`declaration route error: ${err.message}`);
  } finally {
    if (declarationRouteAbortRef.current === controller) {
      declarationRouteAbortRef.current = null;
    }
    setIsBuildingDeclarationRoute(false);
  }
}

  function cancelSupplySearch(nextStatus) {
    if (supplyAbortRef.current) {
      supplyAbortRef.current.abort();
      supplyAbortRef.current = null;
    }
    setIsSearchingSupply(false);
    if (nextStatus) setStatus(nextStatus);
  }

  function cancelRecommendationSearch(nextStatus) {
    if (recommendationAbortRef.current) {
      recommendationAbortRef.current.abort();
      recommendationAbortRef.current = null;
    }
    setIsSearchingRecommendations(false);
    if (nextStatus) setStatus(nextStatus);
  }

  function cancelNotebookLmQuery(nextStatus) {
    if (notebookLmAbortRef.current) {
      notebookLmAbortRef.current.abort();
      notebookLmAbortRef.current = null;
    }
    setIsQueryingNotebookLm(false);
    if (nextStatus) setStatus(nextStatus);
  }

  function resetNotebookLmArtifacts() {
    setNotebookLmPrompt("");
    setNotebookLmRawAnswer("");
    setMarketSignalsText("");
  }

  async function handleSupplyDestinationClick(destination) {
    setPickSupplyDestinationMode(false);
    await searchSupply(destination);
  }

  function handleRecommendationBasePointClick(point) {
    setPickRecommendationBasePointMode(false);
    setRecommendationBasePoint(point);
    const map = mapRef.current;
    if (map) {
      drawRecommendationSelectionPoint(map, point);
    }
    setStatus(`Базовая точка выбрана: ${point.name}`);
  }

  function resolveProductToUse() {
    const currentSelectedProduct = selectedProductRef.current;
    const currentProducts = productsRef.current;
    if (currentSelectedProduct && String(currentSelectedProduct).trim()) return currentSelectedProduct;
    if (currentProducts.length > 0) return currentProducts[0] ?? DEFAULT_PRODUCT;
    return DEFAULT_PRODUCT;
  }

  async function searchSupply(destination) {
    const map = mapRef.current;
    if (!map) return;

    resetSelectionInternal(map);
    clearDeclarationState(map);
    clearRecommendationState(map);

    const productToUse = resolveProductToUse();
    const need = Number(needVolumeTonsRef.current);

    if (!productToUse) {
      setStatus("выбери продукт");
      return;
    }

    if (!Number.isFinite(need) || need <= 0) {
      setStatus("объем в тоннах некорректен");
      return;
    }

    const controller = new AbortController();
    if (supplyAbortRef.current) supplyAbortRef.current.abort();
    supplyAbortRef.current = controller;

    try {
      setIsSearchingSupply(true);
      setStatus("search supply...");
      clearSupplyState(map);
      setDemandPoint(map, destination.lon, destination.lat);

      const payload = {
        product: productToUse,
        need_volume_tons: need,
        options_limit: 6,
        transport_mode: supplyTransportModeRef.current,
        destination,
      };

      const rawData = await apiSearchSupply(payload, controller.signal, routeApiBase);
      const normalizedData = {
        ...rawData,
        options: Array.isArray(rawData.options) ? rawData.options.slice(0, 6) : [],
      };

      setSupplyResult(normalizedData);
      const firstOptionNo = normalizedData.options?.[0]?.option_no ?? null;
      setSelectedOptionNo(firstOptionNo);
      drawSupplyOption(map, normalizedData, firstOptionNo);

      if (!normalizedData.options?.length) {
        setStatus(normalizedData.empty_state_reason || "Нет вариантов");
      } else {
        setStatus(`ok: показаны варианты ${normalizedData.options.length}`);
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setStatus("поиск отменён");
        return;
      }
      console.error("Supply search error:", err);
      setStatus(`supply error: ${err.message}`);
    } finally {
      if (supplyAbortRef.current === controller) supplyAbortRef.current = null;
      setIsSearchingSupply(false);
    }
  }

  async function requestNotebookLmSignals({ product, volumeTons }) {
    if (!notebookLmStatus?.direct_query_enabled) {
      const freshStatus = await apiGetNotebookLmStatus(routeApiBase);
      setNotebookLmStatus(freshStatus);

      if (!freshStatus?.direct_query_enabled) {
        const reason = freshStatus?.error || "NotebookLM не настроен на backend";
        throw new Error(reason);
      }
    }

    const controller = new AbortController();
    if (notebookLmAbortRef.current) notebookLmAbortRef.current.abort();
    notebookLmAbortRef.current = controller;

    try {
      setIsQueryingNotebookLm(true);
      setStatus("Запрашиваем рыночные сигналы в NotebookLM...");

      const response = await apiQueryNotebookLm(
        {
          mode: recommendationModeRef.current,
          product,
          volume_tons: volumeTons,
          transport_mode: recommendationTransportModeRef.current,
        },
        controller.signal,
        routeApiBase
      );

      setNotebookLmPrompt(response.prompt || "");
      setNotebookLmRawAnswer(response.raw_text || "");

      const normalizedSignals =
        response.normalized_market_signals ??
        response.parsed_json?.market_signals ??
        response.parsed_json?.signals ??
        response.parsed_json ??
        null;

      const signalArray = Array.isArray(normalizedSignals)
        ? normalizedSignals
        : Array.isArray(normalizedSignals?.market_signals)
        ? normalizedSignals.market_signals
        : Array.isArray(normalizedSignals?.signals)
        ? normalizedSignals.signals
        : [];

      if (!response.parse_ok || signalArray.length === 0) {
        throw new Error(
          "NotebookLM ответил, но JSON-сигналы не распознаны. Проверь raw answer."
        );
      }

      setMarketSignalsText(JSON.stringify(signalArray, null, 2));
      setStatus(`NotebookLM вернул ${signalArray.length} рыночных сигналов`);
      return signalArray;
    } catch (err) {
      if (err?.name === "AbortError") {
        setStatus("запрос к NotebookLM отменён");
      } else {
        console.error(err);
        setStatus(`notebooklm error: ${err.message}`);
      }
      throw err;
    } finally {
      if (notebookLmAbortRef.current === controller) notebookLmAbortRef.current = null;
      setIsQueryingNotebookLm(false);
    }
  }

  async function runRecommendations() {
    const map = mapRef.current;
    if (!map) return;

    cancelSupplySearch();
    cancelRecommendationSearch();
    resetSelectionInternal(map);
    clearSupplyState(map);

    const product = resolveProductToUse();
    const volume = Number(needVolumeTonsRef.current);
    if (!product) {
      setStatus("выбери продукт");
      return;
    }
    if (!Number.isFinite(volume) || volume <= 0) {
      setStatus("объем в тоннах некорректен");
      return;
    }
    if (
      recommendationModeRef.current !== RECOMMENDATION_MODE_TRADER &&
      !recommendationBasePoint
    ) {
      setStatus("сначала выбери базовую точку");
      return;
    }

    let marketSignals = [];
    try {
      marketSignals = await requestNotebookLmSignals({
        product,
        volumeTons: volume,
      });
    } catch (err) {
      return;
    }

    const controller = new AbortController();
    if (recommendationAbortRef.current) recommendationAbortRef.current.abort();
    recommendationAbortRef.current = controller;

    try {
      setIsSearchingRecommendations(true);
      setStatus("Считаем маршруты и рейтинг направлений...");
      clearRecommendationState(map);
      if (recommendationBasePoint) {
        drawRecommendationSelectionPoint(map, recommendationBasePoint);
      }

      const rawResult = await apiSearchRecommendations(
        {
          mode: recommendationModeRef.current,
          product,
          volume_tons: volume,
          transport_mode: recommendationTransportModeRef.current,
          base_point:
            recommendationModeRef.current === RECOMMENDATION_MODE_TRADER
              ? null
              : recommendationBasePoint,
          market_signals: marketSignals,
        },
        controller.signal,
        routeApiBase
      );

      const result = normalizeRecommendationResult(rawResult);
      setRecommendationResult(result);
      const firstId = result.results?.[0]?._ui_id ?? null;
      setSelectedRecommendationId(firstId);
      drawRecommendation(map, result, firstId);


    

      if (!result.results?.length) {
        setStatus("Не найдено ни одной рекомендации по текущим сигналам");
      } else {
        setStatus(`ok: найдено ${result.results.length} рекомендаций`);
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setStatus("поиск рекомендаций отменён");
        return;
      }
      console.error(err);
      setStatus(`recommendations error: ${err.message}`);
    } finally {
      if (recommendationAbortRef.current === controller) recommendationAbortRef.current = null;
      setIsSearchingRecommendations(false);
    }
  }

  function drawSupplyOption(map, data, optionNo) {
    if (!map) return;
    const option = (data?.options || []).find((x) => x.option_no === optionNo);
    const routeSrc = map.getSource("supplyRoutes");
    const pointSrc = map.getSource("supplyPoints");
    if (!routeSrc || !pointSrc) return;

    if (!option) {
      routeSrc.setData(emptyFeatureCollection());
      pointSrc.setData(emptyFeatureCollection());
      return;
    }

    const routeFeatures = option.sources.flatMap((s) =>
      Array.isArray(s.route_segments) ? s.route_segments : []
    );

    const pointFeatures = option.sources
      .filter((s) => Number(s.shipped_volume_tons) > 0)
      .map((s) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.point.lon, s.point.lat] },
        properties: {
          declarer: s.declarer,
          product: s.product,
          available_volume_tons: s.available_volume_tons,
          shipped_volume_tons: s.shipped_volume_tons,
          need_volume_tons: s.need_volume_tons,
          region: s.region,
          route_km: s.total_route_km,
          source_station_name: s.source_station?.name || "",
          destination_name: data?.destination?.name || "",
          arrival_station_name: data?.arrival_station?.name || "",
          is_sufficient: s.is_sufficient,
        },
      }));

    routeSrc.setData({ type: "FeatureCollection", features: routeFeatures });
    pointSrc.setData({ type: "FeatureCollection", features: pointFeatures });
    fitToFeatures(map, [...routeFeatures, ...pointFeatures], data?.destination);
  }

  function drawRecommendationSelectionPoint(map, point) {
    const src = map.getSource("recommendationPoints");
    if (!src || !point) return;
    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [point.lon, point.lat] },
          properties: { point_role: "base", name: point.name },
        },
      ],
    });
  }

  function drawRecommendation(map, data, recommendationId) {
    if (!map) return;
    const item = (data?.results || []).find(
      (x) => x._ui_id === recommendationId || x.id === recommendationId
    );
    const routeSrc = map.getSource("recommendationRoutes");
    const pointSrc = map.getSource("recommendationPoints");
    if (!routeSrc || !pointSrc) return;

    if (!item) {
      routeSrc.setData(emptyFeatureCollection());
      pointSrc.setData(emptyFeatureCollection());
      if (recommendationBasePoint) drawRecommendationSelectionPoint(map, recommendationBasePoint);
      return;
    }

    routeSrc.setData({
      type: "FeatureCollection",
      features: Array.isArray(item.route_segments) ? item.route_segments : [],
    });

    const pointFeatures = (item.points || []).map((point) => ({
      ...point,
      properties: {
        ...(point.properties || {}),
        name: point.properties?.name || point.properties?.point_role || "Точка",
      },
    }));

    pointSrc.setData({ type: "FeatureCollection", features: pointFeatures });
    fitToFeatures(map, [...(item.route_segments || []), ...pointFeatures]);
  }

  function setDemandPoint(map, lon, lat) {
    const src = map.getSource("demandPoint");
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: {} }],
    });
  }

  function clearSupplyLayers(map) {
    map.getSource("supplyRoutes")?.setData(emptyFeatureCollection());
    map.getSource("supplyPoints")?.setData(emptyFeatureCollection());
    map.getSource("demandPoint")?.setData(emptyFeatureCollection());
  }

  function clearRecommendationLayers(map) {
    map.getSource("recommendationRoutes")?.setData(emptyFeatureCollection());
    map.getSource("recommendationPoints")?.setData(emptyFeatureCollection());
  }

  function clearSupplyState(map) {
    clearSupplyLayers(map);
    setSupplyResult(null);
    setSelectedOptionNo(null);
    setPickSupplyDestinationMode(false);
  }

  function clearRecommendationState(map) {
    clearRecommendationLayers(map);
    setRecommendationResult(null);
    setSelectedRecommendationId(null);
    setPickRecommendationBasePointMode(false);
  }

  function clearEverything(map) {
    resetSelectionInternal(map);
    clearDeclarationState(map);
    clearSupplyState(map);
    clearRecommendationState(map);
    clearHoverState(map, hoverIdRef);
  }

  function switchMode(nextMode) {
    if (nextMode === activeMode) return;
    cancelDeclarationSearch();
    cancelDeclarationRoute();
    cancelSupplySearch();
    cancelRecommendationSearch();
    cancelNotebookLmQuery();
    const map = mapRef.current;
    if (map) clearEverything(map);
    setActiveMode(nextMode);
    setStatus(
      nextMode === MODE_DECLARATIONS
        ? "режим: декларации"
        : nextMode === MODE_STATION_ROUTE
        ? "режим: маршрут между станциями"
        : nextMode === MODE_PRODUCT_SEARCH
        ? "режим: поиск продукта"
        : "режим: рыночные рекомендации"
    );
  }

  function handleProductChange(nextProduct) {
    cancelDeclarationSearch();
    cancelDeclarationRoute();
    cancelSupplySearch();
    cancelRecommendationSearch();
    cancelNotebookLmQuery();
    selectedProductRef.current = nextProduct;
    setSelectedProduct(nextProduct);
    const map = mapRef.current;
    if (map) {
      clearDeclarationState(map);
      clearSupplyState(map);
      clearRecommendationState(map);
    }
    resetNotebookLmArtifacts();
    setStatus("изменился продукт — обнови поиск");
  }

  function handleNeedChange(nextNeed) {
    cancelDeclarationSearch();
    cancelDeclarationRoute();
    cancelSupplySearch();
    cancelRecommendationSearch();
    cancelNotebookLmQuery();
    needVolumeTonsRef.current = nextNeed;
    setNeedVolumeTons(nextNeed);
    const map = mapRef.current;
    if (map) {
      clearDeclarationState(map);
    }
    resetNotebookLmArtifacts();
    setStatus("изменилась потребность — обнови поиск");
  }

  function handleSupplyTransportModeChange(nextMode) {
    if (nextMode === supplyTransportModeRef.current) return;
    cancelSupplySearch();
    cancelNotebookLmQuery();
    supplyTransportModeRef.current = nextMode;
    setSupplyTransportMode(nextMode);
    const map = mapRef.current;
    if (map) clearSupplyState(map);
    resetNotebookLmArtifacts();
    setStatus(`режим доставки: ${nextMode}`);
  }

  function handleRecommendationModeChange(nextMode) {
    if (nextMode === recommendationModeRef.current) return;
    cancelNotebookLmQuery();
    recommendationModeRef.current = nextMode;
    setRecommendationMode(nextMode);
    const map = mapRef.current;
    if (map) clearRecommendationState(map);
    resetNotebookLmArtifacts();
    setStatus(`режим рекомендаций: ${nextMode}`);
  }

  function handleRecommendationTransportModeChange(nextMode) {
    if (nextMode === recommendationTransportModeRef.current) return;
    cancelNotebookLmQuery();
    recommendationTransportModeRef.current = nextMode;
    setRecommendationTransportMode(nextMode);
    const map = mapRef.current;
    if (map) clearRecommendationState(map);
    resetNotebookLmArtifacts();
    setStatus(`режим маршрута для рекомендаций: ${nextMode}`);
  }

  const activeDeclarationQuickRange = React.useMemo(() => {
    const end = todayIso();

    if (declarationDateTo !== end) return null;

    for (const days of [0, 7, 30, 60]) {
      if (declarationDateFrom === shiftDateIso(end, -days)) {
        return days;
      }
    }

    return null;
  }, [declarationDateFrom, declarationDateTo]);


  return (
    <div style={{ position: "relative", height: "100vh", width: "100vw" }}>
      <div ref={mapContainerRef} style={{ position: "absolute", inset: 0 }} />

      <LoadingOverlay
        open={
          isSearchingDeclarations ||
          isBuildingDeclarationRoute ||
          isSearchingSupply ||
          isSearchingRecommendations ||
          isQueryingNotebookLm
        }
        title={
          isBuildingDeclarationRoute
            ? "Строим маршрут от декларации"
            : isSearchingDeclarations
            ? "Ищем декларации"
            : isQueryingNotebookLm
            ? "Запрашиваем NotebookLM"
            : isSearchingRecommendations
            ? "Считаем рекомендации"
            : "Ищем варианты поставки"
        }
        message={activeLoaderMessages[searchMessageIndex]}
      />

      <LeftPanel
        ready={ready}
        status={status}
        isSearchingSupply={isSearchingSupply}
        isSearchingRecommendations={isSearchingRecommendations}
        isQueryingNotebookLm={isQueryingNotebookLm}
        isSearchingDeclarations={isSearchingDeclarations}
        isBuildingDeclarationRoute={isBuildingDeclarationRoute}
        isStationRouteMode={activeMode === MODE_STATION_ROUTE}
        isDeclarationMode={activeMode === MODE_DECLARATIONS}
        isProductSearchMode={activeMode === MODE_PRODUCT_SEARCH}
        isRecommendationMode={activeMode === MODE_MARKET_RECOMMENDATIONS}
        onSwitchToStationRoute={() => switchMode(MODE_STATION_ROUTE)}
        onSwitchToDeclarations={() => switchMode(MODE_DECLARATIONS)}
        onSwitchToProductSearch={() => switchMode(MODE_PRODUCT_SEARCH)}
        onSwitchToRecommendations={() => switchMode(MODE_MARKET_RECOMMENDATIONS)}
        showLines={showLines}
        showStations={showStations}
        showPorts={showPorts}
        showElevators={showElevators}
        setShowLines={setShowLines}
        setShowStations={setShowStations}
        setShowPorts={setShowPorts}
        setShowElevators={setShowElevators}
        onResetSelection={() => {
          const map = mapRef.current;
          if (!map) return;
          resetSelectionInternal(map);
          setStatus("ok");
        }}
        products={products}
        selectedProduct={selectedProduct}
        onProductChange={handleProductChange}
        needVolumeTons={needVolumeTons}
        onNeedVolumeChange={handleNeedChange}
        declarationDateFrom={declarationDateFrom}
        declarationDateTo={declarationDateTo}
        activeDeclarationQuickRange={activeDeclarationQuickRange}

        onDeclarationDateFromChange={setDeclarationDateFrom}
        onDeclarationDateToChange={setDeclarationDateTo}
        onApplyDeclarationQuickRange={applyDeclarationQuickRange}
        onSearchDeclarations={searchDeclarations}
        onClearDeclarations={() => {
          const map = mapRef.current;
          if (!map) return;
          clearDeclarationState(map);
          setStatus("ok");
        }}
        declarationResult={declarationResult}
        selectedDeclaration={selectedDeclaration}
        pickDeclarationDestinationMode={pickDeclarationDestinationMode}
        onToggleDeclarationDestinationPick={() =>
          setPickDeclarationDestinationMode((prev) => !prev)
        }
        supplyTransportMode={supplyTransportMode}
        onSupplyTransportModeChange={handleSupplyTransportModeChange}
        pickSupplyDestinationMode={pickSupplyDestinationMode}
        onToggleDestinationPick={() => setPickSupplyDestinationMode((prev) => !prev)}
        onClearSupply={() => {
          const map = mapRef.current;
          if (!map) return;
          cancelSupplySearch();
          clearSupplyState(map);
          setStatus("ok");
        }}
        supplyResult={supplyResult}
        marketRecommendationMode={recommendationMode}
        onMarketRecommendationModeChange={handleRecommendationModeChange}
        marketTransportMode={recommendationTransportMode}
        onMarketTransportModeChange={handleRecommendationTransportModeChange}
        recommendationBasePoint={recommendationBasePoint}
        pickRecommendationBasePointMode={pickRecommendationBasePointMode}
        onToggleRecommendationBasePointPick={() =>
          setPickRecommendationBasePointMode((prev) => !prev)
        }
        notebookLmStatus={notebookLmStatus}
        notebookLmPrompt={notebookLmPrompt}
        notebookLmRawAnswer={notebookLmRawAnswer}
        marketSignalsText={marketSignalsText}
        onSearchRecommendations={runRecommendations}
        onClearRecommendations={() => {
          const map = mapRef.current;
          if (!map) return;
          cancelRecommendationSearch();
          cancelNotebookLmQuery();
          clearRecommendationState(map);
          setRecommendationBasePoint(null);
          resetNotebookLmArtifacts();
          setStatus("ok");
        }}
        recommendationResult={recommendationResult}
      />

      {activeMode === MODE_DECLARATIONS && (
        <DeclarationResultsPanel
          declarationResult={declarationResult}
          selectedDeclarationId={selectedDeclarationId}
          declarationRouteResult={declarationRouteResult}
          onSelectDeclaration={(id) =>
            selectDeclarationById(id, {
              centerOnSelection: true,
            })
          }
        />
      )}

      {activeMode === MODE_STATION_ROUTE && <RouteInfoPanel routeInfo={routeInfo} />}

      {activeMode === MODE_PRODUCT_SEARCH && (
        <SupplyResultsPanel
          supplyResult={supplyResult}
          selectedOptionNo={selectedOptionNo}
          needVolumeTons={needVolumeTons}
          onSelectOption={(optionNo) => {
            setSelectedOptionNo(optionNo);
            drawSupplyOption(mapRef.current, supplyResult, optionNo);
          }}
        />
      )}

      {activeMode === MODE_MARKET_RECOMMENDATIONS && (
        <RecommendationResultsPanel
          recommendationResult={recommendationResult}
          selectedRecommendationId={selectedRecommendationId}
          onSelectRecommendation={(id) => {
            setSelectedRecommendationId(id);
            drawRecommendation(mapRef.current, recommendationResult, id);
          }}
        />
      )}
    </div>
  );

  function resetSelectionInternal(map) {
    const { a, b } = selectedIdsRef.current;
    if (a != null) {
      try {
        map.setFeatureState({ source: "rail", sourceLayer: "rail_stations", id: a }, { selectedA: false });
      } catch {}
    }
    if (b != null) {
      try {
        map.setFeatureState({ source: "rail", sourceLayer: "rail_stations", id: b }, { selectedB: false });
      } catch {}
    }
    selectedIdsRef.current = { a: null, b: null };
    selectedRef.current = [];
    setSelectedLabels(map, []);
    setRouteInfo(null);
    clearRoute(map);
  }

  function setSelectedFeature(map, which, osmId) {
    const key = which === "A" ? "selectedA" : "selectedB";
    try {
      map.setFeatureState({ source: "rail", sourceLayer: "rail_stations", id: osmId }, { [key]: true });
    } catch {}
  }

  function setSelectedLabels(map, selected) {
    const fc = {
      type: "FeatureCollection",
      features: selected.map((s) => ({
        type: "Feature",
        properties: { name: s.name, osm_id: s.osmId },
        geometry: { type: "Point", coordinates: [s.lngLat.lng, s.lngLat.lat] },
      })),
    };
    map.getSource("selectedStations")?.setData(fc);
  }
}

function emptyFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}

function fitToFeatures(map, features = [], singlePoint) {
  if (!map) return;
  const bounds = new maplibregl.LngLatBounds();

  features.forEach((f) => {
    const geom = f?.geometry;
    if (!geom) return;
    if (geom.type === "Point") {
      bounds.extend(geom.coordinates);
    } else if (geom.type === "LineString") {
      geom.coordinates.forEach((c) => bounds.extend(c));
    } else if (geom.type === "MultiLineString") {
      geom.coordinates.forEach((line) => line.forEach((c) => bounds.extend(c)));
    }
  });

  if (singlePoint?.lon != null && singlePoint?.lat != null) {
    bounds.extend([Number(singlePoint.lon), Number(singlePoint.lat)]);
  }

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 60, maxZoom: 9, duration: 500 });
  }
}

function todayIso() {
  const now = new Date();
  return toIsoDate(now);
}

function shiftDateIso(baseIso, days) {
  const date = new Date(`${baseIso}T00:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return toIsoDate(date);
}

function toIsoDate(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildDeclarationPopupHtml(item) {
  const bucketLabels = {
    0: "&lt; 100 т",
    1: "100 – 500 т",
    2: "500 – 1 000 т",
    3: "1 000 – 10 000 т",
    4: "&gt; 10 000 т",
  };

  return `
    <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(item.product || "Декларация")}</div>
    <div style="margin-bottom:4px;">${escapeHtml(item.declarer || "(без названия)")}</div>
    ${item.region ? `<div style="color:#6b7280;margin-bottom:4px;">${escapeHtml(item.region)}</div>` : ""}
    <div><b>Объём:</b> ${formatTons(item.volume_tons)}</div>
    ${item.publication_date ? `<div><b>Дата:</b> ${escapeHtml(item.publication_date)}</div>` : ""}
    <div><b>Категория:</b> ${bucketLabels[item.volume_bucket_idx] || "—"}</div>
  `;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}
