// @ts-nocheck
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const KEY = 'branchlab-notion-v2';
const START = [
  { id: 'root', parent: null, side: 'bottom', text: 'Ma décision principale' },
  { id: 'a', parent: 'root', side: 'left', text: 'Possibilité A' },
  { id: 'b', parent: 'root', side: 'right', text: 'Possibilité B' },
];
// Mise en page pensée pour un panneau étroit : l'arbre descend et chaque niveau est décalé vers la droite
const INDENT = 34;
const GAP = 24;
const PAD = 14;
const TYPES = { branch: Branch };

// Une case et toutes ses descendantes
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
  const lastChange = useRef(0);
  // La case grandit pendant la frappe (jamais de défilement interne) et tout décalage ajouté par le navigateur est remis à zéro
  const fit = () => {
    const a = area.current;
    if (!a) return;
    a.style.height = 'auto';
    a.style.height = a.scrollHeight + 'px';
    for (let p = a; p; p = p.parentElement) { if (p.scrollTop) p.scrollTop = 0; if (p.scrollLeft) p.scrollLeft = 0; }
  };
  useLayoutEffect(() => { fit(); }, [data.text]);
  // Mesure la hauteur réelle de la case pour que les cases ne se chevauchent jamais
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    data.measure(id, el.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => data.measure(id, el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [id]);
  // Une nouvelle branche prend le curseur tout de suite : il suffit de taper
  useEffect(() => {
    if (!data.focusMe) return;
    const t = setTimeout(() => { area.current?.focus({ preventScroll: true }); area.current?.select(); }, 90);
    return () => clearTimeout(t);
  }, [data.focusMe]);
  // Pendant la saisie, la vue suit le texte pour ne jamais écrire hors de l'écran
  useEffect(() => {
    if (document.activeElement !== area.current) return;
    const r = requestAnimationFrame(() => data.follow(id, true));
    return () => cancelAnimationFrame(r);
  }, [data.text]);
  const cls = 'branch' + (data.top ? ' root' : '') + (data.selected ? ' selected' : '') + (data.dim ? ' dim' : '');
  return <div ref={box} className={cls} onClick={() => data.pick(id)}>
    <Handle type="target" position={Position.Left} style={{ opacity: 0, top: 24 }} />
    <textarea ref={area} className="nodrag nopan" value={data.text} rows={1} spellCheck={false} aria-label="Texte de la branche"
      onChange={e => { fit(); caret.current = [e.target.selectionStart, e.target.selectionEnd]; lastChange.current = Date.now(); data.rename(id, e.target.value); }}
      onSelect={e => { caret.current = [e.target.selectionStart, e.target.selectionEnd]; }}
      onFocus={() => data.select(id)}
      onBlur={() => {
        data.endEdit();
        const a = area.current;
        // Perte de curseur involontaire en pleine frappe (alors que la fenêtre garde le focus) : on le remet au même endroit
        if (Date.now() - lastChange.current < 400 && Date.now() - data.lastIntent() > 500 && document.hasFocus()) {
          requestAnimationFrame(() => {
            if (a && document.activeElement !== a) {
              a.focus({ preventScroll: true });
              const c = caret.current;
              if (c) a.setSelectionRange(c[0], c[1]);
            }
          });
        }
      }}
      placeholder="Écris ton idée..." />
    {data.selected && !data.moving && <div className="tools nodrag nopan">
      {id !== 'root' && <button title="Changer le parent de cette branche (M)" onClick={e => { e.stopPropagation(); data.startMove(id); }}>Déplacer</button>}
      <button title="Ajouter une case au même niveau (S)" onClick={e => { e.stopPropagation(); data.addSibling(id); }}>+ Voisine</button>
      {id !== 'root' && <button className="del" title="Supprimer la branche (Suppr)" onClick={e => { e.stopPropagation(); data.remove(id); }}>✕</button>}
    </div>}
    <button className="plus nodrag nopan" title="Ajouter une sous-branche (A)"
      onClick={e => { e.stopPropagation(); data.add(id, 'bottom'); }}>+</button>
    <Handle type="source" position={Position.Bottom} style={{ opacity: 0, left: 22 }} />
  </div>;
}

function layout(items, heights) {
  const groups = new Map();
  for (const item of items) groups.set(item.parent, [...(groups.get(item.parent) || []), item]);
  const rank = { left: 0, bottom: 1, right: 2 }; // anciennes cartes : l'ordre gauche/bas/droite est conservé
  for (const group of groups.values()) group.sort((a, b) => rank[a.side] - rank[b.side]);
  const positions = {};
  let y = PAD;
  function place(id, depth) {
    if (positions[id]) return;
    positions[id] = { x: PAD + depth * INDENT, y };
    y += (heights[id] || 70) + GAP;
    for (const child of groups.get(id) || []) place(child.id, depth + 1);
  }
  // Plusieurs cases de premier niveau sont possibles (parent = null)
  for (const top of groups.get(null) || []) place(top.id, 0);
  return positions;
}

