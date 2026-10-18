// Idiomas: dicionários JSON em src/locales/<código>.json, com o inglês como reserva.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'locales');
const cache = new Map();

function load(code) {
  if (!cache.has(code)) {
    let dict = null;
    try { dict = JSON.parse(fs.readFileSync(path.join(DIR, `${code}.json`), 'utf8')); } catch {}
    cache.set(code, dict);
  }
  return cache.get(code);
}

function available() {
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
}

function languages() {
  return available().map((code) => ({ code, name: load(code)?._name || code, dir: load(code)?._dir || 'ltr' }));
}

// Escolhe o melhor idioma disponível para uma lista de preferências (ex.: ['pt-PT', 'en-US']).
function match(prefs, avail = available()) {
  const lower = avail.map((c) => c.toLowerCase());
  for (const p of prefs.filter(Boolean)) {
    const want = p.toLowerCase().replace('_', '-');
    const exact = lower.indexOf(want);
    if (exact >= 0) return avail[exact];
    const base = want.split('-')[0];
    const sameBase = lower.findIndex((c) => c === base || c.startsWith(`${base}-`));
    if (sameBase >= 0) return avail[sameBase];
  }
  return 'en';
}

function format(str, vars = {}) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

function createT(code) {
  const dict = load(code) || {};
  const en = load('en') || {};
  const plural = new Intl.PluralRules(code);
  return (key, vars = {}) => {
    let v = dict[key] ?? en[key] ?? key;
    if (v && typeof v === 'object' && !Array.isArray(v)) v = v[plural.select(Number(vars.n) || 0)] ?? v.other;
    return format(v, vars);
  };
}

module.exports = { DIR, load, available, languages, match, format, createT };
