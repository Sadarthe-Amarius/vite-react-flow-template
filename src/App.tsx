// @ts-nocheck
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const OLD_KEY = 'branchlab-notion-v2'; // single-page storage of earlier versions (never touched, so it stays as a backup)
// Every Notion page can have its own map: the link ends with ?m=<anything unique> (for example the Notion page id).
// Without ?m the default map is used, exactly as before, so nothing already saved is touched.
const MAP = (() => { try { return (new URLSearchParams(window.location.search).get('m') || '').replace(/[^\w-]/g, '').slice(0, 64); } catch { return ''; } })();
const KEY = MAP ? 'branchlab-pages-v1:' + MAP : 'branchlab-pages-v1';
const makeStart = () => [
  { id: 'root', parent: null, side: 'bottom', text: 'My main decision' },
  { id: 'a', parent: 'root', side: 'left', text: 'Possibility A' },
  { id: 'b', parent: 'root', side: 'right', text: 'Possibility B' },
];
// Layout made for a narrow panel: the tree goes down and every level is shifted a little to the right
const INDENT = 34;
const GAP = 24;
const PAD = 14;
const TYPES = { branch: Branch };

const validItems = list => Array.isArray(list) && list.some(i => i && i.id === 'root');
// A page only keeps a name when you renamed it; otherwise its label is its position (1, 2, 3...), so numbering is always continuous
const normPages = list => list.map(p => ({ ...p, name: /^\d+$/.test(String(p.name || '').trim()) ? '' : String(p.name || '') }));
const labelOf = (p, i) => p.name || String(i + 1);
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    const pages = raw && Array.isArray(raw.pages) ? normPages(raw.pages.filter(p => p && p.id && validItems(p.items))) : [];
    if (pages.length) return { pages, current: pages.some(p => p.id === raw.current) ? raw.current : pages[0].id };
  } catch {}
  try { // first launch of the multi-page version: the old single map becomes page 1 (default map only)
    if (MAP) throw 0;
    const old = JSON.parse(localStorage.getItem(OLD_KEY));
    if (validItems(old)) return { pages: [{ id: 'p1', name: '', items: old }], current: 'p1' };
  } catch {}
  return { pages: [{ id: 'p1', name: '', items: makeStart() }], current: 'p1' };
}

// A box and all of its descendants
function descendants(items, id) {
  const gone = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const i of items) if (!gone.has(i.id) && gone.has(i.parent)) { gone.add(i.id); changed = true; }
  }
  return gone;
}

