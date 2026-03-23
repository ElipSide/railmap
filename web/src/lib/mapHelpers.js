export function clearHoverState(map, hoverIdRef) {
  if (!map) return;

  const prev = hoverIdRef.current;
  hoverIdRef.current = null;

  if (prev != null) {
    try {
      map.setFeatureState(
        { source: "rail", sourceLayer: "rail_stations", id: prev },
        { hover: false }
      );
    } catch {}
  }
}

export function clearRoute(map) {
  const src = map.getSource("route");
  if (src) {
    src.setData({ type: "FeatureCollection", features: [] });
  }
}

export function applyVisibility(
  map,
  { showLines, showStations, showPorts, showElevators }
) {
  const vis = (v) => (v ? "visible" : "none");

  const safeSet = (layerId, value) => {
    if (!map.getLayer(layerId)) return;
    map.setLayoutProperty(layerId, "visibility", value);
  };

  safeSet("rail-lines-shadow", vis(showLines));
  safeSet("rail-lines-casing", vis(showLines));
  safeSet("rail-lines", vis(showLines));

  safeSet("rail-stations", vis(showStations));
  safeSet("rail-station-labels", vis(showStations));
  safeSet("selectedStations-labels", vis(showStations));

  safeSet("port-terminals", vis(showPorts));
  safeSet("elevators", vis(showElevators));
}