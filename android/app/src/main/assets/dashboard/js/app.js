/* ============================================================
 * MW Utils — Dashboard Android
 * Replica la logica della dashboard "points" dell'estensione
 * Chrome (mw_injected.js) usando il bridge nativo MwBridge.
 * ============================================================ */
'use strict';

var POINT_TO_USD = 0.066;

/* ---------------- fetch helpers (same-origin, come l'estensione) ---------------- */

function bridge() {
  return (typeof window.MwBridge !== 'undefined' && window.MwBridge) ? window.MwBridge : null;
}

/** GET JSON same-origin: i cookie di sessione sono inviati automaticamente. */
function fetchJson(url) {
  return fetch(url, { credentials: 'include' }).then(function (r) {
    return r.text().then(function (t) {
      var json = null;
      try { json = JSON.parse(t); } catch (e) { /* corpo non JSON */ }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (json === null) throw new Error('Risposta non valida dal server');
      return json;
    });
  });
}

/** GET testo/HTML same-origin (per estrarre il buildId). */
function fetchText(url) {
  return fetch(url, { credentials: 'include' }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  });
}

/** Carica Chart.js da CDN (come fa l'estensione) solo quando serve. */
function ensureChart() {
  if (window.Chart) return Promise.resolve();
  return new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    s.onload = function () { resolve(); };
    s.onerror = function () { reject(new Error('Chart.js non disponibile')); };
    document.head.appendChild(s);
  });
}

/* ---------------- stato globale ---------------- */

var state = {
  hits: [],
  labels: [],
  dailyRegular: [],
  dailyExclusive: [],   // netto (earned - redeemed), come nell'estensione
  dailyExclusiveEarned: [],
  dailyOut: [],
  modelRanking: [],
  modelDailyMap: new Map(),
  modelsNoPointsLast5: [],
  lastDateStr: null,
  balance: null,
  profile: null,
  market: localStorage.getItem('mw_market') || null,
  range: 90,
  chart: null
};

/* ---------------- utilità ---------------- */

function fmtInt(n) { return (Math.round(Number(n) || 0)).toLocaleString('en-US'); }

function fmtUsd(usd) {
  var n = (typeof usd === 'number' && !isNaN(usd)) ? Math.round(usd * 100) / 100 : 0;
  return '$' + n.toFixed(2);
}

function byId(id) { return document.getElementById(id); }
function show(el, yes) { el.hidden = !yes; }

function showState(name) {
  show(byId('state-loading'), name === 'loading');
  show(byId('state-error'), name === 'error');
  show(byId('state-empty'), name === 'empty');
  show(byId('state-dashboard'), name === 'dashboard');
}

