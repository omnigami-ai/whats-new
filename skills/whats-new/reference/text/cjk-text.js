// Generated from engine/cards/ by engine/film-text.mjs; edit the source.
(()=>{
const sourceURL=document.currentScript.src,loads=new Map();
function loadScript(file){if(!loads.has(file))loads.set(file,new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL(file,sourceURL).href;script.onload=resolve;script.onerror=()=>{loads.delete(file);reject(new Error('Could not load '+file));};document.head.append(script);}));return loads.get(file);}
// Local, opt-in CJK fonts and phrase boundaries. Latin cards keep their old path.
const hangul = /\p{Script=Hangul}/u;
const kana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const han = /\p{Script=Han}/u;
const hasCJK = value => /[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value);
const fields = ['headline', 'description', 'brand', 'label', 'domain'];
const faces = { ja: 'JP', ko: 'KR', 'zh-Hans': 'SC', 'zh-Hant': 'TC' };
const fontLoads = new Map(), loaded = new Set();
const parserLoads = new Map(), parsers = new Map();
const modelFiles = { ja: 'ja', 'zh-Hans': 'zh-hans', 'zh-Hant': 'zh-hant' };

function prepareParser(lang) {
  if (!parserLoads.has(lang)) parserLoads.set(lang, (async () => {
    await Promise.all([loadScript('budoux-parser.js'),loadScript('budoux-'+modelFiles[lang]+'.js')]);
    const Parser=window.omniCJKParser,model=window.omniCJKModels[modelFiles[lang]];
    parsers.set(lang, new Parser(model));
  })().catch(error => { parserLoads.delete(lang); throw error; }));
  return parserLoads.get(lang);
}
function parserLanguages(options) {
  return [...new Set(fields.flatMap(key => String(options[key] || '').split('\n')
    .filter(hasCJK).map(value => textLanguage(value, cardLanguage(options))).filter(lang => lang !== 'ko')))];
}

function cardLanguage(options = {}) {
  return options.lang || document.documentElement.lang || 'zh';
}
function textLanguage(value, lang = cardLanguage()) {
  if (hangul.test(value)) return 'ko';
  if (kana.test(value)) return 'ja';
  if (/^ja(?:-|$)/i.test(lang)) return 'ja';
  if (/^ko(?:-|$)/i.test(lang)) return 'ko';
  if (/^zh-(?:tw|hk|mo|hant)(?:-|$)/i.test(lang)) return 'zh-Hant';
  return 'zh-Hans';
}
function scriptsFor(value, lang) {
  const scripts = [];
  if (hangul.test(value)) scripts.push('KR');
  if (kana.test(value)) scripts.push('JP');
  if (han.test(value)) scripts.push(faces[textLanguage(value, lang)]);
  return [...new Set(scripts)];
}
async function prepareCJK(options = {}) {
  const scripts = new Set(fields.flatMap(key => scriptsFor(String(options[key] || ''), cardLanguage(options))));
  // Latin input requests neither a CJK font nor the parser/models. Korean
  // needs its font only; all async loading finishes before measuring/drawing.
  await Promise.all([...parserLanguages(options).map(prepareParser), ...[...scripts].map(script => {
    if (!fontLoads.has(script)) fontLoads.set(script, (async () => {
      const face = new FontFace(`Noto Sans ${script}`, `url("${new URL(`../assets/fonts/noto-sans-${script.toLowerCase()}.woff2`, sourceURL).href}")`, { weight: '100 900' });
      document.fonts.add(await face.load()); loaded.add(script);
    })().catch(error => { fontLoads.delete(script); throw error; }));
    return fontLoads.get(script);
  })]);
}
function assertCJKPrepared(options) {
  for (const lang of parserLanguages(options)) if (!parsers.has(lang)) {
    throw new Error(`Call await prepare(assets, state) before drawing CJK text (BudouX ${lang}).`);
  }
  for (const key of fields) for (const script of scriptsFor(String(options[key] || ''), cardLanguage(options))) {
    if (!loaded.has(script)) throw new Error(`Call await prepare(assets, state) before drawing CJK text (Noto Sans ${script}).`);
  }
}
function fontFamily(family, value, lang) {
  return [`"${family}"`, ...scriptsFor(value, lang).map(script => `"Noto Sans ${script}"`)].join(', ');
}