function Branch({ id, data }) {
  const box = useRef(null);
  const area = useRef(null);
  const caret = useRef(null);
  const guard = useRef(0);
  // The box grows while typing (no inner scrolling) and any shift added by the browser is reset
  const fit = () => {
    const a = area.current;
    if (!a) return;
    a.style.height = 'auto';
    a.style.height = a.scrollHeight + 'px';
    for (let p = a; p; p = p.parentElement) { if (p.scrollTop) p.scrollTop = 0; if (p.scrollLeft) p.scrollLeft = 0; }
  };
  useLayoutEffect(() => { fit(); }, [data.text]);
  // Focus guard: for a moment after each keystroke, if the text cursor disappears without the user clicking
  // somewhere else, it is put back at the same place (frame by frame, so it also works if the box is briefly hidden)
  const watch = () => {
    const started = Date.now();
    guard.current = started;
    const tick = () => {
      const a = area.current;
      if (!a || guard.current !== started || Date.now() - started > 900 || data.lastIntent() >= started) return;
      if (document.hasFocus() && document.activeElement !== a) {
        a.focus({ preventScroll: true });
        const c = caret.current;
        if (c) { try { a.setSelectionRange(c[0], c[1]); } catch {} }
        data.report('cursor restored ' + (Date.now() - started) + ' ms after a keystroke');
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  // Measures the real height of the box so boxes never overlap
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    data.measure(id, el.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => data.measure(id, el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [id]);
  // A new branch gets the cursor immediately: just type
  useEffect(() => {
    if (!data.focusMe) return;
    const t = setTimeout(() => { area.current?.focus({ preventScroll: true }); area.current?.select(); }, 90);
    return () => clearTimeout(t);
  }, [data.focusMe]);
  // While typing, the view follows the text so you never write off screen
  useEffect(() => {
    if (document.activeElement !== area.current) return;
    const r = requestAnimationFrame(() => data.follow(id, true));
    return () => cancelAnimationFrame(r);
  }, [data.text]);
  const cls = 'branch' + (data.top ? ' root' : '') + (data.selected ? ' selected' : '') + (data.dim ? ' dim' : '');
  return <div ref={box} className={cls} onClick={() => data.pick(id)}>
    <Handle type="target" position={Position.Left} style={{ opacity: 0, top: 24 }} />
    <textarea ref={area} className="nodrag nopan" value={data.text} rows={1} spellCheck={false} aria-label="Branch text"
      onChange={e => { fit(); caret.current = [e.target.selectionStart, e.target.selectionEnd]; watch(); data.rename(id, e.target.value); }}
      onSelect={e => { caret.current = [e.target.selectionStart, e.target.selectionEnd]; }}
      onFocus={() => data.select(id)}
      onBlur={() => data.endEdit()}
      placeholder="Write your idea..." />
    {data.selected && !data.moving && <div className="tools nodrag nopan">
      {id !== 'root' && <button title="Change the parent of this branch (M)" onClick={e => { e.stopPropagation(); data.startMove(id); }}>Move</button>}
      <button title="Add a box at the same level (S)" onClick={e => { e.stopPropagation(); data.addSibling(id); }}>+ Sibling</button>
      {id !== 'root' && <button className="del" title="Delete branch (Del)" onClick={e => { e.stopPropagation(); data.remove(id); }}>✕</button>}
    </div>}
    <button className="plus nodrag nopan" title="Add a sub-branch (A)"
      onClick={e => { e.stopPropagation(); data.add(id, 'bottom'); }}>+</button>
    <Handle type="source" position={Position.Bottom} style={{ opacity: 0, left: 22 }} />
  </div>;
}

// Children of every box in display order (older maps: the left/bottom/right order is kept)
function groupItems(items) {
  const groups = new Map();
  for (const item of items) groups.set(item.parent, [...(groups.get(item.parent) || []), item]);
  const rank = { left: 0, bottom: 1, right: 2 };
  for (const group of groups.values()) group.sort((a, b) => rank[a.side] - rank[b.side]);
  return groups;
}

// The whole page as a plain text tree (no instructions: the structure alone tells the story)
function toOutline(items) {
  const groups = groupItems(items);
  const lines = [];
  const seen = new Set();
  const clean = item => (item.text || '').trim().replace(/\s*\n\s*/g, ' ') || '(empty)';
  const walk = (item, prefix, last, top) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    lines.push(top ? clean(item) : prefix + (last ? '└─ ' : '├─ ') + clean(item));
    const kids = groups.get(item.id) || [];
    const next = top ? '' : prefix + (last ? '   ' : '│  ');
    kids.forEach((child, i) => walk(child, next, i === kids.length - 1, false));
  };
  (groups.get(null) || []).forEach((top, i) => { if (i) lines.push(''); walk(top, '', true, true); });
  return lines.join('\n');
}

const copyText = async text => {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try { // fallback for frames where the clipboard API is blocked
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
};

function layout(items, heights) {
  const groups = groupItems(items);
  const positions = {};
  let y = PAD;
  function place(id, depth) {
    if (positions[id]) return;
    positions[id] = { x: PAD + depth * INDENT, y };
    y += (heights[id] || 70) + GAP;
    for (const child of groups.get(id) || []) place(child.id, depth + 1);
  }
  // Several top-level boxes are possible (parent = null)
  for (const top of groups.get(null) || []) place(top.id, 0);
  return positions;
}

export default function App() {
  const [store, setStore] = useState(load); // { pages: [{ id, name, items }], current }
  const storeRef = useRef(store); storeRef.current = store;
  const { pages, current } = store;
  const page = pages.find(p => p.id === current) || pages[0];
  const items = page.items;
  const [selected, setSelected] = useState('root');
  const [focusId, setFocusId] = useState(null);
  const [heights, setHeights] = useState({});
  const [moving, setMoving] = useState(null); // box being moved
  const [help, setHelp] = useState(false);
  const [dbg, setDbg] = useState('none so far');
  const [shareText, setShareText] = useState(null); // shown only if the clipboard is blocked
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [draft, setDraft] = useState('');
  // The map only catches the mouse wheel after a click on it (otherwise the Notion page scrolls normally)
  const [active, setActive] = useState(() => typeof document !== 'undefined' && document.hasFocus());
  const rf = useRef(null);
  const intent = useRef(0); // last moment a loss of focus was wanted (click, Tab, Esc)

  useEffect(() => {
    const on = () => setActive(true);
    const off = () => setActive(false);
    const mark = () => { intent.current = Date.now(); };
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    window.addEventListener('pointerdown', on, true);
    window.addEventListener('pointerdown', mark, true);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
      window.removeEventListener('pointerdown', on, true);
      window.removeEventListener('pointerdown', mark, true);
    };
  }, []);

  const setItems = next => setStore(s => ({ ...s, pages: s.pages.map(p => p.id === s.current
    ? { ...p, items: typeof next === 'function' ? next(p.items) : next } : p) }));
  const measure = (id, h) => setHeights(old => Math.abs((old[id] || 0) - h) < 1 ? old : { ...old, [id]: h });

  // Scrolls the view just enough to keep a box fully visible
  const keepVisible = (id, typingMode) => {
    const inst = rf.current;
    if (!inst) return;
    const el = document.querySelector('.react-flow__node[data-id="' + id + '"]');
    const wrap = document.querySelector('.canvas');
    if (!el || !wrap) return;
    const a = el.getBoundingClientRect(), b = wrap.getBoundingClientRect();
    const m = 16;
    let dx = 0, dy = 0;
    if (a.bottom > b.bottom - m) dy = (b.bottom - m) - a.bottom;
    if (a.top + dy < b.top + m) dy = (b.top + m) - a.top;
    if (!typingMode) { // while typing the view only follows vertically, never sideways
      if (a.right > b.right - m) dx = (b.right - m) - a.right;
      if (a.left + dx < b.left + m) dx = (b.left + m) - a.left;
    }
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const v = inst.getViewport();
    inst.setViewport({ x: v.x + dx, y: v.y + dy, zoom: v.zoom }, typingMode ? undefined : { duration: 120 });
  };

  // History: no confirmations anywhere, Ctrl+Z brings anything back (it covers all pages)
  const past = useRef([]);
  const future = useRef([]);
  const typing = useRef(null); // box being typed in (one typing session = one history step)
  const [, bump] = useState(0);
  const commit = () => {
    past.current.push(storeRef.current);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    bump(n => n + 1);
  };
  const resetView = () => { setHeights({}); setSelected('root'); setFocusId(null); setMoving(null); typing.current = null; };
  const restore = snap => {
    if (snap.current !== storeRef.current.current) resetView();
    storeRef.current = snap; setStore(snap); typing.current = null; setFocusId(null); setMoving(null);
    const snapItems = (snap.pages.find(p => p.id === snap.current) || { items: [] }).items;
    setSelected(s => snapItems.some(i => i.id === s) ? s : 'root'); bump(n => n + 1);
  };
  const undo = () => {
    if (!past.current.length) return;
    future.current.push(storeRef.current); restore(past.current.pop());
  };
  const redo = () => {
    if (!future.current.length) return;
    past.current.push(storeRef.current); restore(future.current.pop());
  };

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {} }, [store]);

  // After adding a box, the view follows it if it is not already visible
  useEffect(() => {
    if (!focusId) return;
    const t = setTimeout(() => keepVisible(focusId), 140);
    return () => clearTimeout(t);
  }, [focusId]);

  // Stops the browser from shifting the content when the text cursor gets close to an edge
  const stopScroll = e => {
    const t = e.target;
    if (t && (t.scrollTop || t.scrollLeft)) { t.scrollTop = 0; t.scrollLeft = 0; }
  };

  const rename = (id, text) => {
    if (typing.current !== id) { commit(); typing.current = id; }
    setItems(old => old.map(i => i.id === id ? { ...i, text } : i));
  };
  const endEdit = () => { typing.current = null; };
  const add = (parent, side) => { const id = crypto.randomUUID();
    commit(); typing.current = null;
    setItems(old => [...old, { id, parent, side, text: 'New possibility' }]);
    setSelected(id); setFocusId(id); };
  // Same level as the chosen box, placed right after it (also works for the initial box)
  const addSibling = id => {
    const cur = items.find(i => i.id === id);
    if (!cur) return;
    const nid = crypto.randomUUID();
    commit(); typing.current = null;
    setItems(old => {
      const idx = old.findIndex(i => i.id === id);
      const copy = old.slice();
      copy.splice(idx + 1, 0, { id: nid, parent: cur.parent, side: cur.side, text: cur.parent === null ? 'New decision' : 'New possibility' });
      return copy;
    });
    setSelected(nid); setFocusId(nid);
  };
  const remove = (target = selected) => {
    if (target === 'root') return;
    const cur = items.find(i => i.id === target);
    if (!cur) return;
    const gone = descendants(items, target);
    commit(); typing.current = null;
    setItems(old => old.filter(i => !gone.has(i.id)));
    setSelected(cur.parent || 'root'); setFocusId(null);
  };
  // Clears the current page only (other pages are untouched)
  const reset = () => { commit(); resetView(); setItems(makeStart()); };
  // Changes the parent of a branch (with all its descendants) without deleting anything
  const reparent = (id, newParent) => {
    commit(); typing.current = null;
    setItems(old => {
      const moved = old.find(i => i.id === id);
      if (!moved) return old;
      return [...old.filter(i => i.id !== id), { ...moved, parent: newParent, side: 'bottom' }];
    });
    setMoving(null); setSelected(id);
    intent.current = Date.now();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    setTimeout(() => keepVisible(id), 140);
  };
  const startMove = id => { if (id !== 'root') setMoving(id); };
  const pick = id => {
    if (moving) { if (!descendants(items, moving).has(id)) reparent(moving, id); return; }
    setSelected(id);
  };

  // Pages
  const switchPage = id => {
    if (id === current || !pages.some(p => p.id === id)) return;
    resetView();
    setStore(s => ({ ...s, current: id }));
  };
  const newPage = () => {
    commit(); resetView();
    const id = crypto.randomUUID();
    setStore(s => ({ pages: [...s.pages, { id, name: '', items: makeStart() }], current: id }));
  };
  const deletePage = id => {
    if (pages.length <= 1) return;
    commit();
    const idx = pages.findIndex(p => p.id === id);
    const rest = pages.filter(p => p.id !== id);
    const nextCurrent = id === current ? rest[Math.max(0, idx - 1)].id : current;
    if (nextCurrent !== current) resetView();
    setStore({ pages: rest, current: nextCurrent });
  };
  const finishRename = id => {
    // an empty or purely numeric name goes back to the automatic number
    const typed = draft.trim();
    const name = typed && !/^\d+$/.test(typed) ? typed : '';
    setStore(s => ({ ...s, pages: s.pages.map(p => p.id === id ? { ...p, name } : p) }));
    setRenaming(null);
  };
  const share = async () => {
    const text = toOutline(items);
    if (await copyText(text)) { setShareText(null); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    else setShareText(text);
  };

  const positions = useMemo(() => layout(items, heights), [items, heights]);
  const order = useMemo(() => items.filter(i => positions[i.id]).sort((a, b) => positions[a.id].y - positions[b.id].y).map(i => i.id), [items, positions]);
  const invalid = moving ? descendants(items, moving) : null;

  const choose = id => { setSelected(id); setTimeout(() => keepVisible(id), 30); };
  const go = (d, wrap) => {
    if (!order.length) return;
    let i = order.indexOf(selected);
    if (i < 0) i = 0;
    i += d;
    i = wrap ? (i + order.length) % order.length : Math.max(0, Math.min(order.length - 1, i));
    choose(order[i]);
  };
  const edit = id => {
    const ta = document.querySelector('.react-flow__node[data-id="' + id + '"] textarea');
    if (ta) { ta.focus({ preventScroll: true }); const n = ta.value.length; ta.setSelectionRange(n, n); }
  };

  // Keyboard shortcuts (the handler is replaced on every render so it always sees the latest state)
  const keyRef = useRef(null);
  keyRef.current = e => {
    const t = e.target;
    const typingNow = !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT');
    const k = e.key;
    if (e.ctrlKey || e.metaKey) {
      const kk = k.toLowerCase();
      if (kk === 'a') { // select all: only the text of the box, never the interface around it
        if (t && t.tagName === 'INPUT') return;
        e.preventDefault();
        const ta = typingNow ? t : document.querySelector('.react-flow__node[data-id="' + selected + '"] textarea');
        if (ta) { ta.focus({ preventScroll: true }); ta.select(); }
        return;
      }
      if (kk === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (kk === 'y' || (kk === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      return;
    }
    if (e.altKey) return;
    if (k === 'Escape') {
      if (moving) setMoving(null);
      else if (typingNow) { intent.current = Date.now(); t.blur(); }
      else if (help) setHelp(false);
      return;
    }
    if (k === 'Tab') { e.preventDefault(); if (typingNow) { intent.current = Date.now(); t.blur(); } go(e.shiftKey ? -1 : 1, true); return; }
    if (typingNow) return;
    const cur = items.find(i => i.id === selected);
    if (k === 'ArrowDown') { e.preventDefault(); go(1); }
    else if (k === 'ArrowUp') { e.preventDefault(); go(-1); }
    else if (k === 'ArrowLeft') { e.preventDefault(); if (cur && cur.parent) choose(cur.parent); }
    else if (k === 'ArrowRight') { e.preventDefault(); const kid = order.find(id => (items.find(i => i.id === id) || {}).parent === selected); if (kid) choose(kid); }
    else if (moving && k === 'Enter') { e.preventDefault(); pick(selected); }
    else if (k === 'Enter' || k === 'F2' || k === 'e' || k === 'E') { e.preventDefault(); edit(selected); }
    else if (k === 'a' || k === 'A' || k === '+' || k === '=') { e.preventDefault(); add(selected, 'bottom'); }
    else if (k === 's' || k === 'S') { e.preventDefault(); addSibling(selected); }
    else if (k === 'c' || k === 'C') { e.preventDefault(); share(); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); remove(selected); }
    else if (k === 'm' || k === 'M') { e.preventDefault(); startMove(selected); }
    else if (k === '[' || k === ']') {
      e.preventDefault();
      const i = pages.findIndex(p => p.id === current);
      switchPage(pages[(i + (k === ']' ? 1 : -1) + pages.length) % pages.length].id);
    }
    else if (k === '?') { e.preventDefault(); setHelp(h => !h); }
  };
  useEffect(() => {
    const h = e => keyRef.current && keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Callbacks given to the boxes keep the same identity forever, and a box object is only rebuilt when
  // something about it really changed: this keeps React Flow from re-reading every box on every keystroke
  const api = useRef({});
  api.current = { rename, endEdit, add, addSibling, remove, startMove, pick, measure, follow: keepVisible,
    lastIntent: () => intent.current, report: setDbg };
  const stable = useMemo(() => {
    const w = name => (...args) => api.current[name](...args);
    return { rename: w('rename'), endEdit: w('endEdit'), add: w('add'), addSibling: w('addSibling'), remove: w('remove'),
      startMove: w('startMove'), pick: w('pick'), measure: w('measure'), follow: w('follow'), lastIntent: w('lastIntent'),
      report: w('report'), select: setSelected };
  }, []);
  const nodeCache = useRef(new Map());
  const nodes = items.filter(i => positions[i.id]).map(i => {
    const pos = positions[i.id];
    const flags = { top: i.parent === null, selected: selected === i.id, focusMe: focusId === i.id,
      dim: !!(invalid && invalid.has(i.id)), moving: !!moving };
    const sig = JSON.stringify([i.text, flags, pos.x, pos.y]);
    const hit = nodeCache.current.get(i.id);
    if (hit && hit.sig === sig) return hit.node;
    const node = { id: i.id, type: 'branch', position: { x: pos.x, y: pos.y }, draggable: false, data: { text: i.text, ...flags, ...stable } };
    nodeCache.current.set(i.id, { sig, node });
    return node;
  });
  const edges = useMemo(() => items.filter(i => i.parent && positions[i.id] && positions[i.parent]).map(i => ({
    id: 'e-' + i.id, source: i.parent, target: i.id, type: 'smoothstep', style: { stroke: '#8ba5d2', strokeWidth: 2 } })), [items, positions]);

  return <div className={'app' + (active ? ' active' : '') + (moving ? ' moving' : '')}>
    <style>{`
      *{box-sizing:border-box} html,body,#root{width:100%;height:100%;margin:0} body{font-family:system-ui,sans-serif}
      .app{height:100vh;height:100dvh;display:flex;flex-direction:column;background:#f4f7fd;user-select:none;-webkit-user-select:none}
      .share{padding:8px;background:#fff;border-top:1px solid #dae1f0;display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start}
      .share .sharehint{width:100%;font-size:11.5px;color:#6d7b97}
      .share textarea{flex:1;min-width:0;height:80px;font:11px/1.3 monospace;border:1px solid #d1daea;border-radius:8px;padding:6px;user-select:text;-webkit-user-select:text}
      .share button{border:1px solid #d1daea;border-radius:8px;padding:5px 9px;background:#fff;cursor:pointer;font-size:12px;color:#223456}
      .canvas{flex:1;min-height:0;position:relative}
      .react-flow__node{outline:none!important}
      .bar{padding:5px 7px;background:#fff;border-top:2px solid #dae1f0;display:flex;flex-wrap:nowrap;gap:5px;align-items:center;overflow:hidden}
      .app.active .bar{border-top-color:#5683eb}
      .bar button{border:1px solid #d1daea;border-radius:8px;padding:5px 9px;background:#fff;cursor:pointer;font-size:12px;color:#223456;white-space:nowrap;flex:none}
      .bar button:disabled{opacity:.4;cursor:default}
      .bar .hint{font-size:12px;color:#8a5a12;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
      .tabs{display:flex;gap:4px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none;padding:1px}
      .tabs::-webkit-scrollbar{display:none}
      .bar .tab{padding:5px 10px;border-radius:14px;border-color:#d1daea;background:#f4f7fd}
      .bar .tab.on{background:#223456;border-color:#223456;color:#fff}
      .tab .tx{margin-left:6px;opacity:.7;font-size:13px}
      .tab .tx:hover{opacity:1}
      .bar .tabadd{padding:5px 9px;border-radius:14px;font-size:14px;line-height:1}
      .tabinput{width:70px;flex:none;border:1px solid #5683eb;border-radius:14px;padding:4px 9px;font-size:12px;outline:none;color:#223456}
      .help{position:absolute;left:8px;right:8px;top:8px;z-index:20;background:#fff;border:1px solid #cfd8ec;border-radius:12px;padding:10px 12px;font-size:12.5px;line-height:1.7;color:#223456;box-shadow:0 8px 24px #20345a26}
      .help b{display:inline-block;min-width:92px;color:#2860d4}
      .help .dbg{margin-top:6px;padding-top:6px;border-top:1px solid #e3e9f6;font-size:11px;color:#6d7b97;line-height:1.4}
      .branch{width:240px;min-height:44px;background:#fff;border:2px solid #d3dded;border-radius:12px;padding:9px 12px 10px;position:relative;box-shadow:0 3px 12px #20345a12}
      .branch.root{background:#edf3ff}.branch.selected{border-color:#5683eb}
      .branch.dim{opacity:.35}
      .moving .branch:not(.dim):hover{border-color:#e08a2b;cursor:pointer}
      .branch textarea{display:block;width:100%;border:0;padding:0;margin:0;resize:none;overflow:hidden;background:transparent;text-align:left;outline:none;color:#223456;font:600 15px/1.35 system-ui;word-break:break-word;user-select:text;-webkit-user-select:text;cursor:text}
      .branch.root textarea{font-size:16px;font-weight:700}
      .plus{position:absolute;right:-9px;bottom:-11px;width:24px;height:24px;border-radius:50%;border:1px solid #a6bceb;background:white;color:#2860d4;cursor:pointer;font-size:17px;line-height:1;padding:0}
      .plus:hover{background:#326bdf;color:white}
      .tools{position:absolute;right:8px;top:-14px;display:flex;gap:4px;z-index:5}
      .tools button{height:22px;padding:0 8px;border-radius:11px;border:1px solid #c5d2ee;background:#fff;color:#2860d4;cursor:pointer;font-size:11px;line-height:1;white-space:nowrap}
      .tools button:hover{background:#326bdf;color:#fff;border-color:#326bdf}
      .tools .del{width:22px;padding:0;color:#c04040;border-color:#e3b5b5}
      .tools .del:hover{background:#d64545;color:#fff;border-color:#d64545}
    `}</style>
    <div className="canvas" onScrollCapture={stopScroll}>
      <ReactFlow key={current} nodes={nodes} edges={edges} nodeTypes={TYPES}
        defaultViewport={{ x: 6, y: 6, zoom: 1 }} minZoom={0.3} maxZoom={1.6}
        onInit={inst => { rf.current = inst; }}
        nodesDraggable={false} nodesConnectable={false} disableKeyboardA11y deleteKeyCode={null}
        panOnScroll={active} preventScrolling={active} panOnScrollSpeed={1} zoomOnScroll={false}
        zoomOnDoubleClick={false} panOnDrag>
        <Background gap={22} size={1} color="#d3deee" /><Controls showInteractive={false} />
      </ReactFlow>
      {help && <div className="help" onClick={() => setHelp(false)}>
        <div><b>Tab / Shift+Tab</b>next / previous box</div>
        <div><b>Arrow keys</b>navigate (left = parent, right = first child)</div>
        <div><b>A or +</b>add a sub-branch</div>
        <div><b>S</b>add a box at the same level</div>
        <div><b>Enter or E</b>write in the box</div>
        <div><b>Esc</b>stop writing</div>
        <div><b>Ctrl+A</b>select all the text of the box</div>
        <div><b>C</b>copy this page as a text tree</div>
        <div><b>M</b>change the parent (then Enter on the new one)</div>
        <div><b>Del</b>delete the branch</div>
        <div><b>[ and ]</b>previous / next page</div>
        <div><b>Ctrl+Z / Ctrl+Y</b>undo / redo</div>
        <div><b>?</b>show or hide this help</div>
        <div className="dbg">Map: {MAP || 'default'}<br />Last typing recovery: {dbg}</div>
      </div>}
    </div>
    {shareText !== null && <div className="share">
      <div className="sharehint">Copying is blocked here. Click the text, press Ctrl+A then Ctrl+C, and paste it where you need it.</div>
      <textarea readOnly value={shareText} onFocus={e => e.target.select()} />
      <button onClick={() => setShareText(null)}>Close</button>
    </div>}
    <div className="bar">
      {moving ? <>
        <span className="hint">Click the new parent box</span>
        <button onClick={() => reparent(moving, null)}>Main level</button>
        <button onClick={() => setMoving(null)}>Cancel</button>
      </> : <>
        <button title="Undo (Ctrl+Z)" disabled={!past.current.length} onClick={undo}>↶</button>
        <button title="Redo (Ctrl+Y)" disabled={!future.current.length} onClick={redo}>↷</button>
        <div className="tabs">
          {pages.map((p, idx) => renaming === p.id
            ? <input key={p.id} className="tabinput" autoFocus maxLength={14} value={draft}
                onChange={e => setDraft(e.target.value)} onBlur={() => finishRename(p.id)}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
            : <button key={p.id} className={'tab' + (p.id === current ? ' on' : '')} title="Open page (double-click to rename)"
                onClick={() => switchPage(p.id)} onDoubleClick={() => { setRenaming(p.id); setDraft(labelOf(p, idx)); }}>
                {labelOf(p, idx)}
                {p.id === current && pages.length > 1 && <span className="tx" title="Delete this page"
                  onClick={e => { e.stopPropagation(); deletePage(p.id); }}>×</span>}
              </button>)}
        </div>
        <button className="tabadd" title="New page" onClick={newPage}>+</button>
        <button title="Copy this page as a text tree (C)" onClick={share}>{copied ? 'Copied ✓' : 'Copy'}</button>
        <button title="Clear the current page" onClick={reset}>Reset</button>
        <button title="Keyboard shortcuts (?)" onClick={() => setHelp(h => !h)}>?</button>
      </>}
    </div>
  </div>;
}