export default function App() {
  const [items, setItems] = useState(() => { try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(saved) && saved.some(i => i.id === 'root') ? saved : START;
  } catch { return START; } });
  const [selected, setSelected] = useState('root');
  const [focusId, setFocusId] = useState(null);
  const [heights, setHeights] = useState({});
  const [exportText, setExportText] = useState(null);
  const [moving, setMoving] = useState(null); // case en cours de déplacement
  const [help, setHelp] = useState(false);
  // La carte n'attrape la molette qu'après un clic dedans (sinon la page Notion défile normalement)
  const [active, setActive] = useState(() => typeof document !== 'undefined' && document.hasFocus());
  const rf = useRef(null);
  const intent = useRef(0); // dernier moment où la perte de focus était voulue (clic, Tab, Échap)

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

  const measure = (id, h) => setHeights(old => Math.abs((old[id] || 0) - h) < 1 ? old : { ...old, [id]: h });

  // Fait glisser la vue juste ce qu'il faut pour que la case reste entièrement visible
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
    if (!typingMode) { // pendant la frappe on ne suit que verticalement, jamais de glissement sur le côté
      if (a.right > b.right - m) dx = (b.right - m) - a.right;
      if (a.left + dx < b.left + m) dx = (b.left + m) - a.left;
    }
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const v = inst.getViewport();
    inst.setViewport({ x: v.x + dx, y: v.y + dy, zoom: v.zoom }, typingMode ? undefined : { duration: 120 });
  };

  // Historique : pas de confirmation, on peut revenir en arrière (Ctrl+Z) ou refaire (Ctrl+Y)
  const itemsRef = useRef(items); itemsRef.current = items;
  const past = useRef([]);
  const future = useRef([]);
  const typing = useRef(null); // case en cours de saisie (une saisie = une seule étape d'historique)
  const [, bump] = useState(0);
  const commit = () => {
    past.current.push(itemsRef.current);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    bump(n => n + 1);
  };
  const restore = next => {
    itemsRef.current = next; setItems(next); typing.current = null; setFocusId(null); setMoving(null);
    setSelected(s => next.some(i => i.id === s) ? s : 'root'); bump(n => n + 1);
  };
  const undo = () => {
    if (!past.current.length) return;
    future.current.push(itemsRef.current); restore(past.current.pop());
  };
  const redo = () => {
    if (!future.current.length) return;
    past.current.push(itemsRef.current); restore(future.current.pop());
  };

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} }, [items]);

  // Après un ajout, la vue suit la nouvelle case si elle n'est pas déjà visible
  useEffect(() => {
    if (!focusId) return;
    const t = setTimeout(() => keepVisible(focusId), 140);
    return () => clearTimeout(t);
  }, [focusId]);

  // Empêche le navigateur de décaler le contenu quand le curseur d'écriture approche du bord
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
    setItems(old => [...old, { id, parent, side, text: 'Nouvelle possibilité' }]);
    setSelected(id); setFocusId(id); };
  // Même niveau que la case choisie, placée juste après elle (y compris pour la case initiale)
  const addSibling = id => {
    const cur = items.find(i => i.id === id);
    if (!cur) return;
    const nid = crypto.randomUUID();
    commit(); typing.current = null;
    setItems(old => {
      const idx = old.findIndex(i => i.id === id);
      const copy = old.slice();
      copy.splice(idx + 1, 0, { id: nid, parent: cur.parent, side: cur.side, text: cur.parent === null ? 'Nouvelle décision' : 'Nouvelle possibilité' });
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
  const reset = () => { commit(); typing.current = null; setItems(START); setSelected('root'); setFocusId(null); setMoving(null); };
  // Change le parent d'une branche (avec tous ses descendants) sans rien supprimer
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
  const exportJSON = () => {
    const json = JSON.stringify(items, null, 2);
    // Si le téléchargement est bloqué par Notion, le texte reste copiable dans la zone affichée
    setExportText(json);
    try { const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'branchlab.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch {}
  };
  const copyExport = () => { try { navigator.clipboard.writeText(exportText); } catch {} };

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

  // Raccourcis clavier (le gestionnaire est remplacé à chaque rendu pour voir l'état à jour)
  const keyRef = useRef(null);
  keyRef.current = e => {
    const t = e.target;
    const typingNow = !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT');
    const k = e.key;
    if (e.ctrlKey || e.metaKey) {
      const kk = k.toLowerCase();
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
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); remove(selected); }
    else if (k === 'm' || k === 'M') { e.preventDefault(); startMove(selected); }
    else if (k === '?') { e.preventDefault(); setHelp(h => !h); }
  };
  useEffect(() => {
    const h = e => keyRef.current && keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const nodes = items.filter(i => positions[i.id]).map(i => ({ id: i.id, type: 'branch', position: positions[i.id], draggable: false,
    data: { text: i.text, top: i.parent === null, selected: selected === i.id, focusMe: focusId === i.id,
      dim: !!(invalid && invalid.has(i.id)), moving: !!moving,
      rename, endEdit, add, addSibling, remove, startMove, pick, measure, follow: keepVisible, select: setSelected,
      lastIntent: () => intent.current } }));
  const edges = items.filter(i => i.parent && positions[i.id] && positions[i.parent]).map(i => ({
    id: 'e-' + i.id, source: i.parent, target: i.id, type: 'smoothstep', style: { stroke: '#8ba5d2', strokeWidth: 2 } }));

  return <div className={'app' + (active ? ' active' : '') + (moving ? ' moving' : '')}>
    <style>{`
      *{box-sizing:border-box} html,body,#root{width:100%;height:100%;margin:0} body{font-family:system-ui,sans-serif}
      .app{height:100vh;height:100dvh;display:flex;flex-direction:column;background:#f4f7fd}
      .canvas{flex:1;min-height:0;position:relative}
      .react-flow__node{outline:none!important}
      .bar{padding:5px 7px;background:#fff;border-top:2px solid #dae1f0;display:flex;flex-wrap:nowrap;gap:5px;align-items:center;overflow:hidden}
      .app.active .bar{border-top-color:#5683eb}
      .bar button{border:1px solid #d1daea;border-radius:8px;padding:5px 9px;background:#fff;cursor:pointer;font-size:12px;color:#223456;white-space:nowrap;flex:none}
      .bar button:disabled{opacity:.4;cursor:default}
      .bar .spacer{flex:1;min-width:0}
      .bar .hint{font-size:12px;color:#8a5a12;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
      .export{padding:8px;background:#fff;border-top:1px solid #dae1f0;display:flex;gap:6px;align-items:flex-start}
      .export textarea{flex:1;height:64px;min-width:0;font:11px/1.3 monospace;border:1px solid #d1daea;border-radius:8px;padding:6px}
      .export button{border:1px solid #d1daea;border-radius:8px;padding:5px 9px;background:#fff;cursor:pointer;font-size:12px}
      .help{position:absolute;left:8px;right:8px;top:8px;z-index:20;background:#fff;border:1px solid #cfd8ec;border-radius:12px;padding:10px 12px;font-size:12.5px;line-height:1.7;color:#223456;box-shadow:0 8px 24px #20345a26}
      .help b{display:inline-block;min-width:92px;color:#2860d4}
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
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={TYPES}
        defaultViewport={{ x: 6, y: 6, zoom: 1 }} minZoom={0.3} maxZoom={1.6}
        onInit={inst => { rf.current = inst; }}
        nodesDraggable={false} nodesConnectable={false} disableKeyboardA11y deleteKeyCode={null}
        panOnScroll={active} preventScrolling={active} panOnScrollSpeed={1} zoomOnScroll={false}
        zoomOnDoubleClick={false} panOnDrag>
        <Background gap={22} size={1} color="#d3deee" /><Controls showInteractive={false} />
      </ReactFlow>
      {help && <div className="help" onClick={() => setHelp(false)}>
        <div><b>Tab / Maj+Tab</b>case suivante / précédente</div>
        <div><b>↑ ↓ ← →</b>naviguer (← parent, → premier enfant)</div>
        <div><b>A ou +</b>ajouter une sous-branche</div>
        <div><b>S</b>ajouter une case au même niveau</div>
        <div><b>Entrée ou E</b>écrire dans la case</div>
        <div><b>Échap</b>arrêter d'écrire</div>
        <div><b>M</b>changer le parent (Entrée sur la nouvelle)</div>
        <div><b>Suppr</b>supprimer la branche</div>
        <div><b>Ctrl+Z / Ctrl+Y</b>annuler / rétablir</div>
        <div><b>?</b>afficher ou cacher cette aide</div>
      </div>}
    </div>
    {exportText !== null && <div className="export">
      <textarea readOnly value={exportText} onFocus={e => e.target.select()} />
      <button onClick={copyExport}>Copier</button><button onClick={() => setExportText(null)}>Fermer</button>
    </div>}
    <div className="bar">
      {moving ? <>
        <span className="hint">Clique la nouvelle case parente</span>
        <button onClick={() => reparent(moving, null)}>Niveau principal</button>
        <button onClick={() => setMoving(null)}>Annuler</button>
      </> : <>
        <button title="Annuler (Ctrl+Z)" disabled={!past.current.length} onClick={undo}>↶</button>
        <button title="Rétablir (Ctrl+Y)" disabled={!future.current.length} onClick={redo}>↷</button>
        <span className="spacer" />
        <button onClick={exportJSON}>Exporter</button>
        <button onClick={reset}>Réinitialiser</button>
        <button title="Raccourcis clavier (?)" onClick={() => setHelp(h => !h)}>?</button>
      </>}
    </div>
  </div>;
}
