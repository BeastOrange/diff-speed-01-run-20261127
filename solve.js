// High-performance drop-in replacement for makefun-diff 1.0.0 diffPatch.
// Dependency-free ES module exporting run(input).

const FORMAT = 'makefun-diff/1';
const CONTEXT = 3;

/** Tokenize and intern lines into 32-bit integer IDs. */
function tokenizeAndIntern(text, map, idRef) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const hasNoTrailing = parts[last] !== '';
  const count = hasNoTrailing ? parts.length : last;
  const ids = new Int32Array(count);

  for (let i = 0; i < last; i++) {
    const s = parts[i];
    let id = map.get(s);
    if (id === undefined) {
      id = idRef.id++;
      map.set(s, id);
    }
    ids[i] = id;
  }

  if (hasNoTrailing) {
    // Prefix with null byte so a line without trailing newline never matches one with it
    const s = '\0' + parts[last];
    let id = map.get(s);
    if (id === undefined) {
      id = idRef.id++;
      map.set(s, id);
    }
    ids[last] = id;
  }

  return { parts, count, hasNoTrailing, ids };
}

/** Myers greedy search matching makefun-diff 1.0.0 tie-break rules exactly. */
function editRuns(oldIds, newIds) {
  const oldLen = oldIds.length;
  const newLen = newIds.length;
  if (oldLen === 0 && newLen === 0) return [];
  if (oldLen === 0) return [{ kind: '+', count: newLen }];
  if (newLen === 0) return [{ kind: '-', count: oldLen }];

  const maxEdit = oldLen + newLen;

  // Triangular history: capacity starts at 4M and grows if needed
  let historyCapacity = Math.min(16 * 1024 * 1024, Math.max(1024 * 1024, ((maxEdit + 2) * (maxEdit + 3)) / 2));
  let history = new Int32Array(historyCapacity);

  let vPrev = new Int32Array(maxEdit + 2);
  let vCurr = new Int32Array(maxEdit + 2);

  // d = 0
  let oldPos = -1;
  let newPos = -1;
  while (oldPos + 1 < oldLen && newPos + 1 < newLen && oldIds[oldPos + 1] === newIds[newPos + 1]) {
    oldPos++;
    newPos++;
  }
  history[0] = oldPos;
  vPrev[0] = oldPos;

  if (oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
    return oldPos >= 0 ? [{ kind: '=', count: oldPos + 1 }] : [];
  }

  let finalD = -1;
  let finalK = 0;

  const oldLimit = oldLen - 1;
  const newLimit = newLen - 1;
  let currOffset = 0;

  for (let d = 1; d <= maxEdit; d++) {
    currOffset += d;
    let currIdx = currOffset;

    if (currOffset + d + 1 > history.length) {
      const nextBuf = new Int32Array(Math.max(history.length * 2, currOffset + d + 1));
      nextBuf.set(history);
      history = nextBuf;
    }

    // idx = 0 (k = -d)
    {
      const addOldPos = vPrev[0];
      const canAdd = addOldPos !== -2 && addOldPos + d < newLen;
      if (!canAdd) {
        history[currIdx++] = -2;
        vCurr[0] = -2;
      } else {
        let curOldPos = addOldPos;
        let curNewPos = curOldPos + d;
        while (curOldPos < oldLimit && curNewPos < newLimit && oldIds[curOldPos + 1] === newIds[curNewPos + 1]) {
          curOldPos++;
          curNewPos++;
        }
        history[currIdx++] = curOldPos;
        vCurr[0] = curOldPos;
        if (curOldPos >= oldLimit && curNewPos >= newLimit) {
          finalD = d;
          finalK = -d;
          break;
        }
      }
    }

    // idx = 1 .. d - 1
    let k = -d + 2;
    let removeOldPos = vPrev[0];
    for (let idx = 1; idx < d; idx++, k += 2) {
      const addOldPos = vPrev[idx];
      const canRemove = removeOldPos !== -2 && removeOldPos < oldLimit;
      const canAdd = addOldPos !== -2 && addOldPos - k < newLen;

      if (!canRemove && !canAdd) {
        history[currIdx++] = -2;
        vCurr[idx] = -2;
        removeOldPos = addOldPos;
        continue;
      }

      const candDel = canRemove ? removeOldPos + 1 : -2;
      const candIns = canAdd ? addOldPos : -2;

      let curOldPos = candDel >= candIns ? candDel : candIns;
      let curNewPos = curOldPos - k;

      while (curOldPos < oldLimit && curNewPos < newLimit && oldIds[curOldPos + 1] === newIds[curNewPos + 1]) {
        curOldPos++;
        curNewPos++;
      }

      history[currIdx++] = curOldPos;
      vCurr[idx] = curOldPos;
      removeOldPos = addOldPos;

      if (curOldPos >= oldLimit && curNewPos >= newLimit) {
        finalD = d;
        finalK = k;
        break;
      }
    }
    if (finalD !== -1) break;

    // idx = d (k = d)
    {
      const canRemove = removeOldPos !== -2 && removeOldPos < oldLimit;
      if (!canRemove) {
        history[currIdx] = -2;
        vCurr[d] = -2;
      } else {
        let curOldPos = removeOldPos + 1;
        let curNewPos = curOldPos - d;
        while (curOldPos < oldLimit && curNewPos < newLimit && oldIds[curOldPos + 1] === newIds[curNewPos + 1]) {
          curOldPos++;
          curNewPos++;
        }
        history[currIdx] = curOldPos;
        vCurr[d] = curOldPos;
        if (curOldPos >= oldLimit && curNewPos >= newLimit) {
          finalD = d;
          finalK = d;
          break;
        }
      }
    }
    if (finalD !== -1) break;

    // Swap vPrev and vCurr
    const tmp = vPrev;
    vPrev = vCurr;
    vCurr = tmp;
  }

  if (finalD === -1) {
    throw new Error('makefun-diff: the search ended without reaching both ends');
  }

  // Backtrack
  const reverseRuns = [];
  function addRun(kind, count) {
    if (count <= 0) return;
    if (reverseRuns.length > 0 && reverseRuns[reverseRuns.length - 1].kind === kind) {
      reverseRuns[reverseRuns.length - 1].count += count;
    } else {
      reverseRuns.push({ kind, count });
    }
  }

  let currD = finalD;
  let currK = finalK;
  let currOldPos = history[((currD * (currD + 1)) / 2) + ((currK + currD) >> 1)];

  while (currD > 0) {
    const idx = (currK + currD) >> 1;
    const prevOffset = ((currD - 1) * currD) / 2;
    const removeOldPos = idx > 0 ? history[prevOffset + idx - 1] : -2;
    const addOldPos = idx < currD ? history[prevOffset + idx] : -2;

    const canRemove = removeOldPos !== -2 && removeOldPos + 1 < oldLen;
    const canAdd = addOldPos !== -2 && addOldPos - currK < newLen;

    const candDel = canRemove ? removeOldPos + 1 : -2;
    const candIns = canAdd ? addOldPos : -2;

    const isDel = candDel >= candIns;
    const startOldPos = isDel ? candDel : candIns;

    const snake = currOldPos - startOldPos;
    if (snake > 0) addRun('=', snake);

    if (isDel) {
      addRun('-', 1);
      currOldPos = removeOldPos;
      currK = currK - 1;
    } else {
      addRun('+', 1);
      currOldPos = addOldPos;
      currK = currK + 1;
    }
    currD = currD - 1;
  }

  const d0Snake = currOldPos + 1;
  if (d0Snake > 0) addRun('=', d0Snake);

  return reverseRuns.reverse();
}

