(() => {
  const page = document.body.dataset.page || "match";
  const assetBase = location.pathname.includes("/frontend/") ? "../backend/static" : "/static";
  const MAP_PASSWORD = "warrior_is_op";
  const KEYS = {
    theme: "aw_theme_v2",
    themeLegacy: "aw_theme_v1",
    lastMap: "aw_last_map_v1",
    maps: "aw_map_manifest_v1",
    layers: "aw_map_layers_v1",
    matches: "aw_matches_v4",
    matchesLegacy: "aw_matches_v3",
    teams: "aw_teams_v4",
    teamsLegacy: "aw_teams_v3",
    teamStats: "aw_team_stats_v1"
  };
  const COLORS = ["#ffab19", "#ff5d67", "#38d5ff", "#22d28b", "#ffffff", "#a78bfa"];
  const STROKES = [1, 2, 4, 6, 8];
  const TEAM_COLORS = ["#ffab19", "#38d5ff", "#22d28b", "#ff5d67"];
  const NAV_ITEMS = [
    { key: "match", label: "MATCH", href: "index.html" },
    { key: "maps", label: "MAPS", href: "maps.html" },
    { key: "teams", label: "TEAMS", href: "teams.html" },
    { key: "teamstats", label: "TEAM STATS", href: "performance.html" },
    { key: "export", label: "EXPORT", href: "export.html" }
  ];
  const TOOL_SHORTCUTS = {
    select: "V",
    pan: "H",
    pencil: "P",
    line: "L",
    arrow: "A",
    rotation: "R",
    circle: "C",
    rect: "B",
    polygon: "G",
    text: "T",
    zone: "Z"
  };
  const SELECTED_ZONE = -2;

  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  const modalRoot = document.getElementById("modal-root");

  let maps = normalizeMaps(read(KEYS.maps, null) || buildDefaultMaps());
  let mapLayers = read(KEYS.layers, {});
  const store = {
    matches: normalizeMatches(readFirst([KEYS.matches, KEYS.matchesLegacy], [])),
    teams: normalizeTeams(readFirst([KEYS.teams, KEYS.teamsLegacy], buildDefaultTeams())),
    teamStats: read(KEYS.teamStats, [])
  };
  const state = {
    tool: "select",
    color: COLORS[0],
    stroke: 2,
    opacity: 1,
    mapId: getInitialMapId(),
    mapTabsOpen: true,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    shapes: [],
    zone: null,
    zoneSelectedLayer: -1,
    selected: -1,
    draft: null,
    drag: null,
    undo: [],
    redo: []
  };

  let refreshPage = function () {};
  let mapImage = new Image();
  let mapObjectUrl = null;
  let activeLoadToken = 0;
  let nextId = 1;
  let dbPromise = null;
  let zoneWheelUndoTimer = null;

  renderAppShell();
  setBrandLogo();
  bindSharedEvents();
  applyTheme(readFirst([KEYS.theme, KEYS.themeLegacy], "dark"));

  if (page === "match") {
    refreshPage = initMatchPage();
  } else if (page === "maps") {
    refreshPage = renderMapsPage;
    renderMapsPage();
  } else if (page === "teams") {
    refreshPage = renderTeamsPage;
    renderTeamsPage();
  } else if (page === "performance" || page === "teamstats") {
    refreshPage = renderTeamStatsPage;
    renderTeamStatsPage();
  } else if (page === "export") {
    refreshPage = renderExportPage;
    renderExportPage();
  }

  requestAnimationFrame(() => document.body.classList.add("ready"));

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function readFirst(keys, fallback) {
    for (let index = 0; index < keys.length; index += 1) {
      try {
        const raw = localStorage.getItem(keys[index]);
        if (raw) {
          return JSON.parse(raw);
        }
      } catch (_error) {
      }
    }
    return fallback;
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.style.display = "block";
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      toastEl.style.display = "none";
    }, 2200);
  }

  function buildDefaultTeams() {
    return [
      { name: "Team A", color: TEAM_COLORS[0], players: [] },
      { name: "Team B", color: TEAM_COLORS[1], players: [] }
    ];
  }

  function normalizeTeamPlayer(player) {
    return {
      name: String(player.name),
      kills: Number(player.kills) || 0,
      deaths: Number(player.deaths) || 0,
      assists: Number(player.assists) || 0,
      damage: Number(player.damage) || 0,
      role: player.role ? String(player.role) : "-"
    };
  }

  function buildDefaultMaps() {
    return [
      { id: "kalahari", name: "Kalahari", info: "Desert routes", kind: "built-in", fileName: "kalahari.jpg", blobKey: "" },
      { id: "nexterra", name: "Nexterra", info: "Futuristic lanes", kind: "built-in", fileName: "nexterra.jpg", blobKey: "" },
      { id: "purgatory", name: "Purgatory", info: "Bridge fights", kind: "built-in", fileName: "purgatory.jpg", blobKey: "" },
      { id: "solara", name: "Solara", info: "High tempo mid", kind: "built-in", fileName: "solara.jpg", blobKey: "" },
      { id: "bermuda", name: "Bermuda", info: "Classic rotations", kind: "built-in", fileName: "bermuda.jpg", blobKey: "" }
    ];
  }

  function normalizeMaps(list) {
    if (!Array.isArray(list) || !list.length) {
      return buildDefaultMaps();
    }
    return list
      .filter((item) => item && item.id && item.name)
      .map((item) => ({
        id: String(item.id),
        name: String(item.name),
        info: item.info ? String(item.info) : "Custom arena",
        kind: item.kind === "custom" ? "custom" : "built-in",
        fileName: item.fileName ? String(item.fileName) : "",
        blobKey: item.blobKey ? String(item.blobKey) : ""
      }));
  }

  function normalizeMatches(list) {
    if (!Array.isArray(list)) {
      return [];
    }
    return list
      .filter((match) => match && match.team)
      .map((match) => {
        const players = Array.isArray(match.players) ? match.players : [];
        const cleanPlayers = players
          .filter((player) => player && player.name)
          .map((player) => ({
            name: String(player.name),
            kills: Number(player.kills) || 0,
            deaths: Number(player.deaths) || 0,
            assists: Number(player.assists) || 0,
            damage: Number(player.damage) || 0,
            character: player.character ? String(player.character) : "-",
            role: player.role ? String(player.role) : "-"
          }));
        return {
          id: match.id || Date.now(),
          team: String(match.team),
          map: match.map ? String(match.map) : "Unknown",
          mapId: match.mapId ? String(match.mapId) : inferMapIdFromName(match.map),
          position: Number(match.position) || 1,
          date: match.date ? String(match.date) : new Date().toISOString().slice(0, 10),
          players: cleanPlayers,
          total_kills: Number(match.total_kills) || cleanPlayers.reduce((sum, player) => sum + player.kills, 0),
          total_deaths: Number(match.total_deaths) || cleanPlayers.reduce((sum, player) => sum + player.deaths, 0),
          total_assists: Number(match.total_assists) || cleanPlayers.reduce((sum, player) => sum + player.assists, 0),
          total_damage: Number(match.total_damage) || cleanPlayers.reduce((sum, player) => sum + player.damage, 0)
        };
      });
  }

  function normalizeTeams(list) {
    if (!Array.isArray(list) || !list.length) {
      return buildDefaultTeams();
    }
    return list.map((team, index) => ({
      name: team && team.name ? String(team.name) : "Team " + String.fromCharCode(65 + index),
      color: team && team.color ? String(team.color) : TEAM_COLORS[index % TEAM_COLORS.length],
      players: Array.isArray(team && team.players)
        ? team.players
            .filter((player) => player && player.name)
            .map((player) => normalizeTeamPlayer(player))
        : []
    }));
  }

  function inferMapIdFromName(name) {
    const target = String(name || "").trim().toLowerCase();
    const found = maps.find((item) => item.name.toLowerCase() === target || item.id.toLowerCase() === target);
    return found ? found.id : "";
  }

  function getInitialMapId() {
    const lastMap = read(KEYS.lastMap, "");
    return maps.some((item) => item.id === lastMap) ? lastMap : (maps[0] ? maps[0].id : "kalahari");
  }

  function saveMatches() {
    write(KEYS.matches, store.matches);
    write(KEYS.matchesLegacy, store.matches);
    refreshPage();
  }

  function saveTeams() {
    write(KEYS.teams, store.teams);
    write(KEYS.teamsLegacy, store.teams);
    refreshPage();
  }

  function saveMaps() {
    write(KEYS.maps, maps);
  }

  function saveLayers() {
    write(KEYS.layers, mapLayers);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clampLayerWithinParent(layer, parent, padding) {
    const dx = layer.x - parent.x;
    const dy = layer.y - parent.y;
    const distance = Math.hypot(dx, dy);
    const maxDistance = Math.max(0, parent.r - layer.r - padding);
    if (!distance || distance <= maxDistance) {
      return;
    }
    layer.x = parent.x + (dx / distance) * maxDistance;
    layer.y = parent.y + (dy / distance) * maxDistance;
  }

  function expandZoneLayers(layers, targetCount) {
    const nextLayers = layers.map((layer) => ({ x: layer.x, y: layer.y, r: layer.r }));
    if (nextLayers.length >= targetCount) {
      return nextLayers;
    }
    if (nextLayers.length === 1) {
      const base = nextLayers[0];
      for (let index = 1; index < targetCount; index += 1) {
        nextLayers.push({
          x: base.x,
          y: base.y,
          r: Math.max(18, Math.round(base.r * (1 - index / (targetCount + 1))))
        });
      }
      return nextLayers.sort((left, right) => right.r - left.r);
    }
    while (nextLayers.length < targetCount) {
      let insertIndex = 0;
      let widestGap = -1;
      for (let index = 0; index < nextLayers.length - 1; index += 1) {
        const gap = nextLayers[index].r - nextLayers[index + 1].r;
        if (gap > widestGap) {
          widestGap = gap;
          insertIndex = index;
        }
      }
      const outer = nextLayers[insertIndex];
      const inner = nextLayers[insertIndex + 1];
      nextLayers.splice(insertIndex + 1, 0, {
        x: (outer.x + inner.x) / 2,
        y: (outer.y + inner.y) / 2,
        r: Math.max(18, Math.round((outer.r + inner.r) / 2))
      });
    }
    return nextLayers;
  }

  function normalizeZone(zone) {
    if (!zone) {
      return null;
    }
    let layers = [];
    if (Array.isArray(zone.layers) && zone.layers.length) {
      layers = zone.layers
        .map((layer) => ({
          x: Number(layer && layer.x) || 0,
          y: Number(layer && layer.y) || 0,
          r: Math.max(18, Math.round(Number(layer && layer.r) || 0))
        }))
        .filter((layer) => layer.r > 0)
        .sort((left, right) => right.r - left.r);
    } else if (Array.isArray(zone.radii) && zone.radii.length) {
      const x = Number(zone.x) || 0;
      const y = Number(zone.y) || 0;
      layers = zone.radii
        .map((radius) => Math.max(18, Math.round(Number(radius) || 0)))
        .filter((radius) => radius > 0)
        .sort((left, right) => right - left)
        .map((radius) => ({ x: x, y: y, r: radius }));
    }
    if (!layers.length) {
      return null;
    }
    layers = expandZoneLayers(layers, 8);
    for (let index = 1; index < layers.length; index += 1) {
      clampLayerWithinParent(layers[index], layers[index - 1], 4);
    }
    return {
      color: "#ffffff",
      layers: layers
    };
  }

  function persistCurrentLayer() {
    if (!state.mapId) {
      return;
    }
    mapLayers[state.mapId] = {
      shapes: clone(state.shapes),
      zone: clone(state.zone)
    };
    saveLayers();
  }

  function hydrateCurrentLayer() {
    const layer = mapLayers[state.mapId] || { shapes: [], zone: null };
    state.shapes = clone(layer.shapes || []);
    state.zone = normalizeZone(layer.zone);
    state.zoneSelectedLayer = state.zone ? 0 : -1;
    state.selected = -1;
    state.draft = null;
    state.drag = null;
    state.undo = [];
    state.redo = [];
    nextId = state.shapes.reduce((max, shape) => Math.max(max, Number(shape.id) || 0), 0) + 1;
  }

  function getMapById(mapId) {
    return maps.find((map) => map.id === mapId);
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "map";
  }

  function setBrandLogo() {
    const logo = document.getElementById("brand-logo");
    if (logo) {
      logo.src = assetBase + "/logo.jpg";
    }
  }

  function bindSharedEvents() {
    const themeButton = document.getElementById("theme-btn");
    const copyButton = document.getElementById("copy-btn");
    if (themeButton) {
      themeButton.addEventListener("click", toggleTheme);
    }
    if (copyButton) {
      copyButton.addEventListener("click", copyLink);
    }
    window.addEventListener("beforeunload", () => {
      if (page === "match") {
        persistCurrentLayer();
      }
    });
  }

  function applyTheme(theme) {
    const nextTheme = theme === "light" ? "light" : "dark";
    document.body.classList.toggle("light", nextTheme === "light");
    localStorage.setItem(KEYS.theme, JSON.stringify(nextTheme));
    localStorage.setItem(KEYS.themeLegacy, JSON.stringify(nextTheme));
    const button = document.getElementById("theme-btn");
    if (button) {
      button.innerHTML = nextTheme === "light" ? "&#9728; LIGHT" : "&#127769; DARK";
    }
  }

  function toggleTheme() {
    applyTheme(document.body.classList.contains("light") ? "dark" : "light");
  }

  async function copyLink() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(location.href);
      } else {
        throw new Error("fallback");
      }
      toast("Page link copied");
    } catch (_error) {
      try {
        const area = document.createElement("textarea");
        area.value = location.href;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
        toast("Page link copied");
      } catch (_copyError) {
        toast("Copy is blocked on this browser");
      }
    }
  }

  function renderAppShell() {
    app.innerHTML = page === "match" ? renderMatchShell() : renderSecondaryShell();
  }

  function renderMatchShell() {
    return '<div class="app-shell">' + renderTopbar() + '<div class="match-layout"><aside class="sidebar animate-card"><section class="section-block"><p class="eyebrow">TOOLS</p><div class="tool-list">' + renderToolButton("select", "&#127919;", "Select") + renderToolButton("pan", "&#9995;", "Pan") + renderToolButton("pencil", "&#9999;", "Pencil") + renderToolButton("line", "&#128207;", "Line") + renderToolButton("arrow", "&#10145;", "Arrow") + renderToolButton("rotation", "&#128260;", "Team Rotation") + renderToolButton("circle", "&#11044;", "Circle") + renderToolButton("rect", "&#9723;", "Rect") + renderToolButton("polygon", "&#128311;", "Polygon") + renderToolButton("text", "&#128290;", "Text") + renderToolButton("zone", "&#128205;", "Zone") + '</div><div class="tool-hint" id="zone-hint">Zone rings are saved per map. Select zone to move it, use mouse wheel to resize active layer.</div></section><section class="section-block" id="zone-panel" style="display:none;"><p class="eyebrow">ZONE LAYERS</p><div id="zone-layer-list"></div><div class="button-row" style="margin-top:8px;"><input type="color" id="zone-color-picker" value="#ffffff" title="Zone color" style="width:36px;height:30px;border-radius:8px;border:1px solid var(--line);cursor:pointer;background:none;padding:2px;"><span class="muted-line" style="font-size:11px;align-self:center;">Color</span><button class="mini-btn" id="zone-delete-btn" type="button">DEL ZONE</button></div></section><section class="section-block"><p class="eyebrow">STYLE</p><div class="palette-row" id="color-row"></div><p class="eyebrow" style="margin-top:14px;">STROKE</p><div class="button-row" id="stroke-row"></div><div class="range-row" style="margin-top:14px;"><span>OPACITY</span><input id="opacity-slider" type="range" min="10" max="100" value="100"><span id="opacity-value">100%</span></div></section><section class="section-block"><p class="eyebrow">HISTORY</p><div class="button-row"><button class="mini-btn" id="undo-btn" type="button">UNDO</button><button class="mini-btn" id="redo-btn" type="button">REDO</button><button class="mini-btn" id="delete-btn" type="button">DELETE</button></div></section><div class="storage-note">&#128274; Local browser storage only. Each map keeps its own private layer.</div></aside><main class="canvas-stage animate-card delay-1"><div class="map-status"><strong id="map-status-title">MAP</strong><span id="map-status-copy">Private layer active</span></div><canvas id="canvas"></canvas><input id="text-input" type="text" maxlength="60" placeholder="Type note and press Enter"><div class="canvas-badge" id="zoom-badge">100%</div><div class="canvas-badge" id="tool-badge">SELECT</div></main><aside class="panel-shell animate-card delay-2"><div class="panel-head"><div><p class="eyebrow">MATCH PAGE</p><h2 id="matches-title">Map Match Log</h2><p id="matches-copy">Only current-map entries show here.</p></div><button class="action-btn primary" id="add-match-btn" type="button">+ ADD MATCH</button></div><div id="match-form"></div><div id="matches-list" class="card-grid"></div><div class="empty-state" id="matches-empty">No matches saved for this map yet.</div></aside></div></div>';
  }

  function renderSecondaryShell() {
    return '<div class="app-shell">' + renderTopbar() + '<main class="secondary-shell"><section class="hero-card animate-card"><div class="hero-copy"><p class="eyebrow">' + esc(getPageLabel(page)) + '</p><h1>' + esc(getHeroTitle(page)) + '</h1><p>' + esc(getHeroCopy(page)) + '</p></div><div class="hero-chips" id="hero-chips"></div></section><section class="page-content animate-card delay-1" id="page-content"></section></main></div>';
  }

  function renderTopbar() {
    const activeMap = getMapById(state.mapId);
    const matchActions = '<button class="top-btn primary" id="theme-btn" type="button">THEME</button><button class="top-btn" id="edit-maps-btn" type="button">&#9881; EDIT MAPS</button><button class="top-btn" id="png-btn" type="button">PNG</button><button class="top-btn" id="copy-btn" type="button">&#128203; COPY</button><button class="top-btn warn" id="clear-btn" type="button">&#128465; CLEAR MAP</button>';
    const dataActions = '<button class="top-btn primary" id="theme-btn" type="button">THEME</button><button class="top-btn" id="copy-btn" type="button">&#128203; COPY</button><a class="top-btn solid" href="index.html">MAP STUDIO</a>';
    const matchNote = '<a class="page-note" href="maps.html">&#128506; ACTIVE MAP <span id="topbar-active-map">' + esc(activeMap ? activeMap.name : "Select") + '</span></a>';
    const pageNote = page === "maps"
      ? '<div class="page-note">&#128506; ALL MAPS <span>All battlegrounds live here now</span></div>'
      : '<div class="page-note">&#128274; LOCAL ONLY <span>Only this page data is visible here</span></div>';
    const nav = NAV_ITEMS.map((item) => '<a class="page-link' + (page === item.key ? ' active' : '') + '" href="' + item.href + '">' + item.label + '</a>').join('');
    return '<header class="topbar"><div class="brand"><img class="brand-logo" id="brand-logo" alt="Analyst Warrior logo"><div class="brand-copy"><div class="brand-title">ANALYST WARRIOR</div><div class="brand-subtitle">Private Tactical Workspace</div></div></div><nav class="nav-links">' + nav + '</nav>' + (page === "match" ? matchNote : pageNote) + '<div class="topbar-actions">' + (page === "match" ? matchActions : dataActions) + '</div></header>';
  }

  function renderToolButton(tool, emoji, label) {
    return '<button class="tool-btn' + (tool === 'select' ? ' active' : '') + '" data-tool="' + tool + '" type="button"><span class="tool-emoji">' + emoji + '</span><span class="tool-copy"><span>' + esc(label) + '</span><span class="tool-key">' + esc(TOOL_SHORTCUTS[tool] || "") + '</span></span></button>';
  }

  function getPageLabel(key) {
    const found = NAV_ITEMS.find((item) => item.key === key);
    return found ? found.label : 'PAGE';
  }

  function getHeroTitle(key) {
    if (key === 'maps') return 'All maps are now inside one dedicated tab';
    if (key === 'teams') return 'Team roster page with only team data';
    if (key === 'performance' || key === 'teamstats') return 'Team Stats — track performance across all maps';
    return 'Export page for CSV and PDF style reports';
  }

  function getHeroCopy(key) {
    if (key === 'maps') return 'Choose any battleground from here instead of top separate tabs. Set one active and jump straight into the studio.';
    if (key === 'teams') return 'Only team roster data is shown here. Canvas drawings and other controls stay out of this page.';
    if (key === 'performance' || key === 'teamstats') return 'Add up to 12 teams. For each team, select a map, enter kills, damage, position and per-player stats. Export generates avg DMG and avg Kills in the PDF.';
    return 'Use this page to export CSV and open a branded report page that you can save as PDF from the browser print dialog.';
  }

  function initMatchPage() {
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");
    const textInput = document.getElementById("text-input");

    hydrateCurrentLayer();
    renderControls();
    updateMapCopy();
    renderMatches();
    resizeCanvas();
    loadMap(state.mapId);
    setTool("select");
    updateZonePanel();

    document.getElementById("png-btn").addEventListener("click", downloadPNG);
    document.getElementById("clear-btn").addEventListener("click", clearCurrentMap);
    document.getElementById("undo-btn").addEventListener("click", undo);
    document.getElementById("redo-btn").addEventListener("click", redo);
    document.getElementById("delete-btn").addEventListener("click", deleteSelected);
    document.getElementById("add-match-btn").addEventListener("click", renderMatchForm);
    document.getElementById("edit-maps-btn").addEventListener("click", openMapsModal);
    document.getElementById("opacity-slider").addEventListener("input", (event) => setOpacity(event.target.value));
    document.getElementById("undo-btn").title = "Ctrl+Z";
    document.getElementById("redo-btn").title = "Ctrl+Y or Ctrl+Shift+Z";
    document.getElementById("delete-btn").title = "Delete or Backspace";
    document.querySelectorAll("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => setTool(button.dataset.tool));
    });

    textInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitTextInput();
      }
      if (event.key === "Escape") {
        hideTextInput();
      }
    });
    textInput.addEventListener("blur", () => {
      if (textInput.style.display === "block") {
        commitTextInput();
      }
    });

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerUp);
    canvas.addEventListener("dblclick", onCanvasDoubleClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(animateRotationFrame);

    return renderMatches;

    function snapshot() {
      return JSON.stringify({ shapes: state.shapes, zone: state.zone, selected: state.selected, zoneSelectedLayer: state.zoneSelectedLayer });
    }

    function pushUndo() {
      state.undo.push(snapshot());
      if (state.undo.length > 50) {
        state.undo.shift();
      }
      state.redo = [];
    }

    function restore(raw) {
      const parsed = JSON.parse(raw);
      state.shapes = parsed.shapes || [];
      state.zone = normalizeZone(parsed.zone);
      state.selected = typeof parsed.selected === "number" ? parsed.selected : -1;
      state.zoneSelectedLayer = state.selected === SELECTED_ZONE && state.zone
        ? clamp(Number(parsed.zoneSelectedLayer) || 0, 0, state.zone.layers.length - 1)
        : -1;
      if (state.selected === SELECTED_ZONE && !state.zone) {
        state.selected = -1;
      }
      nextId = state.shapes.reduce((max, shape) => Math.max(max, Number(shape.id) || 0), 0) + 1;
      persistCurrentLayer();
      syncColorFromSelection();
      draw();
    }

    function updateBadges() {
      document.getElementById("zoom-badge").textContent = Math.round(state.zoom * 100) + "%";
      document.getElementById("tool-badge").textContent = state.tool.toUpperCase();
    }

    function setTool(tool) {
      state.tool = tool;
      state.draft = null;
      if (tool === "rotation" && state.color === "#ffffff") {
        state.color = "#38d5ff";
        renderControls();
      }
      document.querySelectorAll("[data-tool]").forEach((button) => {
        button.classList.toggle("active", button.dataset.tool === tool);
      });
      const hint = document.getElementById("zone-hint");
      hint.classList.toggle("show", tool === "zone" || tool === "rotation");
      if (tool === "zone") {
        hint.textContent = "Zone rings are saved per map. Select zone to move it, use mouse wheel to resize active layer.";
      } else if (tool === "rotation") {
        hint.textContent = "Drag to create an animated team rotation line. Select it later and change its color from the palette.";
      }
      updateBadges();
      updateZonePanel();
      draw();
    }

    function updateZonePanel() {
      const panel = document.getElementById("zone-panel");
      const layerList = document.getElementById("zone-layer-list");
      const colorPicker = document.getElementById("zone-color-picker");
      const deleteBtn = document.getElementById("zone-delete-btn");
      if (!panel || !layerList) return;
      const hasZone = !!(state.zone && state.zone.layers && state.zone.layers.length);
      panel.style.display = hasZone ? "block" : "none";
      if (!hasZone) return;
      if (colorPicker) {
        colorPicker.value = state.zone.color || "#ffffff";
        colorPicker.onchange = () => {
          if (state.zone) { pushUndo(); state.zone.color = colorPicker.value; persistCurrentLayer(); draw(); }
        };
      }
      if (deleteBtn) {
        deleteBtn.onclick = () => {
          if (!state.zone) return;
          pushUndo(); state.zone = null; state.zoneSelectedLayer = -1; state.selected = -1;
          persistCurrentLayer(); draw(); updateZonePanel();
        };
      }
      layerList.innerHTML = state.zone.layers.map((layer, idx) => {
        const isActive = getActiveZoneLayerIndex() === idx;
        return '<div class="zone-layer-row' + (isActive ? ' active' : '') + '" data-layer-idx="' + idx + '">' +
          '<span class="zone-layer-label">Zone ' + (idx + 1) + ' &nbsp; r=' + layer.r + '</span>' +
          '<button class="tiny-btn zone-layer-del" data-del-layer="' + idx + '" type="button">DEL</button>' +
          '</div>';
      }).join('');
      layerList.querySelectorAll("[data-del-layer]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const layerIdx = Number(btn.getAttribute("data-del-layer"));
          if (!state.zone || state.zone.layers.length <= 1) {
            pushUndo(); state.zone = null; state.zoneSelectedLayer = -1; state.selected = -1;
            persistCurrentLayer(); draw(); updateZonePanel(); return;
          }
          pushUndo();
          state.zone.layers.splice(layerIdx, 1);
          state.zoneSelectedLayer = Math.min(state.zoneSelectedLayer, state.zone.layers.length - 1);
          persistCurrentLayer(); draw(); updateZonePanel();
        });
      });
      layerList.querySelectorAll("[data-layer-idx]").forEach((row) => {
        row.addEventListener("click", () => {
          const idx = Number(row.getAttribute("data-layer-idx"));
          state.zoneSelectedLayer = idx;
          state.selected = SELECTED_ZONE;
          updateZonePanel(); draw();
        });
      });
    }

    function renderControls() {
      const colorRow = document.getElementById("color-row");
      const strokeRow = document.getElementById("stroke-row");
      colorRow.innerHTML = "";
      strokeRow.innerHTML = "";
      COLORS.forEach((color) => {
        const button = document.createElement("button");
        button.className = "color-dot" + (state.color === color ? " active" : "");
        button.type = "button";
        button.style.background = color;
        button.addEventListener("click", () => {
          applyColor(color);
          renderControls();
        });
        colorRow.appendChild(button);
      });
      STROKES.forEach((stroke) => {
        const button = document.createElement("button");
        button.className = "stroke-btn" + (state.stroke === stroke ? " active" : "");
        button.type = "button";
        button.textContent = stroke + "px";
        button.addEventListener("click", () => {
          state.stroke = stroke;
          renderControls();
        });
        strokeRow.appendChild(button);
      });
    }

    function setOpacity(value) {
      state.opacity = Number(value) / 100;
      document.getElementById("opacity-value").textContent = value + "%";
    }

    function applyColor(color) {
      if (state.selected === SELECTED_ZONE && state.zone) {
        state.color = "#ffffff";
        renderControls();
        draw();
        return;
      }
      state.color = color;
      if (state.selected >= 0 && state.shapes[state.selected]) {
        pushUndo();
        state.shapes[state.selected].color = color;
        persistCurrentLayer();
        draw();
      }
    }

    function syncColorFromSelection() {
      if (state.selected === SELECTED_ZONE && state.zone) {
        state.color = "#ffffff";
      } else if (state.selected >= 0 && state.shapes[state.selected] && state.shapes[state.selected].color) {
        state.color = state.shapes[state.selected].color;
      }
      renderControls();
    }

    function createDefaultZone(x, y) {
      return {
        color: "#ffffff",
        layers: [
          { x: x, y: y, r: 240 },
          { x: x, y: y, r: 205 },
          { x: x, y: y, r: 172 },
          { x: x, y: y, r: 142 },
          { x: x, y: y, r: 114 },
          { x: x, y: y, r: 88 },
          { x: x, y: y, r: 64 },
          { x: x, y: y, r: 42 }
        ]
      };
    }

    function getZoneLayers() {
      return state.zone && Array.isArray(state.zone.layers) ? state.zone.layers : [];
    }

    function getActiveZoneLayerIndex() {
      const layers = getZoneLayers();
      if (!layers.length) {
        return -1;
      }
      return clamp(state.zoneSelectedLayer >= 0 ? state.zoneSelectedLayer : 0, 0, layers.length - 1);
    }

    function getZoneHit(point, tolerance) {
      const layers = getZoneLayers();
      if (!layers.length) {
        return null;
      }
      const centerTolerance = Math.max(12 / state.zoom, tolerance * 0.85);
      let ringHit = null;
      let insideHit = null;
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        const layer = layers[index];
        const distance = Math.hypot(point.x - layer.x, point.y - layer.y);
        if (distance <= centerTolerance) {
          return { layerIndex: index, mode: "center" };
        }
        const ringDelta = Math.abs(distance - layer.r);
        if (ringDelta <= tolerance * 1.5) {
          if (!ringHit || ringDelta < ringHit.delta) {
            ringHit = { layerIndex: index, mode: "ring", delta: ringDelta };
          }
        }
        if (distance < layer.r && !insideHit) {
          insideHit = { layerIndex: index, mode: "inside" };
        }
      }
      return ringHit || insideHit;
    }

    function moveZoneLayers(baseZone, layerIndex, dx, dy) {
      const nextZone = clone(baseZone);
      const layers = nextZone.layers;
      if (!layers || !layers.length) {
        return nextZone;
      }
      if (layerIndex <= 0) {
        layers.forEach((layer) => {
          layer.x += dx;
          layer.y += dy;
        });
        return nextZone;
      }
      for (let index = layerIndex; index < layers.length; index += 1) {
        layers[index].x += dx;
        layers[index].y += dy;
      }
      clampLayerWithinParent(layers[layerIndex], layers[layerIndex - 1], 4);
      const appliedDx = layers[layerIndex].x - baseZone.layers[layerIndex].x;
      const appliedDy = layers[layerIndex].y - baseZone.layers[layerIndex].y;
      for (let index = layerIndex + 1; index < layers.length; index += 1) {
        layers[index].x = baseZone.layers[index].x + appliedDx;
        layers[index].y = baseZone.layers[index].y + appliedDy;
      }
      return nextZone;
    }

    function resizeZoneLayer(baseZone, layerIndex, scale) {
      const nextZone = clone(baseZone);
      const layers = nextZone.layers;
      if (!layers || !layers[layerIndex]) {
        return nextZone;
      }
      const padding = 4;
      const layer = layers[layerIndex];
      const child = layerIndex < layers.length - 1 ? layers[layerIndex + 1] : null;
      const parent = layerIndex > 0 ? layers[layerIndex - 1] : null;
      const minRadius = Math.max(18, child ? Math.ceil(Math.hypot(layer.x - child.x, layer.y - child.y) + child.r + padding) : 18);
      const maxRadius = parent
        ? Math.max(minRadius, Math.floor(parent.r - Math.hypot(layer.x - parent.x, layer.y - parent.y) - padding))
        : Math.max(minRadius, 2000);
      layer.r = clamp(Math.round(layer.r * scale), minRadius, maxRadius);
      return nextZone;
    }

    function isTypingContext(target) {
      if (!target) {
        return false;
      }
      const tag = String(target.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
    }

    function onKeyDown(event) {
      if (isTypingContext(event.target) || isTypingContext(document.activeElement)) {
        return;
      }
      const key = String(event.key || "").toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      if (modifier && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if ((key === "delete" || key === "backspace") && !modifier && !event.altKey) {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (modifier || event.altKey) {
        return;
      }
      const shortcutTool = Object.keys(TOOL_SHORTCUTS).find((toolName) => TOOL_SHORTCUTS[toolName].toLowerCase() === key);
      if (shortcutTool) {
        event.preventDefault();
        setTool(shortcutTool);
      }
    }

    function updateMapCopy() {
      const currentMap = getMapById(state.mapId);
      document.getElementById("map-status-title").textContent = currentMap ? currentMap.name : "MAP";
      document.getElementById("map-status-copy").textContent = "Drawings on this map stay separate from other maps. Change it from the MAPS tab.";
      document.getElementById("matches-title").textContent = (currentMap ? currentMap.name : "Current") + " Match Log";
      document.getElementById("matches-copy").textContent = "Only " + (currentMap ? currentMap.name : "this map") + " entries are shown on this page.";
      const topbarActiveMap = document.getElementById("topbar-active-map");
      if (topbarActiveMap) {
        topbarActiveMap.textContent = currentMap ? currentMap.name : "Select";
      }
    }

    function resizeCanvas() {
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
      fitMap();
      draw();
    }

    function fitMap() {
      if (!mapImage.naturalWidth) {
        return;
      }
      const ratio = Math.min(canvas.width / mapImage.naturalWidth, canvas.height / mapImage.naturalHeight) * 0.92;
      state.zoom = ratio;
      state.offsetX = (canvas.width - mapImage.naturalWidth * ratio) / 2;
      state.offsetY = (canvas.height - mapImage.naturalHeight * ratio) / 2;
      updateBadges();
    }

    async function loadMap(id) {
      if (!getMapById(id)) {
        toast("This map does not exist anymore");
        return;
      }
      persistCurrentLayer();
      state.mapId = id;
      write(KEYS.lastMap, id);
      hydrateCurrentLayer();
      updateMapCopy();
      renderMatches();
      activeLoadToken += 1;
      const token = activeLoadToken;
      mapImage = new Image();
      try {
        const src = await resolveMapSource(getMapById(id));
        mapImage.onload = () => {
          if (token !== activeLoadToken) return;
          fitMap();
          draw();
          toast(getMapById(id).name + " ready");
        };
        mapImage.onerror = () => {
          if (token !== activeLoadToken) return;
          draw();
          toast("Map image failed to load");
        };
        mapImage.src = src;
      } catch (_error) {
        draw();
        toast("Map asset missing");
      }
    }

    function eventPoint(event) {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function toWorld(x, y) {
      return { x: (x - state.offsetX) / state.zoom, y: (y - state.offsetY) / state.zoom };
    }

    function toScreen(x, y) {
      return { x: x * state.zoom + state.offsetX, y: y * state.zoom + state.offsetY };
    }

    function distanceToSegment(point, start, end) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      if (!dx && !dy) {
        return Math.hypot(point.x - start.x, point.y - start.y);
      }
      const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
      const px = start.x + ratio * dx;
      const py = start.y + ratio * dy;
      return Math.hypot(point.x - px, point.y - py);
    }

    function hitTest(point, zoneHit) {
      const tolerance = 16 / state.zoom;
      for (let index = state.shapes.length - 1; index >= 0; index -= 1) {
        const shape = state.shapes[index];
        if (shape.type === "circle" && Math.hypot(point.x - shape.x, point.y - shape.y) <= shape.r + tolerance) return index;
        if ((shape.type === "line" || shape.type === "arrow" || shape.type === "rotation") && distanceToSegment(point, { x: shape.x, y: shape.y }, { x: shape.x2, y: shape.y2 }) <= tolerance) return index;
        if (shape.type === "rect" && point.x >= Math.min(shape.x, shape.x2) - tolerance && point.x <= Math.max(shape.x, shape.x2) + tolerance && point.y >= Math.min(shape.y, shape.y2) - tolerance && point.y <= Math.max(shape.y, shape.y2) + tolerance) return index;
        if ((shape.type === "pencil" || shape.type === "polygon") && Array.isArray(shape.points)) {
          for (let pointIndex = 0; pointIndex < shape.points.length - 1; pointIndex += 1) {
            if (distanceToSegment(point, shape.points[pointIndex], shape.points[pointIndex + 1]) <= tolerance) return index;
          }
        }
        if (shape.type === "text" && Math.hypot(point.x - shape.x, point.y - shape.y) <= 26 / state.zoom) return index;
      }
      if (zoneHit || getZoneHit(point, tolerance)) return SELECTED_ZONE;
      return -1;
    }

    function moveShape(shape, dx, dy) {
      if (shape.type === "line" || shape.type === "arrow" || shape.type === "rotation" || shape.type === "rect") {
        shape.x += dx; shape.y += dy; shape.x2 += dx; shape.y2 += dy; return;
      }
      if (shape.type === "pencil" || shape.type === "polygon") {
        shape.points.forEach((point) => { point.x += dx; point.y += dy; });
        return;
      }
      shape.x += dx;
      shape.y += dy;
    }

    function drawShape(shape, isSelected) {
      ctx.save();
      ctx.globalAlpha = shape.opacity != null ? shape.opacity : 1;
      ctx.strokeStyle = shape.color;
      ctx.fillStyle = shape.color;
      ctx.lineWidth = (shape.stroke || 2) * state.zoom;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (shape.type === "line" || shape.type === "arrow" || shape.type === "rotation") {
        const start = toScreen(shape.x, shape.y);
        const end = toScreen(shape.x2, shape.y2);
        if (shape.type === "rotation") {
          const rotationColor = shape.color || "#38d5ff";
          ctx.strokeStyle = rotationColor;
          ctx.fillStyle = rotationColor;
          ctx.lineWidth = Math.max(4, (shape.stroke || 4) * state.zoom * 1.4);
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
          ctx.strokeStyle = "#ffffff";
          ctx.fillStyle = "#ffffff";
          ctx.lineWidth = Math.max(2, (shape.stroke || 4) * state.zoom * 0.55);
          ctx.setLineDash([18, 10]);
          ctx.lineDashOffset = -Date.now() / 45;
        }
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        if (shape.type === "arrow" || shape.type === "rotation") {
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const head = shape.type === "rotation" ? 18 : 14;
          if (shape.type === "rotation") {
            const rotationColor = shape.color || "#38d5ff";
            ctx.fillStyle = rotationColor;
            ctx.beginPath();
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(end.x - (head + 6) * Math.cos(angle - 0.45), end.y - (head + 6) * Math.sin(angle - 0.45));
            ctx.lineTo(end.x - (head + 6) * Math.cos(angle + 0.45), end.y - (head + 6) * Math.sin(angle + 0.45));
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = "#ffffff";
          }
          ctx.beginPath();
          ctx.moveTo(end.x, end.y);
          ctx.lineTo(end.x - head * Math.cos(angle - 0.45), end.y - head * Math.sin(angle - 0.45));
          ctx.lineTo(end.x - head * Math.cos(angle + 0.45), end.y - head * Math.sin(angle + 0.45));
          ctx.closePath();
          ctx.fill();
        }
        if (shape.type === "rotation") {
          const midX = (start.x + end.x) / 2;
          const midY = (start.y + end.y) / 2;
          ctx.setLineDash([]);
          ctx.font = "700 11px Bahnschrift";
          ctx.fillStyle = "#ffffff";
          ctx.fillText("ROTATION", midX + 10, midY - 10);
        }
      }
      if (shape.type === "circle") {
        const center = toScreen(shape.x, shape.y);
        ctx.beginPath();
        ctx.arc(center.x, center.y, shape.r * state.zoom, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (shape.type === "rect") {
        const start = toScreen(shape.x, shape.y);
        const end = toScreen(shape.x2, shape.y2);
        ctx.fillRect(start.x, start.y, end.x - start.x, end.y - start.y);
        ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      }
      if (shape.type === "text") {
        const point = toScreen(shape.x, shape.y);
        ctx.font = "700 " + Math.max(14, Math.round(14 * state.zoom)) + "px Bahnschrift";
        ctx.fillText(shape.text, point.x, point.y);
      }
      if ((shape.type === "pencil" || shape.type === "polygon") && Array.isArray(shape.points) && shape.points.length) {
        ctx.beginPath();
        let current = toScreen(shape.points[0].x, shape.points[0].y);
        ctx.moveTo(current.x, current.y);
        for (let index = 1; index < shape.points.length; index += 1) {
          current = toScreen(shape.points[index].x, shape.points[index].y);
          ctx.lineTo(current.x, current.y);
        }
        if (shape.type === "polygon") {
          ctx.closePath();
          ctx.fill();
        }
        ctx.stroke();
      }
      if (isSelected) {
        const anchor = shape.type === "line" || shape.type === "arrow" || shape.type === "rotation" || shape.type === "rect"
          ? toScreen((shape.x + shape.x2) / 2, (shape.y + shape.y2) / 2)
          : toScreen(shape.x != null ? shape.x : shape.points[0].x, shape.y != null ? shape.y : shape.points[0].y);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (mapImage.naturalWidth) {
        ctx.drawImage(mapImage, state.offsetX, state.offsetY, mapImage.naturalWidth * state.zoom, mapImage.naturalHeight * state.zoom);
      } else {
        ctx.fillStyle = "#0f1725";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (state.zone && Array.isArray(state.zone.layers) && state.zone.layers.length) {
        ctx.save();
        const zoneSelected = state.selected === SELECTED_ZONE;
        const zoneColor = state.zone.color || "#ffffff";
        state.zone.layers.forEach((layer, index) => {
          const center = toScreen(layer.x, layer.y);
          const isActiveLayer = zoneSelected && getActiveZoneLayerIndex() === index;
          ctx.save();
          ctx.strokeStyle = zoneColor;
          ctx.globalAlpha = zoneSelected ? Math.max(0.58, 0.92 - index * 0.08) : Math.max(0.46, 0.76 - index * 0.08);
          ctx.lineWidth = isActiveLayer ? 2.6 : (zoneSelected ? 1.9 : 1.35);
          ctx.setLineDash(isActiveLayer ? [14, 10] : []);
          ctx.beginPath();
          ctx.arc(center.x, center.y, layer.r * state.zoom, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        });
        ctx.restore();
      }
      state.shapes.forEach((shape, index) => drawShape(shape, index === state.selected));
      if (state.draft) {
        drawShape({
          type: state.draft.type,
          x: state.draft.x,
          y: state.draft.y,
          x2: state.draft.x2,
          y2: state.draft.y2,
          r: state.draft.r,
          points: state.draft.points,
          color: state.color,
          stroke: state.stroke,
          opacity: state.opacity
        }, false);
      }
    }

    function showTextInput(point, world) {
      textInput.style.display = "block";
      textInput.style.left = point.x + "px";
      textInput.style.top = point.y - 18 + "px";
      textInput.dataset.x = String(world.x);
      textInput.dataset.y = String(world.y);
      textInput.value = "";
      textInput.focus();
    }

    function hideTextInput() {
      textInput.style.display = "none";
      textInput.value = "";
    }

    function commitTextInput() {
      const text = textInput.value.trim();
      if (text) {
        pushUndo();
        state.shapes.push({ id: nextId++, type: "text", x: Number(textInput.dataset.x), y: Number(textInput.dataset.y), text: text, color: state.color, stroke: state.stroke, opacity: state.opacity });
        state.selected = state.shapes.length - 1;
        state.zoneSelectedLayer = -1;
        persistCurrentLayer();
        draw();
      }
      hideTextInput();
    }

    function onPointerDown(event) {
      const point = eventPoint(event);
      const world = toWorld(point.x, point.y);
      if (state.tool === "pan") {
        state.drag = { type: "pan", x: point.x, y: point.y, ox: state.offsetX, oy: state.offsetY };
        return;
      }
      if (state.tool === "select") {
        const zoneHit = getZoneHit(world, 16 / state.zoom);
        state.selected = hitTest(world, zoneHit);
        if (state.selected === SELECTED_ZONE && state.zone) {
          state.zoneSelectedLayer = zoneHit ? zoneHit.layerIndex : 0;
          syncColorFromSelection();
          pushUndo();
          state.drag = { type: "zone", start: world, base: clone(state.zone), layerIndex: getActiveZoneLayerIndex(), moved: false };
        } else if (state.selected >= 0) {
          state.zoneSelectedLayer = -1;
          syncColorFromSelection();
          pushUndo();
          state.drag = { type: "shape", start: world, base: clone(state.shapes[state.selected]), moved: false };
        } else {
          state.zoneSelectedLayer = -1;
          state.drag = null;
          renderControls();
        }
        draw();
        return;
      }
      if (state.tool === "text") {
        showTextInput(point, world);
        return;
      }
      if (state.tool === "zone") {
        pushUndo();
        state.zone = createDefaultZone(world.x, world.y);
        state.selected = SELECTED_ZONE;
        state.zoneSelectedLayer = 0;
        syncColorFromSelection();
        persistCurrentLayer();
        updateZonePanel();
        draw();
        return;
      }
      if (state.tool === "polygon") {
        if (!state.draft || state.draft.type !== "polygon") {
          state.draft = { type: "polygon", points: [world], x: world.x, y: world.y };
        } else {
          state.draft.points.push(world);
        }
        draw();
        return;
      }
      if (state.tool === "pencil") {
        state.draft = { type: "pencil", points: [world], x: world.x, y: world.y };
        return;
      }
      state.draft = { type: state.tool, x: world.x, y: world.y, x2: world.x, y2: world.y, r: 0 };
    }

    function onPointerMove(event) {
      const point = eventPoint(event);
      const world = toWorld(point.x, point.y);
      if (state.drag && state.drag.type === "pan") {
        state.offsetX = state.drag.ox + (point.x - state.drag.x);
        state.offsetY = state.drag.oy + (point.y - state.drag.y);
        draw();
        return;
      }
      if (state.drag && state.drag.type === "zone" && state.zone) {
        state.drag.moved = true;
        state.zone = moveZoneLayers(state.drag.base, state.drag.layerIndex, world.x - state.drag.start.x, world.y - state.drag.start.y);
        draw();
        return;
      }
      if (state.drag && state.drag.type === "shape" && state.selected >= 0) {
        state.drag.moved = true;
        state.shapes[state.selected] = clone(state.drag.base);
        moveShape(state.shapes[state.selected], world.x - state.drag.start.x, world.y - state.drag.start.y);
        draw();
        return;
      }
      if (state.draft && state.draft.type === "pencil") {
        state.draft.points.push(world);
        draw();
        return;
      }
      if (state.draft) {
        state.draft.x2 = world.x;
        state.draft.y2 = world.y;
        state.draft.r = Math.hypot(world.x - state.draft.x, world.y - state.draft.y);
        draw();
      }
    }

    function onPointerUp() {
      if (state.drag) {
        const moved = (state.drag.type === "shape" || state.drag.type === "zone") && state.drag.moved;
        state.drag = null;
        if (moved) {
          persistCurrentLayer();
        }
        return;
      }
      if (!state.draft || state.draft.type === "polygon") {
        return;
      }
      pushUndo();
      if (state.draft.type === "pencil" && state.draft.points.length > 1) {
        state.shapes.push({ id: nextId++, type: "pencil", points: clone(state.draft.points), x: state.draft.points[0].x, y: state.draft.points[0].y, color: state.color, stroke: state.stroke, opacity: state.opacity });
      }
      if (state.draft.type === "line" || state.draft.type === "arrow" || state.draft.type === "rotation" || state.draft.type === "rect") {
        state.shapes.push({ id: nextId++, type: state.draft.type, x: state.draft.x, y: state.draft.y, x2: state.draft.x2, y2: state.draft.y2, color: state.color, stroke: state.stroke, opacity: state.opacity });
      }
      if (state.draft.type === "circle" && state.draft.r > 3) {
        state.shapes.push({ id: nextId++, type: "circle", x: state.draft.x, y: state.draft.y, r: state.draft.r, color: state.color, stroke: state.stroke, opacity: state.opacity });
      }
      state.selected = state.shapes.length - 1;
      state.zoneSelectedLayer = -1;
      state.draft = null;
      persistCurrentLayer();
      draw();
    }

    function onCanvasDoubleClick() {
      if (state.tool === "polygon" && state.draft && Array.isArray(state.draft.points) && state.draft.points.length >= 3) {
        pushUndo();
        state.shapes.push({ id: nextId++, type: "polygon", points: clone(state.draft.points), x: state.draft.points[0].x, y: state.draft.points[0].y, color: state.color, stroke: state.stroke, opacity: state.opacity });
        state.selected = state.shapes.length - 1;
        state.zoneSelectedLayer = -1;
        state.draft = null;
        persistCurrentLayer();
        draw();
        toast("Polygon closed");
      }
    }

    function onWheel(event) {
      if (state.tool === "select" && state.selected === SELECTED_ZONE && state.zone) {
        event.preventDefault();
        if (!zoneWheelUndoTimer) {
          pushUndo();
        }
        clearTimeout(zoneWheelUndoTimer);
        zoneWheelUndoTimer = setTimeout(() => {
          zoneWheelUndoTimer = null;
        }, 180);
        const scale = event.deltaY < 0 ? 1.06 : 0.94;
        state.zone = resizeZoneLayer(state.zone, getActiveZoneLayerIndex(), scale);
        persistCurrentLayer();
        draw();
        return;
      }
      event.preventDefault();
      const point = eventPoint(event);
      const nextZoom = Math.min(12, Math.max(0.08, state.zoom * (event.deltaY < 0 ? 1.1 : 0.9)));
      state.offsetX = point.x - (point.x - state.offsetX) * (nextZoom / state.zoom);
      state.offsetY = point.y - (point.y - state.offsetY) * (nextZoom / state.zoom);
      state.zoom = nextZoom;
      updateBadges();
      draw();
    }

    function animateRotationFrame() {
      if (state.shapes.some((shape) => shape.type === "rotation") || (state.draft && state.draft.type === "rotation")) {
        draw();
      }
      requestAnimationFrame(animateRotationFrame);
    }

    function getCurrentMapName() {
      const current = getMapById(state.mapId);
      return current ? current.name : "Map";
    }

    function renderMetricBox(value, label) {
      return '<div class="metric-box"><strong>' + esc(String(value)) + '</strong><span>' + esc(label) + '</span></div>';
    }

    function renderMatches() {
      const list = document.getElementById("matches-list");
      const empty = document.getElementById("matches-empty");
      const filtered = store.matches.filter((match) => (match.mapId || inferMapIdFromName(match.map)) === state.mapId);
      if (!filtered.length) {
        list.innerHTML = "";
        empty.style.display = "block";
        return;
      }
      empty.style.display = "block";
      empty.style.display = "none";
      list.innerHTML = filtered.map((match) => '<div class="panel-card match-card"><div class="card-top"><div class="card-title">' + esc(match.team) + '</div><button class="mini-btn" data-delete-match="' + esc(String(match.id)) + '" type="button">DELETE</button></div><div class="muted-line">' + esc(match.map) + ' | Position #' + esc(String(match.position)) + ' | ' + esc(match.date) + '</div><div class="report-metrics" style="margin-top:12px;">' + renderMetricBox(match.total_kills, 'Kills') + renderMetricBox(match.total_assists, 'Assists') + renderMetricBox(match.total_damage, 'Damage') + '</div><table><thead><tr><th>PLAYER</th><th>CHAR</th><th>K</th><th>D</th><th>A</th><th>DMG</th><th>ROLE</th></tr></thead><tbody>' + match.players.map((player) => '<tr><td>' + esc(player.name) + '</td><td>' + esc(player.character || '-') + '</td><td>' + player.kills + '</td><td>' + player.deaths + '</td><td>' + player.assists + '</td><td>' + player.damage + '</td><td>' + esc(player.role || '-') + '</td></tr>').join('') + '</tbody></table></div>').join('');
      list.querySelectorAll("[data-delete-match]").forEach((button) => {
        button.addEventListener("click", () => {
          const targetId = Number(button.getAttribute("data-delete-match"));
          store.matches = store.matches.filter((match) => Number(match.id) !== targetId);
          saveMatches();
        });
      });
    }

    function renderMatchForm() {
      const form = document.getElementById("match-form");
      form.innerHTML = '<div class="panel-card"><div class="form-grid two"><input class="input" id="mt-team" placeholder="Team name"><input class="input" id="mt-map" placeholder="Map name" value="' + esc(getCurrentMapName()) + '"><input class="input" id="mt-pos" type="number" min="1" value="1"><input class="input" id="mt-date" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></div><div id="player-rows" class="card-grid" style="margin-top:12px;"></div><div class="button-row" style="margin-top:14px;"><button class="action-btn" id="add-player-row" type="button">ADD PLAYER</button><button class="action-btn primary" id="save-match" type="button">SAVE MATCH</button><button class="action-btn" id="close-match" type="button">CLOSE</button></div></div>';
      document.getElementById("add-player-row").addEventListener("click", addPlayerRow);
      document.getElementById("save-match").addEventListener("click", saveMatch);
      document.getElementById("close-match").addEventListener("click", () => { form.innerHTML = ""; });
      addPlayerRow();
    }

    function addPlayerRow() {
      const row = document.createElement("div");
      row.className = "panel-card";
      row.innerHTML = '<div class="form-grid two"><input class="input" placeholder="Player name"><input class="input" placeholder="Character"><input class="input" type="number" value="0" placeholder="Kills"><input class="input" type="number" value="0" placeholder="Deaths"><input class="input" type="number" value="0" placeholder="Assists"><input class="input" type="number" value="0" placeholder="Damage"><input class="input" placeholder="Role"></div>';
      document.getElementById("player-rows").appendChild(row);
    }

    function saveMatch() {
      const team = document.getElementById("mt-team").value.trim();
      if (!team) {
        toast("Team name is required");
        return;
      }
      const players = Array.from(document.querySelectorAll("#player-rows .panel-card")).map((row) => {
        const inputs = row.querySelectorAll("input");
        return {
          name: inputs[0].value.trim(),
          character: inputs[1].value.trim() || "-",
          kills: Number(inputs[2].value) || 0,
          deaths: Number(inputs[3].value) || 0,
          assists: Number(inputs[4].value) || 0,
          damage: Number(inputs[5].value) || 0,
          role: inputs[6].value.trim() || "-"
        };
      }).filter((player) => player.name);
      if (!players.length) {
        toast("Add at least one player");
        return;
      }
      const match = {
        id: Date.now(),
        team: team,
        map: document.getElementById("mt-map").value.trim() || getCurrentMapName(),
        mapId: state.mapId,
        position: Number(document.getElementById("mt-pos").value) || 1,
        date: document.getElementById("mt-date").value || new Date().toISOString().slice(0, 10),
        players: players
      };
      match.total_kills = players.reduce((sum, player) => sum + player.kills, 0);
      match.total_deaths = players.reduce((sum, player) => sum + player.deaths, 0);
      match.total_assists = players.reduce((sum, player) => sum + player.assists, 0);
      match.total_damage = players.reduce((sum, player) => sum + player.damage, 0);
      store.matches.unshift(match);
      document.getElementById("match-form").innerHTML = "";
      saveMatches();
      toast("Match saved for " + getCurrentMapName());
    }

    function downloadPNG() {
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = "analyst-" + state.mapId + ".png";
      link.click();
      toast("PNG downloaded");
    }

    function clearCurrentMap() {
      if (!window.confirm("Clear only the current map drawings and zone?")) return;
      pushUndo();
      state.shapes = [];
      state.zone = null;
      state.zoneSelectedLayer = -1;
      state.selected = -1;
      persistCurrentLayer();
      draw();
      toast("Current map cleared");
    }

    function undo() {
      if (!state.undo.length) return toast("Nothing to undo");
      state.redo.push(snapshot());
      restore(state.undo.pop());
    }

    function redo() {
      if (!state.redo.length) return toast("Nothing to redo");
      state.undo.push(snapshot());
      restore(state.redo.pop());
    }

    function deleteSelected() {
      if (state.selected === SELECTED_ZONE && state.zone) {
        pushUndo();
        state.zone = null;
        state.zoneSelectedLayer = -1;
        state.selected = -1;
        persistCurrentLayer();
        updateZonePanel();
        draw();
        return;
      }
      if (state.selected < 0) return toast("Nothing selected");
      pushUndo();
      state.shapes.splice(state.selected, 1);
      state.zoneSelectedLayer = -1;
      state.selected = -1;
      persistCurrentLayer();
      draw();
    }

    function openMapsModal() {
      modalRoot.innerHTML = '<div class="modal-root open" id="maps-modal"><div class="modal-scrim" id="maps-modal-scrim"></div><div class="modal-card"><button class="modal-close" id="maps-modal-close" type="button">&times;</button><div id="maps-modal-content"></div></div></div>';
      document.getElementById("maps-modal-close").addEventListener("click", closeMapsModal);
      document.getElementById("maps-modal-scrim").addEventListener("click", closeMapsModal);
      renderMapPasswordStage();
    }

    function closeMapsModal() {
      modalRoot.innerHTML = "";
    }

    function renderMapPasswordStage() {
      document.getElementById("maps-modal-content").innerHTML = '<div class="modal-grid"><div><p class="eyebrow">EDIT MAPS</p><h2 style="margin:0;font-family:var(--hud);">Protected map manager</h2><p class="section-help">Enter the password to unlock add-map and delete-map options.</p></div><form class="modal-section form-grid" id="map-gate-form"><input class="input" id="map-gate-password" type="password" placeholder="Enter password"><div class="button-row"><button class="action-btn primary" type="submit">UNLOCK</button><button class="action-btn" id="cancel-map-gate" type="button">CANCEL</button></div></form></div>';
      document.getElementById("cancel-map-gate").addEventListener("click", closeMapsModal);
      document.getElementById("map-gate-form").addEventListener("submit", (event) => {
        event.preventDefault();
        const password = document.getElementById("map-gate-password").value;
        if (password !== MAP_PASSWORD) return toast("Wrong password");
        renderMapManagerStage();
      });
    }

    function renderMapManagerStage() {
      document.getElementById("maps-modal-content").innerHTML = '<div class="modal-grid"><div><p class="eyebrow">MAP OPTIONS</p><h2 style="margin:0;font-family:var(--hud);">Add map or delete map</h2><p class="section-help">New map image size must stay under 50 MB. Custom files stay on this browser only.</p></div><div class="map-pill-row">' + maps.map((map) => '<div class="map-pill">' + esc(map.name) + '</div>').join('') + '</div><div class="modal-section"><p class="eyebrow">ADD MAP</p><form class="form-grid" id="add-map-form"><input class="input" id="new-map-name" placeholder="Map name"><textarea class="textarea" id="new-map-info" placeholder="Map info / notes"></textarea><input class="input" id="new-map-file" type="file" accept="image/*"><button class="action-btn primary" type="submit">ADD MAP</button></form></div><div class="modal-section"><p class="eyebrow">DELETE MAP</p><form class="form-grid" id="delete-map-form"><select class="select" id="delete-map-id">' + maps.map((map) => '<option value="' + esc(map.id) + '">' + esc(map.name) + '</option>').join('') + '</select><input class="input" id="delete-map-password" type="password" placeholder="Enter password again"><button class="action-btn" type="submit">DELETE MAP</button></form></div></div>';
      document.getElementById("add-map-form").addEventListener("submit", addMapFromForm);
      document.getElementById("delete-map-form").addEventListener("submit", deleteMapFromForm);
    }

    async function addMapFromForm(event) {
      event.preventDefault();
      const name = document.getElementById("new-map-name").value.trim();
      const info = document.getElementById("new-map-info").value.trim() || "Custom arena";
      const input = document.getElementById("new-map-file");
      const file = input.files && input.files[0];
      if (!name || !file) return toast("Map name and image are required");
      if (file.size > 50 * 1024 * 1024) return toast("Map image must be 50 MB or less");
      if (!window.indexedDB) return toast("This browser cannot store custom maps");
      const id = slugify(name) + "-" + Date.now();
      try {
        await putMapBlob(id, file);
        maps.push({ id: id, name: name, info: info, kind: "custom", fileName: "", blobKey: id });
        saveMaps();
        renderMapManagerStage();
        await loadMap(id);
        toast(name + " added");
      } catch (_error) {
        toast("Could not add this map");
      }
    }

    async function deleteMapFromForm(event) {
      event.preventDefault();
      const mapId = document.getElementById("delete-map-id").value;
      const password = document.getElementById("delete-map-password").value;
      if (password !== MAP_PASSWORD) return toast("Wrong password");
      if (maps.length <= 1) return toast("Keep at least one map");
      const target = getMapById(mapId);
      if (!target) return toast("Map not found");
      if (!window.confirm("Delete " + target.name + "?")) return;
      maps = maps.filter((map) => map.id !== mapId);
      saveMaps();
      delete mapLayers[mapId];
      saveLayers();
      if (target.kind === "custom" && target.blobKey) {
        try { await deleteMapBlob(target.blobKey); } catch (_error) {}
      }
      if (state.mapId === mapId) {
        state.mapId = maps[0].id;
      }
      renderMapManagerStage();
      await loadMap(state.mapId);
      toast(target.name + " deleted");
    }
  }

  function getStoreStats() {
    return {
      teamCount: store.teams.length,
      playerCount: store.teams.reduce((sum, team) => sum + team.players.length, 0),
      matchCount: store.matches.length
    };
  }

  function getMapPreviewSrc(map) {
    return map.kind === "custom"
      ? "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 96'%3E%3Crect width='160' height='96' rx='16' fill='%23111a28'/%3E%3Cpath d='M18 72L46 44L70 60L100 28L142 72' stroke='%23ffab19' stroke-width='8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='110' cy='28' r='10' fill='%2338d5ff'/%3E%3C/svg%3E"
      : assetBase + "/maps/" + map.fileName;
  }

  function getMapUsage(mapId) {
    const layer = mapLayers[mapId] || { shapes: [], zone: null };
    const shapeCount = Array.isArray(layer.shapes) ? layer.shapes.length : 0;
    const zoneCount = layer.zone ? 1 : 0;
    const matchCount = store.matches.filter((match) => (match.mapId || inferMapIdFromName(match.map)) === mapId).length;
    return {
      drawingCount: shapeCount + zoneCount,
      matchCount: matchCount
    };
  }

  function setActiveMap(mapId, shouldOpenStudio) {
    if (!getMapById(mapId)) {
      return;
    }
    state.mapId = mapId;
    write(KEYS.lastMap, mapId);
    if (shouldOpenStudio) {
      location.href = "index.html";
      return;
    }
    toast((getMapById(mapId) ? getMapById(mapId).name : "Map") + " selected");
    renderMapsPage();
  }

  function renderMapsPage() {
    const stats = getStoreStats();
    const hero = document.getElementById("hero-chips");
    const content = document.getElementById("page-content");
    const activeMap = getMapById(state.mapId);
    hero.innerHTML = '<div class="hero-chip">' + maps.length + ' MAPS</div><div class="hero-chip">' + maps.filter((map) => map.kind === "custom").length + ' CUSTOM</div><div class="hero-chip">' + esc(activeMap ? activeMap.name : "NO ACTIVE MAP") + '</div>';
    content.innerHTML =
      '<section class="secondary-card"><div class="card-top"><div><p class="eyebrow">MAP SELECTOR</p><div class="section-title">All maps in one place</div><p class="section-help">Separate map tabs hata diye gaye hain. Yahin se map select karo aur studio open karo.</p></div><a class="action-btn primary" href="index.html">OPEN STUDIO</a></div></section>' +
      '<section class="map-grid">' +
      maps.map((map) => {
        const usage = getMapUsage(map.id);
        return '<article class="secondary-card map-card' + (map.id === state.mapId ? ' active-map' : '') + '">' +
          '<img class="map-card-media" data-open-map="' + esc(map.id) + '" src="' + esc(getMapPreviewSrc(map)) + '" alt="' + esc(map.name) + '">' +
          '<div class="map-card-copy"><h3>' + esc(map.name) + '</h3><p>' + esc(map.info) + '</p></div>' +
          '<div class="map-card-stats"><div class="map-card-stat"><strong>' + usage.matchCount + '</strong><span>MATCHES</span></div><div class="map-card-stat"><strong>' + usage.drawingCount + '</strong><span>DRAWINGS</span></div></div>' +
          '<div class="map-card-actions"><button class="action-btn' + (map.id === state.mapId ? ' primary' : '') + '" data-set-map="' + esc(map.id) + '" type="button">' + (map.id === state.mapId ? 'ACTIVE MAP' : 'SET ACTIVE') + '</button><button class="action-btn primary" data-open-map="' + esc(map.id) + '" type="button">OPEN IN STUDIO</button></div>' +
        '</article>';
      }).join("") +
      '</section>' +
      '<section class="secondary-card"><p class="eyebrow">TOTALS</p><div class="report-metrics"><div class="metric-box"><strong>' + stats.matchCount + '</strong><span>All Matches</span></div><div class="metric-box"><strong>' + stats.teamCount + '</strong><span>Teams</span></div><div class="metric-box"><strong>' + stats.playerCount + '</strong><span>Players</span></div></div></section>';
    content.querySelectorAll("[data-set-map]").forEach((button) => {
      button.addEventListener("click", () => setActiveMap(button.getAttribute("data-set-map"), false));
    });
    content.querySelectorAll("[data-open-map]").forEach((button) => {
      button.addEventListener("click", () => setActiveMap(button.getAttribute("data-open-map"), true));
    });
  }

  function renderTeamsPage() {
    const stats = getStoreStats();
    const hero = document.getElementById("hero-chips");
    const content = document.getElementById("page-content");
    hero.innerHTML = '<div class="hero-chip">' + stats.teamCount + ' TEAMS</div><div class="hero-chip">' + stats.playerCount + ' PLAYERS</div><div class="hero-chip">&#128274; LOCAL ONLY</div>';

    const teamCountButtons = [2, 3, 4].map((n) =>
      '<button class="mini-btn" data-team-count="' + n + '" type="button">' + n + ' TEAMS</button>'
    ).join('');

    const teamsHTML = store.teams.map((team, teamIndex) => {
      const playersRows = team.players.length
        ? team.players.map((player, playerIndex) =>
            '<tr>' +
            '<td>' + esc(player.name) + '</td>' +
            '<td>' + esc(player.role || '-') + '</td>' +
            '<td>' + player.kills + '</td>' +
            '<td>' + player.deaths + '</td>' +
            '<td>' + player.assists + '</td>' +
            '<td>' + player.damage + '</td>' +
            '<td class="player-action"><button class="tiny-btn" data-remove-player="' + teamIndex + ':' + playerIndex + '" type="button">REMOVE</button></td>' +
            '</tr>'
          ).join('')
        : '<tr><td colspan="7" class="muted-line">No players yet</td></tr>';

      return '<section class="secondary-card">' +
        '<div class="card-top">' +
          '<div style="display:flex;align-items:center;gap:10px;">' +
            '<input class="color-picker-small" data-team-color="' + teamIndex + '" type="color" value="' + esc(team.color) + '" title="Team color">' +
            '<input class="input" data-team-name="' + teamIndex + '" value="' + esc(team.name) + '" style="max-width:200px;">' +
          '</div>' +
          '<button class="action-btn primary" data-add-player="' + teamIndex + '" type="button">+ ADD PLAYER</button>' +
        '</div>' +
        '<div class="muted-line">' + team.players.length + ' players on this roster.</div>' +
        '<table><thead><tr><th>PLAYER</th><th>ROLE</th><th>K</th><th>D</th><th>A</th><th>DMG</th><th>ACTION</th></tr></thead>' +
        '<tbody>' + playersRows + '</tbody></table>' +
        '</section>';
    }).join('');

    content.innerHTML =
      '<section class="secondary-card"><p class="eyebrow">TEAM CONTROLS</p><div class="team-count-row">' + teamCountButtons + '</div></section>' +
      teamsHTML;

    content.querySelectorAll("[data-team-count]").forEach((button) => {
      button.addEventListener("click", () => {
        const count = Number(button.getAttribute("data-team-count"));
        while (store.teams.length > count) store.teams.pop();
        while (store.teams.length < count) store.teams.push({ name: "Team " + String.fromCharCode(65 + store.teams.length), color: TEAM_COLORS[store.teams.length % TEAM_COLORS.length], players: [] });
        saveTeams();
      });
    });
    content.querySelectorAll("[data-team-name]").forEach((input) => {
      input.addEventListener("change", () => {
        const index = Number(input.getAttribute("data-team-name"));
        store.teams[index].name = input.value.trim() || ("Team " + String.fromCharCode(65 + index));
        saveTeams();
      });
    });
    content.querySelectorAll("[data-team-color]").forEach((input) => {
      input.addEventListener("change", () => {
        const index = Number(input.getAttribute("data-team-color"));
        store.teams[index].color = input.value;
        saveTeams();
      });
    });
    content.querySelectorAll("[data-add-player]").forEach((button) => {
      button.addEventListener("click", () => openAddPlayerModal(Number(button.getAttribute("data-add-player"))));
    });
    content.querySelectorAll("[data-remove-player]").forEach((button) => {
      button.addEventListener("click", () => {
        const parts = button.getAttribute("data-remove-player").split(":");
        store.teams[Number(parts[0])].players.splice(Number(parts[1]), 1);
        saveTeams();
      });
    });
  }

  function openAddPlayerModal(teamIndex) {
    const team = store.teams[teamIndex];
    if (!team) return;
    modalRoot.innerHTML =
      '<div class="modal-root open" id="player-modal">' +
        '<div class="modal-scrim" id="player-modal-scrim"></div>' +
        '<div class="modal-card">' +
          '<button class="modal-close" id="player-modal-close" type="button">&times;</button>' +
          '<div id="player-modal-content">' +
            '<div class="modal-grid">' +
              '<div><p class="eyebrow">ADD PLAYER</p><h2 style="margin:0;font-family:var(--hud);">Add to ' + esc(team.name) + '</h2></div>' +
              '<div class="modal-section form-grid">' +
                '<input class="input" id="pm-name" placeholder="Player name" autofocus>' +
                '<input class="input" id="pm-role" placeholder="Role (e.g. IGL, Fragger, Support)">' +
                '<input class="input" type="number" id="pm-kills" value="0" placeholder="Kills">' +
                '<input class="input" type="number" id="pm-deaths" value="0" placeholder="Deaths">' +
                '<input class="input" type="number" id="pm-assists" value="0" placeholder="Assists">' +
                '<input class="input" type="number" id="pm-damage" value="0" placeholder="Damage">' +
              '</div>' +
              '<div class="button-row" style="margin-top:14px;">' +
                '<button class="action-btn primary" id="pm-save" type="button">ADD PLAYER</button>' +
                '<button class="action-btn" id="pm-cancel" type="button">CANCEL</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    const closeModal = () => { modalRoot.innerHTML = ""; };
    document.getElementById("player-modal-close").addEventListener("click", closeModal);
    document.getElementById("player-modal-scrim").addEventListener("click", closeModal);
    document.getElementById("pm-cancel").addEventListener("click", closeModal);
    document.getElementById("pm-save").addEventListener("click", () => {
      const name = document.getElementById("pm-name").value.trim();
      if (!name) { toast("Player name is required"); return; }
      store.teams[teamIndex].players.push({
        name: name,
        role: document.getElementById("pm-role").value.trim() || "-",
        kills: Number(document.getElementById("pm-kills").value) || 0,
        deaths: Number(document.getElementById("pm-deaths").value) || 0,
        assists: Number(document.getElementById("pm-assists").value) || 0,
        damage: Number(document.getElementById("pm-damage").value) || 0
      });
      saveTeams();
      closeModal();
    });
    document.getElementById("pm-name").focus();
  }

  function computePerformanceData() {
    const teamStats = {};
    const playerStats = {};
    store.matches.forEach((match) => {
      if (!teamStats[match.team]) teamStats[match.team] = { kills: 0, damage: 0, matches: 0 };
      teamStats[match.team].kills += match.total_kills;
      teamStats[match.team].damage += match.total_damage;
      teamStats[match.team].matches += 1;
      match.players.forEach((player) => {
        if (!playerStats[player.name]) playerStats[player.name] = { kills: 0, deaths: 0, assists: 0, damage: 0 };
        playerStats[player.name].kills += player.kills;
        playerStats[player.name].deaths += player.deaths;
        playerStats[player.name].assists += player.assists;
        playerStats[player.name].damage += player.damage;
      });
    });
    store.teams.forEach((team) => {
      if (!teamStats[team.name]) teamStats[team.name] = { kills: 0, damage: 0, matches: 0 };
      team.players.forEach((player) => {
        teamStats[team.name].kills += player.kills;
        teamStats[team.name].damage += player.damage;
        if (!playerStats[player.name]) playerStats[player.name] = { kills: 0, deaths: 0, assists: 0, damage: 0 };
        playerStats[player.name].kills += player.kills;
        playerStats[player.name].deaths += player.deaths;
        playerStats[player.name].assists += player.assists;
        playerStats[player.name].damage += player.damage;
      });
    });
    return {
      teamStats: teamStats,
      playerStats: playerStats,
      totalKills: Object.keys(playerStats).reduce((sum, key) => sum + playerStats[key].kills, 0),
      totalDamage: Object.keys(playerStats).reduce((sum, key) => sum + playerStats[key].damage, 0)
    };
  }

  function renderStatCard(value, label) {
    return '<div class="stat-card"><strong>' + esc(String(value)) + '</strong><span>' + esc(label) + '</span></div>';
  }

  function formatAverage(total, count) {
    return count > 0 ? (total / count).toFixed(1) : "-";
  }

  function saveTeamStats() {
    write(KEYS.teamStats, store.teamStats);
    refreshPage();
  }

  function renderTeamStatsPage() {
    const hero = document.getElementById("hero-chips");
    const content = document.getElementById("page-content");
    const MAX_TEAMS = 12;
    const teamCount = store.teamStats.length;

    hero.innerHTML = '<div class="hero-chip">' + teamCount + ' / ' + MAX_TEAMS + ' TEAMS</div>' +
      '<div class="hero-chip">' + maps.length + ' MAPS</div>' +
      '<div class="hero-chip">&#128220; EXPORT READY</div>';

    const mapOptions = maps.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>').join('');

    const addBtn = teamCount < MAX_TEAMS
      ? '<button class="action-btn primary" id="ts-add-team" type="button">+ ADD TEAM</button>'
      : '<span class="muted-line">Max 12 teams reached</span>';

    const teamsHTML = store.teamStats.map((team, ti) => {
      // Count map occurrences
      const mapCounts = {};
      team.entries.forEach((e) => { mapCounts[e.mapId] = (mapCounts[e.mapId] || 0) + 1; });

      const entriesHTML = team.entries.length ? team.entries.map((entry, ei) => {
        const mapObj = maps.find((m) => m.id === entry.mapId);
        const mapName = mapObj ? mapObj.name : entry.mapId;
        const dupCount = mapCounts[entry.mapId] || 1;
        const dupLabel = dupCount > 1 ? ' <span class="map-dup-badge">x' + dupCount + '</span>' : '';
        const playersHTML = (entry.players || []).map((p, pi) =>
          '<tr class="player-stat-row">' +
          '<td style="padding-left:20px;color:var(--muted)">' + esc(p.name) + '</td>' +
          '<td>' + esc(p.role || '-') + '</td>' +
          '<td>' + (p.kills || 0) + '</td>' +
          '<td>' + (p.damage || 0) + '</td>' +
          '<td>' + (p.assists || 0) + '</td>' +
          '<td>' + (p.deaths || 0) + '</td>' +
          '<td><button class="tiny-btn" data-del-player="' + ti + ':' + ei + ':' + pi + '" type="button">×</button></td>' +
          '</tr>'
        ).join('');
        return '<tr class="entry-row">' +
          '<td><strong>' + esc(mapName) + dupLabel + '</strong></td>' +
          '<td>' + (entry.kills || 0) + '</td>' +
          '<td>' + (entry.damage || 0) + '</td>' +
          '<td>#' + (entry.position || '-') + '</td>' +
          '<td><button class="tiny-btn" data-del-entry="' + ti + ':' + ei + '" type="button">DEL</button></td>' +
          '</tr>' +
          (entry.players && entry.players.length ? '<tr><td colspan="5"><table style="width:100%;margin:0;border:none;"><thead><tr><th style="padding-left:20px;">PLAYER</th><th>ROLE</th><th>K</th><th>DMG</th><th>A</th><th>D</th><th></th></tr></thead><tbody>' + playersHTML + '</tbody></table></td></tr>' : '');
      }).join('') : '<tr><td colspan="5" class="muted-line">No entries yet</td></tr>';

      return '<section class="secondary-card">' +
        '<div class="card-top">' +
          '<div><strong style="font-family:var(--hud);font-size:15px;">' + esc(team.name) + '</strong>' +
          '<span class="muted-line" style="margin-left:10px;font-size:12px;">' + team.entries.length + ' match entries</span></div>' +
          '<button class="tiny-btn" data-del-team="' + ti + '" type="button">DELETE TEAM</button>' +
        '</div>' +
        '<div class="ts-add-entry" style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;align-items:center;">' +
          '<select class="select" id="ts-map-' + ti + '" style="min-width:140px;">' + mapOptions + '</select>' +
          '<input class="input" type="number" id="ts-kills-' + ti + '" placeholder="Kills" style="width:80px;" min="0" value="0">' +
          '<input class="input" type="number" id="ts-dmg-' + ti + '" placeholder="Damage" style="width:90px;" min="0" value="0">' +
          '<input class="input" type="number" id="ts-pos-' + ti + '" placeholder="Position" style="width:80px;" min="1" value="1">' +
          '<button class="action-btn" data-add-entry="' + ti + '" type="button">+ ADD ENTRY</button>' +
        '</div>' +
        '<div class="ts-add-player" style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0;align-items:center;border-top:1px solid var(--line);padding-top:8px;">' +
          '<span class="muted-line" style="font-size:11px;">ADD PLAYER TO LAST ENTRY:</span>' +
          '<input class="input" id="ts-pname-' + ti + '" placeholder="Player name" style="width:120px;">' +
          '<input class="input" id="ts-prole-' + ti + '" placeholder="Role" style="width:90px;">' +
          '<input class="input" type="number" id="ts-pk-' + ti + '" placeholder="K" style="width:60px;" value="0">' +
          '<input class="input" type="number" id="ts-pd-' + ti + '" placeholder="DMG" style="width:70px;" value="0">' +
          '<input class="input" type="number" id="ts-pa-' + ti + '" placeholder="A" style="width:60px;" value="0">' +
          '<input class="input" type="number" id="ts-pde-' + ti + '" placeholder="D" style="width:60px;" value="0">' +
          '<button class="action-btn" data-add-player-entry="' + ti + '" type="button">+ PLAYER</button>' +
        '</div>' +
        '<table><thead><tr><th>MAP</th><th>KILLS</th><th>DMG</th><th>POS</th><th></th></tr></thead>' +
        '<tbody>' + entriesHTML + '</tbody></table>' +
        '</section>';
    }).join('');

    content.innerHTML =
      '<section class="secondary-card">' +
        '<div class="card-top"><div><p class="eyebrow">TEAM STATS</p><div class="section-title">Tournament Performance Tracker</div></div>' +
        '<div class="button-row">' + addBtn + '<button class="action-btn primary" id="ts-pdf-btn" type="button">&#128220; EXPORT PDF</button></div>' +
        '</div>' +
      '</section>' +
      teamsHTML;

    // Add team
    const addTeamBtn = document.getElementById("ts-add-team");
    if (addTeamBtn) {
      addTeamBtn.addEventListener("click", () => {
        openAddTeamStatsModal();
      });
    }

    // PDF export
    const pdfBtn = document.getElementById("ts-pdf-btn");
    if (pdfBtn) pdfBtn.addEventListener("click", exportTeamStatsPDF);

    // Add entry
    content.querySelectorAll("[data-add-entry]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ti = Number(btn.getAttribute("data-add-entry"));
        const mapId = document.getElementById("ts-map-" + ti).value;
        const kills = Number(document.getElementById("ts-kills-" + ti).value) || 0;
        const damage = Number(document.getElementById("ts-dmg-" + ti).value) || 0;
        const position = Number(document.getElementById("ts-pos-" + ti).value) || 1;
        store.teamStats[ti].entries.push({ mapId, kills, damage, position, players: [] });
        saveTeamStats();
      });
    });

    // Add player to last entry
    content.querySelectorAll("[data-add-player-entry]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ti = Number(btn.getAttribute("data-add-player-entry"));
        const team = store.teamStats[ti];
        if (!team || !team.entries.length) { toast("Add a map entry first"); return; }
        const name = document.getElementById("ts-pname-" + ti).value.trim();
        if (!name) { toast("Player name required"); return; }
        const lastEntry = team.entries[team.entries.length - 1];
        if (!lastEntry.players) lastEntry.players = [];
        lastEntry.players.push({
          name,
          role: document.getElementById("ts-prole-" + ti).value.trim() || "-",
          kills: Number(document.getElementById("ts-pk-" + ti).value) || 0,
          damage: Number(document.getElementById("ts-pd-" + ti).value) || 0,
          assists: Number(document.getElementById("ts-pa-" + ti).value) || 0,
          deaths: Number(document.getElementById("ts-pde-" + ti).value) || 0
        });
        saveTeamStats();
      });
    });

    // Delete entry
    content.querySelectorAll("[data-del-entry]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [ti, ei] = btn.getAttribute("data-del-entry").split(":").map(Number);
        store.teamStats[ti].entries.splice(ei, 1);
        saveTeamStats();
      });
    });

    // Delete player
    content.querySelectorAll("[data-del-player]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [ti, ei, pi] = btn.getAttribute("data-del-player").split(":").map(Number);
        store.teamStats[ti].entries[ei].players.splice(pi, 1);
        saveTeamStats();
      });
    });

    // Delete team
    content.querySelectorAll("[data-del-team]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ti = Number(btn.getAttribute("data-del-team"));
        if (!window.confirm("Delete team " + store.teamStats[ti].name + "?")) return;
        store.teamStats.splice(ti, 1);
        saveTeamStats();
      });
    });
  }

  function openAddTeamStatsModal() {
    modalRoot.innerHTML =
      '<div class="modal-root open" id="ts-team-modal">' +
        '<div class="modal-scrim" id="ts-team-scrim"></div>' +
        '<div class="modal-card">' +
          '<button class="modal-close" id="ts-team-close" type="button">&times;</button>' +
          '<div class="modal-grid">' +
            '<div><p class="eyebrow">NEW TEAM</p><h2 style="margin:0;font-family:var(--hud);">Add team to stats tracker</h2></div>' +
            '<div class="modal-section form-grid">' +
              '<input class="input" id="ts-new-name" placeholder="Team name" autofocus>' +
            '</div>' +
            '<div class="button-row" style="margin-top:14px;">' +
              '<button class="action-btn primary" id="ts-team-save" type="button">ADD TEAM</button>' +
              '<button class="action-btn" id="ts-team-cancel" type="button">CANCEL</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    const close = () => { modalRoot.innerHTML = ""; };
    document.getElementById("ts-team-close").addEventListener("click", close);
    document.getElementById("ts-team-scrim").addEventListener("click", close);
    document.getElementById("ts-team-cancel").addEventListener("click", close);
    document.getElementById("ts-team-save").addEventListener("click", () => {
      const name = document.getElementById("ts-new-name").value.trim();
      if (!name) { toast("Team name required"); return; }
      if (store.teamStats.length >= 12) { toast("Max 12 teams reached"); return; }
      store.teamStats.push({ name, entries: [] });
      saveTeamStats();
      close();
    });
    document.getElementById("ts-new-name").focus();
  }

  function exportTeamStatsPDF() {
    if (!store.teamStats.length) { toast("No teams added yet"); return; }
    const w = window.open("", "_blank");
    if (!w) { toast("Popup blocked"); return; }

    const teamsHTML = store.teamStats.map((team) => {
      if (!team.entries.length) return '';
      const totalKills = team.entries.reduce((s, e) => s + (e.kills || 0), 0);
      const totalDmg = team.entries.reduce((s, e) => s + (e.damage || 0), 0);
      const count = team.entries.length;
      const avgKills = count > 0 ? (totalKills / count).toFixed(1) : '-';
      const avgDmg = count > 0 ? (totalDmg / count).toFixed(0) : '-';

      // Map frequency
      const mapCounts = {};
      team.entries.forEach((e) => {
        const m = maps.find((mp) => mp.id === e.mapId);
        const mName = m ? m.name : e.mapId;
        mapCounts[mName] = (mapCounts[mName] || 0) + 1;
      });

      const entriesHTML = team.entries.map((entry) => {
        const m = maps.find((mp) => mp.id === entry.mapId);
        const mName = m ? m.name : entry.mapId;
        const cnt = mapCounts[mName] || 1;
        const mapLabel = mName + (cnt > 1 ? ' (played ' + cnt + 'x)' : '');

        const playersHTML = (entry.players || []).map((p) =>
          '<tr style="background:#f9fafc;">' +
          '<td style="padding-left:24px;color:#555;">' + esc(p.name) + '</td>' +
          '<td>' + esc(p.role || '-') + '</td>' +
          '<td>' + (p.kills || 0) + '</td>' +
          '<td>' + (p.damage || 0) + '</td>' +
          '<td>' + (p.assists || 0) + '</td>' +
          '<td>' + (p.deaths || 0) + '</td>' +
          '</tr>'
        ).join('');

        return '<tr>' +
          '<td><strong>' + esc(mapLabel) + '</strong></td>' +
          '<td>' + (entry.kills || 0) + '</td>' +
          '<td>' + (entry.damage || 0) + '</td>' +
          '<td>#' + (entry.position || '-') + '</td>' +
          '</tr>' +
          (playersHTML ? '<tr><td colspan="4" style="padding:0;"><table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="background:#eef2fb;"><th style="padding:6px 8px 6px 24px;text-align:left;">PLAYER</th><th style="padding:6px 8px;text-align:left;">ROLE</th><th style="padding:6px 8px;text-align:left;">K</th><th style="padding:6px 8px;text-align:left;">DMG</th><th style="padding:6px 8px;text-align:left;">A</th><th style="padding:6px 8px;text-align:left;">D</th></tr></thead><tbody>' + playersHTML + '</tbody></table></td></tr>' : '');
      }).join('');

      return '<div style="margin-bottom:32px;">' +
        '<div style="background:#111723;color:#fff;border-radius:16px 16px 0 0;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;">' +
          '<div><div style="font-size:18px;font-weight:800;letter-spacing:2px;color:#ffab19;">' + esc(team.name) + '</div>' +
          '<div style="font-size:12px;color:#9cb0d3;margin-top:4px;">' + count + ' map entries</div></div>' +
          '<div style="display:flex;gap:20px;text-align:center;">' +
            '<div><div style="font-size:22px;font-weight:800;color:#38d5ff;">' + avgKills + '</div><div style="font-size:10px;letter-spacing:1px;color:#9cb0d3;">AVG KILLS</div></div>' +
            '<div><div style="font-size:22px;font-weight:800;color:#22d28b;">' + avgDmg + '</div><div style="font-size:10px;letter-spacing:1px;color:#9cb0d3;">AVG DMG</div></div>' +
            '<div><div style="font-size:22px;font-weight:800;color:#ffab19;">' + totalKills + '</div><div style="font-size:10px;letter-spacing:1px;color:#9cb0d3;">TOTAL K</div></div>' +
            '<div><div style="font-size:22px;font-weight:800;color:#ff5d67;">' + totalDmg.toLocaleString() + '</div><div style="font-size:10px;letter-spacing:1px;color:#9cb0d3;">TOTAL DMG</div></div>' +
          '</div>' +
        '</div>' +
        '<table style="width:100%;border-collapse:collapse;background:#fff;border-radius:0 0 16px 16px;overflow:hidden;">' +
          '<thead><tr style="background:#f4f6fb;"><th style="padding:10px 14px;text-align:left;font-size:11px;letter-spacing:2px;color:#6b7280;">MAP</th><th style="padding:10px 14px;text-align:left;font-size:11px;color:#6b7280;">KILLS</th><th style="padding:10px 14px;text-align:left;font-size:11px;color:#6b7280;">DAMAGE</th><th style="padding:10px 14px;text-align:left;font-size:11px;color:#6b7280;">POSITION</th></tr></thead>' +
          '<tbody>' + entriesHTML + '</tbody>' +
        '</table></div>';
    }).join('');

    const html = [
      '<html><head><title>Analyst Warrior – Team Stats Report</title><style>',
      'body{margin:0;font-family:Segoe UI,Tahoma,sans-serif;background:#f0f4fb;color:#111;}',
      '.page{padding:30px;max-width:900px;margin:0 auto;}',
      '.header{background:#111723;color:#fff;border-radius:20px;padding:24px 28px;margin-bottom:28px;display:flex;justify-content:space-between;align-items:center;}',
      '.brand{font-size:26px;font-weight:800;letter-spacing:4px;color:#ffab19;}',
      '.sub{font-size:12px;letter-spacing:2px;color:#9cb0d3;margin-top:6px;}',
      'table{width:100%;border-collapse:collapse;} th,td{padding:10px 14px;border-bottom:1px solid #e4e8f0;text-align:left;font-size:13px;}',
      '.avg-note{font-size:11px;color:#6b7280;margin-bottom:18px;letter-spacing:1px;}',
      '@media print{body{background:#fff;}.page{padding:16px;}}',
      '</style></head><body><div class="page">',
      '<div class="header"><div><div class="brand">ANALYST WARRIOR</div><div class="sub">FREE FIRE · TEAM STATS REPORT</div><div class="sub" style="margin-top:8px;color:#cfd8ea;">Generated: ' + new Date().toLocaleDateString() + '</div></div><div style="text-align:right;"><div style="font-size:12px;color:#9cb0d3;">Avg DMG &amp; Avg Kills shown per team above each table</div></div></div>',
      '<p class="avg-note">&#9432; AVG KILLS and AVG DMG are computed across all map entries for each team. Map played more than once shows "(played Nx)" label.</p>',
      teamsHTML,
      '<div style="margin-top:28px;font-size:11px;color:#9cb0d3;text-align:center;">ANALYST WARRIOR · LOCAL DEVICE STORAGE · Use browser print dialog → Save as PDF</div>',
      '</div></body></html>'
    ].join('');

    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }

  function renderReportPreview(match) {
    if (!match) {
      return '<div class="empty-state">Save at least one match to generate a branded report.</div>';
    }
    return '<div class="report-preview"><div class="card-top"><div class="card-title">' + esc(match.team) + '</div><div class="muted-line">' + esc(match.map) + ' | Position #' + esc(String(match.position)) + '</div></div><div class="report-metrics"><div class="metric-box"><strong>' + match.total_kills + '</strong><span>Kills</span></div><div class="metric-box"><strong>' + match.total_assists + '</strong><span>Assists</span></div><div class="metric-box"><strong>' + match.total_damage + '</strong><span>Damage</span></div></div><table><thead><tr><th>#</th><th>PLAYER</th><th>CHAR</th><th>K</th><th>A</th><th>DMG</th><th>ROLE</th></tr></thead><tbody>' + match.players.map((player, index) => '<tr><td>' + (index + 1) + '</td><td>' + esc(player.name) + '</td><td>' + esc(player.character || '-') + '</td><td>' + player.kills + '</td><td>' + player.assists + '</td><td>' + player.damage + '</td><td>' + esc(player.role || '-') + '</td></tr>').join('') + '</tbody></table></div>';
  }

  function renderExportPage() {
    const hero = document.getElementById("hero-chips");
    const content = document.getElementById("page-content");
    const latest = store.matches[0];
    hero.innerHTML = '<div class="hero-chip">' + store.matches.length + ' MATCHES READY</div><div class="hero-chip">' + store.teams.length + ' TEAMS READY</div><div class="hero-chip">&#128220; PDF PRINT VIEW</div>';
    content.innerHTML = '<section class="secondary-card"><p class="eyebrow">EXPORT OPTIONS</p><div class="check-grid"><label><input type="checkbox" id="exp-matches" checked> Match stats</label><label><input type="checkbox" id="exp-teams" checked> Team data</label><label><input type="checkbox" id="exp-players" checked> Player data</label></div><div class="form-grid" style="margin-top:14px;">' + (store.matches.length ? '<select class="select" id="report-match">' + store.matches.map((match) => '<option value="' + esc(String(match.id)) + '">' + esc(match.team + ' | ' + match.map + ' | ' + match.date) + '</option>').join('') + '</select>' : '<div class="empty-state">No matches yet.</div>') + '</div><div class="button-row" style="margin-top:14px;"><button class="action-btn" id="csv-btn" type="button">EXPORT CSV</button><button class="action-btn primary" id="print-btn" type="button">PDF REPORT</button></div></section><section class="secondary-card"><p class="eyebrow">REPORT PREVIEW</p>' + renderReportPreview(latest) + '</section>';
    const csvButton = document.getElementById("csv-btn");
    const printButton = document.getElementById("print-btn");
    if (csvButton) csvButton.addEventListener("click", exportCSV);
    if (printButton) printButton.addEventListener("click", printReport);
  }

  function exportCSV() {
    const includeMatches = document.getElementById("exp-matches") && document.getElementById("exp-matches").checked;
    const includeTeams = document.getElementById("exp-teams") && document.getElementById("exp-teams").checked;
    const includePlayers = document.getElementById("exp-players") && document.getElementById("exp-players").checked;
    let csv = "";
    if (includeMatches) {
      csv += "Team,Map,Position,Date,Player,Character,Kills,Deaths,Assists,Damage,Role\n";
      store.matches.forEach((match) => {
        match.players.forEach((player) => {
          csv += [match.team, match.map, match.position, match.date, player.name, player.character || "-", player.kills, player.deaths, player.assists, player.damage, player.role || "-"].join(",") + "\n";
        });
      });
      csv += "\n";
    }
    if (includeTeams) {
      csv += "Team,Player,Kills,Deaths,Assists,Damage\n";
      store.teams.forEach((team) => {
        team.players.forEach((player) => {
          csv += [team.name, player.name, player.kills, player.deaths, player.assists, player.damage].join(",") + "\n";
        });
      });
      csv += "\n";
    }
    if (includePlayers) {
      const playerStats = computePerformanceData().playerStats;
      csv += "Player,Kills,Deaths,Assists,Damage,KD\n";
      Object.keys(playerStats).forEach((name) => {
        const stats = playerStats[name];
        csv += [name, stats.kills, stats.deaths, stats.assists, stats.damage, (stats.kills / (stats.deaths || 1)).toFixed(2)].join(",") + "\n";
      });
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "analyst_export.csv";
    link.click();
    toast("CSV exported");
  }

  function printReport() {
    const select = document.getElementById("report-match");
    const matchId = select ? Number(select.value) : 0;
    const match = store.matches.find((item) => Number(item.id) === matchId) || store.matches[0];
    if (!match) return toast("Save a match first");
    const reportWindow = window.open("", "_blank");
    if (!reportWindow) return toast("Popup blocked");
    const rows = match.players.map((player, index) => '<tr><td>' + (index + 1) + '</td><td>' + esc(player.name) + '</td><td>' + esc(player.character || '-') + '</td><td>' + player.kills + '</td><td>' + player.assists + '</td><td>' + player.damage + '</td><td>' + esc(player.role || '-') + '</td></tr>').join('');
    const html = ['<html><head><title>Analyst Warrior Report</title><style>', 'body{margin:0;font-family:Segoe UI,Tahoma,sans-serif;background:#f5f2ea;color:#111;} .page{padding:30px;} .card{background:#111723;color:#fff;border-radius:24px;padding:26px;} .top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;} .brand{font-size:28px;font-weight:800;letter-spacing:4px;color:#ffab19;} .sub{margin-top:6px;font-size:13px;letter-spacing:2px;color:#9cb0d3;} .map{margin-top:18px;font-size:16px;color:#cfd8ea;} .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:22px 0;} .metric{padding:16px;border-radius:18px;background:#1a2232;} .metric b{display:block;font-size:28px;color:#ffab19;} .metric span{display:block;margin-top:8px;font-size:12px;letter-spacing:1px;color:#9cb0d3;} table{width:100%;border-collapse:collapse;background:#fff;color:#111;border-radius:18px;overflow:hidden;margin-top:24px;} th,td{padding:12px 14px;border-bottom:1px solid #e4e8f0;text-align:left;font-size:13px;} th{background:#f4f6fb;font-size:11px;letter-spacing:2px;color:#6b7280;} .footer{margin-top:20px;font-size:12px;color:#7c869d;}', '</style></head><body><div class="page"><div class="card"><div class="top"><div><div class="brand">ANALYST WARRIOR</div><div class="sub">FREE FIRE · MATCH REPORT</div><div class="map">' + esc(match.date) + ' · ' + esc(match.team) + '</div><div class="map">' + esc(match.map) + ' · Position #' + esc(String(match.position)) + '</div></div><div class="sub">PRIVATE LOCAL REPORT</div></div><div class="metrics"><div class="metric"><b>' + match.total_kills + '</b><span>KILLS</span></div><div class="metric"><b>' + match.total_assists + '</b><span>ASSISTS</span></div><div class="metric"><b>' + match.total_damage + '</b><span>DAMAGE</span></div></div><table><thead><tr><th>#</th><th>PLAYER</th><th>CHARACTER</th><th>KILLS</th><th>ASSISTS</th><th>DAMAGE</th><th>ROLE</th></tr></thead><tbody>', rows, '</tbody></table><div class="footer">ANALYST WARRIOR · LOCAL DEVICE STORAGE · Use the browser print dialog and choose Save as PDF.</div></div></div></bo', 'dy></ht', 'ml>'].join('');
    reportWindow.document.write(html);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.print();
  }

  function openMapDatabase() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = window.indexedDB.open("analyst-warrior-maps", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("files")) {
            request.result.createObjectStore("files");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB failed"));
      });
    }
    return dbPromise;
  }

  function withStore(mode, callback) {
    return openMapDatabase().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("files", mode);
      const storeRef = tx.objectStore("files");
      const request = callback(storeRef);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    }));
  }

  function putMapBlob(key, blob) {
    return withStore("readwrite", (storeRef) => storeRef.put(blob, key));
  }

  function getMapBlob(key) {
    return withStore("readonly", (storeRef) => storeRef.get(key));
  }

  function deleteMapBlob(key) {
    return withStore("readwrite", (storeRef) => storeRef.delete(key));
  }

  async function resolveMapSource(map) {
    if (!map) throw new Error("Missing map");
    if (map.kind !== "custom") {
      if (mapObjectUrl) {
        URL.revokeObjectURL(mapObjectUrl);
        mapObjectUrl = null;
      }
      return assetBase + "/maps/" + map.fileName;
    }
    const blob = await getMapBlob(map.blobKey);
    if (!blob) throw new Error("Missing custom map image");
    if (mapObjectUrl) URL.revokeObjectURL(mapObjectUrl);
    mapObjectUrl = URL.createObjectURL(blob);
    return mapObjectUrl;
  }
})();


