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
const GAP = 14;
const PAD = 14;
const TYPES = { branch: Branch };

function Branch({ id, data }) {
  const box = useRef(null);
  const area = useRef(null);
  // Le texte passe à la ligne et la case grandit avec lui (jamais de défilement interne)
  useLayoutEffect(() => {
    const a = area.current;
    if (a) { a.style.height = 'auto'; a.style.height = a.scrollHeight + 'px'; }
  }, [data.text]);
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
  return <div ref={box} className={'branch ' + (id === 'root' ? 'root' : '') + (data.selected ? ' selected' : '')} onClick={() => data.select(id)}>
    <Handle type="target" position={Position.Left} style={{ opacity: 0, top: 24 }} />
    <textarea ref={area} className="nodrag" value={data.text} rows={1} spellCheck={false} aria-label="Texte de la branche"
      onChange={e => data.rename(id, e.target.value)} onFocus={() => data.select(id)} onBlur={data.endEdit}
      placeholder="Écris ton idée..." />
    {id !== 'root' && data.selected && <button className="del nodrag" title="Supprimer la branche"
      onClick={e => { e.stopPropagation(); data.remove(id); }}>✕</button>}
    <button className="plus nodrag" title="Ajouter une sous-branche"
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
  place('root', 0);
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
  const rf = useRef(null);

  const measure = (id, h) => setHeights(old => Math.abs((old[id] || 0) - h) < 1 ? old : { ...old, [id]: h });

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
    itemsRef.current = next; setItems(next); typing.current = null; setFocusId(null);
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
  useEffect(() => {
    const onKey = e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} }, [items]);

  // Après un ajout, la vue se recentre sur la nouvelle case seulement si elle n'est pas déjà visible
  useEffect(() => {
    if (!focusId) return;
    const t = setTimeout(() => {
      const inst = rf.current;
      if (!inst) return;
      const el = document.querySelector('.react-flow__node[data-id="' + focusId + '"]');
      const wrap = document.querySelector('.canvas');
      if (el && wrap) {
        const a = el.getBoundingClientRect(), b = wrap.getBoundingClientRect();
        if (a.top >= b.top && a.bottom <= b.bottom && a.left >= b.left && a.right <= b.right) return;
      }
      const z = inst.getZoom();
      inst.fitView({ nodes: [{ id: focusId }], minZoom: z, maxZoom: z, duration: 250 });
    }, 140);
    return () => clearTimeout(t);
  }, [focusId]);

  const rename = (id, text) => {
    if (typing.current !== id) { commit(); typing.current = id; }
    setItems(old => old.map(i => i.id === id ? { ...i, text } : i));
  };
  const endEdit = () => { typing.current = null; };
  const add = (parent, side) => { const id = crypto.randomUUID();
    commit(); typing.current = null;
    setItems(old => [...old, { id, parent, side, text: 'Nouvelle possibilité' }]);
    setSelected(id); setFocusId(id); };
  const remove = (target = selected) => {
    if (target === 'root') return;
    const gone = new Set([target]); let changed = true;
    while (changed) { changed = false; for (const i of items) if (!gone.has(i.id) && gone.has(i.parent)) { gone.add(i.id); changed = true; } }
    commit(); typing.current = null;
    setItems(old => old.filter(i => !gone.has(i.id))); setSelected('root'); setFocusId(null); };
  const reset = () => { commit(); typing.current = null; setItems(START); setSelected('root'); setFocusId(null); };
  const exportJSON = () => {
    const json = JSON.stringify(items, null, 2);
    // Si le téléchargement est bloqué par Notion, le texte reste copiable dans la zone affichée
    setExportText(json);
    try { const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'branchlab.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch {}
  };
  const copyExport = () => { try { navigator.clipboard.writeText(exportText); } catch {} };

  const positions = useMemo(() => layout(items, heights), [items, heights]);
  const nodes = items.filter(i => positions[i.id]).map(i => ({ id: i.id, type: 'branch', position: positions[i.id], draggable: false,
    data: { text: i.text, selected: selected === i.id, focusMe: focusId === i.id, rename, endEdit, add, remove, measure, select: setSelected } }));
  const edges = items.filter(i => i.parent && positions[i.id] && positions[i.parent]).map(i => ({
    id: 'e-' + i.id, source: i.parent, target: i.id, type: 'smoothstep', style: { stroke: '#8ba5d2', strokeWidth: 2 } }));

  return <div className="app">
    <style>{`
      *{box-sizing:border-box} html,body,#root{width:100%;height:100%;margin:0} body{font-family:system-ui,sans-serif}
      .app{height:100vh;height:100dvh;display:flex;flex-direction:column;background:#f4f7fd}
      .bar{padding:6px 8px;background:#fff;border-bottom:1px solid #dae1f0;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
      .bar strong{margin-right:auto;font-size:13px;color:#223456} .bar button{border:1px solid #d1daea;border-radius:8px;padding:5px 9px;background:#fff;cursor:pointer;font-size:12px;color:#223456}
      .bar button:disabled{opacity:.4;cursor:default}
      .export{padding:8px;background:#fff;border-bottom:1px solid #dae1f0;display:flex;gap:6px;align-items:flex-start}
      .export textarea{flex:1;height:64px;min-width:0;font:11px/1.3 monospace;border:1px solid #d1daea;border-radius:8px;padding:6px}
      .export button{border:1px solid #d1daea;border-radius:8px;padding:5px 9px;background:#fff;cursor:pointer;font-size:12px}
      .canvas{flex:1;min-height:0}
      .branch{width:240px;min-height:44px;background:#fff;border:2px solid #d3dded;border-radius:12px;padding:9px 12px 10px;position:relative;box-shadow:0 3px 12px #20345a12}
      .branch.root{background:#edf3ff}.branch.selected{border-color:#5683eb}
      .branch textarea{display:block;width:100%;border:0;padding:0;margin:0;resize:none;overflow:hidden;background:transparent;text-align:left;outline:none;color:#223456;font:600 15px/1.35 system-ui;word-break:break-word}
      .branch.root textarea{font-size:16px;font-weight:700}
      .plus{position:absolute;right:-9px;bottom:-11px;width:24px;height:24px;border-radius:50%;border:1px solid #a6bceb;background:white;color:#2860d4;cursor:pointer;font-size:17px;line-height:1;padding:0}
      .plus:hover{background:#326bdf;color:white}
      .del{position:absolute;right:-8px;top:-10px;width:22px;height:22px;border-radius:50%;border:1px solid #e3b5b5;background:white;color:#c04040;cursor:pointer;font-size:11px;line-height:1;padding:0}
      .del:hover{background:#d64545;color:white;border-color:#d64545}
    `}</style>
    <div className="bar"><strong>🌿 BranchLab</strong>
      <button title="Annuler (Ctrl+Z)" disabled={!past.current.length} onClick={undo}>↶</button>
      <button title="Rétablir (Ctrl+Y)" disabled={!future.current.length} onClick={redo}>↷</button>
      <button onClick={exportJSON}>Exporter</button>
      <button onClick={reset}>Réinitialiser</button>
    </div>
    {exportText !== null && <div className="export">
      <textarea readOnly value={exportText} onFocus={e => e.target.select()} />
      <button onClick={copyExport}>Copier</button><button onClick={() => setExportText(null)}>Fermer</button>
    </div>}
    <div className="canvas"><ReactFlow nodes={nodes} edges={edges} nodeTypes={TYPES}
      defaultViewport={{ x: 6, y: 6, zoom: 1 }} minZoom={0.3} maxZoom={1.6}
      onInit={inst => { rf.current = inst; }}
      nodesDraggable={false} nodesConnectable={false} panOnScroll panOnScrollSpeed={1} zoomOnScroll={false}
      zoomOnDoubleClick={false} panOnDrag>
      <Background gap={22} size={1} color="#d3deee" /><Controls showInteractive={false} />
    </ReactFlow></div>
  </div>;
}
