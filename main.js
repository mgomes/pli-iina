const { core, event, http, console, overlay } = iina;

const REPORT_INTERVAL = 10000;
const OVERLAY_INTERVAL = 500;
const NEXT_EPISODE_THRESHOLD_MS = 30000;
const RESUME_SEEK_GRACE_MS = 3000;

let session = null;
let reportTimer = null;
let overlayTimer = null;
let lastPosition = 0;
let lastOverlayState = "";
let overlayVisible = false;
let overlayInitialized = false;
let overlayLoaded = false;

function initializeOverlay() {
  if (overlayInitialized) {
    return;
  }

  overlayInitialized = true;
  overlayLoaded = false;
  overlay.loadFile("overlay.html");
  overlay.setOpacity(1);
  overlay.setClickable(false);
  overlay.hide();
  overlay.onMessage("action", function (payload) {
    const action = payload && typeof payload === "object" ? payload.action : payload;
    if (action === "skip-intro") {
      skipMarker("intro", "Skipped intro");
      return;
    }
    if (action === "skip-credits") {
      skipMarker("credits", "Skipped credits");
      return;
    }
    if (action === "next-episode") {
      playNextEpisode();
    }
  });
}

function getParam(url, name) {
  const re = new RegExp("[?&]" + name + "=([^&]+)");
  const m = url.match(re);
  return m ? decodeURIComponent(m[1]) : null;
}

function getPlayerContextURL(callback) {
  try {
    return new URL("player/context", callback).toString();
  } catch (_) {
    return null;
  }
}

function parseHTTPData(response) {
  if (!response) return null;
  if (response.data !== undefined && response.data !== null) return response.data;
  if (typeof response.text === "string" && response.text.length > 0) {
    try {
      return JSON.parse(response.text);
    } catch (_) {
      return null;
    }
  }
  return null;
}

function normalizeMarkers(markers) {
  if (!Array.isArray(markers)) return [];

  return markers
    .map(function (marker) {
      return {
        type: typeof marker.type === "string" ? marker.type.toLowerCase() : "",
        startMs: Number(marker.start_ms || 0),
        endMs: Number(marker.end_ms || 0),
        final: Boolean(marker.final),
      };
    })
    .filter(function (marker) {
      return marker.type && marker.endMs > marker.startMs;
    })
    .sort(function (a, b) {
      if (a.startMs === b.startMs) {
        return a.endMs - b.endMs;
      }
      return a.startMs - b.startMs;
    });
}

function normalizeNextItem(item) {
  if (!item || typeof item !== "object" || typeof item.stream_url !== "string" || item.stream_url.length === 0) {
    return null;
  }

  const ratingKey =
    typeof item.rating_key === "string" || typeof item.rating_key === "number" ? String(item.rating_key) : "";

  return {
    title: typeof item.title === "string" ? item.title : "",
    ratingKey: ratingKey,
    streamURL: item.stream_url,
    durationMs: Number(item.duration_ms || 0),
    viewOffsetMs: Number(item.view_offset_ms || 0),
  };
}

function getCurrentDurationMs() {
  if (session && session.durationMs > 0) {
    return session.durationMs;
  }
  const durationSec = core.status.duration || 0;
  return durationSec > 0 ? Math.round(durationSec * 1000) : 0;
}

function getCurrentPositionMs() {
  const positionSec = core.status.position || 0;
  const observedPositionMs = positionSec > 0 ? Math.round(positionSec * 1000) : 0;

  if (session && session.resumePositionMs > 0) {
    if (observedPositionMs >= session.resumePositionMs) {
      session.resumePositionMs = 0;
      session.resumeRequestedAtMs = 0;
    } else {
      const resumeGraceExpired =
        observedPositionMs > 0 &&
        session.resumeRequestedAtMs > 0 &&
        Date.now() - session.resumeRequestedAtMs >= RESUME_SEEK_GRACE_MS;
      if (!resumeGraceExpired) {
        lastPosition = session.resumePositionMs;
        return lastPosition;
      }
      session.resumePositionMs = 0;
      session.resumeRequestedAtMs = 0;
    }
  }

  if (observedPositionMs > 0) {
    lastPosition = observedPositionMs;
  }
  return lastPosition;
}

function report(state, preservePosition) {
  if (!session) return;

  const timeMs = preservePosition ? lastPosition : getCurrentPositionMs();
  const durationMs = session.durationMs > 0 ? session.durationMs : getCurrentDurationMs();

  http.post(session.callback, {
    headers: { "Content-Type": "application/json" },
    data: {
      rating_key: session.ratingKey,
      time_ms: timeMs,
      duration_ms: durationMs,
      state: state,
    },
  }).catch(function () {});
}

function hideOverlay() {
  if (!overlayInitialized) {
    overlayVisible = false;
    return;
  }

  overlay.setClickable(false);
  if (overlayVisible) {
    overlay.hide();
    overlayVisible = false;
  }
}

function stopTracking() {
  if (reportTimer) {
    clearInterval(reportTimer);
    reportTimer = null;
  }
  if (overlayTimer) {
    clearInterval(overlayTimer);
    overlayTimer = null;
  }
  hideOverlay();
  if (session) {
    report("stopped", true);
    session = null;
    lastPosition = 0;
  }
}

function startTracking(ratingKey, durationMs, callback, startMs) {
  stopTracking();

  session = {
    ratingKey: ratingKey,
    durationMs: durationMs,
    callback: callback,
    contextURL: getPlayerContextURL(callback),
    markers: [],
    next: null,
    resumePositionMs: startMs > 0 ? startMs : 0,
    resumeRequestedAtMs: startMs > 0 ? Date.now() : 0,
  };
  lastPosition = startMs > 0 ? startMs : 0;

  report("playing", true);

  reportTimer = setInterval(function () {
    const state = core.status.paused ? "paused" : "playing";
    report(state);
  }, REPORT_INTERVAL);

  overlayTimer = setInterval(function () {
    updateOverlay();
  }, OVERLAY_INTERVAL);

  updateOverlay();
  void refreshPlayerContext();
}

