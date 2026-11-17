/* Run with: node tests.js */
var Engine = require('./engine.js');
var Voice = require('./voice.js');

var passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.log('FAIL: ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}
function eq(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  check(name, g === w, 'got ' + g + ', want ' + w);
}
function newState() { return Engine.reset({ demo: false }); }
function addPractice(state, shots, extra) {
  var p = { id: 'x' + state.practices.length, startedAt: 1000 + state.practices.length, mode: 'bag', clubId: null, planned: 0,
    currentTarget: 100, shots: shots, done: true };
  for (var k in (extra || {})) p[k] = extra[k];
  state.practices.push(p);
  return p;
}
function sh(target, actual, clubId, at) {
  return { target: target, actual: actual, clubId: clubId || null, at: at === undefined ? 0 : at };
}
function gs(clubId, actual, at) { return { clubId: clubId, actual: actual, at: at === undefined ? 1 : at, target: null }; }
function addGap(state, shots, extra) {
  return addPractice(state, shots, Object.assign({ mode: 'gap', currentClubId: null, planned: 0 }, extra || {}));
}

// ---- miss / onTarget ----
eq('miss long', Engine.miss(sh(150, 155)), 5);
eq('miss short', Engine.miss(sh(165, 163)), -2);
eq('miss zero', Engine.miss(sh(100, 100)), 0);
check('onTarget +5', Engine.onTarget(5) === true);
check('onTarget -5', Engine.onTarget(-5) === true);
check('onTarget +6', Engine.onTarget(6) === false);
check('onTarget -6', Engine.onTarget(-6) === false);
check('onTarget 0', Engine.onTarget(0) === true);
eq('constants', [Engine.TOLERANCE, Engine.STORAGE_KEY], [5, 'yardage.v1']);

// ---- summary (hand computed) ----
// misses: +5, -2, +10, 0, -7  -> |.| = 5,2,10,0,7 sum 24 /5 = 4.8 -> 5 ; signed sum 6 /5 = 1.2 -> 1 ; on target: 5,-2,0 = 3
var list = [sh(150, 155, '7i'), sh(165, 163, '6i'), sh(100, 110, 'GW'), sh(120, 120, 'PW'), sh(150, 143, '7i')];
var sm = Engine.summary(list);
eq('summary count', sm.count, 5);
eq('summary avgMiss', sm.avgMiss, 5);
eq('summary bias', sm.bias, 1);
eq('summary onTarget', sm.onTarget, 3);
eq('summary best', sm.best, list[3]);
var by7 = sm.byClub.filter(function (b) { return b.clubId === '7i'; })[0];
eq('summary byClub 7i', by7, { clubId: '7i', count: 2, avgMiss: 6 }); // (5+7)/2 = 6
eq('summary byClub length', sm.byClub.length, 4);
var se = Engine.summary([]);
eq('summary empty', [se.count, se.avgMiss, se.bias, se.onTarget, se.best, se.byClub.length], [0, 0, 0, 0, null, 0]);
eq('summary bias negative (-3.5 rounds half up)', Engine.summary([sh(100, 96), sh(100, 97)]).bias, -3);
check('summary whole numbers', Number.isInteger(Engine.summary([sh(100, 96), sh(100, 97)]).bias));

// ---- gapping ----
(function () {
  var st = newState();
  // 7i: three shots; 150, 155, 160
  addGap(st, [gs('7i', 150), gs('7i', 155), gs('7i', 160)]);
  // game shots never count toward gapping
  addPractice(st, [sh(155, 300, '7i'), sh(149, 999, '7i')]);
  // 6i, six shots: 160..170 step 2 -> avg 165, p10 = 161, p90 = 169
  addGap(st, [160, 162, 164, 166, 168, 170].map(function (a) { return gs('6i', a); }));
  // GW 108 / SW 92 -> avg 100 and 95: tight gap of 5
  addGap(st, [gs('GW', 100), gs('GW', 100), gs('SW', 95)]);
  // 3W 210 avg 200 vs D 230 (no shots): wide gap of 30
  addGap(st, [gs('3W', 200)]);
  var g = Engine.gapping(st);
  function row(id) { return g.clubs.filter(function (c) { return c.clubId === id; })[0]; }
  function gap(u, l) { return g.gaps.filter(function (x) { return x.upperId === u && x.lowerId === l; })[0]; }
  eq('gapping clubs order', g.clubs.map(function (c) { return c.clubId; }), Engine.defaultBag().map(function (c) { return c.id; }));
  eq('gapping 7i small n', [row('7i').n, row('7i').avg, row('7i').lo, row('7i').hi], [3, 155, 150, 160]);
  check('gapping rows carry stock and carry', row('7i').stock === 155 && typeof row('7i').carry === 'number');
  eq('gapping 6i percentile', [row('6i').n, row('6i').avg, row('6i').lo, row('6i').hi], [6, 165, 161, 169]);
  eq('gapping empty club', [row('LW').n, row('LW').avg, row('LW').lo, row('LW').hi], [0, null, null, null]);
  eq('gapping count of gaps', g.gaps.length, 12);
  eq('gapping tight', gap('GW', 'SW'), { upperId: 'GW', lowerId: 'SW', value: 5, flag: 'tight' });
  eq('gapping wide', gap('D', '3W').flag, 'wide');
  eq('gapping wide value', gap('D', '3W').value, 30);
  eq('gapping uses stock when no avg', gap('8i', '9i'), { upperId: '8i', lowerId: '9i', value: 10, flag: null });
  eq('gapping ok flag null', gap('6i', '7i'), { upperId: '6i', lowerId: '7i', value: 10, flag: null });
  eq('gapping exactly 20 not wide', gap('3W', '5W').flag === 'wide', false);
  // off clubs are skipped
  st.bag.forEach(function (c) { if (c.id === '4H') c.on = false; });
  var g2 = Engine.gapping(st);
  check('gapping skips off clubs', g2.clubs.every(function (c) { return c.clubId !== '4H'; }) && g2.gaps.length === 11);
  eq('gapping bridges over off club', g2.gaps.filter(function (x) { return x.upperId === '5W'; })[0].lowerId, '5i');
})();

// ---- suggestClub ----
(function () {
  var st = newState();
  eq('suggest exact', Engine.suggestClub(st, 155), '7i');
  eq('suggest nearest', Engine.suggestClub(st, 160), '6i'); // 160 is 5 from 165 and 5 from 155: tie goes to longer
  eq('suggest tie longer', Engine.suggestClub(st, 150), '7i'); // 145 vs 155 tie -> longer 7i
  eq('suggest very long', Engine.suggestClub(st, 400), 'D');
  eq('suggest very short', Engine.suggestClub(st, 10), 'LW');
  st.bag.forEach(function (c) { if (c.id === '7i') c.on = false; });
  eq('suggest skips off', Engine.suggestClub(st, 155), '6i'); // 165 (d10) vs 145 (d10) tie -> longer
})();

// ---- club mode targets (range scales with the club) ----
[[78, 66, 85, 76, 83], [165, 140, 180, 160, 175], [230, 195, 251, 223, 244]].forEach(function (c) {
  var S = c[0], lo = c[1], hi = c[2], bl = c[3], bh = c[4];
  var r = Engine._clubRange(S);
  eq('club range S=' + S, [r.lo, r.hi, r.bandLo, r.bandHi], [lo, hi, bl, bh]);
  var st = newState(), id = S === 78 ? 'LW' : S === 165 ? '6i' : 'D';
  var p = Engine.startPractice(st, { mode: 'club', clubId: id, planned: 0 }), inBand = 0, N = 5000, ok = true, bad = null, rep = 0;
  for (var i = 0; i < N; i++) {
    var t = Engine.nextTarget(st, p);
    if (t < lo || t > hi) { ok = false; bad = t; }
    if (t >= bl && t <= bh) inBand++;
    if (p.shots.length && p.shots[p.shots.length - 1].target === t) rep++;
    p.shots.push(sh(t, t, null));
  }
  check('club targets in range S=' + S, ok, bad);
  var share = inBand / N;
  check('club targets about 70% in band S=' + S, share > 0.66 && share < 0.74, share);
  check('club targets avoid immediate repeats S=' + S, rep === 0, rep);
});

// ---- bag mode targets ----
(function () {
  var st = newState(), p = Engine.startPractice(st, { mode: 'bag', planned: 0 }), ok = true, far = true, prev = null, bad = '';
  eq('bag practice clubId null', p.clubId, null);
  for (var i = 0; i < 5000; i++) {
    var t = Engine.nextTarget(st, p);
    if (t < 10 || t > 230 || t !== Math.round(t)) { ok = false; bad = 'range ' + t; }
    if (p.shots.length && Math.abs(t - p.shots[p.shots.length - 1].target) <= 15) { far = false; bad = 'close ' + t; }
    p.shots.push(sh(t, t, null));
  }
  check('bag targets within 10..230', ok, bad);
  check('bag targets more than 15 from previous', far, bad);
  st.bag.forEach(function (c) { if (c.id === 'D' || c.id === '3W') c.on = false; });
  var p2 = Engine.startPractice(st, { mode: 'bag', planned: 0 }), max = 0;
  for (var k = 0; k < 500; k++) { var t2 = Engine.nextTarget(st, p2); if (t2 > max) max = t2; p2.shots.push(sh(t2, t2, null)); }
  check('bag max follows longest on club (195)', max <= 195 && max > 150, max);
})();

// ---- addShot / undo / planned ----
(function () {
  var st = newState();
  var p = Engine.startPractice(st, { mode: 'bag', planned: 3 });
  check('startPractice registered', st.practices.indexOf(p) >= 0 && p.currentTarget >= 10 && !p.done);
  var t1 = p.currentTarget;
  var s1 = Engine.addShot(st, p, { actual: t1 + 4, clubId: 'D' });
  eq('addShot target is currentTarget', s1.target, t1);
  eq('addShot stores club', s1.clubId, 'D');
  check('addShot timestamp', typeof s1.at === 'number' && s1.at > 0);
  eq('addShot miss', Engine.miss(s1), 4);
  var t2 = p.currentTarget;
  Engine.addShot(st, p, { actual: t2, clubId: '7i' });
  check('not done after 2 of 3', !p.done);
  var u = Engine.undo(st, p);
  eq('undo returns last shot', u.clubId, '7i');
  eq('undo restores target', p.currentTarget, t2);
  eq('undo removes shot', p.shots.length, 1);
  Engine.addShot(st, p, { actual: p.currentTarget, clubId: '7i' });
  Engine.addShot(st, p, { actual: p.currentTarget, clubId: '7i' });
  check('planned practice done at 3', p.done === true && p.shots.length === 3);
  var u2 = Engine.undo(st, p);
  check('undo clears done', p.done === false && p.shots.length === 2 && u2 !== null);
  Engine.undo(st, p); Engine.undo(st, p);
  eq('undo on empty returns null', Engine.undo(st, p), null);
  var open = Engine.startPractice(st, { mode: 'bag', planned: 0 });
  for (var i = 0; i < 100; i++) Engine.addShot(st, open, { actual: open.currentTarget, clubId: '7i' });
  check('open-ended not done after 100 shots', open.done === false && open.shots.length === 100);
  Engine.finish(st, open);
  check('finish sets done', open.done === true);
})();

// ---- planned practices (compat) finish at the right count ----
[20, 40, 80].forEach(function (n) {
  var st = newState(), p = Engine.startPractice(st, { mode: 'bag', planned: n }), ok = true;
  for (var i = 0; i < n - 1; i++) { Engine.addShot(st, p, { actual: p.currentTarget }); if (p.done) ok = false; }
  check('planned ' + n + ' not done at ' + (n - 1), ok && !p.done);
  Engine.addShot(st, p, { actual: p.currentTarget });
  check('planned ' + n + ' done at ' + n, p.done && p.shots.length === n);
});

// ---- setUnit ----
(function () {
  var st = newState();
  addPractice(st, [sh(150, 155, '7i'), sh(165, 163, '6i')]);
  Engine.setUnit(st, 'm');
  eq('unit set', st.unit, 'm');
  eq('driver 230 yd -> 210 m', st.bag[0].stock, 210);   // 210.31
  eq('7i 155 yd -> 142 m', st.bag.filter(function (c) { return c.id === '7i'; })[0].stock, 142); // 141.73
  eq('shot target 150 -> 137', st.practices[0].shots[0].target, 137); // 137.16
  eq('shot actual 155 -> 142', st.practices[0].shots[0].actual, 142);
  check('all whole numbers', st.bag.every(function (c) { return Number.isInteger(c.stock); }) &&
    st.practices[0].shots.every(function (s) { return Number.isInteger(s.target) && Number.isInteger(s.actual); }));
  Engine.setUnit(st, 'm'); // no-op
  eq('setUnit same unit is no-op', st.bag[0].stock, 210);
  Engine.setUnit(st, 'yd');
  eq('back to yards', [st.unit, st.bag[0].stock], ['yd', 230]);
  eq('round trip bag stays near', st.bag.map(function (c) { return c.stock; }),
    [230, 210, 195, 185, 175, 165, 155, 145, 135, 122, 108, 92, 78]);
})();

// ---- trend & bests ----
(function () {
  var st = newState();
  addPractice(st, [sh(100, 110), sh(100, 90)], { startedAt: 5000 });                      // avg 10, 2 shots
  addPractice(st, [], { startedAt: 1000 });                                              // no shots: excluded
  addPractice(st, [sh(100, 100), sh(100, 101), sh(100, 99), sh(100, 120)], { startedAt: 3000, done: false }); // unfinished: excluded
  var ten = []; for (var i = 0; i < 10; i++) ten.push(sh(100, 100 + (i % 2 ? 3 : -3)));
  addPractice(st, ten, { id: 'ten', startedAt: 2000 });                                  // avg 3, 10 shots
  var tr = Engine.trend(st);
  eq('trend ordering and filtering', tr.map(function (r) { return [r.at, r.avgMiss, r.count]; }), [[2000, 3, 10], [5000, 10, 2]]);
  var b = Engine.bests(st);
  eq('bests avgMiss needs >=10 shots', b.avgMiss, { value: 3, practiceId: 'ten' });
  // streak: ten alternates -3/+3, all on target -> run of 10 ; the unfinished practice has 3 on-target in a row (not counted as longer)
  eq('bests streak', b.streak, { value: 10 });
  eq('bests closest', Engine.miss(b.closest.shot), 0);
  var empty = Engine.bests(newState());
  eq('bests empty', empty, { avgMiss: null, streak: null, closest: null });
})();

// ---- demo data ----
(function () {
  function strip(s) { return JSON.stringify(s); }
  var a = Engine.reset({ demo: true }), b = Engine.reset({ demo: true });
  check('demo identical across resets', strip(a) === strip(b));
  eq('demo practice count', a.practices.length, 10);
  eq('demo gap practices', a.practices.filter(function (p) { return p.mode === 'gap'; }).map(function (p) { return [p.clubId, p.shots.length, p.done]; }), [[null, 65, true], [null, 65, true], ['7i', 12, true]]);
  var bagP = a.practices.filter(function (p) { return p.mode === 'bag'; });
  var clubP = a.practices.filter(function (p) { return p.mode === 'club'; });
  eq('demo bag practices', bagP.map(function (p) { return p.shots.length; }), [24, 18, 42, 22, 35]);
  eq('demo club practices', clubP.map(function (p) { return [p.clubId, p.shots.length]; }), [['7i', 31], ['PW', 27]]);
  check('demo all finished', a.practices.every(function (p) { return p.done; }));
  var span = (Date.now() - Math.min.apply(null, a.practices.map(function (p) { return p.startedAt; }))) / 86400000;
  check('demo spans about 5 weeks', span > 30 && span < 36, span);
  var g = Engine.gapping(a);
  var populated = g.clubs.filter(function (c) { return c.n >= 5; }).length;
  check('demo most clubs have >=5 full shots', populated >= 11, populated);
  var gap67 = g.gaps.filter(function (x) { return x.upperId === '6i' && x.lowerId === '7i'; })[0];
  eq('demo 6i/7i gap is tight', gap67.flag, 'tight');
  eq('demo exactly one tight gap (6i>7i)', g.gaps.filter(function (x) { return x.flag === 'tight'; }).map(function (x) { return x.upperId + '>' + x.lowerId; }), ['6i>7i']);
  eq('demo no wide gaps', g.gaps.filter(function (x) { return x.flag === 'wide'; }).length, 0);
  check('demo averages within 3 of stock except 6i', g.clubs.every(function (c) { return c.clubId === '6i' || Math.abs(c.avg - c.stock) <= 3; }));
  check('demo spreads 10-16 wide', g.clubs.every(function (c) { return c.hi - c.lo >= 10 && c.hi - c.lo <= 16; }), JSON.stringify(g.clubs.map(function (c) { return c.hi - c.lo; })));
  check('demo whole numbers only', a.practices.every(function (p) { return p.shots.every(function (s) { return (s.target === null || Number.isInteger(s.target)) && Number.isInteger(s.actual) && s.actual >= 1; }); }));
  var gr = function (id) { return g.clubs.filter(function (c) { return c.clubId === id; })[0]; };
  check('demo 7i lo above 140 despite mishits', gr('7i').lo > 140, gr('7i').lo);
  check('demo driver lo above 200 despite mishits', gr('D').lo > 200, gr('D').lo);
  check('demo mishits present in the data', a.practices.some(function (p) { return p.shots.some(function (s) { return s.clubId === '7i' && s.actual < 100; }); }) && a.practices.some(function (p) { return p.shots.some(function (s) { return s.clubId === 'D' && s.actual < 160; }); }));
  var tr = Engine.trend(a);
  check('demo trend improves', tr.length === 7 && tr[6].avgMiss <= tr[0].avgMiss, JSON.stringify(tr.map(function (t) { return t.avgMiss; })));
  eq('load under node returns demo', Engine.load().practices.length, 10);
  check('demo practices all planned 0 and done', a.practices.every(function (p) { return p.planned === 0 && p.done === true; }));
  check('demo shots have no full flag', a.practices.every(function (p) { return p.shots.every(function (s) { return !('full' in s); }); }));
  check('no BUCKETS export', Engine.BUCKETS === undefined);
  a.bag.forEach(function (c) {
    var cy = Engine.carry(a, c.id);
    if (c.id === '6i') check('demo 6i carry at least 2 under stock', c.stock - cy >= 2, cy);
    else check('demo ' + c.id + ' carry within 2 of stock', Math.abs(cy - c.stock) <= 2, cy);
  });
  check('demo stockAt 0', a.bag.every(function (c) { return c.stockAt === 0; }));
  eq('reset without demo', Engine.reset({}).practices.length, 0);
})();

// ---- gapping practice: walk, blocks, switching ----
(function () {
  var st = newState();
  eq('GAP_BLOCK', Engine.GAP_BLOCK, 5);
  var p = Engine.startGapping(st, { clubId: null });
  check('startGapping registered', st.practices.indexOf(p) >= 0 && p.mode === 'gap' && p.clubId === null && p.done === false && p.planned === 0 && p.shots.length === 0);
  eq('walk starts at shortest club', p.currentClubId, 'LW');
  eq('progress at start', Engine.gapProgress(st, p), { clubId: 'LW', hit: 0, block: 5 });
  var s1 = Engine.addGapShot(st, p, { actual: 77 });
  eq('gap shot shape', [s1.clubId, s1.actual, s1.target, typeof s1.at], ['LW', 77, null, 'number']);
  eq('progress after 1', Engine.gapProgress(st, p), { clubId: 'LW', hit: 1, block: 5 });
  for (var i = 0; i < 3; i++) Engine.addGapShot(st, p, { actual: 78 });
  eq('still LW after 4', [p.currentClubId, Engine.gapProgress(st, p).hit], ['LW', 4]);
  Engine.addGapShot(st, p, { actual: 79 });
  eq('advances to SW after 5', [p.currentClubId, Engine.gapProgress(st, p).hit], ['SW', 0]);
  // undo after an auto-advance returns to the club of the removed shot
  var u = Engine.undo(st, p);
  eq('undo gap shot', [u.clubId, u.actual, p.currentClubId, p.shots.length, Engine.gapProgress(st, p).hit], ['LW', 79, 'LW', 4, 4]);
  Engine.addGapShot(st, p, { actual: 79 });
  // walk up to the longest club
  var order = ['SW', 'GW', 'PW', '9i', '8i', '7i', '6i', '5i', '4H', '5W', '3W', 'D'];
  order.forEach(function (id) {
    eq('walk is at ' + id, p.currentClubId, id);
    for (var k = 0; k < 5; k++) Engine.addGapShot(st, p, { actual: 100 });
  });
  eq('wraps from longest back to shortest', p.currentClubId, 'LW');
  eq('shot count after full walk', p.shots.length, 65);
  // switching: pass a different clubId
  var p2 = Engine.startGapping(st, { clubId: null });
  Engine.addGapShot(st, p2, { actual: 77 });
  var sw = Engine.addGapShot(st, p2, { actual: 150, clubId: '8i' });
  eq('switch by clubId', [sw.clubId, p2.currentClubId, Engine.gapProgress(st, p2).hit], ['8i', '8i', 1]);
  Engine.addGapShot(st, p2, { actual: 150 });
  eq('keeps current club when no clubId', p2.shots[2].clubId, '8i');
  eq('gapNext skips ahead', [Engine.gapNext(st, p2), p2.currentClubId], ['7i', '7i']);
  Engine.gapSwitch(st, p2, 'D');
  eq('gapSwitch', [p2.currentClubId, Engine.gapProgress(st, p2).hit], ['D', 0]);
  eq('gapNext wraps at longest', Engine.gapNext(st, p2), 'LW');
  // off clubs are skipped in the walk
  var s6 = newState(); s6.bag.forEach(function (c) { if (c.id === 'LW') c.on = false; });
  eq('walk starts at shortest ON club', Engine.startGapping(s6, { clubId: null }).currentClubId, 'SW');
  // one-club gapping never advances
  var one = Engine.startGapping(st, { clubId: '7i' });
  eq('one-club current', one.currentClubId, '7i');
  for (var j = 0; j < 12; j++) Engine.addGapShot(st, one, { actual: 154 });
  eq('one-club stays put with unbounded hit', [one.currentClubId, Engine.gapProgress(st, one).hit], ['7i', 12]);
  eq('gapNext is a no-op in one-club', [Engine.gapNext(st, one), one.currentClubId], ['7i', '7i']);
  Engine.finish(st, one);
  check('finish gap practice', one.done === true);
  eq('undo on empty gap practice', Engine.undo(st, Engine.startGapping(st, { clubId: null })), null);
})();

// ---- gapSummary ----
(function () {
  var st = newState();
  var p = Engine.startGapping(st, { clubId: null });
  [150, 155, 160].forEach(function (a) { Engine.addGapShot(st, p, { actual: a, clubId: '7i' }); });
  [165, 160, 170, 166, 164, 168, 162].forEach(function (a) { Engine.addGapShot(st, p, { actual: a, clubId: '6i' }); });
  Engine.addGapShot(st, p, { actual: 96, clubId: '7i' }); // mishit
  var g = Engine.gapSummary(st, p);
  eq('gapSummary count', g.count, 11);
  eq('gapSummary clubs in bag order', g.clubs.map(function (c) { return c.clubId; }), ['6i', '7i']);
  eq('gapSummary 6i', g.clubs[0], { clubId: '6i', tag: '6i', count: 7, kept: 7, avg: 165, lo: 161, hi: 169 });
  // 7i: 150,155,160,96 -> median 152.5, tolerance round(18.3)=18, 96 dropped -> n 3, avg 155
  eq('gapSummary 7i drops mishit', g.clubs[1], { clubId: '7i', tag: '7i', count: 4, kept: 3, avg: 155, lo: 150, hi: 160 });
})();

// ---- carry learning from gapping shots only ----
(function () {
  var st = newState();
  eq('carry no shots equals stock', Engine.carry(st, '6i'), 165);
  eq('carryInfo no shots', Engine.carryInfo(st, '6i'), { carry: 165, entered: 165, n: 0, learned: false });
  eq('constants learn', [Engine.LEARN_WEIGHT, Engine.LEARN_WINDOW], [5, 30]);
  // game shots never move carry
  var g = Engine.startPractice(st, { mode: 'club', clubId: '6i', planned: 0 });
  for (var q = 0; q < 20; q++) Engine.addShot(st, g, { actual: 100, clubId: '6i' });
  eq('game shots do not move carry', Engine.carry(st, '6i'), 165);
  eq('carryChanges empty for game practice', Engine.carryChanges(st, g), []);
  // hand blend: weight 5*(1-10/30) = 3.3333; (3.3333*165 + 1500)/13.3333 = 153.75 -> 154
  var ten = []; for (var i = 0; i < 10; i++) ten.push(gs('6i', 150, 10 + i));
  var s2 = newState(); addGap(s2, ten);
  eq('carry blend hand-computed', Engine.carry(s2, '6i'), 154);
  eq('carryInfo blend', Engine.carryInfo(s2, '6i'), { carry: 154, entered: 165, n: 10, learned: true });
  eq('4 gap shots not learned', (function () { var s = newState(); addGap(s, [1, 2, 3, 4].map(function (k) { return gs('6i', 150, k); })); return Engine.carryInfo(s, '6i').learned; })(), false);
  // outlier discard: ten shots of 160 plus one 95 -> carry from the tens only: (20*165 + 6*1600)/80 = 161.25 -> 161
  var s3 = newState(); var tens = []; for (var a = 0; a < 10; a++) tens.push(gs('6i', 160, 20 + a)); tens.push(gs('6i', 95, 40));
  addGap(s3, tens);
  eq('outlier discarded from carry', [Engine.carry(s3, '6i'), Engine.carryInfo(s3, '6i').n], [161, 10]);
  eq('outlier discarded from gapping', (function () { var r = Engine.gapping(s3).clubs.filter(function (c) { return c.clubId === '6i'; })[0]; return [r.n, r.avg, r.lo, r.hi]; })(), [10, 160, 160, 160]);
  // 30-shot window: 10 old at 100 (will be outliers anyway if mixed), so use 120 vs 150 windows
  var s4 = newState(), shots = [];
  for (var b = 0; b < 10; b++) shots.push(gs('6i', 140, 100 + b));
  for (var c = 0; c < 30; c++) shots.push(gs('6i', 150, 200 + c));
  addGap(s4, shots);
  eq('30-shot window drops old shots', [Engine.carry(s4, '6i'), Engine.carryInfo(s4, '6i').n], [150, 30]); // full window: stock fades out completely
  eq('gapping uses all time', Engine.gapping(s4).clubs.filter(function (c) { return c.clubId === '6i'; })[0].n, 40);
  // setStock restarts learning but gapping keeps history
  var s5 = newState(); addGap(s5, ten.map(function (x) { return Object.assign({}, x); }));
  Engine.setStock(s5, '6i', 170);
  check('setStock stamps stockAt', s5.bag[5].stock === 170 && s5.bag[5].stockAt > 0);
  eq('carry after setStock ignores older shots', Engine.carry(s5, '6i'), 170);
  eq('gapping still counts older shots', Engine.gapping(s5).clubs.filter(function (c) { return c.clubId === '6i'; })[0].n, 10);
  eq('gapping carry field follows learning', Engine.gapping(s5).clubs.filter(function (c) { return c.clubId === '6i'; })[0].carry, 170);
  // game suggestClub / nextTarget keep using carry
  var s7 = newState(); addGap(s7, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (k) { return gs('7i', 135, k); }));
  eq('7i carry after learning', Engine.carry(s7, '7i'), 140); // (20*155 + 6*1350)/80 = 140
  eq('suggestClub uses carry', Engine.suggestClub(s7, 142), '7i');
  eq('suggestClub follows learned carry', Engine.suggestClub(s7, 143), '8i');
})();

