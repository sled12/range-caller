/* Course Board - screens. Logic lives in engine.js and voice.js. */
(function () {
  'use strict';
  var APP_NAME = 'Hit the Number';
  var E = window.Engine, V = window.Voice || {};
  var C = { paper: '#FFFFFF', ink: '#111111', green: '#0B6B3A', greenD: '#07502B', tint: '#E3F0E7', yellow: '#FFD21F', yellowD: '#D9A400', pale: '#FFF1B8', miss: '#E4572E', missTint: '#FAD9CF', g1: '#8A9099', g2: '#C9CDD2', g3: '#E6E8EB' };
  var NUMF = 'font-family="Barlow Condensed, Arial Narrow, sans-serif"';
  var MINUS = '−';
  var PAD = 16; // turf side padding (user units)
  var params = new URLSearchParams(location.search);
  var state;
  var ui = {
    tab: 'play', screen: 'tab', cfg: { mode: 'bag', clubId: null }, practice: null, shot: null,
    voice: 'idle', msg: false, sheet: null, returnTab: 'play', summaryId: null, lastClubId: null,
    entry: null, roll: false, firstRun: false, hints: {}, seven: 150, today: false
  };
  var stopListen = null, token = 0, timers = { result: 0, msg: 0, speak: 0 };

  /* ---------- small utilities ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fin(v) { return typeof v === 'number' && isFinite(v); }
  function rnd(v) { return fin(v) ? Math.round(v) : null; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function fmtMiss(m) { return m > 0 ? '+' + m : (m < 0 ? MINUS + (-m) : '0'); }
  function missClass(m) { return E.onTarget(m) ? 'green' : 'missc'; }
  function fmtDate(ts) { var d = new Date(ts); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }); }
  function dash(cls) { return '<span class="n34 g2 ' + (cls || '') + '">–</span>'; }
  function club(id) { return state.bag.filter(function (c) { return c.id === id; })[0] || null; }
  function onClubs() { return state.bag.filter(function (c) { return c.on; }); }
  function unit() { return state.unit === 'm' ? 'm' : 'yd'; }
  function roll() { return ui.roll ? ' roll' : ''; }
  function save() { try { E.save(state); } catch (e) { } }
  function validPractices() { return state.practices.filter(function (p) { return p.mode !== 'gap' && p.shots && p.shots.length > 0; }); }
  function gameState() { return Object.assign({}, state, { practices: state.practices.filter(function (p) { return p.mode !== 'gap'; }) }); }
  function pm(v) { return v === 0 ? '0' : '±' + Math.abs(v); }
  function isGap(p) { return !!p && p.mode === 'gap'; }
  function byTimeDesc(a, b) { return new Date(b.startedAt) - new Date(a.startedAt); }
  function hintSeen(k) { try { return localStorage.getItem('cb_hint_' + k) === '1' || ui.hints[k]; } catch (e) { return !!ui.hints[k]; } }
  function hintMark(k) { ui.hints[k] = true; try { localStorage.setItem('cb_hint_' + k, '1'); } catch (e) { } }

  /* ---------- carries (all arithmetic lives in the engine) ---------- */
  function carryOf(id) {
    var c = club(id); if (!c) return null;
    if (typeof E.carry === 'function') { try { var v = E.carry(state, id); if (fin(v)) return Math.round(v); } catch (e) { } }
    return c.stock;
  }
  function carryInfoOf(id) {
    if (typeof E.carryInfo !== 'function') return null;
    try { return E.carryInfo(state, id) || null; } catch (e) { return null; }
  }
  function setCarry(id, v) {
    var c = club(id); if (!c) return;
    if (typeof E.setStock === 'function') E.setStock(state, id, v); else c.stock = v;
    save();
  }
  function carryChanges(p) {
    if (typeof E.carryChanges !== 'function') return [];
    try { return E.carryChanges(state, p) || []; } catch (e) { return []; }
  }

  /* ---------- glyphs (inline SVG, 2.5px round strokes) ---------- */
  var ICONS = {
    flag: '<path d="M6 3v18"/><path d="M6 4h13v9H6z" fill="currentColor"/>',
    speaker: '<path d="M4 9.5v5h4l5 4v-13l-5 4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>',
    keypad: '<g fill="currentColor" stroke="none"><circle cx="6" cy="6" r="1.8"/><circle cx="12" cy="6" r="1.8"/><circle cx="18" cy="6" r="1.8"/><circle cx="6" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18" cy="12" r="1.8"/><circle cx="6" cy="18" r="1.8"/><circle cx="12" cy="18" r="1.8"/><circle cx="18" cy="18" r="1.8"/></g>',
    undo: '<path d="M9 5L4 10l5 5"/><path d="M4 10h9a5.5 5.5 0 0 1 0 11H9"/>',
    skip: '<path d="M6 5l9 7-9 7z"/><path d="M19 5v14"/>',
    stop: '<rect x="5" y="5" width="14" height="14" fill="currentColor" stroke="none"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    close: '<path d="M5 5l14 14M19 5L5 19"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    bars: '<path d="M5 19v-8M12 19V5M19 19v-5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>',
    thermo: '<path d="M10 14.2V5a2 2 0 0 1 4 0v9.2a4 4 0 1 1-4 0z"/>',
    mountain: '<path d="M3 19l6-11 4 7 3-4 5 8z"/>',
    dots: '<g fill="currentColor" stroke="none"><circle cx="6" cy="16" r="2.3"/><circle cx="12" cy="8" r="2.3"/><circle cx="18" cy="13" r="2.3"/></g>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrow: '<path d="M4 12h15M13 6l6 6-6 6"/>',
    teeball: '<circle cx="12" cy="8" r="6"/><g fill="currentColor" stroke="none"><circle cx="10" cy="6.6" r="1"/><circle cx="13.8" cy="9.2" r="1"/></g><path d="M8.5 16h7l-2 3h-3z" fill="currentColor"/><path d="M12 19v3"/>',
    noads: '<rect x="3.5" y="6.5" width="17" height="11"/><path d="M4 20L20 4"/>'
  };
  function ic(name, size, cls) {
    var s = size || 24;
    if (name === 'pin') return drawFlagSvg(s, { green: true });
    return '<svg class="ic ' + (cls || '') + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICONS[name] + '</svg>';
  }
  function cbtn(act, icon, label, opts) {
    opts = opts || {};
    return '<button type="button" class="cbtn' + (opts.primary ? ' primary' : '') + (opts.sm ? ' sm' : '') + (opts.flat ? ' flat' : '') + (opts.stop ? ' stop' : '') + '" data-act="' + act + '"' +
      (opts.data ? ' ' + opts.data : '') + ' aria-label="' + esc(label) + '">' + ic(icon, opts.size || 26) + '</button>';
  }
  function tagBtn(c, act, sel) {
    return '<button type="button" class="tag' + (sel ? ' sel' : '') + '" data-act="' + act + '" data-club="' + esc(c.id) + '" aria-pressed="' + (sel ? 'true' : 'false') + '" aria-label="' + esc(c.name || c.tag) + '">' + esc(c.tag) + '</button>';
  }
  function tagSpan(c, cls) { return '<span class="tag ring ' + (cls || '') + '" aria-label="' + esc(c ? (c.name || c.tag) : '') + '">' + esc(c ? c.tag : '') + '</span>'; }

  /* ---------- illustrated assets ---------- */
  var MOUTH = 'cx="113" cy="65" rx="13" ry="39" transform="rotate(-9 113 65)"';
  function drawDefs() { // once per page
    return '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' +
      '<pattern id="basketMesh" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0H10M0 0V10" fill="none" stroke="' + C.green + '" stroke-width="1.8"/></pattern>' +
      '<clipPath id="mouthClip"><ellipse ' + MOUTH + '/></clipPath></defs></svg>';
  }

  /* B) range ball */
  function drawBall(cx, cy, r, o) {
    o = o || {};
    var fill = o.fill || C.yellow, line = o.stroke || (o.green ? C.yellowD : C.ink), dim = o.dimple || C.yellowD;
    var s = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '" stroke="' + line + '" stroke-width="' + (o.sw || 1.5) + '"/>';
    if (r * 2 >= 8) {
      var f = function (k) { return +(k * r).toFixed(2); };
      s += '<path d="M' + (cx + f(.18)) + ' ' + (cy + f(.42)) + 'Q' + (cx + f(.52)) + ' ' + (cy + f(.5)) + ' ' + (cx + f(.64)) + ' ' + (cy + f(.14)) +
        'M' + (cx - f(.08)) + ' ' + (cy + f(.68)) + 'Q' + (cx + f(.2)) + ' ' + (cy + f(.74)) + ' ' + (cx + f(.4)) + ' ' + (cy + f(.58)) +
        '" fill="none" stroke="' + dim + '" stroke-width="' + Math.max(1, r * .15).toFixed(2) + '" stroke-linecap="round"/>';
    }
    return s;
  }
  function ballSvg(size, o) {
    return '<svg class="ballsvg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' + drawBall(size / 2, size / 2, size / 2 - 1.5, o) + '</svg>';
  }

  function ringSvg(size) {
    return '<svg class="ballsvg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + (size / 2 - 2) + '" fill="none" stroke="' + C.g2 + '" stroke-width="2.5"/></svg>';
  }

  /* C) pin flag: pole + rectangular flag + hole; x is the pole, base the turf edge */
  function drawFlag(x, base, h, o) {
    o = o || {};
    var pole = o.green ? C.paper : C.ink, fh = Math.round(h * .32), fw = Math.round(fh * 1.5);
    return '<ellipse cx="' + x + '" cy="' + (base + 1) + '" rx="5" ry="2.2" fill="' + C.ink + '"/>' +
      '<line x1="' + x + '" y1="' + (base - h) + '" x2="' + x + '" y2="' + base + '" stroke="' + pole + '" stroke-width="2.5"/>' +
      '<g class="cloth' + (o.flutter ? ' flutter' : '') + '"><rect x="' + (x + 2.25) + '" y="' + (base - h + 1) + '" width="' + fw + '" height="' + fh + '" fill="' + C.yellow + '" stroke="' + C.green + '" stroke-width="2"/>' +
      '<circle cx="' + (x + 2.25 + fw / 2) + '" cy="' + (base - h + 1 + fh / 2) + '" r="' + Math.max(1.8, fh * .2).toFixed(1) + '" fill="' + C.green + '"/></g>';
  }
  function drawFlagSvg(h, o) {
    var fh = Math.round(h * .32), fw = Math.round(fh * 1.5), w = 6 + 2.25 + fw + 4;
    return '<svg class="ic" width="' + w + '" height="' + (h + 4) + '" viewBox="0 0 ' + w + ' ' + (h + 4) + '" aria-hidden="true" focusable="false">' + drawFlag(6, h + 1, h, o) + '</svg>';
  }

  /* Logo: a range basket tipped on its side (mouth facing right), balls spilling out onto the ground */
  var BODY = '44,104 118,104 106,26 38,58';
  function logoInner(simple) {
    var s = '', ink = C.ink;
    var ball = function (x, y, r) { return drawBall(x, y, r, { sw: 1.8 }); };
    if (simple) { // small sizes: solid shapes, no mesh, bigger balls
      s += '<polygon points="' + BODY + '" fill="' + C.green + '"/>' +
        '<ellipse ' + MOUTH + ' fill="' + C.greenD + '" stroke="' + C.tint + '" stroke-width="5"/>' +
        '<line x1="0" y1="104" x2="200" y2="104" stroke="' + ink + '" stroke-width="4"/>';
      [[126, 88, 13], [152, 90, 13], [138, 64, 13], [182, 91, 12]].forEach(function (p) { s += drawBall(p[0], p[1], p[2], { sw: 4 }); });
      return s;
    }
    s += '<path d="M106 28C150 30 150 96 122 103" fill="none" stroke="' + C.green + '" stroke-width="3" stroke-linecap="round"/>';
    s += '<polygon points="' + BODY + '" fill="' + C.tint + '"/><polygon points="' + BODY + '" fill="url(#basketMesh)"/>' +
      '<path d="M38 58L106 26M44 102.5L118 102.5" fill="none" stroke="' + C.green + '" stroke-width="3" stroke-linecap="round"/>' +
      '<ellipse cx="41" cy="81" rx="5" ry="23" transform="rotate(-7 41 81)" fill="' + C.green + '"/>';
    s += '<ellipse ' + MOUTH + ' fill="#C5DCCD"/>' +
      '<g clip-path="url(#mouthClip)"><ellipse ' + MOUTH + ' fill="' + C.greenD + '"/><ellipse cx="116.5" cy="65" rx="13" ry="39" transform="rotate(-9 116.5 65)" fill="#C5DCCD"/>';
    [[117, 95], [107, 82], [121, 80]].forEach(function (p) { s += ball(p[0], p[1], 8); });
    s += '</g><ellipse ' + MOUTH + ' fill="none" stroke="' + C.green + '" stroke-width="5"/>';
    s += '<line x1="0" y1="104" x2="200" y2="104" stroke="' + ink + '" stroke-width="2.5"/>';
    [[143, 67], [140, 82], [156, 81], [190, 97]].forEach(function (p) { s += ball(p[0], p[1], 8); });
    [[149, 97], [164, 96], [177, 96]].forEach(function (p) { s += ball(p[0], p[1], 8); });
    s += ball(134, 96, 8);
    return s;
  }
  function drawLogo(size) {
    return '<svg class="logo" viewBox="0 0 200 120" width="' + size + '" height="' + Math.round(size * .6) + '" aria-hidden="true" focusable="false">' + logoInner(size < 64) + '</svg>';
  }

  function lockup(size, cls) {
    return '<div class="lockup' + (cls ? ' ' + cls : '') + '">' + drawLogo(size) + '<span class="wordmark">' + esc(APP_NAME) + '</span></div>';
  }

  /* turf: a 14px green band with white tick marks inside and numerals below */
  function drawTurf(x0, x1, base, ticks, labels) {
    var s = '<rect x="' + x0 + '" y="' + base + '" width="' + (x1 - x0) + '" height="14" fill="' + C.green + '"/><rect x="' + x0 + '" y="' + (base + 11) + '" width="' + (x1 - x0) + '" height="3" fill="' + C.greenD + '"/>';
    ticks.forEach(function (t) { s += '<line x1="' + t.x + '" y1="' + (base + 11) + '" x2="' + t.x + '" y2="' + (base + 11 - (t.tall ? 7 : 4)) + '" stroke="' + C.paper + '" stroke-width="1.5"/>'; });
    (labels || []).forEach(function (l) { s += '<text x="' + l.x + '" y="' + (base + 14 + (l.big ? 19 : 15)) + '" ' + NUMF + ' font-weight="500" text-anchor="middle" font-size="' + (l.big ? 20 : 13) + '" fill="' + (l.col || C.g1) + '">' + l.t + '</text>'; });
    return s;
  }
  function turfX(o, v) { return PAD + (v - o.min) / (o.max - o.min) * (o.w - 2 * PAD); }
  function turfTicks(o, center, lo) {
    var out = [];
    for (var k = Math.ceil((lo - center) / 5); k <= Math.floor((o.max - center) / 5); k++) out.push({ x: turfX(o, center + k * 5), tall: (k * 5) % 10 === 0 });
    return out;
  }
  function segInner(fx, bx, base, miss) {
    var x = Math.min(fx, bx), w = Math.abs(bx - fx);
    if (w < 1) return '';
    return E.onTarget(miss) ? '<rect x="' + (x - 1) + '" y="' + (base - 6) + '" width="' + (w + 2) + '" height="6" fill="' + C.ink + '"/><rect x="' + x + '" y="' + (base - 5) + '" width="' + w + '" height="4" fill="' + C.yellow + '"/>' :
      '<rect x="' + x + '" y="' + (base - 4) + '" width="' + w + '" height="4" fill="' + C.miss + '"/>';
  }
  function rulerSvg(o) {
    var base = 62, h = 102, lo = Math.max(o.min, 1), fx = turfX(o, o.target), bx = turfX(o, clamp(o.actual, lo, o.max)), R = 10;
    var s = '<svg class="ruler' + (o.drag ? ' drag-able' : '') + '" viewBox="0 0 ' + o.w + ' ' + h + '" data-min="' + o.min + '" data-lo="' + lo + '" data-max="' + o.max + '" data-w="' + o.w + '" data-target="' + o.target + '"' + (o.gap ? ' data-gap="1"' : '') +
      (o.drag ? ' tabindex="0" role="slider" aria-label="Distance" aria-valuemin="' + lo + '" aria-valuemax="' + o.max + '" aria-valuenow="' + o.actual + '"' : ' aria-hidden="true"') + '>';
    var labels = [], X = function (v) { return turfX(o, v); };
    if (o.scale) [-20, -10, 10, 20].forEach(function (d) { if (o.target + d >= lo) labels.push({ x: turfX(o, o.target + d), t: o.target + d }); });
    if (o.label) labels.push({ x: fx, t: o.target, big: true, col: C.ink });
    if (o.gap) labels.push({ x: fx, t: o.target, big: true, col: C.g1 });
    s += drawTurf(turfX(o, lo), turfX(o, o.max), base, turfTicks(o, o.target, lo), labels);
    var miss = o.actual - o.target, anim = o.animate ? ' style="transform:scaleX(0);transform-origin:' + fx + 'px ' + base + 'px"' : '';
    if (o.gap) { // no target: a short grey tick marks the carry, earlier balls rest on the turf
      s += '<g class="seg"></g><rect x="' + (fx - 1.5) + '" y="' + (base - 26) + '" width="3" height="26" fill="' + C.g1 + '"/>' +
        stackBalls((o.cluster || []).map(function (v) { return clamp(v, lo, o.max); }), X, base, 5);
    } else {
      s += '<g class="seg"' + anim + '>' + segInner(fx, bx, base, miss) + '</g>';
      s += drawFlag(fx, base, 46, { flutter: o.flutter && E.onTarget(miss) });
    }
    s += '<g class="ball"' + (o.animate ? '' : ' style="transform:translateX(' + (bx - fx) + 'px)"') + ' data-dx="' + (bx - fx) + '">' + drawBall(fx, base - R, R) + '</g>';
    return s + '</svg>';
  }
  function updateRuler(svg, actual) {
    var o = { min: +svg.getAttribute('data-min'), max: +svg.getAttribute('data-max'), w: +svg.getAttribute('data-w') }, t = +svg.getAttribute('data-target'), lo = +svg.getAttribute('data-lo');
    var fx = turfX(o, t), bx = turfX(o, clamp(actual, lo, o.max));
    $('.ball', svg).style.transform = 'translateX(' + (bx - fx) + 'px)';
    if (!svg.hasAttribute('data-gap')) $('.seg', svg).innerHTML = segInner(fx, bx, 62, actual - t);
    svg.setAttribute('aria-valuenow', actual);
  }
  function slideIn(svg) {
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      var b = $('.ball', svg), s = $('.seg', svg); if (!b) return;
      b.style.transform = 'translateX(' + b.getAttribute('data-dx') + 'px)'; if (s) s.style.transform = 'scaleX(1)';
    }); });
  }
  function stackBalls(values, X, base, r, o) { // range balls resting on the turf, stacked on collisions
    var placed = [], s = '';
    values.slice().sort(function (a, b) { return a - b; }).forEach(function (v) {
      var x = X(v), k = 0;
      for (;;) { var hit = placed.some(function (p) { return p.k === k && Math.abs(p.x - x) < 2 * r; }); if (!hit) break; k++; }
      placed.push({ x: x, k: k });
      s += drawBall(x, base - r - .5 - k * 2 * r, r, o);
    });
    return s;
  }
  function dotStrip(misses, w, h, R) {
    var cx = w / 2, s = '<svg class="strip" viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">';
    s += '<line x1="' + cx + '" y1="3" x2="' + cx + '" y2="' + (h - 3) + '" stroke="' + C.g2 + '" stroke-width="2" stroke-linecap="round"/>';
    misses.forEach(function (m) { s += '<circle cx="' + (cx + clamp(m / R, -1, 1) * (cx - 5)) + '" cy="' + (h / 2) + '" r="3.5" fill="' + C.ink + '" fill-opacity=".85"/>'; });
    return s + '</svg>';
  }
  function sparkline(pts, w, h, big) {
    if (!pts.length) return '';
    var r = big ? 5 : 3, rl = big ? 8 : 6, tp = big ? 34 : 14, max = Math.max(10, Math.max.apply(null, pts.map(function (p) { return p.avgMiss; })));
    var px = function (i) { return pts.length === 1 ? w / 2 : 10 + i * (w - 20) / (pts.length - 1); };
    var py = function (v) { return h - 10 - clamp(v / max, 0, 1) * (h - tp - 10); };
    var s = '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + (big ? '100%' : w) + '"' + (big ? '' : ' height="' + h + '"') + ' aria-hidden="true">';
    if (big) s += '<line x1="0" y1="' + py(E.TOLERANCE) + '" x2="' + w + '" y2="' + py(E.TOLERANCE) + '" stroke="' + C.g3 + '" stroke-width="2"/>';
    if (pts.length > 1) s += '<polyline fill="none" stroke="' + C.ink + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="' + pts.map(function (p, i) { return px(i) + ',' + py(p.avgMiss); }).join(' ') + '"/>';
    pts.forEach(function (p, i) { if (i < pts.length - 1) s += '<circle cx="' + px(i) + '" cy="' + py(p.avgMiss) + '" r="' + r + '" fill="' + C.ink + '"/>'; });
    s += drawBall(px(pts.length - 1), py(pts[pts.length - 1].avgMiss), rl);
    if (big) {
      var lab = function (i, anchor, x, fill) { return '<text x="' + x + '" y="' + Math.max(16, py(pts[i].avgMiss) - 14) + '" text-anchor="' + anchor + '" ' + NUMF + ' font-weight="500" font-size="20" fill="' + fill + '">' + pm(Math.round(pts[i].avgMiss)) + '</text>'; };
      if (pts.length > 1) s += lab(0, 'start', 2, C.ink);
      s += lab(pts.length - 1, 'end', w - 2, C.green);
    }
    return s + '</svg>';
  }
  function hitCount(n) { // top-left: one small range ball and the number of balls hit; nothing at zero
    return '<div class="hit">' + (n > 0 ? ballSvg(18) + '<span class="n20">' + n + '</span>' : '') + '</div>';
  }
  function dotPlot(misses) {
    var W = 342, H = 140, base = 84, r = 5, cx = W / 2;
    var maxAbs = Math.max.apply(null, misses.map(Math.abs).concat([0])), R = Math.max(15, Math.ceil(maxAbs / 5) * 5);
    var X = function (m) { return cx + clamp(m / R, -1, 1) * (cx - 12); };
    var ticks = [], labels = [];
    for (var t = -R; t <= R; t += 5) ticks.push({ x: X(t), tall: t % 10 === 0 });
    [-10, 0, 10].forEach(function (t) { if (Math.abs(t) <= R) labels.push({ x: X(t), t: t > 0 ? '+' + t : t < 0 ? MINUS + (-t) : '0' }); });
    var s = '<svg class="dotplot" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Shots">';
    s += drawTurf(0, W, base, ticks, labels) + drawFlag(cx, base, 46);
    s += '<text x="0" y="' + (H - 4) + '" font-family="Atkinson Hyperlegible, sans-serif" font-size="13" fill="' + C.g1 + '">Short</text>';
    s += '<text x="' + W + '" y="' + (H - 4) + '" text-anchor="end" font-family="Atkinson Hyperlegible, sans-serif" font-size="13" fill="' + C.g1 + '">Long</text>';
    s += stackBalls(misses, X, base, r);
    return s + '</svg>';
  }
  function hint(key, text, up) {
    if (hintSeen(key)) return '';
    return '<div class="hint' + (up ? ' up' : '') + '" data-act="hint" data-key="' + key + '" role="note">' + esc(text) + '</div>';
  }
  function adSlot() {
    if (state.pro) return '';
    return '<div class="adslot"><span class="adword">Ad</span><button type="button" data-act="upgrade" aria-label="Remove ads">' + ic('close', 20) + '</button></div>';
  }
  function micSvg(mode) { // mode: listening | idle | blocked
    var cx = 48, cy = 40, col = mode === 'listening' ? C.ink : C.g2;
    function arc(r, cls) {
      function pt(a) { return (cx + r * Math.cos(a * Math.PI / 180)).toFixed(1) + ' ' + (cy + r * Math.sin(a * Math.PI / 180)).toFixed(1); }
      return '<path class="arc ' + cls + '" stroke="' + C.green + '" d="M' + pt(-40) + ' A' + r + ' ' + r + ' 0 0 1 ' + pt(40) + '"/><path class="arc ' + cls + '" stroke="' + C.green + '" d="M' + pt(220) + ' A' + r + ' ' + r + ' 0 0 0 ' + pt(140) + '"/>';
    }
    var s = '<svg viewBox="0 0 96 96" width="96" height="96" fill="none" stroke="' + col + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="' + mode + '">';
    s += '<rect x="39" y="18" width="18" height="34" rx="9"/><path d="M30 42a18 18 0 0 0 36 0M48 62v14"/>';
    if (mode === 'listening') s += arc(34, 'a1') + arc(44, 'a2') + arc(54, 'a3');
    if (mode === 'blocked') s += '<path d="M22 10L74 82" stroke-width="3"/>';
    return s + '</svg>';
  }

  /* ---------- screens ---------- */
  function viewPlay() {
    var tr = E.trend(gameState()) || [], recent = tr.slice(-3), cfg = ui.cfg, avg = null;
    if (recent.length) avg = Math.round(recent.reduce(function (a, p) { return a + Math.abs(p.avgMiss); }, 0) / recent.length);
    var head = avg == null ? '<div class="headline"><span class="num headline-num g2">–</span></div>' :
      '<div class="headline"><span class="num headline-num' + roll() + '">' + pm(avg) + '</span><span class="unit">' + unit() + '</span></div>';
    var chips = '<button type="button" class="tag' + (cfg.mode === 'bag' ? ' sel' : '') + '" data-act="pickclub" data-club="all" aria-pressed="' + (cfg.mode === 'bag') + '" aria-label="Whole bag">' + ic('bars', 28) + '</button>' +
      onClubs().map(function (c) { return tagBtn(c, 'pickclub', cfg.mode === 'club' && cfg.clubId === c.id); }).join('');
    return '<div class="group">' + lockup(96) + '<div class="headblock">' + head + sparkline(tr.slice(-12), 150, 48) + '</div>' +
      '<div class="chips play" role="group" aria-label="Club">' + chips + '</div>' +
      cbtn('start', 'pin', 'Start', { primary: true, size: 44 }) + '</div>';
  }

  function micMode() { return ui.voice === 'listening' ? 'listening' : (ui.voice === 'blocked' || ui.voice === 'unsupported') ? 'blocked' : 'idle'; }
  function micBlock(mode, hintKey, hintText) { // the hint only shows once listening has really started
    return '<div class="micwrap">' + (mode === 'listening' ? hint(hintKey, hintText) : '') +
      '<button type="button" class="micbtn" data-act="mic" aria-label="Microphone">' + micSvg(mode) + '</button>' +
      '<div class="msg" aria-live="polite">' + (ui.msg ? 'Couldn\'t hear that' : '') + '</div></div>';
  }
  function controlRow(noVoice) {
    return '<div class="btnrow">' + cbtn('close', 'stop', 'Stop', { stop: true }) + cbtn('repeat', 'speaker', 'Repeat') +
      cbtn('keypad', 'keypad', 'Enter distance', { primary: noVoice, sm: noVoice, size: 26 }) + cbtn('skip', 'skip', 'Skip') + '</div>';
  }

  function viewCallout() {
    var p = ui.practice, t = p.currentTarget, mode = micMode();
    if (isGap(p)) return viewGapCallout();
    return hitCount(p.shots.length) +
      '<div class="flagtop">' + drawFlagSvg(44) + '</div>' +
      '<div class="hero-wrap"><span class="num hero' + roll() + '">' + t + '</span><span class="unit">' + unit() + '</span></div>' +
      micBlock(mode, 'callout', 'Say the club and the distance') + controlRow(mode === 'blocked');
  }

  /* gapping: the app calls a club */
  function gapProg(p) {
    var g = null;
    try { g = E.gapProgress(state, p); } catch (e) { }
    return g || { clubId: p.currentClubId, hit: 0, block: E.GAP_BLOCK || 5 };
  }
  function viewGapCallout() {
    var p = ui.practice, gp = gapProg(p), c = club(gp.clubId), mode = micMode(), prog = '', i;
    if (p.clubId) prog = '<div class="gapcount">' + ballSvg(24) + '<span class="n34">' + p.shots.length + '</span></div>';
    else {
      for (i = 0; i < gp.block; i++) prog += i < gp.hit ? ballSvg(22) : ringSvg(22);
      prog = '<div class="gapblock" aria-hidden="true">' + prog + '</div>';
    }
    return hitCount(p.shots.length) +
      '<div class="gapmid"><button type="button" class="tag ring huge' + roll() + '" data-act="gapclubs" aria-label="' + esc(c ? c.name || c.tag : '') + '">' + esc(c ? c.tag : '') + '</button>' +
      '<div class="gapcarry"><span class="n34 g1">' + (c ? carryOf(c.id) : '') + '</span><span class="unit">' + unit() + '</span></div>' + prog + '</div>' +
      micBlock(mode, 'gapcallout', 'Hit your normal shot. Say the distance.') + controlRow(mode === 'blocked');
  }

  function viewEntry() {
    var p = ui.practice, en = ui.entry;
    if (isGap(p)) return viewGapEntry();
    var t = p.currentTarget, miss = en.actual - t;
    var clubs = p.mode === 'club' ? [club(p.clubId)].filter(Boolean) : onClubs();
    var rng = { min: t - 30, max: t + 30, w: 342, target: t, actual: en.actual, drag: true, scale: true };
    return '<div class="topline">' + drawFlagSvg(34) + '<span class="n34">' + t + '</span><span class="unit" style="margin-left:0">' + unit() + '</span></div>' +
      '<div class="stepper">' + cbtn('noop', 'minus', 'Less', { data: 'data-hold="actual:-1"' }) +
      '<span class="num entry-num" id="entryNum" aria-live="polite">' + en.actual + '</span>' +
      cbtn('noop', 'plus', 'More', { data: 'data-hold="actual:1"' }) + '</div>' +
      '<div class="missline ' + missClass(miss) + '" id="entryMiss">' + fmtMiss(miss) + '</div>' +
      '<div class="ruler-wrap"><div id="entryRuler">' + rulerSvg(rng) + '</div>' + hint('entry', 'Drag the ball', true) + '</div>' +
      '<div class="chips" role="group" aria-label="Club" id="entryChips">' + clubs.map(function (c) { return tagBtn(c, 'entryclub', en.clubId === c.id); }).join('') + '</div>' +
      '<div class="bottom">' + cbtn('confirm', 'check', 'Confirm', { primary: true, size: 40 }) + '</div>';
  }
  function gapCluster(p, clubId, skip) {
    return p.shots.filter(function (x) { return x !== skip && x.clubId === clubId && fin(x.actual); }).map(function (x) { return x.actual; });
  }
  function viewGapEntry() {
    var p = ui.practice, en = ui.entry, cv = carryOf(en.clubId);
    var clubs = p.clubId ? [club(p.clubId)].filter(Boolean) : onClubs();
    var rng = { min: cv - 30, max: cv + 30, w: 342, target: cv, actual: en.actual, drag: true, scale: true, gap: true, cluster: gapCluster(p, en.clubId) };
    return '<div class="stepper" style="margin-top:calc(var(--w)*.14)">' + cbtn('noop', 'minus', 'Less', { data: 'data-hold="actual:-1"' }) +
      '<span class="num entry-num" id="entryNum" aria-live="polite">' + en.actual + '</span>' +
      cbtn('noop', 'plus', 'More', { data: 'data-hold="actual:1"' }) + '</div>' +
      '<div class="ruler-wrap gapw"><div id="entryRuler">' + rulerSvg(rng) + '</div>' + hint('entry', 'Drag the ball', true) + '</div>' +
      '<div class="chips" role="group" aria-label="Club" id="entryChips">' + clubs.map(function (c) { return tagBtn(c, 'entryclub', en.clubId === c.id); }).join('') + '</div>' +
      '<div class="bottom">' + cbtn('confirm', 'check', 'Confirm', { primary: true, size: 40 }) + '</div>';
  }
  function updateEntry() {
    var en = ui.entry, p = ui.practice, gap = isGap(p), t = gap ? carryOf(en.clubId) : p.currentTarget, miss = en.actual - t;
    $('#entryNum').textContent = en.actual;
    var m = $('#entryMiss'); if (m) { m.textContent = fmtMiss(miss); m.className = 'missline ' + missClass(miss); }
    updateRuler($('#entryRuler .ruler'), en.actual);
  }

  function viewResult() {
    var p = ui.practice, s = ui.shot;
    if (isGap(p)) return viewGapResult();
    var m = E.miss(s), R = Math.max(30, Math.ceil(Math.abs(m) / 10) * 10), c = club(s.clubId);
    var rng = { min: s.target - R, max: s.target + R, w: 342, target: s.target, actual: s.actual, animate: true, label: true, flutter: true };
    return hitCount(p.shots.length) + '<div class="tapzone resgroup" data-act="advance">' +
      '<div class="topline">' + (c ? tagSpan(c) : '') + '</div>' +
      '<div class="hero-wrap" style="margin-top:calc(var(--w)*.04)"><span class="num result-num' + roll() + '">' + s.actual + '</span><span class="unit">' + unit() + '</span></div>' +
      '<div class="missline ' + missClass(m) + roll() + '">' + fmtMiss(m) + '</div>' +
      '<div class="ruler-wrap rw40" id="resultRuler">' + rulerSvg(rng) + '</div>' +
      '<div class="btnrow" style="margin-top:24px">' + cbtn('undo', 'undo', 'Undo') + '</div></div>';
  }
  function viewGapResult() { // no target: the distance, the carry tick and the new ball rolling in beside earlier ones
    var p = ui.practice, s = ui.shot, c = club(s.clubId), cv = fin(ui.gapCarry) ? ui.gapCarry : carryOf(s.clubId);
    var R = Math.max(30, Math.ceil(Math.abs(s.actual - cv) / 10) * 10);
    var rng = { min: cv - R, max: cv + R, w: 342, target: cv, actual: s.actual, animate: true, scale: true, gap: true, cluster: gapCluster(p, s.clubId, s) };
    return hitCount(p.shots.length) + '<div class="tapzone resgroup" data-act="advance">' +
      '<div class="topline">' + (c ? tagSpan(c) : '') + '</div>' +
      '<div class="hero-wrap" style="margin-top:calc(var(--w)*.04)"><span class="num result-num' + roll() + '">' + s.actual + '</span><span class="unit">' + unit() + '</span></div>' +
      '<div class="ruler-wrap rw40" id="resultRuler">' + rulerSvg(rng) + '</div>' +
      '<div class="btnrow" style="margin-top:24px">' + cbtn('undo', 'undo', 'Undo') + '</div></div>';
  }

  function practiceById(id) { return state.practices.filter(function (p) { return p.id === id; })[0]; }
  function changeRows(p) {
    return carryChanges(p).map(function (x) {
      var c = club(x.clubId) || { tag: x.tag, name: x.tag };
      return '<div class="changerow">' + tagSpan(c, 'sm') + '<span class="n34 g1">' + Math.round(x.before) + '</span><span class="g1">' + ic('arrow', 18) + '</span><span class="n34">' + Math.round(x.after) + '</span></div>';
    }).join('');
  }
  function viewSummary() {
    var p = practiceById(ui.summaryId);
    if (isGap(p)) return viewGapSummary(p);
    var sh = p ? p.shots : [], s = E.summary(sh) || {}, misses = sh.map(E.miss);
    var avg = rnd(s.avgMiss), prev = null, list = validPractices().sort(function (a, b) { return -byTimeDesc(a, b); });
    var idx = list.indexOf(p); if (idx > 0) prev = rnd(E.summary(list[idx - 1].shots).avgMiss);
    var cmp = '';
    if (avg != null && prev != null) {
      var d = avg - prev;
      cmp = d === 0 ? '<span class="fact"><span class="n34 g1">0</span></span>' :
        '<span class="fact"><span class="' + (d < 0 ? 'green' : 'missc') + '">' + ic(d < 0 ? 'down' : 'up', 28) + '</span><span class="n34 ' + (d < 0 ? 'green' : 'missc') + '">' + fmtMiss(d) + '</span></span>';
    }
    var rows = (s.byClub || []).map(function (b) {
      var c = club(b.clubId), ms = sh.filter(function (x) { return x.clubId === b.clubId; }).map(E.miss), a = rnd(b.avgMiss);
      return '<div class="clubrow">' + (c ? tagSpan(c, 'sm') : '<span class="tag sm"></span>') + dotStrip(ms, 160, 22, 20) + (a == null ? dash() : '<span class="n34">' + pm(a) + '</span>') + '</div>';
    }).join('');
    return dotPlot(misses) +
      '<div class="avgrow">' + (avg == null ? '<span class="num headline-num g2">–</span>' : '<span class="num headline-num' + roll() + '">' + pm(avg) + '</span>') + '<span class="unit">' + unit() + '</span></div>' +
      '<div class="facts"><span class="fact">' + ballSvg(28) + '<span class="n34">' + (fin(s.count) ? s.count : sh.length) + '</span></span>' + cmp + '</div>' +
      '<div class="clubrows">' + rows + '</div>' + adSlot() +
      '<div class="stickybar">' + cbtn('summarydone', 'check', 'Done', { primary: true, size: 40 }) + '</div>';
  }
  /* shared gapping list: one row per club, each with its own zoomed range (4px per unit, reduced per row if it would not fit).
     items: {id, tag, lo, hi, v, num, n, counted}; gaps[i]: {value, flag} between items i and i+1 */
  function gapList(items, gaps, tap, side) {
    var avail = Math.min(window.innerWidth, 390) - side * 2 - 48 - 96 - 24, LW = 28;
    var hollow = '<svg class="mk" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="' + C.paper + '" stroke="' + C.g2 + '" stroke-width="2.5"/></svg>';
    var rows = items.map(function (c, i) {
      var trk;
      if (!c.counted) trk = '<span class="trk"><span class="mk" style="left:50%">' + hollow + '</span></span>';
      else if (!(c.n >= 2) || !(c.hi > c.lo)) trk = '<span class="trk"><span class="mk" style="left:50%">' + ballSvg(13, { sw: 1.2 }) + '</span></span>';
      else {
        var lo = Math.min(c.lo, c.v), hi = Math.max(c.hi, c.v), half = Math.max(c.v - lo, hi - c.v, 1);
        var s = Math.min(4, Math.max(0.5, (avail / 2 - LW - 4) / half));
        trk = '<span class="trk"><i class="bar" style="left:calc(50% + ' + ((lo - c.v) * s).toFixed(1) + 'px);width:' + Math.max(2, (hi - lo) * s).toFixed(1) + 'px"></i>' +
          '<span class="lab" style="right:calc(50% + ' + ((c.v - lo) * s + 4).toFixed(1) + 'px)">' + Math.round(lo) + '</span>' +
          '<span class="lab" style="left:calc(50% + ' + ((hi - c.v) * s + 4).toFixed(1) + 'px)">' + Math.round(hi) + '</span>' +
          '<span class="mk" style="left:50%">' + ballSvg(13, { sw: 1.2 }) + '</span></span>';
      }
      var inner = '<span class="tagc">' + tagSpan({ tag: c.tag }) + '</span>' + trk +
        '<span class="rc"><span class="rn"><span class="rnum">' + c.num + '</span><span class="ru">' + unit() + '</span></span>' +
        (c.sub != null ? (c.sub ? '<span class="rs"><span>' + c.sub + '</span></span>' : '') : c.n > 0 ? '<span class="rs">' + ballSvg(14, { sw: 1.2 }) + '<span>' + c.n + '</span></span>' : '') + '</span>';
      var row = tap ? '<button type="button" class="brow" data-act="clubsheet" data-club="' + esc(c.id) + '" aria-label="' + esc(c.tag) + ' ' + c.num + '">' + inner + '</button>' : '<div class="brow">' + inner + '</div>';
      var gp = gaps[i];
      if (!items[i + 1]) return row;
      var has = gp && fin(gp.value);
      return row + '<div class="grow"><i class="hl"></i>' + (has && gp.flag ? '<i class="hl flag"></i>' : '') +
        (has ? '<span class="gn' + (gp.flag ? ' flag' : '') + '">' + Math.round(Math.abs(gp.value)) + '</span>' : '') + '</div>';
    }).join('');
    return { rows: rows };
  }

  function viewGapSummary(p) { // one row per club hit, in the language of the Bag list
    var g = {};
    try { g = E.gapSummary(state, p) || {}; } catch (e) { }
    var cl = (g.clubs || []).filter(function (c) { return fin(c.avg); }), total = fin(g.count) ? g.count : p.shots.length, list = '';
    if (cl.length) {
      var items = cl.map(function (c) {
        return { id: c.clubId, tag: c.tag, lo: fin(c.lo) ? c.lo : c.avg, hi: fin(c.hi) ? c.hi : c.avg, v: c.avg, x: c.avg, num: Math.round(c.avg), n: c.count, counted: true };
      });
      var gaps = items.slice(0, -1).map(function (c, i) {
        var v = c.v - items[i + 1].v; return { value: v, flag: Math.abs(v) < 8 ? 'tight' : (Math.abs(v) > 20 ? 'wide' : null) };
      });
      var gl = gapList(items, gaps, false, 24);
      list = '<div class="blist">' + gl.rows + '</div>';
    }
    return '<div class="gsum" style="margin-top:8px">' + list + '</div><div class="clubrows">' + changeRows(p) + '</div>' +
      '<div class="facts"><span class="fact">' + ballSvg(28) + '<span class="n34">' + total + '</span></span></div>' +
      '<div class="stickybar">' + cbtn('summarydone', 'check', 'Done', { primary: true, size: 40 }) + '</div>';
  }

  function todayOn() { return ui.today && typeof E.gappingToday === 'function' && typeof E.conditionsDisplay === 'function'; }
  function seg(act, v, on, inner, label) {
    return '<button type="button" data-act="' + act + '" data-v="' + v + '" aria-pressed="' + on + '" aria-label="' + label + '">' + inner + '</button>';
  }
  function condText(d) { return d ? { t: d.temp + '\u00B0' + d.tempUnit, e: d.elevation + ' ' + d.elevationUnit } : { t: '', e: '' }; }
  function viewBag() {
    var tOn = todayOn(), can = typeof E.gappingToday === 'function';
    var g = (tOn ? E.gappingToday(state) : E.gapping(state)) || { clubs: [], gaps: [] }, cl = g.clubs || [];
    var left = can ? '<div class="units" role="group" aria-label="View">' + seg('bagview', 'bag', !tOn, ic('bars', 24), 'Bag') +
      seg('bagview', 'today', tOn, ic('sun', 22) + '<span>Today</span>', 'Today') + '</div>' : '<span class="title" style="opacity:0">.</span>';
    var head = '<div class="pagehead">' + left + '<div class="units" role="group" aria-label="Unit">' +
      ['yd', 'm'].map(function (u) { return '<button type="button" data-act="unit" data-u="' + u + '" aria-pressed="' + (unit() === u) + '">' + u + '</button>'; }).join('') + '</div></div>';
    if (tOn) {
      var ct = condText(E.conditionsDisplay(state));
      head += '<button type="button" class="strip" data-act="condsheet" aria-label="Change conditions"><span class="si">' + ic('thermo', 24) + '<span>' + ct.t + '</span></span><span class="si">' + ic('mountain', 24) + '<span>' + ct.e + '</span></span></button>';
    }
    if (!cl.length) return head;
    var cv = function (c) { return fin(c.carry) ? c.carry : carryOf(c.clubId); };
    var counted = function (c) { return c.n > 0 && fin(c.avg); };
    var items = cl.map(function (c) {
      var k = counted(c);
      var it = { id: c.clubId, tag: c.tag, lo: k && fin(c.lo) ? c.lo : cv(c), hi: k && fin(c.hi) ? c.hi : cv(c), v: k ? c.avg : cv(c), x: cv(c),
        num: Math.round(c.n >= 5 && fin(c.avg) ? c.avg : cv(c)), n: c.n, counted: k };
      if (tOn) { var d = Math.round(c.delta || 0); it.sub = d > 0 ? '+' + d : d < 0 ? '\u2212' + Math.abs(d) : ''; }
      return it;
    });
    var gaps = cl.map(function (c, i) {
      var n = cl[i + 1]; if (!n) return null;
      return (g.gaps || []).filter(function (x) { return (x.upperId === c.clubId && x.lowerId === n.clubId) || (x.upperId === n.clubId && x.lowerId === c.clubId); })[0] || null;
    });
    var gl = gapList(items, gaps, true, 20);
    return head +
      '<div class="blist bagl">' + gl.rows + '</div>' +
      '<div class="bottom">' + cbtn('gapstart', 'teeball', 'Measure your clubs', { primary: true, size: 44 }) + '</div>';
  }

  function bestCol(txt, cap, u) {
    return '<div class="best"><div class="bn">' + (txt == null ? dash() : '<span class="n34">' + txt + '</span>' + (u ? '<span class="unit sm13">' + unit() + '</span>' : '')) + '</div><span class="cap">' + cap + '</span></div>';
  }
  function viewShots() {
    var gs = gameState(), b = E.bests(gs) || {}, tr = E.trend(gs) || [];
    var avg = b.avgMiss && fin(b.avgMiss.value) ? Math.round(b.avgMiss.value) : null;
    var run = b.streak && fin(b.streak.value) ? Math.round(b.streak.value) : null;
    var cl = b.closest && b.closest.shot ? fmtMiss(E.miss(b.closest.shot)) : null;
    var list = validPractices().sort(byTimeDesc), rows = '';
    list.forEach(function (p, i) {
      var s = E.summary(p.shots) || {}, a = rnd(s.avgMiss), c = p.mode === 'club' ? club(p.clubId) : null;
      rows += '<button type="button" class="prow" data-act="openprac" data-id="' + esc(p.id) + '" aria-label="' + fmtDate(p.startedAt) + '">' +
        '<span class="date">' + fmtDate(p.startedAt) + '</span><span class="lead">' + (c ? tagSpan(c, 'sm') : ic('bars', 30)) + '</span>' +
        dotStrip(p.shots.map(E.miss), 160, 22, 20) + (a == null ? dash() : '<span class="n34">' + pm(a) + '</span>') + '</button>';
      if (i === 2) rows += adSlot();
    });
    if (list.length > 0 && list.length < 3) rows += adSlot();
    return '<div class="bests">' + bestCol(avg == null ? null : pm(avg), 'Best', true) + bestCol(run, 'Run', false) + bestCol(cl, 'Closest', true) + '</div>' +
      '<div style="margin-top:24px">' + sparkline(tr.slice(-20), 342, 130, true) + '</div><div class="list">' + rows + '</div>';
  }

  function stepper(id, spec, cls) {
    return cbtn('noop', 'minus', 'Less', { data: 'data-hold="' + spec + ':-1"' }) +
      '<span class="' + cls + '" ' + (id ? 'data-stockval="' + esc(id) + '"' : 'id="sevenNum"') + '>' + (id ? carryOf(id) : ui.seven) + '</span>' +
      cbtn('noop', 'plus', 'More', { data: 'data-hold="' + spec + ':1"' });
  }
  function viewBagEdit() {
    var rows = state.bag.map(function (c) {
      return '<div class="editrow"><span class="tag' + (c.on ? ' ring' : '') + '" style="' + (c.on ? '' : 'color:var(--g1)') + '">' + esc(c.tag) + '</span>' +
        stepper(c.id, 'stock:' + c.id, 'n34') + toggleBtn(c) + '</div>';
    }).join('');
    return '<div class="pagehead"><span class="title">Your bag</span></div><div style="margin-top:8px">' + rows + '</div>' +
      '<div class="stickybar">' + cbtn('bagdone', 'check', 'Done', { primary: true, size: 40 }) + '</div>';
  }
  function viewSeven() {
    var W = 342, base = 36, ticks = [], x;
    for (var k = 0; k <= 27; k++) { x = 12 + k * 11.5; ticks.push({ x: x, tall: k % 2 === 0 }); }
    var deco = '<svg class="ruler" viewBox="0 0 ' + W + ' 60" aria-hidden="true">' + drawTurf(0, W, base, ticks, []) + drawFlag(W / 2, base, 34) + '</svg>';
    return lockup(80, 'sm') + '<div class="pagehead center-head"><span class="title">Your 7 iron</span></div>' +
      '<div class="sevenmid"><span class="tag ring big">7i</span><div class="stepper">' + stepper(null, 'seven', 'num seven-num') + '</div><span class="unit" style="margin:0">' + unit() + '</span></div>' +
      '<div class="ruler-wrap">' + deco + '</div>' +
      '<div class="bottom">' + cbtn('sevendone', 'check', 'Done', { primary: true, size: 40 }) + '</div>';
  }
  function toggleBtn(c) {
    return '<button type="button" class="togglebtn" data-act="toggleclub" data-club="' + esc(c.id) + '" role="switch" aria-checked="' + !!c.on + '" aria-label="In bag"><svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="' + (c.on ? C.green : C.paper) + '" stroke="' + (c.on ? C.green : C.ink) + '" stroke-width="2.5"/></svg></button>';
  }

  /* ---------- sheets ---------- */
  function clubActuals(id) {
    var out = [];
    state.practices.forEach(function (p) { p.shots.forEach(function (x) { if (x.clubId === id && fin(x.actual)) out.push(x.actual); }); });
    return out;
  }
  function clubRuler(c) {
    var acts = clubActuals(c.id), cv = carryOf(c.id), W = 342, h = 150, base = 98, o = { min: cv - 25, max: cv + 25, w: W }, lo = Math.max(o.min, 1);
    var X = function (v) { return turfX(o, v); }, labels = [];
    [-20, -10, 10, 20].forEach(function (d) { if (cv + d >= lo) labels.push({ x: X(cv + d), t: cv + d }); });
    var s = '<svg class="ruler" viewBox="0 0 ' + W + ' ' + h + '" aria-hidden="true">' + drawTurf(X(lo), X(o.max), base, turfTicks(o, cv, lo), labels) + drawFlag(X(cv), base, 66);
    s += stackBalls(acts.map(function (v) { return clamp(v, lo, o.max); }), X, base, 5);
    if (acts.length) {
      var a = Math.round(acts.reduce(function (p, q) { return p + q; }, 0) / acts.length), ax = X(clamp(a, lo, o.max));
      s += '<rect x="' + (ax - 1.5) + '" y="' + (base + 14) + '" width="3" height="10" fill="' + C.green + '"/>' +
        '<text x="' + ax + '" y="' + (base + 44) + '" text-anchor="middle" ' + NUMF + ' font-weight="500" font-size="20" fill="' + C.green + '">' + a + '</text>';
    }
    return s + '</svg>';
  }
  function carryInfoHtml(id) {
    var i = carryInfoOf(id);
    return i && fin(i.n) && i.n > 0 ? ballSvg(16) + '<span class="n20 g1">' + i.n + '</span>' : '';
  }
  function sheetClub(id) {
    var c = club(id); if (!c) return '';
    return '<div class="backdrop" data-act="closesheet"></div><div class="sheet" role="dialog" aria-label="' + esc(c.tag) + '">' +
      '<button type="button" class="cbtn flat closer" data-act="closesheet" aria-label="Close">' + ic('close', 26) + '</button>' +
      '<span class="tag big">' + esc(c.tag) + '</span>' +
      '<div class="stepper">' + cbtn('noop', 'minus', 'Less', { data: 'data-hold="stock:' + esc(c.id) + ':-1"' }) +
      '<div class="bigcarry"><span class="n56" data-stockval="' + esc(c.id) + '">' + carryOf(c.id) + '</span><span class="carryinfo" id="carryInfo">' + carryInfoHtml(c.id) + '</span></div>' +
      cbtn('noop', 'plus', 'More', { data: 'data-hold="stock:' + esc(c.id) + ':1"' }) + '</div>' +
      '<div id="sheetRuler" style="width:100%">' + clubRuler(c) + '</div>' +
      '<div class="sheetacts">' + toggleBtn(c) + '<span class="line">In bag</span></div>' +
      '<div class="sheetgo">' + cbtn('clubgap', 'teeball', 'Measure your clubs', { primary: true, sm: true, size: 34, data: 'data-club="' + esc(c.id) + '"' }) +
      cbtn('clubstart', 'flag', 'Start', { size: 26, data: 'data-club="' + esc(c.id) + '"' }) + '</div></div>';
  }
  function condStepper(spec, icon, val, u) {
    return '<div class="condrow">' + ic(icon, 28) + '<div class="stepper">' + cbtn('noop', 'minus', 'Less', { data: 'data-hold="cond:' + spec + ':-1"' }) +
      '<div class="bigcarry"><span class="n56" data-cond="' + spec + '">' + val + '</span></div>' + cbtn('noop', 'plus', 'More', { data: 'data-hold="cond:' + spec + ':1"' }) +
      '</div><span class="n20 g1 condu">' + u + '</span></div>';
  }
  function sheetCond() {
    var d = E.conditionsDisplay(state); if (!d) return '';
    return '<div class="backdrop" data-act="closesheet"></div><div class="sheet" role="dialog" aria-label="Change conditions">' +
      '<button type="button" class="cbtn flat closer" data-act="closesheet" aria-label="Close">' + ic('close', 26) + '</button>' +
      condStepper('t', 'thermo', d.temp, '\u00B0' + d.tempUnit) + condStepper('e', 'mountain', d.elevation, d.elevationUnit) + '</div>';
  }
  function stepCond(k, dir) {
    var d = E.conditionsDisplay(state); if (!d) return;
    var f = d.tempUnit === 'F';
    if (k === 't') d.temp = clamp(d.temp + dir, -40, f ? 130 : 55);
    else d.elevation = clamp(d.elevation + dir * (f ? 50 : 10), 0, f ? 12000 : 3600);
    E.setConditionsDisplay(state, { temp: d.temp, elevation: d.elevation }); save();
    var n = E.conditionsDisplay(state);
    $$('[data-cond="t"]').forEach(function (el) { el.textContent = n.temp; });
    $$('[data-cond="e"]').forEach(function (el) { el.textContent = n.elevation; });
  }
  function sheetGapClubs() {
    var cur = ui.practice && ui.practice.currentClubId;
    return '<div class="backdrop" data-act="closesheet"></div><div class="sheet" role="dialog" aria-label="Club">' +
      '<button type="button" class="cbtn flat closer" data-act="closesheet" aria-label="Close">' + ic('close', 26) + '</button>' +
      '<div class="tagwrap">' + onClubs().map(function (c) { return tagBtn(c, 'gappick', c.id === cur); }).join('') + '</div></div>';
  }
  function sheetUpgrade() {
    var rows = [['noads', 'No ads'], ['dots', 'Every practice kept'], ['bars', 'Full bag chart']].map(function (r) {
      return '<div class="sheetrow">' + ic(r[0], 32) + '<span class="line">' + r[1] + '</span></div>';
    }).join('');
    return '<div class="backdrop" data-act="closesheet"></div><div class="sheet" role="dialog" aria-label="Upgrade">' +
      '<button type="button" class="cbtn flat closer" data-act="closesheet" aria-label="Close">' + ic('close', 26) + '</button>' + rows +
      '<button type="button" class="pricebtn" data-act="buy" aria-label="$9.99">$9.99</button></div>';
  }
  function renderSheet(anim) {
    var h = $('#sheet'), s = ui.sheet;
    h.innerHTML = !s ? '' : s.type === 'club' ? sheetClub(s.id) : s.type === 'gapclubs' ? sheetGapClubs() : s.type === 'cond' ? sheetCond() : sheetUpgrade();
    h.className = 'sheet-host' + (s ? ' open' : '') + (s && anim ? ' anim' : '');
  }

  /* ---------- render ---------- */
  function renderTabbar() {
    var tb = $('#tabbar'); tb.hidden = ui.screen !== 'tab';
    tb.innerHTML = [['play', 'flag', 'Play'], ['bag', 'bars', 'Bag'], ['shots', 'dots', 'Shots']].map(function (t) {
      return '<button type="button" class="tab" data-act="tab" data-tab="' + t[0] + '"' + (ui.tab === t[0] ? ' aria-current="page"' : '') + '>' + ic(t[1], 26) + '<span>' + t[2] + '</span></button>';
    }).join('');
  }
  function fadeIn(el) {
    if (!el.animate || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' });
  }
  function render(keepScroll) {
    var root = $('#screen'), sc = keepScroll ? root.scrollTop : 0, name = ui.screen === 'tab' ? ui.tab : ui.screen;
    var views = { play: viewPlay, bag: viewBag, shots: viewShots, callout: viewCallout, entry: viewEntry, result: viewResult, summary: viewSummary, bagedit: viewBagEdit, seven: viewSeven };
    var bl = keepScroll && $('.bagl'), bsc = bl ? bl.scrollTop : 0;
    root.innerHTML = views[name]();
    root.className = 'screen ' + name + (name === 'callout' || name === 'entry' || name === 'result' || name === 'seven' ? ' noscroll' : '');
    root.scrollTop = sc; ui.roll = false;
    bl = bsc && $('.bagl'); if (bl) bl.scrollTop = bsc;
    renderTabbar(); renderSheet();
    if (!keepScroll) fadeIn(root);
    var rs = $('#resultRuler .ruler'); if (rs && name === 'result') slideIn(rs);
  }
  function go(screen, tab) { ui.screen = screen; if (tab) ui.tab = tab; ui.roll = true; clearTimeout(timers.result); render(); }

  /* ---------- practice flow ---------- */
  function haltVoice() {
    token++; clearTimeout(timers.speak); clearTimeout(timers.msg);
    if (stopListen) { try { stopListen(); } catch (e) { } stopListen = null; }
    if (ui.voice === 'listening') ui.voice = 'idle';
  }
  function startVoice() {
    if (ui.screen !== 'callout') return;
    if (!V.canListen) { ui.voice = 'unsupported'; render(); return; }
    if (stopListen) return;
    var my = token;
    ui.voice = 'listening';
    stopListen = V.listen({
      onText: function (t) { if (my === token) onHeard(t); },
      onState: function (s) {
        if (my !== token || ui.voice === 'blocked') return;
        var nv = (s === 'blocked' || s === 'unsupported') ? s : (s === 'idle' || s === 'stopped' || s === 'paused' || s === 'off') ? 'idle' : 'listening';
        if (nv !== ui.voice) { ui.voice = nv; if (ui.screen === 'callout') render(); }
      }
    });
    if (ui.voice === 'listening' || ui.voice === 'idle') render();
  }
  function pauseVoice() { if (stopListen) { try { stopListen(); } catch (e) { } stopListen = null; } if (ui.voice === 'listening') ui.voice = 'idle'; }
  function speakThenListen() { // game: say the yardage; gapping: say the club name
    var my = token, p = ui.practice, gap = isGap(p), say = gap ? (club(p.currentClubId) || {}).name : null;
    pauseVoice(); clearTimeout(timers.speak);
    if (!V.canSpeak || (gap ? !(V.speak && say) : !V.sayTarget)) { startVoice(); return; }
    var started = false, begin = function () { if (started || my !== token) return; started = true; clearTimeout(timers.speak); startVoice(); };
    timers.speak = setTimeout(begin, 7000);
    try { if (gap) (V.sayClub || V.speak).call(V, say, { onend: begin }); else V.sayTarget(p.currentTarget, unit(), { onend: begin }); } catch (e) { begin(); }
  }
  function enterCallout() {
    var p = ui.practice, gap = isGap(p);
    haltVoice(); ui.msg = false;
    if (ui.voice !== 'blocked' && ui.voice !== 'unsupported') ui.voice = 'idle';
    go('callout');
    if (!V.canListen) { ui.voice = 'unsupported'; render(); }
    if (gap && ui.announced === p.currentClubId) { startVoice(); return; } // same club again: just listen
    if (gap) ui.announced = p.currentClubId;
    speakThenListen();
  }
  function beginPractice(cfg) {
    var p = E.startPractice(state, { mode: cfg.mode, clubId: cfg.clubId });
    if (!p) return;
    if (!fin(p.currentTarget) || !p.currentTarget) p.currentTarget = E.nextTarget(state, p);
    ui.practice = p; ui.lastClubId = null; save(); enterCallout();
  }
  function beginGapping(clubId) {
    if (typeof E.startGapping !== 'function') return;
    var p = E.startGapping(state, { clubId: clubId || null });
    if (!p) return;
    ui.practice = p; ui.lastClubId = null; ui.announced = null; save(); enterCallout();
  }
  function pickClub() {
    var p = ui.practice;
    if (p.mode === 'club' && p.clubId) return p.clubId;
    if (ui.lastClubId) return ui.lastClubId;
    return E.suggestClub(state, p.currentTarget);
  }
  function logShot(actual, clubId) {
    var p = ui.practice;
    haltVoice();
    var sh = E.addShot(state, p, { actual: actual, clubId: clubId });
    if (!sh) sh = p.shots[p.shots.length - 1];
    save(); ui.shot = sh; ui.lastClubId = clubId; hintMark('callout'); hintMark('entry');
    go('result');
    timers.result = setTimeout(advance, 2000);
  }
  function logGapShot(actual, clubId) {
    var p = ui.practice, id = clubId || p.currentClubId;
    haltVoice();
    ui.gapCarry = carryOf(id); // the tick on the result is where the club stood before this shot
    var sh = E.addGapShot(state, p, { actual: actual, clubId: id });
    if (!sh) sh = p.shots[p.shots.length - 1];
    save(); ui.shot = sh; hintMark('gapcallout'); hintMark('entry');
    go('result');
    timers.result = setTimeout(advance, 2000);
  }
  function advance() {
    clearTimeout(timers.result);
    if (ui.screen !== 'result') return;
    save(); enterCallout();
  }
  function undoShot() {
    clearTimeout(timers.result);
    var p = ui.practice, sh = E.undo(state, p);
    if (sh && !isGap(p)) p.currentTarget = sh.target;
    save(); enterCallout();
  }
  function finishPractice() {
    var p = ui.practice, gap = isGap(p); haltVoice(); clearTimeout(timers.result);
    try { E.finish(state, p); } catch (e) { }
    save();
    if (!p.shots.length) { ui.practice = null; ui.screen = 'tab'; ui.tab = gap ? 'bag' : 'play'; ui.roll = true; return render(); }
    ui.summaryId = p.id; ui.returnTab = gap ? 'bag' : 'play'; ui.practice = null; go('summary');
  }
  function openEntry() {
    var p = ui.practice; haltVoice(); ui.msg = false;
    if (isGap(p)) ui.entry = { actual: carryOf(p.currentClubId), clubId: p.currentClubId };
    else ui.entry = { actual: p.currentTarget, clubId: p.mode === 'club' ? p.clubId : E.suggestClub(state, p.currentTarget) };
    go('entry');
  }
  function gapAdvance() { // skip to the next club, then announce it
    var p = ui.practice; E.gapNext(state, p); save(); enterCallout();
  }
  function gapPick(id) {
    var p = ui.practice; E.gapSwitch(state, p, id); save(); enterCallout();
  }

  /* ---------- voice results ---------- */
  var COMMANDS = ['undo', 'correct', 'repeat', 'skip', 'pause', 'resume', 'done'];
  function onHeard(text) {
    var p = ui.practice; if (!p || ui.screen !== 'callout') return;
    var gap = isGap(p), cur = gap ? p.currentClubId : null;
    var r = V.parse(text, gap ? { target: carryOf(cur), bag: state.bag, lastClubId: cur, mode: 'gap' } : { target: p.currentTarget, bag: state.bag, lastClubId: ui.lastClubId }) || {};
    var kind = r.kind || r.type || '', cmd = r.command || r.cmd || (COMMANDS.indexOf(kind) >= 0 ? kind : (COMMANDS.indexOf(r.name) >= 0 ? r.name : null));
    if (kind === 'club') return gap && club(r.clubId) ? gapPick(r.clubId) : unclear();
    if (kind === 'command' || (cmd && kind !== 'shot')) return doCommand(cmd, r);
    if (kind === 'shot') {
      var d = fin(r.distance) ? r.distance : r.actual;
      if (!fin(d) || d <= 0) return unclear();
      return gap ? logGapShot(Math.round(d), r.clubId || cur) : logShot(Math.round(d), r.clubId || pickClub());
    }
    unclear();
  }
  function unclear() {
    ui.msg = true; render(); clearTimeout(timers.msg);
    timers.msg = setTimeout(function () { ui.msg = false; if (ui.screen === 'callout') render(); }, 2000);
  }
  function doCommand(cmd, r) {
    var p = ui.practice, gap = isGap(p);
    if (cmd === 'undo') { var sh = E.undo(state, p); if (!sh) return unclear(); if (!gap) p.currentTarget = sh.target; save(); return enterCallout(); }
    if (cmd === 'correct') {
      var last = p.shots[p.shots.length - 1], d = r.distance;
      if (!last || !fin(d)) return unclear();
      haltVoice(); last.actual = Math.round(d); save(); ui.shot = last; if (gap) ui.gapCarry = carryOf(last.clubId);
      go('result'); timers.result = setTimeout(advance, 2000); return;
    }
    if (cmd === 'repeat') return speakThenListen();
    if (cmd === 'skip') { if (gap) return gapAdvance(); p.currentTarget = E.nextTarget(state, p); save(); return enterCallout(); }
    if (cmd === 'pause') { pauseVoice(); return render(); }
    if (cmd === 'resume') { startVoice(); return; }
    if (cmd === 'done') return finishPractice();
    unclear();
  }

  /* ---------- steppers (hold to repeat) ---------- */
  function stepStock(id, d) {
    var c = club(id); if (!c) return;
    setCarry(id, clamp(carryOf(id) + d, 1, 400));
    $$('[data-stockval="' + id + '"]').forEach(function (el) { el.textContent = carryOf(id); });
    var sr = $('#sheetRuler'); if (sr && ui.sheet && ui.sheet.id === id) { sr.innerHTML = clubRuler(c); $('#carryInfo').innerHTML = carryInfoHtml(id); }
  }
  function stepActual(d) {
    var en = ui.entry; en.actual = clamp(en.actual + d, 1, 999); updateEntry();
  }
  function stepSeven(d) {
    ui.seven = clamp(ui.seven + d, 1, 400); $('#sevenNum').textContent = ui.seven;
  }
  function applyHold(spec) {
    var a = spec.split(':');
    if (a[0] === 'cond') stepCond(a[1], +a[2]); else if (a[0] === 'actual') stepActual(+a[1]); else if (a[0] === 'seven') stepSeven(+a[1]); else stepStock(a[1], +a[2]);
  }
  var hold = { t: 0, i: 0 };
  function holdStop() { clearTimeout(hold.t); clearInterval(hold.i); }
  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest && e.target.closest('[data-hold]'); if (!b) return;
    e.preventDefault(); holdStop(); var spec = b.getAttribute('data-hold'); applyHold(spec);
    hold.t = setTimeout(function () { hold.i = setInterval(function () { applyHold(spec); }, 70); }, 420);
  });
  ['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach(function (ev) { document.addEventListener(ev, holdStop, true); });
  document.addEventListener('keydown', function (e) {
    var b = e.target.closest && e.target.closest('[data-hold]');
    if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); applyHold(b.getAttribute('data-hold')); }
  });

  /* ---------- turf dragging ---------- */
  function rulerValue(svg, ev) {
    var r = svg.getBoundingClientRect(), w = +svg.getAttribute('data-w'), mn = +svg.getAttribute('data-min'), mx = +svg.getAttribute('data-max'), lo = +svg.getAttribute('data-lo');
    var px = (ev.clientX - r.left) / r.width * w;
    return clamp(Math.round(mn + (px - PAD) / (w - 2 * PAD) * (mx - mn)), lo, mx);
  }
  document.addEventListener('pointerdown', function (e) {
    var svg = e.target.closest && e.target.closest('#entryRuler .ruler'); if (!svg) return;
    svg.classList.add('drag'); try { svg.setPointerCapture(e.pointerId); } catch (x) { }
    svg._drag = true; ui.entry.actual = rulerValue(svg, e); updateEntry(); hintMark('entry'); var h = $('.hint[data-key="entry"]'); if (h) h.remove();
  });
  document.addEventListener('pointermove', function (e) {
    var svg = $('#entryRuler .ruler'); if (!svg || !svg._drag) return;
    ui.entry.actual = rulerValue(svg, e); updateEntry();
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    document.addEventListener(ev, function () { var svg = $('#entryRuler .ruler'); if (svg) { svg._drag = false; svg.classList.remove('drag'); } });
  });
  document.addEventListener('keydown', function (e) {
    if (!e.target.closest || !e.target.closest('#entryRuler .ruler')) return;
    var d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0; if (!d) return;
    e.preventDefault(); stepActual(d);
  });

  /* ---------- actions ---------- */
  var actions = {
    tab: function (el) { ui.tab = el.getAttribute('data-tab'); ui.screen = 'tab'; ui.roll = true; render(); },
    pickclub: function (el) { var id = el.getAttribute('data-club'); ui.cfg.mode = id === 'all' ? 'bag' : 'club'; ui.cfg.clubId = id === 'all' ? null : id; render(true); },
    start: function () { beginPractice(ui.cfg); },
    close: function () { finishPractice(); },
    repeat: function () { speakThenListen(); },
    keypad: function () { openEntry(); },
    skip: function () { var p = ui.practice; if (isGap(p)) return gapAdvance(); p.currentTarget = E.nextTarget(state, p); save(); enterCallout(); },
    mic: function () { if (ui.voice === 'listening') { pauseVoice(); render(); } else if (ui.voice === 'idle') { startVoice(); } },
    entryclub: function (el) {
      ui.entry.clubId = el.getAttribute('data-club');
      if (isGap(ui.practice)) { ui.entry.actual = carryOf(ui.entry.clubId); return render(true); } // the ruler re-centres on that club
      $$('#entryChips .tag').forEach(function (b) { var on = b.getAttribute('data-club') === ui.entry.clubId; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on); });
    },
    confirm: function () {
      if (isGap(ui.practice)) return logGapShot(ui.entry.actual, ui.entry.clubId);
      logShot(ui.entry.actual, ui.entry.clubId || E.suggestClub(state, ui.practice.currentTarget));
    },
    advance: function () { advance(); },
    undo: function () { undoShot(); },
    summarydone: function () { ui.screen = 'tab'; ui.tab = ui.returnTab || 'play'; ui.roll = true; render(); },
    openprac: function (el) { ui.summaryId = el.getAttribute('data-id'); ui.returnTab = 'shots'; go('summary'); },
    bagview: function (el) {
      var v = el.getAttribute('data-v') === 'today';
      if (v && !state.conditions) { var S = (E.SAMPLE_CONDITIONS || [])[0] || { tempC: 7, elevationM: 0 }; E.setConditions(state, { tempC: S.tempC, elevationM: S.elevationM, source: 'sample' }); save(); }
      ui.today = v; render();
    },
    condsheet: function () { ui.sheet = { type: 'cond' }; renderSheet(true); },
    unit: function (el) { E.setUnit(state, el.getAttribute('data-u')); save(); render(true); },
    clubsheet: function (el) { ui.sheet = { type: 'club', id: el.getAttribute('data-club') }; renderSheet(true); },
    closesheet: function () { var t = ui.sheet && ui.sheet.type; ui.sheet = null; renderSheet(); if (t === 'club' || t === 'cond') render(true); if (t === 'gapclubs') startVoice(); },
    gapstart: function () { beginGapping(null); },
    clubgap: function (el) { var id = el.getAttribute('data-club'); ui.sheet = null; renderSheet(); beginGapping(id); },
    gapclubs: function () { haltVoice(); ui.sheet = { type: 'gapclubs' }; renderSheet(true); },
    gappick: function (el) { ui.sheet = null; renderSheet(); gapPick(el.getAttribute('data-club')); },
    upgrade: function () { ui.sheet = { type: 'upgrade' }; renderSheet(true); },
    buy: function () { state.pro = true; save(); ui.sheet = null; render(true); },
    toggleclub: function (el) {
      var c = club(el.getAttribute('data-club')); if (!c) return; c.on = !c.on; save();
      if (ui.screen === 'bagedit') render(true);
      if (ui.sheet) renderSheet();
    },
    clubstart: function (el) { var id = el.getAttribute('data-club'); ui.sheet = null; renderSheet(); ui.cfg.mode = 'club'; ui.cfg.clubId = id; beginPractice(ui.cfg); },
    sevendone: function () {
      var c = club('7i');
      if (typeof E.scaleBag === 'function') E.scaleBag(state, '7i', ui.seven); else if (c) c.stock = ui.seven;
      save(); go('bagedit');
    },
    bagdone: function () {
      save(); ui.screen = 'tab'; ui.tab = ui.firstRun ? 'play' : 'bag'; ui.firstRun = false; ui.roll = true; render();
    },
    hint: function (el) { hintMark(el.getAttribute('data-key')); el.remove(); },
    noop: function () { }
  };
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-act]'); if (!el) return;
    if (el.hasAttribute('data-hold') && e.detail !== 0) return; // pointer handled by hold logic
    var f = actions[el.getAttribute('data-act')]; if (f) f(el);
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && ui.screen === 'callout') pauseVoice(); });

  /* ---------- boot ---------- */
  function boot() {
    document.body.insertAdjacentHTML('afterbegin', drawDefs());
    if (params.get('fresh') === '1') {
      state = E.reset({ demo: false });
      try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('cb_hint_') === 0) localStorage.removeItem(k); }); } catch (e) { }
    } else state = E.load();
    state.bag = state.bag || []; state.practices = state.practices || [];
    state.practices.forEach(function (p) { if (!p.done) { try { E.finish(state, p); } catch (e) { } } }); // an unfinished practice is finished silently
    save();
    if (!state.practices.some(function (p) { return p.shots && p.shots.length > 0; })) { ui.screen = 'seven'; ui.firstRun = true; ui.seven = carryOf('7i') || 150; }
    ui.roll = true; render();
  }
  boot();
})();