function dateKeyOf(d) {
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

/* ---------------- fetch dati (stesse API dell'estensione) ---------------- */

function fetchPointBill() {
  return fetchJson('https://makerworld.com/api/v1/point-service/point-bill/my?filter=all&limit=10000')
    .then(function (json) {
      var hits = Array.isArray(json.hits) ? json.hits.slice() : [];
      if (!hits.length) throw new Error('EMPTY');
      hits.sort(function (a, b) { return new Date(a.createTime) - new Date(b.createTime); });
      return hits;
    });
}

function extractBuildId(html) {
  var m = html.match(/_next\/static\/([^\/]+)\/_/);
  return m ? m[1] : null;
}

function fetchBalance() {
  return fetchText('https://makerworld.com/en/points').then(function (html) {
    var id = extractBuildId(html);
    if (!id) return null;
    return fetchJson('https://makerworld.com/_next/data/' + id + '/en/points.json').then(function (j) {
      var p = j && j.pageProps && j.pageProps.pointInfo;
      if (!p) return null;
      var v = Number(p.point) || Number(p.availablePoint) || Number(p.totalPoint);
      return isNaN(v) ? null : v;
    });
  }).catch(function () { return null; });
}

function fetchProfile() {
  return fetchText('https://makerworld.com/en').then(function (html) {
    var id = extractBuildId(html);
    if (!id) return null;
    return fetchJson('https://makerworld.com/_next/data/' + id + '/en.json').then(function (j) {
      var u = j && j.pageProps && j.pageProps.session && j.pageProps.session.user;
      if (!u) return null;
      var mwc = u.MWCount || {};
      return {
        name: u.name || u.handle || u.username || null,
        avatar: u.userAvatar || u.avatarUrl || u.avatar || null,
        downloads: (typeof mwc.myDesignDownloadCount === 'number') ? mwc.myDesignDownloadCount : null,
        prints: (typeof mwc.myDesignPrintCount === 'number') ? mwc.myDesignPrintCount : null
      };
    });
  }).catch(function () { return null; });
}

function fetchGiftcards(market) {
  if (!market) return Promise.resolve(null);
  return fetchJson('https://makerworld.com/api/v1/point-service/product/products?shop=' + encodeURIComponent(market))
    .then(function (json) {
      var hits = json && json.hits;
      if (!Array.isArray(hits)) return null;
      var cards = hits.filter(function (el) {
        return el.title && el.title.indexOf('Gift Card for') > -1 && Number(el.price) > 0;
      });
      if (!cards.length) return null;
      cards.sort(function (a, b) { return Number(a.price) - Number(b.price); });
      var gc = cards[0];
      var value = Number(gc.selfBuiltGiftcard && gc.selfBuiltGiftcard.value) ||
                  Number(gc.giftcard && gc.giftcard.value) || null;
      var currency = (gc.selfBuiltGiftcard && gc.selfBuiltGiftcard.shop && gc.selfBuiltGiftcard.shop.currency) ||
                     (gc.giftcard && gc.giftcard.shop && gc.giftcard.shop.currency) || null;
      if (!value || !currency) return null;
      return { price: Number(gc.price), value: value, currency: currency };
    })
    .catch(function () { return null; });
}

/* ---------------- aggregazione (replica dell'estensione) ---------------- */

function aggregate(hits) {
  var dateMap = new Map();
  var modelMap = new Map();
  var modelDailyMap = new Map();

  hits.forEach(function (entry) {
    var dateKey = dateKeyOf(new Date(entry.createTime));
    var reg = Number(entry.pointChangeRegular) || 0;
    var exc = Number(entry.pointChangeExclusive) || 0;

    if (!dateMap.has(dateKey)) dateMap.set(dateKey, { regular: 0, exclusivePos: 0, exclusiveOut: 0, out: 0 });
    var obj = dateMap.get(dateKey);
    if (reg !== 0) {
      if (reg >= 0) obj.regular += reg; else obj.out += Math.abs(reg);
    }
    if (exc !== 0) {
      if (exc >= 0) obj.exclusivePos += exc;
      else { obj.exclusiveOut += Math.abs(exc); obj.out += Math.abs(exc); }
    }

    // estrazione titolo modello (stessa logica dell'estensione)
    try {
      var title = null;
      var t = entry.type || '';
      if (t === 'boost_exchange_point' && entry.extInfoBoostExchangePoint && entry.extInfoBoostExchangePoint.designTitle) {
        title = String(entry.extInfoBoostExchangePoint.designTitle).trim();
      } else if (t === 'instance_reward_v2' && entry.instanceRewardV2 && entry.instanceRewardV2.designTitle) {
        title = String(entry.instanceRewardV2.designTitle).trim();
      } else if (t === 'design_reward_v2' && entry.designRewardV2 && entry.designRewardV2.title) {
        title = String(entry.designRewardV2.title).trim();
      }
      if (title) {
        var posReg = reg > 0 ? reg : 0;
        var posExc = exc > 0 ? exc : 0;
        var pts = Math.round((posReg + posExc) * 100) / 100;
        if (pts > 0) {
          if (!modelMap.has(title)) modelMap.set(title, { total: 0, lastDate: null });
          var m = modelMap.get(title);
          m.total = Math.round((m.total + pts) * 100) / 100;
          m.lastDate = dateKey;
          if (!modelDailyMap.has(dateKey)) modelDailyMap.set(dateKey, new Map());
          var dayMap = modelDailyMap.get(dateKey);
          dayMap.set(title, Math.round(((dayMap.get(title) || 0) + pts) * 100) / 100);
        }
      }
    } catch (e) { /* ignora */ }
  });

  var labels = Array.from(dateMap.keys()).sort();
  var dailyRegular = labels.map(function (k) {
    var v = dateMap.get(k); return v ? Math.round((v.regular || 0) * 100) / 100 : 0;
  });
  var dailyExclusiveEarned = labels.map(function (k) {
    var v = dateMap.get(k); return v ? Math.round((v.exclusivePos || 0) * 100) / 100 : 0;
  });
  var dailyExclusiveOut = labels.map(function (k) {
    var v = dateMap.get(k); return v ? Math.round((v.exclusiveOut || 0) * 100) / 100 : 0;
  });
  var dailyExclusive = dailyExclusiveEarned.map(function (v, i) {
    return Math.round((v - dailyExclusiveOut[i]) * 100) / 100;
  });
  var dailyOut = labels.map(function (k) {
    var v = dateMap.get(k); return v ? Math.round((v.out || 0) * 100) / 100 : 0;
  });

  var modelRanking = Array.from(modelMap.entries())
    .map(function (e) { return { title: e[0], total: e[1].total, lastDate: e[1].lastDate }; })
    .sort(function (a, b) { return b.total - a.total; });

  // modelli senza punti negli ultimi 5 giorni (rispetto all'ultimo giorno con dati)
  var lastKey = labels.length ? labels[labels.length - 1] : null;
  var modelsNoPointsLast5 = [];
  if (lastKey) {
    var cut = new Date(lastKey + 'T00:00:00Z').getTime() - 4 * 86400000;
    modelRanking.forEach(function (m) {
      if (!m.lastDate || new Date(m.lastDate + 'T00:00:00Z').getTime() < cut) {
        modelsNoPointsLast5.push(m);
      }
    });
  }

  state.hits = hits;
  state.labels = labels;
  state.dailyRegular = dailyRegular;
  state.dailyExclusive = dailyExclusive;
  state.dailyExclusiveEarned = dailyExclusiveEarned;
  state.dailyExclusiveOut = dailyExclusiveOut;
  state.dailyOut = dailyOut;
  state.modelRanking = modelRanking;
  state.modelDailyMap = modelDailyMap;
  state.modelsNoPointsLast5 = modelsNoPointsLast5;
  state.lastDateStr = lastKey;
}

/* ---------------- rendering ---------------- */

function sum(arr) {
  return arr.reduce(function (a, b) { return a + (Number(b) || 0); }, 0);
}

function renderCards() {
  var exEarned = sum(state.dailyExclusiveEarned);
  var sumReg = sum(state.dailyRegular);
  var sumOut = sum(state.dailyOut);
  var lastEx = state.dailyExclusiveEarned.length
    ? state.dailyExclusiveEarned[state.dailyExclusiveEarned.length - 1] : 0;

  byId('card-exclusive').textContent = fmtInt(exEarned);
  byId('card-exclusive-foot').textContent =
    'Ultimo giorno: +' + fmtInt(lastEx) + ' ex · ' + fmtUsd(exEarned * POINT_TO_USD) + ' totali';
  byId('card-usd').textContent = fmtUsd(exEarned * POINT_TO_USD);
  byId('card-regular').textContent = fmtInt(sumReg);
  byId('card-redeemed-foot').textContent = 'Riscattati in totale: ' + fmtInt(sumOut) + ' pts';

  if (state.balance != null) {
    byId('card-balance').textContent = fmtInt(state.balance);
    var next = (state.giftcard && state.giftcard.price)
      ? (state.giftcard.price - (state.balance % state.giftcard.price)) : null;
    byId('card-balance-foot').textContent = next != null
      ? fmtInt(next) + ' pts alla prossima gift card'
      : 'Saldo attuale MakerWorld';
  } else {
    byId('card-balance').textContent = '—';
    byId('card-balance-foot').textContent = 'Saldo non disponibile';
  }
}

/* ---------------- grafico ---------------- */

function shortDate(k) {
  var p = k.split('-');
  return p[2] + '/' + p[1];
}

function renderChart() {
  if (!window.Chart) return;
  var canvas = byId('chart');
  if (!canvas) return;

  // Distrugge qualunque chart sia già agganciato a questo canvas:
  // previene l'errore "Canvas is already in use" in caso di doppia
  // iniezione o di refresh ravvicinati.
  try {
    var existing = window.Chart.getChart ? window.Chart.getChart(canvas) : null;
    if (existing) existing.destroy();
  } catch (e) { /* ignora */ }
  if (state.chart) {
    try { state.chart.destroy(); } catch (e) { /* ignora */ }
    state.chart = null;
  }

  var n = state.range > 0 ? Math.min(state.range, state.labels.length) : state.labels.length;
  var labels = state.labels.slice(-n).map(shortDate);
  var datasets = [
    {
      label: 'Regular',
      data: state.dailyRegular.slice(-n),
      borderColor: '#0BC9B3',
      backgroundColor: 'rgba(11, 201, 179, 0.18)',
      fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2
    },
    {
      label: 'Exclusive',
      data: state.dailyExclusiveEarned.slice(-n),
      borderColor: '#9C6ADE',
      backgroundColor: 'rgba(156, 106, 222, 0.15)',
      fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2
    },
    {
      label: 'Spesi',
      data: state.dailyOut.slice(-n),
      borderColor: '#F45B69',
      backgroundColor: 'rgba(244, 91, 105, 0.12)',
      fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2
    }
  ];

  if (state.chart) { try { state.chart.destroy(); } catch (e) { /* ignora */ } }
  var ctx = byId('chart').getContext('2d');
  state.chart = new Chart(ctx, {
    type: 'line',
    data: { labels: labels, datasets: datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#8B9BAA', boxWidth: 12, boxHeight: 12, font: { size: 11 } },
          callbacks: {
            label: function (c) {
              var usd = (c.parsed.y * POINT_TO_USD) || 0;
              return c.dataset.label + ': ' + fmtInt(c.parsed.y) + ' pts';
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: '#5B6B7A', maxTicksLimit: 8, font: { size: 10 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: '#5B6B7A', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

/* ---------------- gift card ---------------- */

var MARKETS = ['IT', 'US', 'EU', 'UK', 'DE', 'FR', 'ES', 'JP', 'CN', 'AU', 'CA', 'BR'];
var CURRENCY_SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', CNY: '¥', JPY: '¥', AUD: 'A$',
  CAD: 'C$', INR: '₹', KRW: '₩', RUB: '₽', BRL: 'R$', MXN: 'Mex$'
};

function renderGiftcard() {
  var sel = byId('market-select');
  if (!sel.options.length) {
    MARKETS.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m; o.textContent = m;
      sel.appendChild(o);
    });
    sel.value = state.market || 'IT';
  }
  sel.value = state.market || 'IT';

  var gc = state.giftcard;
  var title = byId('giftcard-title');
  var sub = byId('giftcard-sub');
  var bar = byId('giftcard-bar');

  if (!gc || !state.balance) {
    title.textContent = 'Gift Card';
    sub.textContent = gc
      ? 'Saldo punti non disponibile'
      : 'Seleziona il tuo market per calcolare le gift card';
    bar.style.width = '0%';
    return;
  }

  var num = Math.floor(state.balance / gc.price);
  var sym = CURRENCY_SYMBOLS[gc.currency] || gc.currency;
  var remaining = gc.price - (state.balance % gc.price);
  title.textContent = num + ' Gift Card' + (num !== 1 ? '' : '') + ' (' + sym + fmtInt(gc.value) + ')';

  // valore complessivo stimato
  var totalValue = gc.value * num;
  sub.textContent = 'Totale ' + sym + fmtInt(totalValue) +
    ' · Card = ' + fmtInt(gc.price) + ' pts · ' + fmtInt(remaining) + ' pts alla prossima';

  var pct = ((state.balance % gc.price) / gc.price) * 100;
  bar.style.width = Math.min(100, Math.max(2, pct)) + '%';
}

/* ---------------- previsioni ---------------- */

function renderPredictions() {
  var wrap = byId('predictions');
  wrap.innerHTML = '';

  // media exclusive guadagnati su ultimi 30 giorni con valore > 0
  var recent = state.dailyExclusiveEarned.slice(-30).filter(function (v) {
    return typeof v === 'number' && !isNaN(v) && v > 0;
  });
  var avgDaily = recent.length ? sum(recent) / recent.length : 0;

  function pred(k, v) {
    var d = document.createElement('div');
    d.className = 'pred-item';
    d.innerHTML = '<span class="k">' + k + '</span><span class="v">' + v + '</span>';
    wrap.appendChild(d);
  }

  pred('Media giornaliera exclusive (30g)', fmtInt(Math.round(avgDaily)) + ' pts · ' + fmtUsd(avgDaily * POINT_TO_USD));

  var gc = state.giftcard;
  if (gc && state.balance && avgDaily > 0) {
    var remaining = gc.price - (state.balance % gc.price);
    var days = Math.ceil(remaining / avgDaily);
    var dt = new Date();
    dt.setDate(dt.getDate() + days);
    pred('Prossima gift card', dt.toLocaleDateString('it-IT') + ' (≈' + days + ' giorni)');
    pred('Punti mancanti', fmtInt(remaining) + ' pts · ' + fmtUsd(remaining * POINT_TO_USD));
  } else if (gc && state.balance) {
    var rem = gc.price - (state.balance % gc.price);
    pred('Punti mancanti', fmtInt(rem) + ' pts (media non calcolabile)');
  }

  var totalEx = sum(state.dailyExclusiveEarned);
  pred('Totale exclusive guadagnati', fmtInt(Math.round(totalEx)) + ' pts · ' + fmtUsd(totalEx * POINT_TO_USD));
}

/* ---------------- tabelle mensili ---------------- */

function renderMonthly() {
  var monthMap = new Map();
  state.labels.forEach(function (k, i) {
    var mk = k.slice(0, 7);
    if (!monthMap.has(mk)) monthMap.set(mk, { earned: 0, redeemed: 0, days: 0 });
    var o = monthMap.get(mk);
    o.earned += state.dailyExclusiveEarned[i];
    o.redeemed += state.dailyExclusiveOut[i];
    o.days += 1;
  });

  var keys = Array.from(monthMap.keys()).sort().reverse().slice(0, 12);
  var html = '<table><tr><th>Mese</th><th class="num">Guadagnati (USD)</th>' +
    '<th class="num">Riscattati (USD)</th><th class="num">Giorni</th></tr>';
  if (!keys.length) {
    html += '<tr><td colspan="4" class="muted">Nessun dato mensile.</td></tr>';
  }
  keys.forEach(function (k) {
    var o = monthMap.get(k);
    html += '<tr><td>' + k + '</td>' +
      '<td class="num">' + fmtUsd(o.earned * POINT_TO_USD) + '</td>' +
      '<td class="num">' + fmtUsd(o.redeemed * POINT_TO_USD) + '</td>' +
      '<td class="num">' + o.days + '</td></tr>';
  });
  html += '</table>';
  byId('monthly-wrap').innerHTML = html;
}

/* ---------------- modelli ---------------- */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function modelRow(title, pts, maxPts, sub) {
  var pct = maxPts > 0 ? (pts / maxPts) * 100 : 0;
  return '<div class="model-row">' +
    '<div class="model-top"><span class="model-name">' + escapeHtml(title) + '</span>' +
    '<span class="model-pts">' + fmtInt(pts) + ' pts</span></div>' +
    '<div class="model-bar-track"><div class="model-bar" style="width:' + pct + '%"></div></div>' +
    (sub ? '<div class="model-sub">' + escapeHtml(sub) + '</div>' : '') +
    '</div>';
}

function renderModels() {
  var top = byId('top-models');
  var top5 = state.modelRanking.slice(0, 5);
  if (!top5.length) {
    top.innerHTML = '<div class="muted">Nessun modello con punti registrati.</div>';
  } else {
    var max = top5[0].total;
    top.innerHTML = top5.map(function (m) {
      return modelRow(m.title, m.total, max, 'Ultimi punti: ' + (m.lastDate || 'N/D'));
    }).join('');
  }

  // breakdown ultimo giorno
  var bd = byId('last-breakdown');
  var dayMap = state.lastDateStr ? state.modelDailyMap.get(state.lastDateStr) : null;
  if (dayMap && dayMap.size) {
    var entries = Array.from(dayMap.entries()).sort(function (a, b) { return b[1] - a[1]; });
    var maxPts = entries[0][1];
    bd.innerHTML = '<div class="model-sub" style="margin-bottom:6px">Ultimo giorno: ' +
      state.lastDateStr + '</div>' +
      entries.map(function (e) { return modelRow(e[0], e[1], maxPts, null); }).join('');
  } else {
    bd.innerHTML = '<div class="muted">Nessun modello con punti nell\'ultimo giorno registrato.</div>';
  }

  // modelli "freddi"
  var stale = byId('stale-models');
  if (state.modelsNoPointsLast5.length) {
    stale.innerHTML = state.modelsNoPointsLast5.slice(0, 10).map(function (m) {
      return '<div class="model-top"><span class="model-name">' + escapeHtml(m.title) + '</span>' +
        '<span class="model-sub">ultimo: ' + (m.lastDate || 'N/D') + '</span></div>';
    }).join('');
  } else {
    stale.innerHTML = '<div class="muted">Tutti i modelli hanno generato punti di recente. 👍</div>';
  }
}

/* ---------------- header / footer ---------------- */

function renderHeader() {
  var sub = byId('header-user');
  var p = state.profile;
  if (p && p.name) {
    sub.innerHTML = (p.avatar ? '<img src="' + escapeHtml(p.avatar) + '">' : '') +
      '<span>' + escapeHtml(p.name) + '</span>';
  }
  var v = 'MW Utils';
  try {
    if (window.MwBridge && window.MwBridge.appVersion) v += ' v' + window.MwBridge.appVersion();
  } catch (e) { /* ignora */ }
  byId('footer').textContent = v + ' · dati da makerworld.com';
}

/* ---------------- bootstrap ---------------- */

function refresh() {
  showState('loading');
  fetchPointBill()
    .then(function (hits) {
      aggregate(hits);
      return Promise.all([fetchBalance(), fetchProfile()]);
    })
    .then(function (results) {
      state.balance = results[0];
      state.profile = results[1];
      return fetchGiftcards(state.market || 'IT');
    })
    .then(function (gc) {
      state.giftcard = gc;
      renderHeader();
      renderCards();
      renderGiftcard();
      return ensureChart().catch(function () { return null; });
    })
    .then(function () {
      renderChart();
      renderPredictions();
      renderMonthly();
      renderModels();
      showState('dashboard');
    })
    .catch(function (e) {
      if (e && e.message === 'EMPTY') { showState('empty'); return; }
      var msg = (e && e.message) ? e.message : String(e);
      if (/HTTP (401|403)/.test(msg)) {
        // sessione scaduta: torniamo al login
        if (bridge()) { try { bridge().openLogin(); } catch (err) { } }
        return;
      }
      byId('error-msg').textContent = msg;
      showState('error');
    });
}

function bindEvents() {
  byId('btn-refresh').addEventListener('click', refresh);
  byId('btn-retry').addEventListener('click', refresh);
  byId('btn-relogin').addEventListener('click', function () {
    if (bridge()) { try { bridge().openLogin(); } catch (e) { } }
  });
  byId('btn-logout').addEventListener('click', function () {
    if (bridge()) { try { bridge().logout(); } catch (e) { } }
  });
  byId('market-select').addEventListener('change', function (e) {
    state.market = e.target.value;
    localStorage.setItem('mw_market', state.market);
    fetchGiftcards(state.market).then(function (gc) {
      state.giftcard = gc;
      renderGiftcard();
      renderPredictions();
      renderCards();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.range-btn'), function (btn) {
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.range-btn'), function (b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      state.range = parseInt(btn.getAttribute('data-range'), 10) || 0;
      renderChart();
    });
  });
}

// L'esecuzione avviene anche da overlay iniettato a pagina già caricata:
// avvia subito se il DOM è pronto, altrimenti aspetta DOMContentLoaded.
// Guardia anti-doppio-avvio: se la dashboard è già attiva, non rilanciare
// bindEvents/refresh (evita doppi listener e il conflitto sul canvas del chart).
if (!window.__mwDashBooted) {
  window.__mwDashBooted = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindEvents();
      refresh();
    });
  } else {
    bindEvents();
    refresh();
  }
}