/** Formats a single line for patch output */
function writeLine(op, parts, idx, isLastNoNl) {
  if (isLastNoNl) {
    return `${op}${parts[idx]}\n%\n`;
  }
  return `${op}${parts[idx]}\n`;
}

/** High-speed diffPatch implementation */
export function diffPatch(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }

  const map = new Map();
  const idRef = { id: 1 };
  const a = tokenizeAndIntern(input.old, map, idRef);
  const b = tokenizeAndIntern(input.new, map, idRef);

  const n = a.count;
  const m = b.count;
  const aIds = a.ids;
  const bIds = b.ids;

  // Common prefix
  let prefix = 0;
  while (prefix < n && prefix < m && aIds[prefix] === bIds[prefix]) {
    prefix++;
  }

  // Common suffix
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && aIds[n - 1 - suffix] === bIds[m - 1 - suffix]) {
    suffix++;
  }

  const runs = [];
  if (prefix > 0) runs.push({ kind: '=', count: prefix });
  if (prefix + suffix < n || prefix + suffix < m) {
    const middleOld = aIds.subarray(prefix, n - suffix);
    const middleNew = bIds.subarray(prefix, m - suffix);
    runs.push(...editRuns(middleOld, middleNew));
  }
  if (suffix > 0) runs.push({ kind: '=', count: suffix });

  // Compute change runs
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;

  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.kind === '=') {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes.length > 0 ? changes[changes.length - 1] : undefined;
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === '-') {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one
  const hunks = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const h = hunks.length > 0 ? hunks[hunks.length - 1] : undefined;
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) {
      h.push(c);
    } else {
      hunks.push([c]);
    }
  }

  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  const aParts = a.parts;
  const bParts = b.parts;
  const aLastNoNl = a.hasNoTrailing ? n - 1 : -1;
  const bLastNoNl = b.hasNoTrailing ? m - 1 : -1;

  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi];
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;

    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);

    let at = oldStart;
    for (let ci = 0; ci < h.length; ci++) {
      const c = h[ci];
      for (; at < c.o; at++) {
        out.push(writeLine('=', aParts, at, at === aLastNoNl));
      }
      for (let i = 0; i < c.dels; i++) {
        const lineIdx = c.o + i;
        out.push(writeLine('-', aParts, lineIdx, lineIdx === aLastNoNl));
      }
      for (let i = 0; i < c.ins; i++) {
        const lineIdx = c.p + i;
        out.push(writeLine('+', bParts, lineIdx, lineIdx === bLastNoNl));
      }
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) {
      out.push(writeLine('=', aParts, at, at === aLastNoNl));
    }
  }

  return out.join('');
}

export function run(input) {
  return diffPatch(input);
}
