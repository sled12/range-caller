/* engine.js - yardage logic layer. No DOM. Whole yards / whole meters only. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var TOLERANCE = 5;
  var STORAGE_KEY = 'yardage.v1';
  var YD_TO_M = 0.9144;
  var LEARN_WEIGHT = 5;
  var LEARN_WINDOW = 30;
  var GAP_BLOCK = 5;
  var DENSITY_K = 0.41; // provisional sensitivity of carry to air density; change after research
  var BASELINE = { tempC: 21.1, elevationM: 0, pressureHpa: 1013.25 };
  var SAMPLE_CONDITIONS = [
    { id: 'cool', tempC: 7, elevationM: 0 },
    { id: 'hot', tempC: 35, elevationM: 0 },
    { id: 'high', tempC: 21, elevationM: 1600 }
  ];

  var DEFAULT_BAG = [
    ['D', 'Driver', 230], ['3W', '3 wood', 210], ['5W', '5 wood', 195], ['4H', '4 hybrid', 185],
    ['5i', '5 iron', 175], ['6i', '6 iron', 165], ['7i', '7 iron', 155], ['8i', '8 iron', 145],
    ['9i', '9 iron', 135], ['PW', 'Pitching wedge', 122], ['GW', 'Gap wedge', 108],
    ['SW', 'Sand wedge', 92], ['LW', 'Lob wedge', 78]
  ];

  function defaultBag() {
    return DEFAULT_BAG.map(function (c) { return { id: c[0], tag: c[0], name: c[1], stock: c[2], stockAt: 0, on: true }; });
  }

  function hasStorage() {
    try { return typeof localStorage !== 'undefined' && localStorage !== null; } catch (e) { return false; }
  }

  function rnd(rng) { return (rng || Math.random)(); }
  function randInt(lo, hi, rng) { return lo + Math.floor(rnd(rng) * (hi - lo + 1)); }
  function roundInt(x) { var r = Math.round(x); return r === 0 ? 0 : r; }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normal(rng) {
    var u = 0, v = 0;
    while (u === 0) u = rng();
    v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function findClub(state, id) {
    for (var i = 0; i < state.bag.length; i++) if (state.bag[i].id === id) return state.bag[i];
    return null;
  }

  function onClubs(state) { return state.bag.filter(function (c) { return c.on; }); }

  function miss(shot) { return shot.actual - shot.target; }
  function onTarget(m) { return Math.abs(m) <= TOLERANCE; }

  // Whole-number share of a stock distance, rounding half up (internal ratios only).
  function share(pts, S) { return Math.floor((pts * S + 50) / 100); }
  function clubRange(S) {
    return { lo: S - share(15, S), hi: S + share(9, S), bandLo: S - share(3, S), bandHi: S + share(6, S) };
  }
  function roundDiv(num, den) { return Math.floor((2 * num + den) / (2 * den)); }
  function median(arr) {
    var a = arr.slice().sort(function (x, y) { return x - y; }), n = a.length;
    return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  }
  // Drop mishits: anything further than 12 percent-points of the median away from the median.
  function dropOutliers(list) {
    if (!list.length) return [];
    var med = median(list), tol = Math.floor((12 * med + 50) / 100);
    return list.filter(function (a) { return Math.abs(a - med) <= tol; });
  }
  function sumOf(a) { var t = 0; for (var i = 0; i < a.length; i++) t += a[i]; return t; }

  function gapShotsOf(state, clubId, skipPracticeId) {
    var list = [];
    state.practices.forEach(function (p) {
      if (p.mode !== 'gap' || (skipPracticeId != null && p.id === skipPracticeId)) return;
      p.shots.forEach(function (s) { if (s.clubId === clubId) list.push(s); });
    });
    return list;
  }

  // Learned carry: entered stock blended with the club's recent gapping shots since the stock was entered.
  function learnedActuals(state, club, skipPracticeId) {
    var list = gapShotsOf(state, club.id, skipPracticeId).filter(function (s) { return s.at >= (club.stockAt || 0); });
    list.sort(function (a, b) { return a.at - b.at; });
    return dropOutliers(list.slice(-LEARN_WINDOW).map(function (s) { return s.actual; }));
  }
  function carryOf(state, club, skipPracticeId) {
    var a = learnedActuals(state, club, skipPracticeId);
    // The entered number fades out as evidence builds: weight = LEARN_WEIGHT * (1 - n / LEARN_WINDOW).
    // Multiplied through by LEARN_WINDOW / LEARN_WEIGHT to stay in integers.
    var n = a.length, k = LEARN_WINDOW / LEARN_WEIGHT;
    return roundDiv((LEARN_WINDOW - n) * club.stock + k * sumOf(a), (LEARN_WINDOW - n) + k * n);
  }
  function carry(state, clubId) {
    var c = findClub(state, clubId);
    return c ? carryOf(state, c) : null;
  }
  function carryInfo(state, clubId) {
    var c = findClub(state, clubId);
    if (!c) return null;
    var n = learnedActuals(state, c).length;
    return { carry: carryOf(state, c), entered: c.stock, n: n, learned: n >= 5 };
  }
  function setStock(state, clubId, value) {
    var c = findClub(state, clubId);
    if (!c) return;
    c.stock = Math.round(value); c.stockAt = Date.now();
  }
  function scaleBag(state, anchorClubId, value) {
    var table = {};
    DEFAULT_BAG.forEach(function (c) { table[c[0]] = c[2]; });
    var anchorDef = table[anchorClubId], now = Date.now();
    if (!anchorDef) return;
    state.bag.forEach(function (c) {
      if (c.id === anchorClubId) c.stock = Math.round(value);
      else if (table[c.id]) c.stock = roundDiv(table[c.id] * value, anchorDef);
      c.stockAt = now;
    });
  }
  function carryChanges(state, practice) {
    if (!practice || practice.mode !== 'gap') return [];
    var used = {};
    practice.shots.forEach(function (s) { used[s.clubId] = 1; });
    var out = [];
    state.bag.forEach(function (c) {
      if (!used[c.id]) return;
      var before = carryOf(state, c, practice.id), after = carryOf(state, c);
      if (Math.abs(after - before) >= 2) out.push({ clubId: c.id, tag: c.tag, before: before, after: after });
    });
    return out;
  }

  // ---- target generation -------------------------------------------------
  function genTarget(mode, stock, prev, rng) {
    var t, tries = 0;
    do {
      if (mode === 'club') {
        var r = clubRange(stock);
        if (rnd(rng) < 0.7) t = randInt(r.bandLo, r.bandHi, rng);
        else {
          // outside the band: lo..bandLo-1 and bandHi+1..hi
          var below = r.bandLo - r.lo, above = r.hi - r.bandHi;
          var k = randInt(0, below + above - 1, rng);
          t = k < below ? r.lo + k : r.bandHi + 1 + (k - below);
        }
        t = Math.max(10, t);
        if (prev == null || t !== prev) break;
      } else {
        t = randInt(10, Math.max(10, stock), rng);
        if (prev == null || Math.abs(t - prev) > 15) break;
      }
      tries++;
    } while (tries < 200);
    return t;
  }

  function nextTarget(state, practice) {
    var prev = practice.shots.length ? practice.shots[practice.shots.length - 1].target : null;
    if (practice.mode === 'club') {
      var club = findClub(state, practice.clubId);
      return genTarget('club', club ? carryOf(state, club) : 150, prev);
    }
    var on = onClubs(state);
    var maxStock = on.reduce(function (m, c) { return Math.max(m, carryOf(state, c)); }, 0) || 150;
    return genTarget('bag', maxStock, prev);
  }

  function suggestClub(state, target) {
    var best = null;
    onClubs(state).forEach(function (c) {
      if (!best) { best = c; return; }
      var cc = carryOf(state, c), bc = carryOf(state, best);
      var d = Math.abs(cc - target), bd = Math.abs(bc - target);
      if (d < bd || (d === bd && cc > bc)) best = c;
    });
    return best ? best.id : null;
  }

  // ---- practices ---------------------------------------------------------
  var idCounter = 0;
  function startPractice(state, opts) {
    opts = opts || {};
    var mode = opts.mode === 'club' ? 'club' : 'bag';
    var now = Date.now();
    idCounter++;
    var p = {
      id: 'p' + now + '-' + idCounter,
      startedAt: now,
      mode: mode,
      clubId: mode === 'club' ? (opts.clubId || null) : null,
      planned: opts.planned || 0,
      currentTarget: 0,
      shots: [],
      done: false
    };
    state.practices.push(p);
    p.currentTarget = nextTarget(state, p);
    return p;
  }

  function addShot(state, practice, input) {
    var target = practice.currentTarget;
    var clubId = input.clubId != null ? input.clubId : (practice.mode === 'club' ? practice.clubId : suggestClub(state, target));
    var shot = { target: target, actual: Math.round(input.actual), clubId: clubId, at: Date.now() };
    practice.shots.push(shot);
    if (practice.planned > 0 && practice.shots.length >= practice.planned) practice.done = true;
    practice.currentTarget = nextTarget(state, practice);
    return shot;
  }

  function undo(state, practice) {
    if (!practice.shots.length) return null;
    var shot = practice.shots.pop();
    if (practice.mode === 'gap') practice.currentClubId = shot.clubId;
    else practice.currentTarget = shot.target;
    practice.done = false;
    return shot;
  }

  function finish(state, practice) { practice.done = true; }

  // ---- gapping practice: the app calls a club, the golfer reports a normal-shot distance ----
  function walkOrder(state) { return onClubs(state).reverse().map(function (c) { return c.id; }); } // shortest first

  function startGapping(state, opts) {
    opts = opts || {};
    var now = Date.now(), order = walkOrder(state);
    idCounter++;
    var oneClub = opts.clubId || null;
    var p = {
      id: 'g' + now + '-' + idCounter,
      startedAt: now,
      mode: 'gap',
      clubId: oneClub,
      currentClubId: oneClub || (order.length ? order[0] : null),
      shots: [],
      done: false,
      planned: 0,
      conditions: state.conditions ? JSON.parse(JSON.stringify(state.conditions)) : null
    };
    state.practices.push(p);
    return p;
  }

  function gapProgress(state, practice) {
    var hit = 0;
    for (var i = practice.shots.length - 1; i >= 0 && practice.shots[i].clubId === practice.currentClubId; i--) hit++;
    return { clubId: practice.currentClubId, hit: hit, block: GAP_BLOCK };
  }

  function gapNext(state, practice) {
    if (practice.clubId) return practice.currentClubId;
    var order = walkOrder(state);
    if (!order.length) return practice.currentClubId;
    var i = order.indexOf(practice.currentClubId);
    practice.currentClubId = order[(i + 1) % order.length];
    return practice.currentClubId;
  }

  function gapSwitch(state, practice, clubId) {
    if (clubId) practice.currentClubId = clubId;
  }

  function addGapShot(state, practice, input) {
    if (input.clubId != null && input.clubId !== practice.currentClubId) practice.currentClubId = input.clubId;
    var shot = { clubId: practice.currentClubId, actual: Math.round(input.actual), at: Date.now(), target: null };
    practice.shots.push(shot);
    if (!practice.clubId && gapProgress(state, practice).hit >= GAP_BLOCK) gapNext(state, practice);
    return shot;
  }

  function statsOf(kept) {
    var n = kept.length, row = { n: n, avg: null, lo: null, hi: null };
    if (!n) return row;
    var sorted = kept.slice().sort(function (x, y) { return x - y; });
    row.avg = roundInt(sumOf(kept) / n);
    if (n < 5) { row.lo = sorted[0]; row.hi = sorted[n - 1]; }
    else { row.lo = roundInt(percentile(sorted, 0.1)); row.hi = roundInt(percentile(sorted, 0.9)); }
    return row;
  }

  function gapSummary(state, practice) {
    var out = { count: practice.shots.length, clubs: [] };
    state.bag.forEach(function (c) {
      var all = practice.shots.filter(function (s) { return s.clubId === c.id; }).map(function (s) { return s.actual; });
      if (!all.length) return;
      var st = statsOf(dropOutliers(all));
      out.clubs.push({ clubId: c.id, tag: c.tag, count: all.length, kept: st.n, avg: st.avg, lo: st.lo, hi: st.hi });
    });
    return out;
  }


  // ---- stats -------------------------------------------------------------
  function summary(shots) {
    shots = shots.filter(function (s) { return typeof s.target === 'number'; });
    var out = { count: shots.length, avgMiss: 0, bias: 0, onTarget: 0, best: null, byClub: [] };
    if (!shots.length) return out;
    var abs = 0, signed = 0, groups = {}, order = [];
    shots.forEach(function (s) {
      var m = miss(s);
      abs += Math.abs(m); signed += m;
      if (onTarget(m)) out.onTarget++;
      if (!out.best || Math.abs(m) < Math.abs(miss(out.best))) out.best = s;
      var key = String(s.clubId);
      if (!groups[key]) { groups[key] = { clubId: s.clubId, n: 0, abs: 0 }; order.push(key); }
      groups[key].n++; groups[key].abs += Math.abs(m);
    });
    out.avgMiss = roundInt(abs / shots.length);
    out.bias = roundInt(signed / shots.length);
    out.byClub = order.map(function (k) {
      var g = groups[k];
      return { clubId: g.clubId, count: g.n, avgMiss: roundInt(g.abs / g.n) };
    });
    return out;
  }

  // Percentile uses linear interpolation between sorted values at position p*(n-1).
  function percentile(sorted, p) {
    var pos = p * (sorted.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  function gapping(state) {
    var clubs = onClubs(state).map(function (c) {
      var all = gapShotsOf(state, c.id).map(function (s) { return s.actual; });
      var row = statsOf(dropOutliers(all));
      return { clubId: c.id, tag: c.tag, stock: c.stock, carry: carryOf(state, c), n: row.n, avg: row.avg, lo: row.lo, hi: row.hi };
    });
    var gaps = [];
    for (var i = 0; i + 1 < clubs.length; i++) {
      var u = clubs[i], l = clubs[i + 1];
      var value = (u.avg != null ? u.avg : u.carry) - (l.avg != null ? l.avg : l.carry);
      gaps.push({ upperId: u.clubId, lowerId: l.clubId, value: value, flag: value < 8 ? 'tight' : (value > 20 ? 'wide' : null) });
    }
    return { clubs: clubs, gaps: gaps };
  }

  // ---- air conditions ----------------------------------------------------
  function pressureAt(h) { return 1013.25 * Math.pow(1 - 2.25577e-5 * h, 5.25588); }
  function airDensity(c) {
    var p = (c.pressureHpa == null) ? pressureAt(c.elevationM) : c.pressureHpa;
    return (p * 100) / (287.05 * (c.tempC + 273.15));
  }
  function conditionsFactor(c) {
    if (!c) return 1;
    var r0 = airDensity(BASELINE);
    return 1 + DENSITY_K * (r0 - airDensity(c)) / r0;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function setConditions(state, c) {
    state.conditions = {
      tempC: clamp(Number(c.tempC), -30, 50),
      elevationM: clamp(Number(c.elevationM), -400, 4500),
      pressureHpa: (c.pressureHpa == null || isNaN(Number(c.pressureHpa))) ? null : Number(c.pressureHpa),
      source: c.source || 'manual',
      at: Date.now()
    };
  }
  function clearConditions(state) { state.conditions = null; }
  function todayCarry(state, clubId) {
    var c = carry(state, clubId);
    return c == null ? null : roundInt(c * conditionsFactor(state.conditions));
  }
  function todayDelta(state, clubId) {
    var t = todayCarry(state, clubId);
    return t == null ? null : t - carry(state, clubId);
  }
  function gappingToday(state) {
    var f = conditionsFactor(state.conditions);
    function adj(v) { return v == null ? null : roundInt(v * f); }
    var g = gapping(state);
    var clubs = g.clubs.map(function (r) {
      var base = r.avg != null ? r.avg : r.carry;
      var o = { clubId: r.clubId, tag: r.tag, stock: r.stock, carry: adj(r.carry), n: r.n, avg: adj(r.avg), lo: adj(r.lo), hi: adj(r.hi) };
      var shown = o.avg != null ? o.avg : o.carry;
      o.base = base; o.delta = shown - base;
      return o;
    });
    var gaps = [];
    for (var i = 0; i + 1 < clubs.length; i++) {
      var u = clubs[i], l = clubs[i + 1];
      var value = (u.avg != null ? u.avg : u.carry) - (l.avg != null ? l.avg : l.carry);
      gaps.push({ upperId: u.clubId, lowerId: l.clubId, value: value, flag: value < 8 ? 'tight' : (value > 20 ? 'wide' : null) });
    }
    return { clubs: clubs, gaps: gaps };
  }
  function conditionsDisplay(state) {
    var c = state.conditions;
    if (!c) return null;
    if (state.unit === 'yd') {
      return { temp: roundInt(c.tempC * 9 / 5 + 32), tempUnit: 'F', elevation: roundInt(c.elevationM * 3.28084 / 50) * 50, elevationUnit: 'ft' };
    }
    return { temp: roundInt(c.tempC), tempUnit: 'C', elevation: roundInt(c.elevationM / 10) * 10, elevationUnit: 'm' };
  }
  function setConditionsDisplay(state, d) {
    var tempC, elev;
    if (state.unit === 'yd') { tempC = (d.temp - 32) * 5 / 9; elev = d.elevation / 3.28084; }
    else { tempC = d.temp; elev = d.elevation; }
    setConditions(state, { tempC: tempC, elevationM: elev, pressureHpa: null, source: 'manual' });
  }

  function finishedWithShots(state) {
    return state.practices.filter(function (p) { return p.mode !== 'gap' && p.done && p.shots.length > 0; })
      .sort(function (a, b) { return a.startedAt - b.startedAt; });
  }

  function practiceAvg(p) { return summary(p.shots).avgMiss; }

  function trend(state) {
    return finishedWithShots(state).map(function (p) {
      return { practiceId: p.id, at: p.startedAt, avgMiss: practiceAvg(p), count: p.shots.length };
    });
  }

  function bests(state) {
    var res = { avgMiss: null, streak: null, closest: null };
    finishedWithShots(state).forEach(function (p) {
      if (p.shots.length >= 10) {
        var v = practiceAvg(p);
        if (!res.avgMiss || v < res.avgMiss.value) res.avgMiss = { value: v, practiceId: p.id };
      }
    });
    var bestRun = 0, closest = null;
    state.practices.forEach(function (p) {
      if (p.mode === 'gap') return;
      var run = 0;
      p.shots.forEach(function (s) {
        var m = miss(s);
        if (onTarget(m)) { run++; if (run > bestRun) bestRun = run; } else run = 0;
        if (!closest || Math.abs(m) < Math.abs(miss(closest))) closest = s;
      });
    });
    if (bestRun > 0) res.streak = { value: bestRun };
    if (closest) res.closest = { shot: closest };
    return res;
  }

  // ---- units -------------------------------------------------------------
  function setUnit(state, unit) {
    if (unit !== 'yd' && unit !== 'm') return;
    if (state.unit === unit) return;
    var f = unit === 'm' ? function (v) { return Math.round(v * YD_TO_M); } : function (v) { return Math.round(v / YD_TO_M); };
    state.bag.forEach(function (c) { c.stock = f(c.stock); });
    state.practices.forEach(function (p) {
      p.shots.forEach(function (s) { if (typeof s.target === 'number') s.target = f(s.target); s.actual = f(s.actual); });
      if (p.currentTarget) p.currentTarget = f(p.currentTarget);
    });
    state.unit = unit;
  }

  // ---- persistence -------------------------------------------------------
  function save(state) {
    if (!hasStorage()) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function validState(s) {
    return s && (s.unit === 'yd' || s.unit === 'm') && Array.isArray(s.bag) && Array.isArray(s.practices);
  }

  function migrate(s) {
    if (typeof s.pro !== 'boolean') s.pro = false;
    if (s.conditions === undefined || typeof s.conditions !== 'object') s.conditions = null;
    s.bag.forEach(function (c) { if (typeof c.stockAt !== 'number') c.stockAt = 0; });
    s.practices.forEach(function (p) {
      (p.shots || []).forEach(function (sh) { delete sh.full; });
    });
  }

  function load() {
    if (hasStorage()) {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          var s = JSON.parse(raw);
          if (validState(s)) { migrate(s); return s; }
        }
      } catch (e) { /* fall through */ }
    }
    return reset({ demo: true });
  }

  // ---- demo data ---------------------------------------------------------
  function demoPractices(state) {
    var rng = mulberry32(20240607);
    var d = new Date(); d.setHours(9, 0, 0, 0);
    var base = d.getTime(), DAY = 86400000;
    var plan = [
      { mode: 'bag', days: 34, n: 24 },
      { mode: 'club', clubId: '7i', days: 28, n: 31 },
      { mode: 'bag', days: 21, n: 18 },
      { mode: 'club', clubId: 'PW', days: 14, n: 27 },
      { mode: 'bag', days: 9, n: 42 },
      { mode: 'bag', days: 5, n: 22 },
      { mode: 'bag', days: 2, n: 35 }
    ];
    plan.forEach(function (cfg, pi) {
      var sd = 7.5 - pi * 0.5;
      var startedAt = base - cfg.days * DAY;
      var p = { id: 'demo' + (pi + 1), startedAt: startedAt, mode: cfg.mode, clubId: cfg.mode === 'club' ? cfg.clubId : null,
        planned: 0, currentTarget: 0, shots: [], done: true };
      var prev = null;
      for (var k = 0; k < cfg.n; k++) {
        var target, clubId;
        if (cfg.mode === 'bag') {
          target = genTarget('bag', 230, prev, rng);
          clubId = suggestClub(state, target);
        } else {
          target = genTarget('club', findClub(state, cfg.clubId).stock, prev, rng);
          clubId = cfg.clubId;
        }
        prev = target;
        var actual = Math.max(1, target + Math.round(normal(rng) * sd - 2));
        p.shots.push({ target: target, actual: actual, clubId: clubId, at: startedAt + k * 90000 });
      }
      p.currentTarget = p.shots[p.shots.length - 1].target;
      state.practices.push(p);
    });
    demoGapping(state, rng, base, DAY);
  }

  // Two whole-bag walks (5 per club, each with one obvious mishit) and a one-club 7i session.
  function demoGapping(state, rng, base, DAY) {
    var order = state.bag.slice().reverse();
    function mk(id, days, clubId) {
      return { id: id, startedAt: base - days * DAY, mode: 'gap', clubId: clubId, currentClubId: clubId || order[0].id, shots: [], done: true, planned: 0 };
    }
    var walks = [mk('demogap1', 30, null), mk('demogap2', 12, null)];
    var one = mk('demogap3', 6, '7i');
    var mishit = [{ clubId: '7i', value: 96 }, { clubId: 'D', value: 150 }];
    walks.forEach(function (w, wi) {
      var k = 0;
      order.forEach(function (c) {
        for (var j = 0; j < 5; j++) {
          var sh = { clubId: c.id, actual: 0, at: w.startedAt + (k++) * 60000, target: null };
          if (mishit[wi].clubId === c.id && j === 2) { sh.actual = mishit[wi].value + Math.round(rng() * 2); sh._m = true; }
          w.shots.push(sh);
        }
      });
    });
    for (var j = 0; j < 12; j++) one.shots.push({ clubId: '7i', actual: 0, at: one.startedAt + j * 60000, target: null });
    var all = walks.concat(one);
    // Shape each club's normal shots: average = stock + offset, spread (p10..p90) about 13.
    // 6i is deliberately set 6 above 7i so 6i>7i is the one 'tight' gap.
    var OFFSET = { D: -2 };
    var avg7 = findClub(state, '7i').stock - 1;
    state.bag.forEach(function (club) {
      var want = club.stock + (OFFSET[club.id] !== undefined ? OFFSET[club.id] : -1);
      if (club.id === '6i') want = avg7 + 6;
      var kept = [];
      all.forEach(function (p) { p.shots.forEach(function (s) { if (s.clubId === club.id && !s._m) kept.push(s); }); });
      var z = kept.map(function () { return normal(rng); });
      var zm = sumOf(z) / z.length;
      z = z.map(function (v) { return v - zm; });
      var sorted = z.slice().sort(function (x, y) { return x - y; });
      var sp = percentile(sorted, 0.9) - percentile(sorted, 0.1) || 1, sc = 11 / sp;
      var lim = Math.floor(0.09 * want);
      kept.forEach(function (s, i) { s.actual = Math.round(want + Math.max(-lim, Math.min(lim, sc * z[i]))); });
      for (var g = 0; g < 60; g++) {
        var cur = roundInt(sumOf(kept.map(function (s) { return s.actual; })) / kept.length);
        if (cur === want) break;
        kept[g % kept.length].actual += cur < want ? 1 : -1;
      }
    });
    all.forEach(function (p) { p.shots.forEach(function (s) { delete s._m; }); });
    walks.forEach(function (w) { w.currentClubId = order[0].id; });
    all.forEach(function (p) { state.practices.push(p); });
  }

  function reset(opts) {
    var state = { unit: 'yd', bag: defaultBag(), practices: [], pro: false, conditions: null };
    if (opts && opts.demo) demoPractices(state);
    save(state);
    return state;
  }

  return {
    TOLERANCE: TOLERANCE,
    STORAGE_KEY: STORAGE_KEY,
    defaultBag: defaultBag,
    load: load,
    save: save,
    reset: reset,
    setUnit: setUnit,
    startPractice: startPractice,
    nextTarget: nextTarget,
    suggestClub: suggestClub,
    addShot: addShot,
    undo: undo,
    finish: finish,
    miss: miss,
    onTarget: onTarget,
    summary: summary,
    gapping: gapping,
    trend: trend,
    bests: bests,
    GAP_BLOCK: GAP_BLOCK,
    startGapping: startGapping,
    addGapShot: addGapShot,
    gapNext: gapNext,
    gapSwitch: gapSwitch,
    gapProgress: gapProgress,
    gapSummary: gapSummary,
    LEARN_WEIGHT: LEARN_WEIGHT,
    LEARN_WINDOW: LEARN_WINDOW,
    carry: carry,
    carryInfo: carryInfo,
    setStock: setStock,
    scaleBag: scaleBag,
    carryChanges: carryChanges,
    BASELINE: BASELINE,
    DENSITY_K: DENSITY_K,
    SAMPLE_CONDITIONS: SAMPLE_CONDITIONS,
    pressureAt: pressureAt,
    airDensity: airDensity,
    conditionsFactor: conditionsFactor,
    setConditions: setConditions,
    clearConditions: clearConditions,
    todayCarry: todayCarry,
    todayDelta: todayDelta,
    gappingToday: gappingToday,
    conditionsDisplay: conditionsDisplay,
    setConditionsDisplay: setConditionsDisplay,
    _genTarget: genTarget,
    _clubRange: clubRange
  };
});