// ---- 300-shot simulation in gap mode ----
(function () {
  function sim(trueCarry, seed) {
    var st = newState(), a = seed >>> 0;
    function rand() { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    var p = Engine.startGapping(st, { clubId: '6i' }), maxC = 0, noise = 0;
    for (var i = 0; i < 300; i++) {
      // symmetric noise: every second shot mirrors the previous one
      noise = i % 2 === 0 ? Math.round((rand() + rand() + rand() - 1.5) * 8) : -noise;
      Engine.addGapShot(st, p, { actual: trueCarry + noise });
      maxC = Math.max(maxC, Engine.carry(st, '6i'));
    }
    return { fin: Engine.carry(st, '6i'), max: maxC };
  }
  var r1 = sim(150, 7), r2 = sim(165, 11);
  check('gap sim: entered 165, true 150 ends within 1 of 150', Math.abs(r1.fin - 150) <= 1, r1.fin);
  check('gap sim: carry never rises above entered', r1.max <= 165, r1.max);
  check('gap sim: true carry equal to stock stays within 1', Math.abs(r2.fin - 165) <= 1, r2.fin);
  (function () { var st = newState(); addGap(st, Array.apply(null, Array(30)).map(function (_, k) { return gs('6i', 150, 10 + k); })); eq('full window of 150s gives exactly 150', Engine.carry(st, '6i'), 150); })();
  (function () { var st = newState(); Engine.setStock(st, '6i', 220); st.bag[5].stockAt = 0; addGap(st, Array.apply(null, Array(30)).map(function (_, k) { return gs('6i', 150, 10 + k); })); eq('full window ignores entered stock', Engine.carry(st, '6i'), 150); })();
})();

(function () {
  var st = newState();
  Engine.scaleBag(st, '7i', 165);
  var byId = {}; st.bag.forEach(function (c) { byId[c.id] = c; });
  eq('scaleBag anchor exact', byId['7i'].stock, 165);
  eq('scaleBag driver', byId['D'].stock, Math.round(230 * 165 / 155));
  eq('scaleBag 3W', byId['3W'].stock, Math.round(210 * 165 / 155));
  eq('scaleBag LW', byId['LW'].stock, Math.round(78 * 165 / 155));
  check('scaleBag stamps stockAt', st.bag.every(function (c) { return c.stockAt > 0; }));
  var sm = newState(); Engine.setUnit(sm, 'm'); Engine.scaleBag(sm, 'D', 200);
  eq('scaleBag in meters', [sm.bag[0].stock, sm.bag[12].stock], [200, Math.round(78 * 200 / 230)]);
})();

(function () {
  var st = newState();
  addGap(st, [10, 11, 12, 13, 14].map(function (k) { return gs('7i', 155, k); }), { id: 'old' });
  var cur = [145, 145, 145, 145, 145].map(function (a, i) { return gs('7i', a, 100 + i); });
  cur.push(gs('6i', 164, 110));
  var p = addGap(st, cur, { id: 'cur' });
  eq('carryChanges', Engine.carryChanges(st, p), [{ clubId: '7i', tag: '7i', before: 155, after: 151 }]);
  eq('carryChanges none when no shots', Engine.carryChanges(st, addGap(st, [], { id: 'empty' })), []);
})();

(function () {
  var store = {};
  var old = { unit: 'yd', pro: false, bag: Engine.defaultBag().map(function (c) { delete c.stockAt; return c; }),
    practices: [{ id: 'o', startedAt: 1, mode: 'bag', clubId: null, planned: 0, currentTarget: 100, done: true,
      shots: [{ target: 155, actual: 150, clubId: '7i', at: 5, full: true }, { target: 120, actual: 125, clubId: '7i', at: 6, full: false }] }] };
  store['yardage.v1'] = JSON.stringify(old);
  global.localStorage = { getItem: function (k) { return store[k] || null; }, setItem: function (k, v) { store[k] = v; } };
  var s = Engine.load();
  delete global.localStorage;
  check('migration stockAt', s.bag.every(function (c) { return c.stockAt === 0; }));
  check('migration strips full flags', s.practices[0].shots.every(function (x) { return !('full' in x); }));
  eq('migration: game shots leave carry at stock', Engine.carry(s, '7i'), 155);
})();

// ---- trend / bests / summary ignore gap practices ----
(function () {
  var st = newState();
  addPractice(st, [sh(100, 110), sh(100, 90)], { id: 'g1', startedAt: 5000 });
  var before = JSON.stringify([Engine.trend(st), Engine.bests(st)]);
  var many = []; for (var i = 0; i < 30; i++) many.push(gs('7i', 155, i));
  addGap(st, many, { startedAt: 6000 });
  eq('trend and bests unchanged by gap practice', JSON.stringify([Engine.trend(st), Engine.bests(st)]), before);
  var sm = Engine.summary(many);
  eq('summary ignores shots without a target', [sm.count, sm.best, sm.avgMiss], [0, null, 0]);
})();

// ---- setUnit with gap shots ----
(function () {
  var st = Engine.reset({ demo: true }), before = {};
  st.bag.forEach(function (c) { before[c.id] = Engine.carry(st, c.id); });
  Engine.setUnit(st, 'm');
  var gp = st.practices.filter(function (p) { return p.mode === 'gap'; })[0];
  check('setUnit leaves null targets alone', gp.shots.every(function (s) { return s.target === null && Number.isInteger(s.actual); }));
  Engine.setUnit(st, 'yd');
  check('setUnit round trip keeps carries within 1', st.bag.every(function (c) { return Math.abs(Engine.carry(st, c.id) - before[c.id]) <= 1; }), JSON.stringify(st.bag.map(function (c) { return Engine.carry(st, c.id) - before[c.id]; })));
  check('setUnit leaves stockAt', st.bag.every(function (c) { return c.stockAt === 0; }));
})();

// ---- Voice ----
check('Voice.canSpeak false under node', Voice.canSpeak === false);
check('Voice.canListen false under node', Voice.canListen === false);
(function () {
  var fired = 0; Voice.speak('hello', { onend: function () { fired++; } });
  Voice.sayTarget(165, 'yd', { onend: function () { fired++; } });
  eq('speak calls onend when unsupported', fired, 2);
  var states = []; var stop = Voice.listen({ onText: function () {}, onState: function (s) { states.push(s); } });
  eq('listen reports unsupported', states, ['unsupported']);
  check('listen returns stop fn', typeof stop === 'function' && stop() === undefined);
})();

var BAG = Engine.defaultBag();
function ctx(target, bagMod, mode) {
  var bag = JSON.parse(JSON.stringify(BAG));
  if (bagMod) bagMod(bag);
  var c = { target: target, bag: bag, lastClubId: null };
  if (mode) c.mode = mode;
  return c;
}
function show(r) {
  if (r.type === 'shot') return 'shot ' + r.distance + ' ' + r.clubId;
  if (r.type === 'club') return 'club ' + r.clubId;
  if (r.type === 'command') return 'cmd ' + r.name + (r.distance !== undefined ? ' ' + r.distance : '');
  return r.type;
}
function vp(text, target, want, bagMod, mode) {
  var got;
  try { got = show(Voice.parse(text, ctx(target, bagMod, mode))); } catch (e) { got = 'THROW ' + e.message; }
  check('parse "' + text + '"' + (mode ? ' [' + mode + ']' : '') + ' @' + target, got === want, 'got ' + got + ', want ' + want);
}

// distances, no club
vp('163', 165, 'shot 163 null');
vp('one sixty three', 165, 'shot 163 null');
vp('one sixty-three', 165, 'shot 163 null');
vp('one hundred sixty three', 165, 'shot 163 null');
vp('one hundred and sixty three', 165, 'shot 163 null');
vp('a hundred and sixty three', 165, 'shot 163 null');
vp('one six three', 165, 'shot 163 null');
vp('160 3', 165, 'shot 163 null');
vp('1 63', 165, 'shot 163 null');
vp('ninety five', 100, 'shot 95 null');
vp('95', 100, 'shot 95 null');
vp('two ten', 205, 'shot 210 null');
vp('two hundred ten', 205, 'shot 210 null');
vp('two hundred and ten', 205, 'shot 210 null');
vp('210', 205, 'shot 210 null');
vp('eighty', 80, 'shot 80 null');
vp('one hundred', 105, 'shot 100 null');
vp('100', 105, 'shot 100 null');
vp('a hundred', 105, 'shot 100 null');
vp('one oh five', 100, 'shot 105 null');
vp('one fifty five', 150, 'shot 155 null');
vp('sixty three', 60, 'shot 63 null');
vp('one 63 yards', 165, 'shot 163 null');
vp('163 yards', 165, 'shot 163 null');
vp('about 163', 165, 'shot 163 null');
vp('it went 163', 165, 'shot 163 null');
// irons and the disambiguation rule
vp('7 iron 163', 165, 'shot 163 7i');
vp('seven iron one sixty three', 165, 'shot 163 7i');
vp('seven 163', 165, 'shot 163 7i');
vp('163 seven iron', 165, 'shot 163 7i');
vp('one sixty three seven iron', 165, 'shot 163 7i');
vp('7i 163', 165, 'shot 163 7i');
vp('163 7i', 165, 'shot 163 7i');
vp('7-iron 163', 165, 'shot 163 7i');
vp('SEVEN IRON, 163 yards.', 165, 'shot 163 7i');
vp('seven one sixty three', 165, 'shot 163 7i');
vp('six 150', 155, 'shot 150 6i');
vp('nine iron 130', 135, 'shot 130 9i');
vp('with a seven iron it carried about one sixty three yards', 165, 'shot 163 7i');
vp('7 iron went 140 meters', 142, 'shot 140 7i');
vp('seven iron one forty', 140, 'shot 140 7i');
// woods, driver, hybrid
vp('driver 230', 225, 'shot 230 D');
vp('Driver, 228 yards', 225, 'shot 228 D');
vp('driver two thirty', 225, 'shot 230 D');
vp('three wood two ten', 205, 'shot 210 3W');
vp('3 wood 205', 205, 'shot 205 3W');
vp('3w 205', 205, 'shot 205 3W');
vp('five wood one ninety', 195, 'shot 190 5W');
vp('four hybrid 185', 185, 'shot 185 4H');
vp('hybrid 185', 185, 'shot 185 4H');
vp('rescue 185', 185, 'shot 185 4H');
// wedges
vp('pitching wedge 120', 122, 'shot 120 PW');
vp('pitching 120', 122, 'shot 120 PW');
vp('wedge 120', 122, 'shot 120 PW');
vp('pw 120', 122, 'shot 120 PW');
vp('p w 120', 122, 'shot 120 PW');
vp('gap wedge 108', 108, 'shot 108 GW');
vp('gap 108', 108, 'shot 108 GW');
vp('gw 108', 108, 'shot 108 GW');
vp('sand wedge 92', 92, 'shot 92 SW');
vp('sand 92', 92, 'shot 92 SW');
vp('sw ninety two', 92, 'shot 92 SW');
vp('lob wedge 78', 78, 'shot 78 LW');
vp('lob 78', 78, 'shot 78 LW');
vp('lw seventy eight', 78, 'shot 78 LW');
vp('95 sand wedge', 92, 'shot 95 SW');
// commands
vp('scratch that', 150, 'cmd undo');
vp('undo', 150, 'cmd undo');
vp('delete that', 150, 'cmd undo');
vp('correction 168', 165, 'cmd correct 168');
vp('correction one sixty eight', 165, 'cmd correct 168');
vp('make that 168', 165, 'cmd correct 168');
vp('repeat', 150, 'cmd repeat');
vp('say again', 150, 'cmd repeat');
vp('what was it', 150, 'cmd repeat');
vp('skip', 150, 'cmd skip');
vp('pause', 150, 'cmd pause');
vp('resume', 150, 'cmd resume');
vp('done', 150, 'cmd done');
vp('finish', 150, 'cmd done');
vp("that's it", 150, 'cmd done');
vp('Undo.', 150, 'cmd undo');
['skip it', 'skip that', 'cancel', 'cancel that', 'next', 'next one', 'pass', 'another', 'another one', 'different number', 'too far', 'too long',
  "that's too far", "can't reach", "can't reach that", "can't hit that", 'no way'].forEach(function (ph) { vp(ph, 150, 'cmd skip'); });
vp('next 163', 165, 'unclear');
vp('cancel 150', 150, 'unclear');
vp('too far 160', 160, 'unclear');
vp('another seven iron', 150, 'unclear');
// unclear and implausible
vp('', 150, 'unclear');
vp('banana', 150, 'unclear');
vp('um', 150, 'unclear');
vp('seven iron', 150, 'club 7i');
vp('driver', 150, 'club D');
vp('pw', 150, 'club PW');
vp('Pitching wedge', 150, 'club PW');
vp('three wood', 150, 'club 3W');
vp('hybrid', 150, 'club 4H');
vp('7i', 150, 'club 7i');
vp('with a seven iron', 150, 'club 7i');
vp('next club', 150, 'cmd skip');
vp('seven iron seven iron', 150, 'unclear');
vp('driver pw', 150, 'unclear');
vp('7 iron', 150, 'unclear', function (b) { b.forEach(function (c) { if (c.id === '7i') c.on = false; }); });
vp('iron', 150, 'unclear');
vp('seven', 150, 'unclear');
// gapping mode widens the window to +/- 80 around the carry
vp('163', 235, 'shot 163 null', null, 'gap');
vp('163', 245, 'unclear', null, 'gap');
vp('163', 235, 'unclear');
vp('seven iron 160', 230, 'shot 160 7i', null, 'gap');
vp('seven iron 160', 241, 'unclear', null, 'gap');
vp('driver', 230, 'club D', null, 'gap');
vp('banana', 230, 'unclear', null, 'gap');
vp('correction 160', 230, 'cmd correct 160', null, 'gap');
vp('scratch that', 230, 'cmd undo', null, 'gap');
vp('500', 150, 'unclear');
vp('7 iron 300', 150, 'unclear');
vp('163', 300, 'unclear');
vp('0', 50, 'unclear');
vp('sixty', 200, 'unclear');
vp('correction 400', 150, 'unclear');
vp('correction banana', 150, 'unclear');
vp('7 iron 163 banana', 165, 'unclear');
vp('driver seven iron 160', 160, 'unclear');
vp('163.5', 165, 'unclear');
vp('iron 163', 165, 'unclear');
vp('7 iron 163 yards and then some', 165, 'unclear');
vp('scratch that 150', 150, 'unclear');
// bag membership
vp('7 iron 163', 165, 'unclear', function (b) { b.forEach(function (c) { if (c.id === '7i') c.on = false; }); });
vp('hybrid 185', 185, 'unclear', function (b) { b.forEach(function (c) { if (c.id === '4H') c.on = false; }); });
vp('2 iron 200', 200, 'unclear');
check('parse tolerates missing ctx', Voice.parse('163').type === 'shot' && Voice.parse('banana').type === 'unclear');

// ---- Voice delivery ----
[[1, 'one'], [9, 'nine'], [10, 'ten'], [40, 'forty'], [45, 'forty-five'], [95, 'ninety-five'], [100, 'one hundred'], [105, 'one oh five'],
 [110, 'one ten'], [112, 'one twelve'], [142, 'one forty-two'], [165, 'one sixty-five'], [190, 'one ninety'], [200, 'two hundred'],
 [205, 'two oh five'], [210, 'two ten'], [235, 'two thirty-five'], [300, 'three hundred'], [350, 'three fifty'], [309, 'three oh nine']].forEach(function (p) {
  check('spokenNumber ' + p[0], Voice.spokenNumber(p[0]) === p[1]);
});
check('targetPhrase first yards', Voice._targetPhrase(165, 'yd', true, 0) === 'Here we go. One sixty-five yards.');
check('targetPhrase first meters', Voice._targetPhrase(142, 'm', true, 1) === "Let's get started. One forty-two meters.");
check('targetPhrase third opener', Voice._targetPhrase(95, 'yd', true, 2) === 'Alright. Ninety-five yards.');
check('targetPhrase later yards', Voice._targetPhrase(142, 'yd', false) === 'One forty-two.');
check('targetPhrase later meters', Voice._targetPhrase(142, 'm', false) === 'One forty-two.');
check('clubPhrase later', Voice._clubPhrase('7 iron', false) === 'Seven iron.');
check('clubPhrase first', Voice._clubPhrase('Pitching wedge', true, 0) === 'Here we go. Pitching wedge.');
(function () {
  var R = Voice._rankVoices, names = function (l) { return R(l).map(function (v) { return v.name; }); };
  var david = { name: 'Microsoft David - English (United States)', lang: 'en-US' };
  var sam = { name: 'Samantha', lang: 'en-US' };
  var goog = { name: 'Google US English', lang: 'en-US' };
  var nat = { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US' };
  var fr = { name: 'Microsoft Julie Online (Natural) - French', lang: 'fr-FR' };
  check('rank natural beats google', names([goog, nat])[0] === nat.name);
  check('rank google beats samantha', names([sam, goog])[0] === goog.name);
  check('rank samantha beats david', names([david, sam])[0] === sam.name);
  check('rank en-US beats en-GB at equal quality', names([{ name: 'Foo Voice', lang: 'en-GB' }, { name: 'Bar Voice', lang: 'en-US' }])[0] === 'Bar Voice');
  check('rank en-US natural beats en-GB natural', names([{ name: 'Sonia Online (Natural)', lang: 'en-GB' }, nat])[0] === nat.name);
  check('rank never picks non-English', names([fr, david])[0] === david.name && names([fr]).length === 0);
  check('rank robotic en-US below plain en-US', names([david, { name: 'Other', lang: 'en-US' }])[0] === 'Other');
  check('voiceName null under node', Voice.voiceName() === null && Voice.voices().length === 0);
})();
(function () {
  var n = 0; Voice.speak('hello there', { onend: function () { n++; } });
  check('speak under node calls onend once', n === 1);
})();

// ---- air conditions ----
(function () {
  var E = Engine, B = E.BASELINE;
  eq('baseline', B, { tempC: 21.1, elevationM: 0, pressureHpa: 1013.25 });
  eq('density k', E.DENSITY_K, 0.41);
  check('pressureAt 0', E.pressureAt(0) === 1013.25);
  check('pressureAt 1600 ~835', Math.abs(E.pressureAt(1600) - 835) < 1, E.pressureAt(1600));
  check('density baseline', Math.abs(E.airDensity(B) - 1.199) < 0.002, E.airDensity(B));
  check('density null pressure uses elevation', Math.abs(E.airDensity({ tempC: 21.1, elevationM: 0, pressureHpa: null }) - E.airDensity(B)) < 1e-9);
  check('factor null exactly 1', E.conditionsFactor(null) === 1);
  check('factor baseline ~1', Math.abs(E.conditionsFactor({ tempC: 21.1, elevationM: 0, pressureHpa: null }) - 1) < 1e-9);
  check('factor hot >1', E.conditionsFactor({ tempC: 35, elevationM: 0 }) > 1);
  check('factor high >1', E.conditionsFactor({ tempC: 21, elevationM: 1600 }) > 1);
  check('factor cold <1', E.conditionsFactor({ tempC: 7, elevationM: 0 }) < 1);
  var P = 1013.25 * Math.pow(1 - 2.25577e-5 * 1600, 5.25588);
  var rho = P * 100 / (287.05 * (21.1 + 273.15)), rho0 = 101325 / (287.05 * (21.1 + 273.15));
  var want = 1 + 0.41 * (rho0 - rho) / rho0;
  var f = E.conditionsFactor({ tempC: 21.1, elevationM: 1600, pressureHpa: null });
  check('factor hand 1600m', Math.abs(f - want) < 1e-12 && Math.abs(P - 835) < 1, f + ' vs ' + want);
  var st = newState();
  st.bag.filter(function (c) { return c.id === '7i'; })[0].stock = 150;
  E.setConditions(st, { tempC: 21.1, elevationM: 1600, pressureHpa: null, source: 'manual' });
  eq('150 carry rounded product', E.todayCarry(st, '7i'), Math.round(150 * want));
  // explicit pressure overrides elevation
  E.setConditions(st, { tempC: 21.1, elevationM: 1600, pressureHpa: 1013.25, source: 'device' });
  eq('explicit pressure overrides', E.todayCarry(st, '7i'), 150);
  check('explicit pressure factor ~1', Math.abs(E.conditionsFactor(st.conditions) - 1) < 1e-9);
  // clamping
  E.setConditions(st, { tempC: 99, elevationM: 9000, source: 'manual' });
  eq('clamp high', [st.conditions.tempC, st.conditions.elevationM, st.conditions.pressureHpa], [50, 4500, null]);
  E.setConditions(st, { tempC: -80, elevationM: -1000, source: 'sample' });
  eq('clamp low', [st.conditions.tempC, st.conditions.elevationM, st.conditions.source], [-30, -400, 'sample']);
  check('at timestamp', typeof st.conditions.at === 'number' && Math.abs(st.conditions.at - Date.now()) < 5000);
  E.clearConditions(st);
  eq('clear', st.conditions, null);
  eq('todayDelta null conditions 0', E.todayDelta(st, '7i'), 0);
  eq('reset conditions null', newState().conditions, null);

  // samples on demo bag
  var demo = E.reset({ demo: true });
  eq('sample ids', E.SAMPLE_CONDITIONS.map(function (s) { return s.id; }), ['cool', 'hot', 'high']);
  E.SAMPLE_CONDITIONS.forEach(function (s) {
    E.setConditions(demo, { tempC: s.tempC, elevationM: s.elevationM, source: 'sample' });
    var d7 = E.todayDelta(demo, '7i'), dD = E.todayDelta(demo, 'D');
    check('delta sign ' + s.id, s.id === 'cool' ? d7 < 0 && dD < 0 : d7 > 0 && dD > 0, d7 + ',' + dD);
    check('whole ' + s.id, [E.todayCarry(demo, '7i'), d7, E.todayCarry(demo, 'D'), dD].every(Number.isInteger));
    eq('delta = today - carry ' + s.id, d7, E.todayCarry(demo, '7i') - E.carry(demo, '7i'));
  });

  // gappingToday
  E.clearConditions(demo);
  var g = E.gapping(demo), gt = E.gappingToday(demo);
  var stripped = JSON.parse(JSON.stringify(gt));
  stripped.clubs.forEach(function (c) { eq('null cond delta 0 ' + c.clubId, c.delta, 0); delete c.base; delete c.delta; });
  eq('gappingToday null == gapping', stripped, g);
  gt.clubs.forEach(function (c, i) { eq('base rule ' + c.clubId, c.base, g.clubs[i].avg != null ? g.clubs[i].avg : g.clubs[i].carry); });
  E.setConditions(demo, { tempC: 21, elevationM: 1600, source: 'sample' });
  gt = E.gappingToday(demo);
  var allWhole = true;
  gt.clubs.forEach(function (c) {
    var shown = c.avg != null ? c.avg : c.carry;
    check('high shown>=base ' + c.clubId, shown >= c.base && c.delta === shown - c.base);
    [c.carry, c.avg, c.lo, c.hi, c.base, c.delta].forEach(function (v) { if (v !== null && !Number.isInteger(v)) allWhole = false; });
  });
  check('gappingToday whole', allWhole);
  eq('gappingToday length', [gt.clubs.length, gt.gaps.length], [g.clubs.length, g.gaps.length]);
  gt.gaps.forEach(function (gp, i) {
    var u = gt.clubs[i], l = gt.clubs[i + 1];
    var uv = u.avg != null ? u.avg : u.carry, lv = l.avg != null ? l.avg : l.carry;
    check('gap recomputed ' + gp.upperId, gp.value === uv - lv && gp.upperId === u.clubId && gp.lowerId === l.clubId);
    check('gap flag ' + gp.upperId, gp.flag === (gp.value < 8 ? 'tight' : gp.value > 20 ? 'wide' : null));
  });
  eq('gappingToday keeps null lo', E.gappingToday(newState()).clubs[0].lo, null);

  // display round trip
  var ds = newState();
  eq('display null', E.conditionsDisplay(ds), null);
  E.setConditionsDisplay(ds, { temp: 45, elevation: 5200 });
  var cd = E.conditionsDisplay(ds);
  check('yd roundtrip', Math.abs(cd.temp - 45) <= 1 && Math.abs(cd.elevation - 5200) <= 50, JSON.stringify(cd));
  eq('yd units', [cd.tempUnit, cd.elevationUnit], ['F', 'ft']);
  eq('manual no pressure', [ds.conditions.source, ds.conditions.pressureHpa], ['manual', null]);
  check('ft multiple of 50', cd.elevation % 50 === 0 && Number.isInteger(cd.temp));
  ds.unit = 'm';
  cd = E.conditionsDisplay(ds);
  check('m display whole', Number.isInteger(cd.temp) && cd.elevation % 10 === 0 && cd.tempUnit === 'C' && cd.elevationUnit === 'm', JSON.stringify(cd));
  E.setConditionsDisplay(ds, { temp: 12, elevation: 840 });
  cd = E.conditionsDisplay(ds);
  check('m roundtrip', Math.abs(cd.temp - 12) <= 1 && Math.abs(cd.elevation - 840) <= 10, JSON.stringify(cd));
  var us = newState();
  E.setConditions(us, { tempC: 10, elevationM: 500, source: 'manual' });
  var before = JSON.stringify(us.conditions);
  E.setUnit(us, 'm'); E.setUnit(us, 'yd');
  eq('setUnit keeps conditions', JSON.stringify(us.conditions), before);

  // startGapping snapshot
  var gs1 = newState();
  eq('startGapping null cond', E.startGapping(gs1, {}).conditions, null);
  E.setConditions(gs1, { tempC: 30, elevationM: 100, source: 'sample' });
  var gp = E.startGapping(gs1, { clubId: '7i' });
  eq('startGapping snapshot', gp.conditions, gs1.conditions);
  E.setConditions(gs1, { tempC: 5, elevationM: 0, source: 'manual' });
  eq('snapshot independent', gp.conditions.tempC, 30);

  // load migration
  var store = {};
  global.localStorage = { getItem: function (k) { return store[k] || null; }, setItem: function (k, v) { store[k] = v; } };
  var old = newState(); delete old.conditions;
  store[E.STORAGE_KEY] = JSON.stringify(old);
  eq('load migrates conditions', E.load().conditions, null);
  delete global.localStorage;
})();

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