async function refreshPlayerContext() {
  if (!session || !session.contextURL) return;

  const ratingKey = session.ratingKey;
  try {
    const response = await http.get(session.contextURL, {
      headers: { Accept: "application/json" },
      params: { rating_key: ratingKey },
    });
    const payload = parseHTTPData(response);
    if (!payload || !session || session.ratingKey !== ratingKey) {
      return;
    }

    const durationMs = Number(payload.duration_ms || 0);
    if (durationMs > 0) {
      session.durationMs = durationMs;
    }
    session.markers = normalizeMarkers(payload.markers);
    session.next = normalizeNextItem(payload.next);
    updateOverlay();
  } catch (err) {
    console.log("pli: player context fetch failed", String(err));
  }
}

function findActiveMarker(type, positionMs) {
  if (!session || !Array.isArray(session.markers)) return null;

  for (let i = 0; i < session.markers.length; i += 1) {
    const marker = session.markers[i];
    if (marker.type !== type) continue;
    if (positionMs < marker.startMs || positionMs >= marker.endMs) continue;
    return marker;
  }

  return null;
}

function shouldShowNextEpisode(positionMs, creditsMarker) {
  if (!session || !session.next) return false;

  if (creditsMarker && creditsMarker.final) {
    return true;
  }

  const durationMs = getCurrentDurationMs();
  if (durationMs <= 0) return false;

  return durationMs - positionMs <= NEXT_EPISODE_THRESHOLD_MS;
}

function buildOverlayPayload() {
  if (!session) {
    return { visible: false, buttons: [] };
  }

  const positionMs = getCurrentPositionMs();
  const introMarker = findActiveMarker("intro", positionMs);
  const creditsMarker = findActiveMarker("credits", positionMs);
  const buttons = [];

  if (introMarker) {
    buttons.push({
      id: "skip-intro",
      label: "Skip Intro",
      detail: "",
    });
  }

  if (creditsMarker) {
    buttons.push({
      id: "skip-credits",
      label: "Skip Credits",
      detail: "",
    });
  }

  if (shouldShowNextEpisode(positionMs, creditsMarker)) {
    buttons.push({
      id: "next-episode",
      label: "Next Episode",
      detail: session.next && session.next.title ? session.next.title : "",
    });
  }

  return {
    visible: buttons.length > 0,
    buttons: buttons,
  };
}

function updateOverlay() {
  if (!overlayInitialized || !overlayLoaded) {
    return;
  }

  const payload = buildOverlayPayload();
  const nextOverlayState = JSON.stringify(payload);
  if (nextOverlayState === lastOverlayState) {
    return;
  }

  lastOverlayState = nextOverlayState;

  if (!payload.visible) {
    hideOverlay();
    return;
  }

  if (!overlayVisible) {
    overlay.show();
    overlayVisible = true;
  }
  overlay.setClickable(true);
  overlay.postMessage("state", payload);
}

function skipMarker(type, message) {
  const positionMs = getCurrentPositionMs();
  const marker = findActiveMarker(type, positionMs);
  if (!marker) return;

  lastPosition = marker.endMs;
  core.seekTo(marker.endMs / 1000);
  core.osd(message);
  updateOverlay();
}

function buildTrackedPlaybackURL(item) {
  if (!session || !item || !item.streamURL) return null;

  try {
    const playbackURL = new URL(item.streamURL);
    if (item.ratingKey) {
      playbackURL.searchParams.set("X-Pli-Rating-Key", item.ratingKey);
    }
    if (item.durationMs > 0) {
      playbackURL.searchParams.set("X-Pli-Duration", String(item.durationMs));
    }
    playbackURL.searchParams.set("X-Pli-Start", String(item.viewOffsetMs || 0));
    playbackURL.searchParams.set("X-Pli-Callback", session.callback);
    playbackURL.searchParams.set("X-Pli-Session", String(Date.now()));
    return playbackURL.toString();
  } catch (_) {
    return null;
  }
}

function playNextEpisode() {
  if (!session || !session.next) return;

  const nextURL = buildTrackedPlaybackURL(session.next);
  if (!nextURL) return;

  core.osd("Loading next episode");
  core.open(nextURL);
}

event.on("iina.window-loaded", function () {
  initializeOverlay();
  updateOverlay();
});

event.on("iina.plugin-overlay-loaded", function () {
  overlayLoaded = true;
  lastOverlayState = "";
  updateOverlay();
});

event.on("iina.file-loaded", function (url) {
  const ratingKey = getParam(url, "X-Pli-Rating-Key");
  const callback = getParam(url, "X-Pli-Callback");
  if (!ratingKey || !callback) return;

  const durationParam = getParam(url, "X-Pli-Duration");
  const durationMs = durationParam ? parseInt(durationParam, 10) : 0;

  const startParam = getParam(url, "X-Pli-Start");
  const startMs = startParam ? parseInt(startParam, 10) : 0;
  startTracking(ratingKey, durationMs, callback, startMs);
  if (startMs > 0) {
    core.seek(startMs / 1000);
  }
});

event.on("mpv.pause.changed", function () {
  if (!session) return;
  const state = core.status.paused ? "paused" : "playing";
  report(state);
  updateOverlay();
});

event.on("mpv.end-file", function () {
  stopTracking();
});

event.on("iina.window-will-close", function () {
  stopTracking();
  overlayInitialized = false;
  overlayLoaded = false;
  lastOverlayState = "";
});
