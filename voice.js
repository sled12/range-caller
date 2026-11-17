/* voice.js - speech parsing, speaking and listening. Safe to load under Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.Voice = factory(root);
})(typeof window !== 'undefined' ? window : this, function (root) {
  'use strict';

  // ---------- vocabulary ----------
  var UNITS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  var TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  var TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  var FILLER = {};
  ('with a about yards yard meters meter metres metre carried carry went it the i hit that was for at of my uh um ' +
   'ok okay so like got ball flew only just around approximately roughly total please').split(' ').forEach(function (w) { FILLER[w] = 1; });

  var COMMANDS = [
    ['undo', /^(scratch that|scratch it|undo|undo that|undo it|undo last|delete that|delete it|delete last)$/],
    ['repeat', /^(repeat|repeat that|repeat it|say again|say that again|say it again|again|what was it|what was that|what is it)$/],
    ['skip', /^(skip|skip it|skip that|skip this|skip this one|cancel|cancel that|cancel it|next|next one|next club|pass|another|another one|different number|too far|too long|thats too far|thats too long|cant reach|cant reach that|cant hit that|no way)$/],
    ['pause', /^(pause|pause it|hold on|wait)$/],
    ['resume', /^(resume|continue|go on|carry on|unpause|resume practice)$/],
    ['done', /^(done|finish|finished|im done|i am done|thats it|that is it|thats all|all done|finish practice|end session)$/]
  ];
  var CORRECT_RE = /^(correction|correct|correct that|correct it to|make that|make it|change that to|change it to|actually|i meant)\s+(.+)$/;

  function normalize(text) {
    var s = String(text == null ? '' : text).toLowerCase();
    s = s.replace(/['’]/g, '');
    s = s.replace(/[^a-z0-9\s]/g, ' ');
    s = s.replace(/(\d)(iron|wood|hybrid)\b/g, '$1 $2');
    s = s.replace(/\b([pgsl]) w\b/g, '$1w');
    return s.replace(/\s+/g, ' ').trim();
  }

  function tokensOf(s) {
    var raw = s ? s.split(' ') : [], out = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i];
      if (t === 'a' && raw[i + 1] === 'hundred') { out.push('one'); continue; }
      if (t === 'and') { if (raw[i - 1] === 'hundred') out.push(t); continue; }
      if (FILLER[t]) continue;
      out.push(t);
    }
    return out;
  }

  // ---------- numbers ----------
  function isDigits(t) { return /^\d{1,4}$/.test(t); }
  function small(t) {
    if (isDigits(t)) return parseInt(t, 10);
    if (UNITS.hasOwnProperty(t)) return UNITS[t];
    if (TEENS.hasOwnProperty(t)) return TEENS[t];
    if (TENS.hasOwnProperty(t)) return TENS[t];
    return null;
  }
  function unit19(t) {
    if (/^[1-9]$/.test(t)) return parseInt(t, 10);
    if (UNITS.hasOwnProperty(t) && UNITS[t] > 0) return UNITS[t];
    return null;
  }

  function atomVals(t, i, j) {
    var n = j - i, out = [], v;
    if (n === 1) {
      if (t[i] === 'hundred') return [100];
      v = small(t[i]);
      if (v !== null) out.push(v);
    } else if (n === 2) {
      if (TENS.hasOwnProperty(t[i]) && UNITS.hasOwnProperty(t[i + 1]) && UNITS[t[i + 1]] > 0 && t[i + 1] !== 'oh') out.push(TENS[t[i]] + UNITS[t[i + 1]]);
      else if (t[i + 1] === 'hundred' && unit19(t[i]) !== null) out.push(unit19(t[i]) * 100);
    }
    if (n >= 3 && t[i + 1] === 'hundred' && unit19(t[i]) !== null) {
      var k = i + 2;
      if (t[k] === 'and') k++;
      if (k < j) {
        var hasH = false;
        for (var x = k; x < j; x++) if (t[x] === 'hundred') hasH = true;
        if (!hasH) atomVals(t, k, j).forEach(function (r) { if (r >= 1 && r <= 99) out.push(unit19(t[i]) * 100 + r); });
      }
    } else if (n === 2 && t[i + 1] !== 'hundred' && t[i] !== 'hundred') {
      // handled above
    }
    return out;
  }

  // All plausible integer readings of a token run.
  function numberCands(t) {
    var n = t.length, res = {};
    if (n === 0 || n > 8) return [];
    function add(v) { if (v >= 1 && v <= 9999) res[v] = 1; }
    function rec(pos, groups, slices) {
      if (pos === n) {
        if (groups.length === 1) { add(groups[0]); return; }
        if (groups[0] === 0) return;
        var s = groups.join('');
        if (s.length <= 4) add(parseInt(s, 10));
        if (groups.length === 2) {
          var a = groups[0], b = groups[1];
          if (a >= 100 && a % 10 === 0 && b >= 1 && b <= 9) add(a + b);
          else if (a >= 100 && a % 100 === 0 && b >= 1 && b <= 99) add(a + b);
        }
        return;
      }
      for (var j = pos + 1; j <= n; j++) {
        var vals = atomVals(t, pos, j);
        for (var q = 0; q < vals.length; q++) {
          // "twenty" "five" as two groups is never a real reading
          var prev = slices.length ? slices[slices.length - 1] : null;
          if (prev && prev.len === 1 && TENS.hasOwnProperty(t[prev.start]) && UNITS.hasOwnProperty(t[pos]) && unit19(t[pos]) !== null && !isDigits(t[pos])) continue;
          rec(j, groups.concat(vals[q]), slices.concat({ start: pos, len: j - pos }));
        }
      }
    }
    rec(0, [], []);
    return Object.keys(res).map(Number);
  }

  // ---------- clubs ----------
  function findSpan(tokens) {
    var spans = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i], nx = tokens[i + 1], m;
      if ((m = /^([1-9])([iwh])$/.exec(t))) { spans.push({ s: i, e: i + 1, tag: m[1] + m[2] }); continue; }
      if (unit19(t) !== null && (nx === 'iron' || nx === 'wood' || nx === 'hybrid')) {
        spans.push({ s: i, e: i + 2, tag: unit19(t) + (nx === 'iron' ? 'i' : nx === 'wood' ? 'w' : 'h') });
        i++; continue;
      }
      if (t === 'driver') { spans.push({ s: i, e: i + 1, tag: 'd' }); continue; }
      if (t === 'pw' || t === 'gw' || t === 'sw' || t === 'lw') { spans.push({ s: i, e: i + 1, tag: t }); continue; }
      if (t === 'hybrid' || t === 'rescue') { spans.push({ s: i, e: i + 1, tag: 'hyb' }); continue; }
      var wedge = { pitching: 'pw', gap: 'gw', sand: 'sw', lob: 'lw' }[t];
      if (wedge) { var e = nx === 'wedge' ? i + 2 : i + 1; spans.push({ s: i, e: e, tag: wedge }); i = e - 1; continue; }
      if (t === 'wedge') { spans.push({ s: i, e: i + 1, tag: 'pw' }); continue; }
      if (t === 'iron' || t === 'wood') { spans.push({ s: i, e: i + 1, tag: '?' }); continue; }
    }
    return spans;
  }

  function resolveClub(bag, tag) {
    var list = (bag || []).filter(function (c) { return c && c.on; });
    for (var i = 0; i < list.length; i++) {
      var c = list[i], ct = String(c.tag || c.id).toLowerCase();
      if (tag === 'hyb' ? /h$/.test(ct) : ct === tag) return c.id;
    }
    return null;
  }

  var WINDOW = 60;
  function plausible(d, target) {
    if (!(d >= 1 && d <= 400)) return false;
    return typeof target === 'number' && isFinite(target) ? Math.abs(d - target) <= WINDOW : true;
  }

  function nearest(cands, target) {
    var best = null;
    cands.forEach(function (d) {
      if (!plausible(d, target)) return;
      if (best === null || Math.abs(d - target) < Math.abs(best - target)) best = d;
    });
    return best;
  }

  // ---------- parse ----------
  var UNCLEAR = { type: 'unclear' };

  function parse(text, ctx) {
    ctx = ctx || {};
    WINDOW = ctx.mode === 'gap' ? 80 : 60;
    try { return parseInner(text, ctx); } catch (e) { return UNCLEAR; }
  }

  function parseInner(text, ctx) {
    var raw = String(text == null ? '' : text);
    if (/\d\.\d/.test(raw)) return UNCLEAR;
    var s = normalize(raw);
    if (!s) return UNCLEAR;
    var target = ctx.target, bag = ctx.bag || [];

    for (var c = 0; c < COMMANDS.length; c++) if (COMMANDS[c][1].test(s)) return { type: 'command', name: COMMANDS[c][0] };

    var cm = CORRECT_RE.exec(s);
    if (cm) {
      var d0 = nearest(numberCands(tokensOf(cm[2])), target);
      return d0 === null ? UNCLEAR : { type: 'command', name: 'correct', distance: d0 };
    }

    var tokens = tokensOf(s);
    if (!tokens.length) return UNCLEAR;
    var spans = findSpan(tokens);

    if (spans.length > 1) return UNCLEAR;
    if (spans.length === 1) {
      var sp = spans[0];
      if (sp.tag === '?') return UNCLEAR;
      var clubId = resolveClub(bag, sp.tag);
      if (clubId === null) return UNCLEAR;
      if (sp.s === 0 && sp.e === tokens.length) return { type: 'club', clubId: clubId };
      var rest;
      if (sp.s === 0) rest = tokens.slice(sp.e);
      else if (sp.e === tokens.length) rest = tokens.slice(0, sp.s);
      else return UNCLEAR;
      var d = nearest(numberCands(rest), target);
      return d === null ? UNCLEAR : { type: 'shot', distance: d, clubId: clubId };
    }

    // No explicit club: plain distance, or a bare leading iron number ("seven 163").
    var best = null;
    var plain = nearest(numberCands(tokens), target);
    if (plain !== null) best = { type: 'shot', distance: plain, clubId: null };
    var n0 = tokens.length > 1 ? unit19(tokens[0]) : null;
    if (n0 !== null) {
      var iron = resolveClub(bag, n0 + 'i');
      if (iron !== null) {
        var d2 = nearest(numberCands(tokens.slice(1)), target);
        if (d2 !== null && (best === null || Math.abs(d2 - target) < Math.abs(best.distance - target))) {
          best = { type: 'shot', distance: d2, clubId: iron };
        }
      }
    }
    return best || UNCLEAR;
  }

  // ---------- speech ----------
  function synth() {
    try { return typeof root !== 'undefined' && root.speechSynthesis && typeof root.SpeechSynthesisUtterance !== 'undefined' ? root.speechSynthesis : null; } catch (e) { return null; }
  }
  function Recognition() {
    try { return (root && (root.SpeechRecognition || root.webkitSpeechRecognition)) || null; } catch (e) { return null; }
  }

  // ---------- delivery ----------
  var RATE = 0.96, PITCH = 1.04, VOLUME = 1;
  var SAFETY_BASE_MS = 3000, SAFETY_PER_CHAR_MS = 120;
  var QUIET_MS = 5 * 60 * 1000;
  var STORE_KEY = 'yardage.voice';
  var OPENERS = ['Here we go.', "Let's get started.", 'Alright.'];

  // ---------- spoken numbers ----------
  var ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  var TENWORDS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function under100(n) {
    if (n < 20) return ONES[n];
    var t = TENWORDS[Math.floor(n / 10)], u = n % 10;
    return u ? t + '-' + ONES[u] : t;
  }
  function spokenNumber(n) {
    n = Math.round(Number(n));
    if (!isFinite(n) || n < 0 || n > 999) return String(n);
    if (n < 100) return under100(n);
    var h = Math.floor(n / 100), r = n % 100;
    if (r === 0) return ONES[h] + ' hundred';
    if (r < 10) return ONES[h] + ' oh ' + ONES[r];
    return ONES[h] + ' ' + under100(r);
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function targetPhrase(n, unit, isFirst, openerIndex) {
    var num = cap(spokenNumber(n));
    if (!isFirst) return num + '.';
    var u = (unit === 'm' || unit === 'meters' || unit === 'meter') ? 'meters' : 'yards';
    return OPENERS[(openerIndex || 0) % OPENERS.length] + ' ' + num + ' ' + u + '.';
  }
  function clubPhrase(name, isFirst, openerIndex) {
    var s = String(name == null ? '' : name).trim().replace(/\b([1-9])\b/g, function (m) { return ONES[+m]; });
    s = cap(s.replace(/\.+$/, '').toLowerCase()) + '.';
    return isFirst ? OPENERS[(openerIndex || 0) % OPENERS.length] + ' ' + s : s;
  }
  var lastCallout = null, openerIdx = 0;
  function takeFirst() {
    var now = Date.now(), first = lastCallout === null || now - lastCallout > QUIET_MS;
    lastCallout = now;
    return first;
  }

  // ---------- voice choice ----------
  var ROBOTIC = /microsoft (david|zira|mark)|espeak|\b(fred|albert|junior|ralph|kathy|bad news|good news|bahh|bells|boing|bubbles|cellos|deranged|hysterical|organ|princess|superstar|trinoids|whisper|wobble|zarvox|jester)\b/i;
  var APPLE_GOOD = /\b(samantha|ava|allison|evan|zoe|enhanced|premium)\b/i;
  function isEnglish(v) { return !!v && /^en([-_]|$)/i.test(String(v.lang || '')); }
  function isEnUS(v) { return /^en[-_]us$/i.test(String(v.lang || '')); }
  function voiceScore(v) {
    var n = String(v.name || ''), tier;
    if (/natural|neural|online/i.test(n)) tier = 6;
    else if (/google/i.test(n)) tier = 5;
    else if (APPLE_GOOD.test(n) && !ROBOTIC.test(n)) tier = 4;
    else if (isEnUS(v) && !ROBOTIC.test(n)) tier = 3;
    else tier = 2;
    return tier * 10 + (isEnUS(v) ? 5 : 0);
  }
  // Pure: English voices only, best first.
  function rankVoices(list) {
    var arr = [];
    (list || []).forEach(function (v, i) { if (v && isEnglish(v)) arr.push({ v: v, s: voiceScore(v), i: i }); });
    arr.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
    return arr.map(function (x) { return x.v; });
  }

  var chosen, overrideName = null, voicesHooked = false;
  function storedName() {
    try { return (root.localStorage && root.localStorage.getItem(STORE_KEY)) || null; } catch (e) { return null; }
  }
  function rankedVoices() {
    var ss = synth();
    if (!ss) return [];
    hookVoices(ss);
    try { return rankVoices(ss.getVoices() || []); } catch (e) { return []; }
  }
  function hookVoices(ss) {
    if (voicesHooked) return; voicesHooked = true;
    try { if (ss.addEventListener) ss.addEventListener('voiceschanged', function () { chosen = undefined; }); } catch (e) { /* ignore */ }
  }
  function pickVoice() {
    if (chosen) return chosen;
    var ranked = rankedVoices();
    if (!ranked.length) return null; // not loaded yet (or none): retried on next call
    var want = overrideName || storedName(), v = null;
    if (want) for (var i = 0; i < ranked.length; i++) if (ranked[i].name === want) { v = ranked[i]; break; }
    chosen = v || ranked[0];
    return chosen;
  }

  var Voice = {
    parse: parse,
    canSpeak: !!synth(),
    canListen: !!Recognition(),

    speak: function (text, opts) {
      var called = false, timer = null;
      function end() {
        if (called) return; called = true;
        if (timer) { clearTimeout(timer); timer = null; }
        try { if (opts && opts.onend) opts.onend(); } catch (e) { /* ignore */ }
      }
      var ss = synth();
      if (!ss) { end(); return; }
      try {
        var str = String(text);
        var u = new root.SpeechSynthesisUtterance(str);
        u.lang = 'en-US';
        u.rate = RATE; u.pitch = PITCH; u.volume = VOLUME;
        var v = pickVoice();
        if (v) { u.voice = v; if (v.lang) u.lang = v.lang; }
        u.onend = end; u.onerror = end;
        root.__voiceUtterance = u; // keep a reference so it is not garbage collected mid-speech
        timer = setTimeout(end, SAFETY_BASE_MS + str.length * SAFETY_PER_CHAR_MS);
        ss.cancel();
        ss.speak(u);
      } catch (e) { end(); }
    },

    sayTarget: function (n, unit, opts) {
      Voice.speak(targetPhrase(n, unit, takeFirst(), openerIdx++), opts);
    },

    sayClub: function (name, opts) {
      Voice.speak(clubPhrase(name, takeFirst(), openerIdx++), opts);
    },

    spokenNumber: spokenNumber,
    _targetPhrase: targetPhrase,
    _clubPhrase: clubPhrase,
    _rankVoices: rankVoices,

    voices: function () { return rankedVoices().map(function (v) { return v.name; }); },
    voiceName: function () { var v = pickVoice(); return v ? v.name : null; },
    setVoice: function (name) {
      try { if (root.localStorage) root.localStorage.setItem(STORE_KEY, String(name)); } catch (e) { /* ignore */ }
      overrideName = name == null ? null : String(name);
      chosen = undefined;
    },

    listen: function (handlers) {
      handlers = handlers || {};
      var stopped = false, rec = null;
      function state(s) { try { if (handlers.onState) handlers.onState(s); } catch (e) { /* ignore */ } }
      var R = Recognition();
      if (!R) { state('unsupported'); return function () {}; }

      function start() {
        if (stopped) return;
        try {
          rec = new R();
          rec.lang = 'en-US';
          rec.continuous = true;
          rec.interimResults = false;
          rec.onresult = function (ev) {
            try {
              for (var i = ev.resultIndex; i < ev.results.length; i++) {
                if (ev.results[i].isFinal && handlers.onText) handlers.onText(String(ev.results[i][0].transcript));
              }
            } catch (e) { /* ignore */ }
          };
          rec.onstart = function () { state('listening'); };
          rec.onerror = function (ev) {
            var err = ev && ev.error;
            if (err === 'not-allowed' || err === 'service-not-allowed') { stopped = true; state('blocked'); }
          };
          rec.onend = function () {
            if (stopped) { state('idle'); return; }
            setTimeout(start, 250);
          };
          rec.start();
        } catch (e) {
          // start() throws if already started; retry shortly unless stopped
          if (!stopped) setTimeout(start, 500);
        }
      }
      start();

      return function stop() {
        stopped = true;
        try { if (rec) rec.stop(); } catch (e) { /* ignore */ }
        state('idle');
      };
    }
  };

  return Voice;
});
