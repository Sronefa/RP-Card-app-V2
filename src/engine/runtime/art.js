// CardForge procedural art (CF.art): pictures drawn in code, so a screen needs no image for them.
// Charts, gauges, frames and dividers, emblems from a name, patterns and noise textures for CSS
// backgrounds, skies for a time of day, and whole maps (an island, a dungeon, a city) to put pins
// on. The same seed always draws the same picture.
//
// Runs in the card's Tavern Helper script with the engine core. Inline pieces (charts, gauges,
// frames, emblems) are HTML strings styled by the kit with the theme's colours, like CF.ui. Images
// (patterns, maps, noise) are data URLs with their own colours, since a picture can't read the
// theme: pass `color` or a palette. Nothing here loads from the network.

/** A random number generator that gives the same numbers for the same seed (text or number). */
function cfArtRng(seed) {
  var s = String(seed == null ? "" : seed);
  var h = 1779033703 ^ s.length;
  for (var i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  var a = h >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in 0..1 for a seed: noise(x, y), and noise.fbm(x, y, octaves) for more detail. */
function cfArtNoise(seed) {
  var rand = cfArtRng(seed);
  var table = [];
  for (var i = 0; i < 256; i++) table.push(rand());
  function corner(x, y) {
    var h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return table[(h ^ (h >>> 16)) & 255];
  }
  function smooth(t) {
    return t * t * (3 - 2 * t);
  }
  function noise(x, y) {
    y = y || 0;
    var x0 = Math.floor(x);
    var y0 = Math.floor(y);
    var sx = smooth(x - x0);
    var sy = smooth(y - y0);
    var top = corner(x0, y0) + (corner(x0 + 1, y0) - corner(x0, y0)) * sx;
    var bottom = corner(x0, y0 + 1) + (corner(x0 + 1, y0 + 1) - corner(x0, y0 + 1)) * sx;
    return top + (bottom - top) * sy;
  }
  noise.fbm = function (x, y, octaves) {
    var total = 0;
    var amp = 1;
    var norm = 0;
    for (var o = 0; o < (octaves || 4); o++) {
      total += noise(x * Math.pow(2, o), (y || 0) * Math.pow(2, o)) * amp;
      norm += amp;
      amp /= 2;
    }
    return total / norm;
  };
  return noise;
}

function cfArtNum(n) {
  return String(Math.round(n * 10) / 10);
}

function cfArtClamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** An SVG as a data URL, for an image's src. No quotes or brackets left in it, so it fits any attribute or url(). */
function cfArtDataUrl(svg) {
  return "data:image/svg+xml," + encodeURIComponent(svg).replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/** Chart data as [{ label, value, color }], from numbers or objects. */
function cfArtSeries(data) {
  return (data || []).map(function (d, i) {
    return typeof d === "number" || typeof d === "string" ? { label: "", value: Number(d) || 0, color: "", i: i } : { label: d.label == null ? "" : String(d.label), value: Number(d.value) || 0, color: d.color || "", i: i };
  });
}

/** The colour of series item i: its own, else the theme's accents in turn. */
function cfArtColor(d) {
  if (d.color) return d.color;
  return ["var(--cf-accent)", "var(--cf-accent2)", "var(--cf-good)", "var(--cf-bad)", "var(--cf-muted)"][d.i % 5];
}

function cfArtSummary(series) {
  return series.map(function (d) { return (d.label ? d.label + " " : "") + d.value; }).join(", ");
}

function cfArtLegend(series) {
  return (
    '<ul class="cf-art-legend">' +
    series.map(function (d) {
      return '<li><i style="background:' + cfEsc(cfArtColor(d)) + '"></i>' + cfEsc(d.label) + ' <b>' + cfEsc(d.value) + "</b></li>";
    }).join("") +
    "</ul>"
  );
}

/** A polar point: angle in degrees from 12 o'clock, clockwise. */
function cfArtPolar(cx, cy, r, deg) {
  var a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function cfArtArc(cx, cy, r, from, to) {
  var a = cfArtPolar(cx, cy, r, from);
  var b = cfArtPolar(cx, cy, r, to);
  return "M" + cfArtNum(a[0]) + " " + cfArtNum(a[1]) + " A" + r + " " + r + " 0 " + (to - from > 180 ? 1 : 0) + " 1 " + cfArtNum(b[0]) + " " + cfArtNum(b[1]);
}

/** A closed, smooth path through points. */
function cfArtBlob(points) {
  var n = points.length;
  var mid = function (i) {
    var p = points[i % n];
    var q = points[(i + 1) % n];
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  };
  var start = mid(n - 1);
  var d = "M" + cfArtNum(start[0]) + " " + cfArtNum(start[1]);
  for (var i = 0; i < n; i++) {
    var m = mid(i);
    d += " Q" + cfArtNum(points[i][0]) + " " + cfArtNum(points[i][1]) + " " + cfArtNum(m[0]) + " " + cfArtNum(m[1]);
  }
  return d + "Z";
}

var CF_ART_PATTERNS = {
  dots: function (c, s) { return '<circle cx="' + s / 2 + '" cy="' + s / 2 + '" r="' + cfArtNum(s / 8) + '" fill="' + c + '"/>'; },
  grid: function (c, s) { return '<path d="M' + s + " 0V" + s + "H0" + '" fill="none" stroke="' + c + '"/>'; },
  stripes: function (c, s) { return '<path d="M0 ' + s + "L" + s + " 0M" + -s / 2 + " " + s / 2 + "L" + s / 2 + " " + -s / 2 + "M" + s / 2 + " " + s * 1.5 + "L" + s * 1.5 + " " + s / 2 + '" stroke="' + c + '" stroke-width="' + cfArtNum(s / 6) + '"/>'; },
  checks: function (c, s) { return '<path d="M0 0h' + s / 2 + "v" + s / 2 + "H0zM" + s / 2 + " " + s / 2 + "h" + s / 2 + "v" + s / 2 + "h" + -s / 2 + 'z" fill="' + c + '"/>'; },
  diamonds: function (c, s) { return '<path d="M' + s / 2 + " " + s * 0.15 + "L" + s * 0.85 + " " + s / 2 + "L" + s / 2 + " " + s * 0.85 + "L" + s * 0.15 + " " + s / 2 + 'z" fill="none" stroke="' + c + '"/>'; },
  waves: function (c, s) { return '<path d="M0 ' + s / 2 + " Q" + s / 4 + " " + s / 4 + " " + s / 2 + " " + s / 2 + " T" + s + " " + s / 2 + '" fill="none" stroke="' + c + '"/>'; },
  crosshatch: function (c, s) { return '<path d="M0 0L' + s + " " + s + "M" + s + " 0L0 " + s + '" stroke="' + c + '" stroke-width=".6"/>'; },
  hex: function (c, s) {
    // Three hexagons on a tile 1.5 wide and 0.87 high (in hexagon widths) tile seamlessly.
    var r = s / 2;
    var h = r * 1.732;
    var hexAt = function (cx, cy) {
      var d = "";
      for (var k = 0; k < 6; k++) d += (k ? "L" : "M") + cfArtNum(cx + r * Math.cos((k * Math.PI) / 3)) + " " + cfArtNum(cy + r * Math.sin((k * Math.PI) / 3));
      return d + "Z";
    };
    return ['<path d="' + hexAt(r, h / 2) + hexAt(r * 2.5, 0) + hexAt(r * 2.5, h) + '" fill="none" stroke="' + c + '"/>', r * 3, h];
  },
};

/** The palettes a map can be drawn in: sea, land, high land, lines, marks and paper. */
var CF_ART_PALETTES = {
  parchment: { sea: "#c9b48a", land: "#efe0bd", high: "#d9c497", line: "#5b4a2f", mark: "#8a2f1d", paper: "#e6d3a8" },
  sea: { sea: "#1f4e6b", land: "#cdbb8c", high: "#8fa267", line: "#22323c", mark: "#d1452f", paper: "#2a5f80" },
  night: { sea: "#0d1524", land: "#24324a", high: "#34476a", line: "#9fb4d6", mark: "#f4c95d", paper: "#0a101c" },
  neon: { sea: "#07070f", land: "#15152b", high: "#22224a", line: "#2ef2ff", mark: "#ff2bd6", paper: "#05050b" },
  stone: { sea: "#16171b", land: "#4a4740", high: "#5d594f", line: "#c9c1ad", mark: "#e0a33a", paper: "#101114" },
};

function cfArtPalette(o) {
  var base = CF_ART_PALETTES[o.palette] || CF_ART_PALETTES[o.kind === "dungeon" ? "stone" : o.kind === "city" ? "night" : "parchment"];
  return Object.assign({}, base, o.colors || {});
}

/** Places on a map, as points in its own units: given x and y in %, else spread by the seed. */
function cfArtPlaces(places, w, h, rand) {
  return (places || []).map(function (p) {
    var x = p.x == null ? 15 + rand() * 70 : p.x;
    var y = p.y == null ? 15 + rand() * 70 : p.y;
    return { x: (cfArtClamp(Number(x), 0, 100) / 100) * w, y: (cfArtClamp(Number(y), 0, 100) / 100) * h };
  });
}

/** Roads: each place to the next, as gentle curves. */
function cfArtRoads(pts, rand, pal) {
  var d = "";
  for (var i = 1; i < pts.length; i++) {
    var a = pts[i - 1];
    var b = pts[i];
    var mx = (a.x + b.x) / 2 + (rand() - 0.5) * 40;
    var my = (a.y + b.y) / 2 + (rand() - 0.5) * 40;
    d += "M" + cfArtNum(a.x) + " " + cfArtNum(a.y) + " Q" + cfArtNum(mx) + " " + cfArtNum(my) + " " + cfArtNum(b.x) + " " + cfArtNum(b.y);
  }
  return d ? '<path d="' + d + '" fill="none" stroke="' + pal.line + '" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round" opacity=".7"/>' : "";
}

function cfArtCompass(x, y, pal) {
  return (
    '<g transform="translate(' + x + " " + y + ')" opacity=".75"><circle r="15" fill="none" stroke="' + pal.line + '"/>' +
    '<path d="M0 -20L4 0L0 20L-4 0Z" fill="' + pal.line + '"/><path d="M-20 0L0 3L20 0L0 -3Z" fill="' + pal.line + '" opacity=".6"/>' +
    '<text y="-24" text-anchor="middle" font-size="9" font-family="Georgia, serif" fill="' + pal.line + '">N</text></g>'
  );
}

function cfArtIsland(w, h, rand, noise, pal, pts) {
  var cx = w / 2;
  var cy = h / 2;
  var outline = function (scale, offset) {
    var pointsList = [];
    for (var i = 0; i < 48; i++) {
      var a = (i / 48) * Math.PI * 2;
      var r = (0.62 + 0.42 * noise.fbm(Math.cos(a) * 1.4 + 5 + offset, Math.sin(a) * 1.4 + 5, 3)) * scale;
      pointsList.push([cx + Math.cos(a) * r * w * 0.42, cy + Math.sin(a) * r * h * 0.42]);
    }
    return cfArtBlob(pointsList);
  };
  var coast = outline(1, 0);
  var svg =
    '<path d="' + outline(1.1, 0) + '" fill="none" stroke="' + pal.line + '" stroke-opacity=".25" stroke-dasharray="2 5"/>' +
    '<path d="' + coast + '" fill="' + pal.land + '" stroke="' + pal.line + '" stroke-width="1.5"/>' +
    '<path d="' + outline(0.55, 7) + '" fill="' + pal.high + '" opacity=".7"/>';
  // An islet or two off the coast.
  for (var k = 0; k < 2; k++) {
    var a = rand() * Math.PI * 2;
    var ix = cx + Math.cos(a) * w * 0.44;
    var iy = cy + Math.sin(a) * h * 0.44;
    svg += '<ellipse cx="' + cfArtNum(ix) + '" cy="' + cfArtNum(iy) + '" rx="' + cfArtNum(6 + rand() * 8) + '" ry="' + cfArtNum(4 + rand() * 5) + '" fill="' + pal.land + '" stroke="' + pal.line + '"/>';
  }
  // Mountains on the high ground, trees around them, away from the places.
  for (var m = 0; m < 26; m++) {
    var ang = rand() * Math.PI * 2;
    var dist = Math.sqrt(rand()) * 0.5;
    var x = cx + Math.cos(ang) * dist * w * 0.42;
    var y = cy + Math.sin(ang) * dist * h * 0.42;
    var clear = pts.every(function (p) { return Math.abs(p.x - x) > 14 || Math.abs(p.y - y) > 14; });
    if (!clear) continue;
    svg += dist < 0.3
      ? '<path d="M' + cfArtNum(x - 7) + " " + cfArtNum(y + 5) + "L" + cfArtNum(x) + " " + cfArtNum(y - 7) + "L" + cfArtNum(x + 7) + " " + cfArtNum(y + 5) + '" fill="none" stroke="' + pal.line + '" stroke-width="1.2"/>'
      : '<circle cx="' + cfArtNum(x) + '" cy="' + cfArtNum(y) + '" r="3" fill="' + pal.high + '" stroke="' + pal.line + '" stroke-width=".7"/>';
  }
  return svg;
}

function cfArtDungeon(w, h, rand, pal, pts) {
  var cell = 10;
  var rooms = pts.map(function (p) {
    var rw = (3 + Math.floor(rand() * 3)) * cell;
    var rh = (3 + Math.floor(rand() * 2)) * cell;
    return { x: Math.round((p.x - rw / 2) / cell) * cell, y: Math.round((p.y - rh / 2) / cell) * cell, w: rw, h: rh, cx: p.x, cy: p.y };
  });
  for (var extra = 0; extra < 4; extra++) {
    var ex = (2 + Math.floor(rand() * (w / cell - 8))) * cell;
    var ey = (2 + Math.floor(rand() * (h / cell - 7))) * cell;
    rooms.push({ x: ex, y: ey, w: 3 * cell, h: 3 * cell, cx: ex + 1.5 * cell, cy: ey + 1.5 * cell });
  }
  var halls = "";
  for (var i = 1; i < rooms.length; i++) {
    var a = rooms[i - 1];
    var b = rooms[i];
    halls += "M" + cfArtNum(a.cx) + " " + cfArtNum(a.cy) + "H" + cfArtNum(b.cx) + "V" + cfArtNum(b.cy);
  }
  var floor = rooms.map(function (r) {
    return '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="' + pal.land + '" stroke="' + pal.line + '" stroke-width="1.5"/>';
  }).join("");
  var grid = '<pattern id="g" width="' + cell + '" height="' + cell + '" patternUnits="userSpaceOnUse"><path d="M' + cell + ' 0V' + cell + 'H0" fill="none" stroke="' + pal.line + '" stroke-opacity=".12"/></pattern>';
  return (
    "<defs>" + grid + "</defs>" +
    (halls ? '<path d="' + halls + '" fill="none" stroke="' + pal.line + '" stroke-width="9" stroke-linejoin="round"/><path d="' + halls + '" fill="none" stroke="' + pal.land + '" stroke-width="6.5" stroke-linejoin="round"/>' : "") +
    floor + '<rect width="' + w + '" height="' + h + '" fill="url(#g)"/>'
  );
}

function cfArtCity(w, h, rand, noise, pal, pts) {
  var svg = "";
  var step = 34;
  for (var x = 6; x < w - 10; x += step) {
    for (var y = 6; y < h - 10; y += step * 0.8) {
      var near = pts.some(function (p) { return Math.abs(p.x - (x + step / 2)) < step * 0.7 && Math.abs(p.y - (y + step * 0.4)) < step * 0.6; });
      if (near) continue;
      var bw = step - 8 - rand() * 6;
      var bh = step * 0.8 - 8 - rand() * 5;
      svg += '<rect x="' + cfArtNum(x) + '" y="' + cfArtNum(y) + '" width="' + cfArtNum(bw) + '" height="' + cfArtNum(bh) + '" rx="1.5" fill="' + (rand() < 0.25 ? pal.high : pal.land) + '"/>';
    }
  }
  // A river through it.
  var river = [];
  for (var i = 0; i <= 12; i++) river.push(cfArtNum((i / 12) * w) + " " + cfArtNum(h * (0.3 + 0.4 * noise(i * 0.35 + 3, 1.7))));
  svg += '<polyline points="' + river.join(" ") + '" fill="none" stroke="' + pal.sea + '" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>';
  svg += '<polyline points="' + river.join(" ") + '" fill="none" stroke="' + pal.line + '" stroke-opacity=".35" stroke-width="1"/>';
  // Plazas where the places are.
  svg += pts.map(function (p) { return '<circle cx="' + cfArtNum(p.x) + '" cy="' + cfArtNum(p.y) + '" r="13" fill="none" stroke="' + pal.line + '" stroke-opacity=".5"/>'; }).join("");
  return svg;
}

/** Corner ornaments for a frame, drawn for the top left and turned for the rest. */
var CF_ART_CORNERS = {
  ornate: '<path d="M2 22V8a6 6 0 0 1 6-6h14M6 22V12a6 6 0 0 1 6-6h10M2 2h3v3H2z" /><path d="M10 10c3 0 4 2 4 4" />',
  tech: '<path d="M2 18V2h16M6 10V6h4" /><path d="M2 24v4M24 2h4" />',
  sketch: '<path d="M3 20c-1-5 0-11 1-16 5-1 11-2 16-1" /><path d="M6 16c0-3 0-7 1-9 3-1 6-1 9 0" />',
};

var cfArt = {
  /** Random numbers from a seed: the same seed, the same numbers. */
  rng: cfArtRng,
  /** Smooth noise from a seed: noise(x, y) and noise.fbm(x, y, octaves), each 0 to 1. */
  noise: cfArtNoise,
  /** An SVG as a data URL, for an image's src. */
  dataUrl: cfArtDataUrl,
  /** An SVG as a CSS url(), for a background. It has no double quotes, so it can go in a style="…" attribute. */
  url: function (svg) {
    return "url('" + cfArtDataUrl(svg) + "')";
  },

  /** A theme colour ("accent", "bg", "text"…) as an element's screen sees it, for pictures that can't read the theme. */
  themeColor: function (name, el) {
    try {
      var doc = (el && el.ownerDocument) || document;
      return doc.defaultView.getComputedStyle(doc.documentElement).getPropertyValue("--cf-" + name).trim();
    } catch (e) {
      return "";
    }
  },

  /**
   * A repeating pattern as a CSS background: "dots", "grid", "stripes", "checks", "diamonds",
   * "waves", "crosshatch" or "hex". { color, size (px), opacity }.
   */
  pattern: function (kind, o) {
    o = o || {};
    var draw = CF_ART_PATTERNS[kind] || CF_ART_PATTERNS.dots;
    var s = cfArtClamp(Number(o.size) || 16, 4, 120);
    var c = o.color || "rgba(127,127,127,.35)";
    // A pattern gives its markup, or its markup and its own tile size.
    var tile = draw(cfEsc(c), s);
    if (typeof tile === "string") tile = [tile, s, s];
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + cfArtNum(tile[1]) + '" height="' + cfArtNum(tile[2]) + '" opacity="' + (o.opacity == null ? 1 : o.opacity) + '">' + tile[0] + "</svg>";
    return cfArt.url(svg);
  },

  /** Film grain, paper or fog as a CSS background, from SVG noise. { scale (0.2 fine to 0.01 cloudy), opacity, color, seed }. */
  noiseTexture: function (o) {
    o = o || {};
    var scale = cfArtClamp(Number(o.scale) || 0.8, 0.005, 2);
    var size = scale < 0.1 ? 400 : 160;
    var seed = Math.floor(cfArtRng(o.seed == null ? 1 : o.seed)() * 1000);
    var c = o.color || "#000";
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="' + scale + '" numOctaves="3" seed="' + seed + '" stitchTiles="stitch"/>' +
      '<feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ' + cfArtClamp(o.opacity == null ? 0.12 : Number(o.opacity), 0, 1) + ' 0"/></filter>' +
      '<rect width="100%" height="100%" fill="' + cfEsc(c) + '" filter="url(#n)"/></svg>';
    return cfArt.url(svg);
  },

  /** A sky for a time of day ("Morning", "night", "18:30") as a CSS gradient: a background until the art exists. */
  sky: function (time) {
    var t = String(time || "").toLowerCase();
    var h = /^(\d{1,2}):/.exec(t);
    var hour = h ? Number(h[1]) : /dawn|morning/.test(t) ? 7 : /noon|afternoon|day/.test(t) ? 14 : /dusk|evening|sunset/.test(t) ? 19 : /night|midnight/.test(t) ? 23 : 12;
    if (hour < 5 || hour >= 21) return "radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,.8), transparent), radial-gradient(1px 1px at 70% 20%, rgba(255,255,255,.6), transparent), radial-gradient(1.5px 1.5px at 45% 12%, rgba(255,255,255,.7), transparent), linear-gradient(180deg, #070b1a 0%, #141c3a 60%, #232a4d 100%)";
    if (hour < 8) return "linear-gradient(180deg, #2b3a67 0%, #b06a8f 55%, #f6b48f 100%)";
    if (hour < 17) return "linear-gradient(180deg, #5aa5e6 0%, #9fd0f2 65%, #e2f1fb 100%)";
    return "linear-gradient(180deg, #2a2a5e 0%, #c0504d 55%, #f4a35d 100%)";
  },

  /**
   * A chart: "bar", "line", "spark" (a tiny line for inside text), "donut" or "radar".
   * `data` is numbers or [{ label, value, color }]. { max, title, height, legend }.
   */
  chart: function (kind, data, o) {
    o = o || {};
    var series = cfArtSeries(data);
    var title = o.title || "";
    var label = cfEsc((title ? title + ": " : "") + cfArtSummary(series));
    var max = Number(o.max) || Math.max.apply(null, series.map(function (d) { return d.value; }).concat([1]));
    var n = series.length;
    if (!n) return '<div class="cf-art cf-art-empty">' + cfEsc(o.empty || "No data yet") + "</div>";
    if (kind === "spark") {
      var sp = series.map(function (d, i) { return cfArtNum((i / Math.max(1, n - 1)) * 100) + "," + cfArtNum(28 - (d.value / max) * 26); }).join(" ");
      return '<svg class="cf-art-spark" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label="' + label + '"><polyline points="' + sp + '"/></svg>';
    }
    var svg;
    if (kind === "line") {
      var W = 300;
      var H = 140;
      var pts = series.map(function (d, i) { return [20 + (i / Math.max(1, n - 1)) * (W - 30), H - 20 - (d.value / max) * (H - 35)]; });
      var line = pts.map(function (p) { return cfArtNum(p[0]) + "," + cfArtNum(p[1]); }).join(" ");
      svg =
        '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + label + '">' +
        '<path class="cf-art-axis" d="M20 ' + (H - 20) + "H" + (W - 10) + '"/>' +
        '<polygon class="cf-art-area" points="20,' + (H - 20) + " " + line + " " + cfArtNum(pts[n - 1][0]) + "," + (H - 20) + '"/>' +
        '<polyline class="cf-art-stroke" points="' + line + '"/>' +
        pts.map(function (p, i) { return '<circle class="cf-art-dot" cx="' + cfArtNum(p[0]) + '" cy="' + cfArtNum(p[1]) + '" r="3"/>' + (series[i].label ? '<text class="cf-art-text" x="' + cfArtNum(p[0]) + '" y="' + (H - 6) + '" text-anchor="middle">' + cfEsc(series[i].label) + "</text>" : ""); }).join("") +
        "</svg>";
    } else if (kind === "donut") {
      var total = series.reduce(function (s, d) { return s + Math.max(0, d.value); }, 0) || 1;
      var r = 15.9155;
      var at = 0;
      svg =
        '<svg viewBox="0 0 42 42" role="img" aria-label="' + label + '"><circle class="cf-art-track" cx="21" cy="21" r="' + r + '"/>' +
        series.map(function (d) {
          var pct = (Math.max(0, d.value) / total) * 100;
          var seg = '<circle class="cf-art-seg" cx="21" cy="21" r="' + r + '" style="stroke:' + cfEsc(cfArtColor(d)) + '" stroke-dasharray="' + cfArtNum(pct) + " " + cfArtNum(100 - pct) + '" stroke-dashoffset="' + cfArtNum(25 - at) + '"/>';
          at += pct;
          return seg;
        }).join("") +
        (o.center != null ? '<text class="cf-art-center" x="21" y="23.5" text-anchor="middle">' + cfEsc(o.center) + "</text>" : "") +
        "</svg>";
      return '<figure class="cf-art cf-art-donut">' + svg + (o.legend === false ? "" : cfArtLegend(series)) + "</figure>";
    } else if (kind === "radar") {
      var c = 100;
      var R = 70;
      var ring = function (k) {
        return series.map(function (d, i) { var p = cfArtPolar(c, c, R * k, (360 / n) * i); return cfArtNum(p[0]) + "," + cfArtNum(p[1]); }).join(" ");
      };
      var shape = series.map(function (d, i) { var p = cfArtPolar(c, c, R * cfArtClamp(d.value / max, 0, 1), (360 / n) * i); return cfArtNum(p[0]) + "," + cfArtNum(p[1]); }).join(" ");
      svg =
        '<svg viewBox="0 0 200 200" role="img" aria-label="' + label + '">' +
        [0.25, 0.5, 0.75, 1].map(function (k) { return '<polygon class="cf-art-grid" points="' + ring(k) + '"/>'; }).join("") +
        '<polygon class="cf-art-shape" points="' + shape + '"/>' +
        series.map(function (d, i) {
          var p = cfArtPolar(c, c, R + 16, (360 / n) * i);
          return '<text class="cf-art-text" x="' + cfArtNum(p[0]) + '" y="' + cfArtNum(p[1] + 3) + '" text-anchor="middle">' + cfEsc(d.label) + "</text>";
        }).join("") +
        "</svg>";
    } else {
      // Bars, the default: one row per item, so long labels fit a phone.
      return (
        '<div class="cf-art cf-art-bars" role="img" aria-label="' + label + '">' +
        series.map(function (d) {
          var pct = cfArtClamp((d.value / max) * 100, 0, 100);
          return '<div class="cf-art-bar"><span class="cf-art-bar-label">' + cfEsc(d.label) + '</span><span class="cf-art-bar-track"><i style="width:' + cfArtNum(pct) + "%;background:" + cfEsc(cfArtColor(d)) + '"></i></span><b>' + cfEsc(d.value) + "</b></div>";
        }).join("") +
        "</div>"
      );
    }
    return '<figure class="cf-art cf-art-' + kind + '">' + svg + "</figure>";
  },

  /** A dial gauge: { value, min, max, label, unit, ticks, danger (the fraction at the low end shown in danger colour) }. */
  gauge: function (o) {
    o = o || {};
    var min = o.min == null ? 0 : Number(o.min);
    var max = o.max == null ? 100 : Number(o.max);
    var value = Number(o.value) || 0;
    var pct = cfArtClamp((value - min) / (max - min || 1), 0, 1);
    var from = -120;
    var to = 120;
    var ticks = cfArtClamp(o.ticks == null ? 10 : Number(o.ticks), 0, 40);
    var marks = "";
    for (var i = 0; i <= ticks && ticks; i++) {
      var deg = from + ((to - from) * i) / ticks;
      var a = cfArtPolar(50, 50, 40, deg);
      var b = cfArtPolar(50, 50, i % 5 ? 36 : 33, deg);
      marks += "M" + cfArtNum(a[0]) + " " + cfArtNum(a[1]) + "L" + cfArtNum(b[0]) + " " + cfArtNum(b[1]);
    }
    var danger = cfArtClamp(Number(o.danger) || 0, 0, 1);
    var low = pct <= danger && danger > 0;
    var needle = cfArtPolar(50, 50, 30, from + (to - from) * pct);
    return (
      '<div class="cf-art cf-art-gauge' + (low ? " low" : "") + '" role="meter" aria-valuemin="' + min + '" aria-valuemax="' + max + '" aria-valuenow="' + value + '" aria-label="' + cfEsc(o.label || "") + '">' +
      '<svg viewBox="0 0 100 82" aria-hidden="true">' +
      '<path class="cf-art-gauge-track" d="' + cfArtArc(50, 50, 44, from, to) + '"/>' +
      (danger ? '<path class="cf-art-gauge-danger" d="' + cfArtArc(50, 50, 44, from, from + (to - from) * danger) + '"/>' : "") +
      (pct > 0 ? '<path class="cf-art-gauge-fill" d="' + cfArtArc(50, 50, 44, from, from + (to - from) * Math.max(pct, 0.005)) + '"/>' : "") +
      (marks ? '<path class="cf-art-gauge-ticks" d="' + marks + '"/>' : "") +
      '<path class="cf-art-gauge-needle" d="M50 50L' + cfArtNum(needle[0]) + " " + cfArtNum(needle[1]) + '"/><circle class="cf-art-gauge-hub" cx="50" cy="50" r="3"/>' +
      '<text class="cf-art-gauge-value" x="50" y="72" text-anchor="middle">' + cfEsc(o.text != null ? o.text : Math.round(value)) + (o.unit ? '<tspan class="cf-art-gauge-unit"> ' + cfEsc(o.unit) + "</tspan>" : "") + "</text></svg>" +
      (o.label ? '<span class="cf-art-gauge-label">' + cfEsc(o.label) + "</span>" : "") +
      "</div>"
    );
  },

  /** A frame around HTML with drawn corners: "ornate", "tech" or "sketch". { title }. */
  frame: function (html, o) {
    o = typeof o === "string" ? { kind: o } : o || {};
    var kind = CF_ART_CORNERS[o.kind] ? o.kind : "ornate";
    var corner = function (pos) {
      return '<svg class="cf-art-corner ' + pos + '" viewBox="0 0 30 30" aria-hidden="true">' + CF_ART_CORNERS[kind] + "</svg>";
    };
    return (
      '<div class="cf-art-frame ' + kind + '">' + corner("tl") + corner("tr") + corner("bl") + corner("br") +
      (o.title ? '<div class="cf-art-frame-title">' + cfEsc(o.title) + "</div>" : "") +
      '<div class="cf-art-frame-body">' + (html || "") + "</div></div>"
    );
  },

  /** An ornamental divider: "flourish", "diamond", "circuit" or "line". */
  divider: function (kind) {
    var mid = {
      flourish: '<path d="M88 10c-6-7-14-7-18 0 4 7 12 7 18 0zm24 0c6-7 14-7 18 0-4 7-12 7-18 0z"/><circle cx="100" cy="10" r="3"/>',
      diamond: '<path d="M100 3l7 7-7 7-7-7z"/><path d="M84 10l4-4 4 4-4 4zm24 0l4-4 4 4-4 4z"/>',
      circuit: '<path d="M80 10h8l4-5h16l4 5h8"/><circle cx="100" cy="5" r="2"/>',
      line: "",
    };
    var k = mid[kind] != null ? kind : "flourish";
    return '<svg class="cf-art-divider ' + k + '" viewBox="0 0 200 20" preserveAspectRatio="xMidYMid meet" role="separator"><path class="cf-art-divider-line" d="M6 10H' + (k === "line" ? 194 : 78) + (k === "line" ? "" : "M122 10H194") + '"/>' + mid[k] + "</svg>";
  },

  /** An emblem drawn from a name: the same name, the same crest. For a faction, a house, or a portrait's fallback. { size, color }. */
  sigil: function (seed, o) {
    o = o || {};
    var rand = cfArtRng(seed);
    var fold = 3 + Math.floor(rand() * 6);
    var petal = [];
    var steps = 3 + Math.floor(rand() * 3);
    for (var i = 0; i <= steps; i++) petal.push([rand() * 12 + 2, (i / steps) * 34 + 4]);
    var shape = function (sign) { return petal.map(function (p) { return cfArtNum(50 + sign * p[0]) + " " + cfArtNum(50 - p[1]); }).join(" L"); };
    var arm = '<path d="M50 50 L' + shape(1) + " L50 " + cfArtNum(50 - petal[petal.length - 1][1]) + " L" + shape(-1).split(" L").reverse().join(" L") + ' Z"/>';
    var arms = "";
    for (var k = 0; k < fold; k++) arms += '<g transform="rotate(' + cfArtNum((360 / fold) * k) + ' 50 50)">' + arm + "</g>";
    var ring = rand() < 0.6 ? '<circle class="cf-art-sigil-ring" cx="50" cy="50" r="' + cfArtNum(40 + rand() * 6) + '"/>' : "";
    var core = rand() < 0.5 ? '<circle class="cf-art-sigil-core" cx="50" cy="50" r="' + cfArtNum(4 + rand() * 6) + '"/>' : "";
    var size = o.size || 64;
    return (
      '<svg class="cf-art-sigil" viewBox="0 0 100 100" width="' + size + '" height="' + size + '" role="img" aria-label="' + cfEsc(o.label || "Emblem of " + seed) + '"' +
      (o.color ? ' style="--cf-art-sigil:' + cfEsc(o.color) + '"' : "") + ">" + ring + '<g class="cf-art-sigil-arms">' + arms + "</g>" + core + "</svg>"
    );
  },

  /**
   * A whole map as an image (a data URL), to give CF.ui.map as its picture: "island", "dungeon" or
   * "city". { seed, places: [{ x, y }] in % (the pins go on top), roads (default true), palette:
   * "parchment", "sea", "night", "neon" or "stone", colors: { sea, land, high, line, mark, paper } }.
   */
  mapImage: function (o) {
    o = o || {};
    var w = 400;
    var h = 300;
    var kind = ["island", "dungeon", "city"].indexOf(o.kind) >= 0 ? o.kind : "island";
    var seed = o.seed == null ? kind : o.seed;
    var rand = cfArtRng(seed);
    var noise = cfArtNoise(seed);
    var pal = cfArtPalette(Object.assign({}, o, { kind: kind }));
    pal = Object.keys(pal).reduce(function (all, k) { all[k] = cfEsc(pal[k]); return all; }, {});
    var pts = cfArtPlaces(o.places, w, h, rand);
    var body = kind === "dungeon" ? cfArtDungeon(w, h, rand, pal, pts) : kind === "city" ? cfArtCity(w, h, rand, noise, pal, pts) : cfArtIsland(w, h, rand, noise, pal, pts);
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h + '">' +
      '<rect width="' + w + '" height="' + h + '" fill="' + (kind === "island" ? pal.sea : pal.paper) + '"/>' +
      body + (o.roads === false || kind === "dungeon" ? "" : cfArtRoads(pts, rand, pal)) +
      (kind === "dungeon" ? "" : cfArtCompass(w - 30, h - 34, pal)) +
      "</svg>";
    return cfArtDataUrl(svg);
  },

  /**
   * A canvas filling `el`, sized for the screen's pixel density: { canvas, ctx, width, height }
   * in CSS pixels, or null where there is no canvas. { height } in px (default 160).
   */
  canvas: function (el, o) {
    o = o || {};
    if (!el || !el.ownerDocument) return null;
    var doc = el.ownerDocument;
    var canvas = doc.createElement("canvas");
    var ctx = null;
    try {
      ctx = canvas.getContext("2d");
    } catch (e) {}
    if (!ctx) return null;
    var width = el.clientWidth || o.width || 300;
    var height = o.height || 160;
    var ratio = (doc.defaultView && doc.defaultView.devicePixelRatio) || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = "100%";
    canvas.style.height = height + "px";
    canvas.style.display = "block";
    ctx.scale(ratio, ratio);
    el.appendChild(canvas);
    return { canvas: canvas, ctx: ctx, width: width, height: height };
  },

  /** Coloured noise (clouds, fog, a nebula) drawn on a canvas, as a PNG data URL; "" where there is no canvas. { seed, size, scale, from, to }. */
  noiseImage: function (o) {
    o = o || {};
    var size = cfArtClamp(Number(o.size) || 128, 16, 512);
    var canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
    var ctx = null;
    try {
      ctx = canvas && canvas.getContext("2d");
    } catch (e) {}
    if (!ctx) return "";
    canvas.width = size;
    canvas.height = size;
    var noise = cfArtNoise(o.seed == null ? 1 : o.seed);
    var scale = Number(o.scale) || 4;
    var hex = function (c, d) { var m = /^#?([0-9a-f]{6})$/i.exec(c || ""); var v = parseInt(m ? m[1] : d, 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
    var a = hex(o.from, "101828");
    var b = hex(o.to, "8fa6d6");
    var img = ctx.createImageData(size, size);
    for (var y = 0; y < size; y++)
      for (var x = 0; x < size; x++) {
        var t = noise.fbm((x / size) * scale, (y / size) * scale, 4);
        var i = (y * size + x) * 4;
        img.data[i] = a[0] + (b[0] - a[0]) * t;
        img.data[i + 1] = a[1] + (b[1] - a[1]) * t;
        img.data[i + 2] = a[2] + (b[2] - a[2]) * t;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/png");
  },
};