const noStart = /^[、。，．,.!?！？：；」』）】〉》〕ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶー・…]/u;
const noEnd = /[「『（【〈《〔]$/u;
// 同一 ("the same one") never splits: a native reader found 同 / 一個 jarring, so it's a rule, not a preference.
const chineseJoin = (before, after) => {
  const left = Array.from(before).at(-1), right = Array.from(after)[0];
  // 叠字: BudouX may offer 小 / 小 or 慢 / 慢. These are never legal
  // line boundaries, in films or cards, even when the font must shrink.
  return (left === right && han.test(left || '')) || (/同$/u.test(before) && /^一/u.test(after)) ||
    (/[让讓]$/u.test(before) && /^(\p{Script=Han})\1/u.test(after)); // never strand 让 before 小小
};
const koreanBound = new Set(['한', '두', '세', '네', '이', '그', '저', '각', '모든', '바로', '더', '잘', '꼭', '다', '안', '못']);
// These model boundaries are legal but less natural. Rank them after size and
// stranded lines, rather than forcing a smaller headline to avoid them.
const chineseNoEnd = /(?:[从從到在都同]|[一二三四五六七八九十两兩几幾这這那每各某][个個])$/u;
const koreanModifier = /[을될할볼올갈줄낼쓸둘살]$/u;
const koreanModified = /^(?:때(?:까지|부터|마다|는|도)?|동안|수)(?:\s|$)/u;
// Break only at word/phrase boundaries, preserving source spaces. Punctuation,
// small kana and opening brackets remove boundaries rather than becoming lines.
function boundaries(value, lang) {
  let ends;
  if (lang === 'ko' || !hasCJK(value)) {
    ends = [...value.matchAll(/\S+\s*/gu)]
      .filter((m, i, words) => i === words.length - 1 || !koreanBound.has(m[0].trim()))
      .map(m => m.index + m[0].length);
  } else {
    const parser = parsers.get(lang);
    if (!parser) throw new Error(`Call await prepare(assets, state) before wrapping BudouX ${lang} text.`);
    ends = [...parser.parseBoundaries(value), value.length];
  }
  // A model can offer a boundary within an unfamiliar Latin name. Remove it;
  // never add a character/word fallback when an entire phrase is too wide.
  const latinWords = [...value.matchAll(/[\p{Script=Latin}\p{Number}]+(?:[’'._-][\p{Script=Latin}\p{Number}]+)*/gu)];
  return [0, ...ends.filter(end => end === value.length ||
    (!latinWords.some(m => end > m.index && end < m.index + m[0].length) &&
      !noEnd.test(value.slice(0, end).trimEnd()) && !noStart.test(value.slice(end).trimStart()) &&
      !chineseJoin(value.slice(0, end).trimEnd(), value.slice(end).trimStart()) &&
      !/^\s/u.test(value.slice(end))))];
}
function compareCJKLayouts(a, b) {
  return a.orphans - b.orphans || a.phrasing - b.phrasing ||
    a.modifierBreaks - b.modifierBreaks ||
    Math.round(a.balance * 1000) - Math.round(b.balance * 1000) || a.lines.length - b.lines.length;
}
// Keep one best breaking for EACH exact line count. A preferred three-line
// breaking must never hide a two-line one that fits the available height.
// Films can supply measureLine(line, sourceOffset) for mixed emphasis; cards
// keep their original native measurement and ranking when it is omitted.
function cjkLayoutsFor(ctx, value, width, maxLines = Infinity, lang = cardLanguage(), measureLine) {
  let sourceOffset = 0;
  let all = [{ orphans: 0, phrasing: 0, modifierBreaks: 0, squares: 0, widths: [], lines: [] }];
  for (const raw of String(value).split('\n')) {
    const paragraph = raw.trim(), paragraphOffset = sourceOffset + raw.length - raw.trimStart().length;
    sourceOffset += raw.length + 1;
    if (!paragraph) {
      all = all.filter(a => a.lines.length < maxLines).map(a => ({...a, lines: [...a.lines, ''], widths: [...a.widths, 0]}));
      continue;
    }
    const language = textLanguage(paragraph, lang);
    const points = boundaries(paragraph, language), memo = new Map(), measures = new Map();
    const solve = (i, remaining) => {
      if (i === points.length - 1) return remaining === 0
        ? { orphans: 0, phrasing: 0, modifierBreaks: 0, squares: 0, widths: [], lines: [] } : null;
      if (remaining <= 0) return null;
      const key = `${i}:${remaining}`;
      if (memo.has(key)) return memo.get(key);
      let best = null;
      for (let j = i + 1; j < points.length; j++) {
        const line = paragraph.slice(points[i], points[j]).trim();
        const measureKey = measureLine ? `${i}:${j}` : line;
        if (!measures.has(measureKey)) measures.set(measureKey, measureLine ? measureLine(line, paragraphOffset + points[i]) : ctx.measureText(line).width);
        const w = measures.get(measureKey);
        if (w > width + .1) { if (measureLine) continue; break; }
        const rest = solve(j, remaining - 1); if (!rest) continue;
        const chars = Array.from(line.replace(/[^\p{L}\p{N}]/gu, '')).length;
        // A short isolated phrase is stranded regardless of its font size.
        // A complete short clause (보내고,) is a sound line, as in the brief.
        const orphan = chars <= 2 || (j === i + 1 && chars <= 4 && !/[、。，．,.!?！？：；]$/u.test(line));
        const brokenPhrase = j < points.length - 1 && language.startsWith('zh') &&
          (chineseNoEnd.test(line) || /^[里裡]/u.test(paragraph.slice(points[j])) ||
            (/(\p{Script=Han})\1/u.test(paragraph) && /[，,]/u.test(paragraph) && !/[，,。！？!?；;]/u.test(line.at(-1))));
        const brokenModifier = j < points.length - 1 && language === 'ko' &&
          koreanModifier.test(line) && koreanModified.test(paragraph.slice(points[j]).trimStart());
        const candidate = {
          orphans: rest.orphans + (orphan ? 1 : 0),
          phrasing: rest.phrasing + (brokenPhrase ? 1 : 0),
          modifierBreaks: rest.modifierBreaks + (brokenModifier ? 1 : 0),
          squares: rest.squares + w ** 2,
          widths: [w, ...rest.widths],
          lines: [line, ...rest.lines],
        };
        if (!best || candidate.orphans < best.orphans ||
          (candidate.orphans === best.orphans && (candidate.phrasing < best.phrasing ||
            (candidate.phrasing === best.phrasing && (candidate.modifierBreaks < best.modifierBreaks ||
              (candidate.modifierBreaks === best.modifierBreaks && candidate.squares < best.squares)))))) best = candidate;
      }
      memo.set(key, best); return best;
    };
    const combined = new Map();
    for (const previous of all) for (let count = 1; count <= Math.min(points.length - 1, maxLines - previous.lines.length); count++) {
      const next = solve(0, count); if (!next) continue;
      const candidate = {
        orphans: previous.orphans + next.orphans, phrasing: previous.phrasing + next.phrasing,
        modifierBreaks: previous.modifierBreaks + next.modifierBreaks,
        squares: previous.squares + next.squares, widths: [...previous.widths, ...next.widths], lines: [...previous.lines, ...next.lines],
      };
      const key = candidate.lines.length, best = combined.get(key);
      if (!best || candidate.orphans < best.orphans ||
        (candidate.orphans === best.orphans && (candidate.phrasing < best.phrasing ||
          (candidate.phrasing === best.phrasing && (candidate.modifierBreaks < best.modifierBreaks ||
            (candidate.modifierBreaks === best.modifierBreaks && candidate.squares < best.squares)))))) combined.set(key, candidate);
    }
    all = [...combined.values()];
  }
  return all.map(a => {
    const mean = a.widths.reduce((sum, w) => sum + w, 0) / a.lines.length;
    return {...a, balance: mean ? a.widths.reduce((sum, w) => sum + (w - mean) ** 2, 0) / a.lines.length / mean ** 2 : 0};
  });
}
function cjkLinesFor(ctx, value, width, maxLines = Infinity, lang = cardLanguage(), page = false) {
  return cjkLayoutsFor(ctx, value, width, maxLines, lang).sort(compareCJKLayouts)[0]?.lines ?? null;
}

window.omniCJK={hasCJK,cardLanguage,textLanguage,prepareCJK,assertCJKPrepared,fontFamily,scriptsFor,boundaries,compareCJKLayouts,cjkLayoutsFor,cjkLinesFor};
})();
