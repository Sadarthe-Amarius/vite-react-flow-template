// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const KEY = 'branchlab-notion-v2';
const START = [
  { id: 'root', parent: null, side: 'bottom', text: 'Ma décision principale' },
  { id: 'a', parent: 'root', side: 'left', text: 'Possibilité A' },
  { id: 'b', parent: 'root', side: 'right', text: 'Possibilité B' },
];
const TYPES = { branch: Branch };
function Branch({ id, data }) {
  return <div className={'branch ' + (id === 'root' ? 'root' : '') + (data.selected ? ' selected' : '')} onClick={() => data.select(id)}>
    <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
    <textarea className="nodrag nowheel" value={data.text} rows={2} aria-label="Texte de la branche"
      onChange={e => data.rename(id, e.target.value)} placeholder="Écris ton idée..." />
    {['left', 'bottom', 'right'].map(side => <button key={side} className={'plus ' + side + ' nodrag'}
      title={'Ajouter une branche : ' + side} onClick={e => { e.stopPropagation(); data.add(id, side); }}>+</button>)}
    <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
  </div>;
}
function layout(items) {
  const groups = new Map();
  for (const item of items) groups.set(item.parent, [...(groups.get(item.parent) || []), item]);
  const rank = { left: 0, bottom: 1, right: 2 };
  for (const group of groups.values()) group.sort((a, b) => rank[a.side] - rank[b.side]);
  const widths = {};
  function size(id) {
    const children = groups.get(id) || [];
    return widths[id] = Math.max(220, children.reduce((n, child) => n + size(child.id), 0) + Math.max(0, children.length - 1) * 36);
  }
  const positions = {};
  function place(id, left, depth) {
    positions[id] = { x: left + (widths[id] - 220) / 2, y: depth * 155 + 25 };
    let x = left;
    for (const child of groups.get(id) || []) { place(child.id, x, depth + 1); x += widths[child.id] + 36; }
  }
  size('root'); place('root', 30, 0);
  return positions;
}
export default function App() {
  const [items, setItems] = useState(() => { try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(saved) && saved.some(i => i.id === 'root') ? saved : START;
  } catch { return START; } });
  const [selected, setSelected] = useState('root');
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} }, [items]);
  const rename = (id, text) => setItems(old => old.map(i => i.id === id ? { ...i, text } : i));
  const add = (parent, side) => { const id = crypto.randomUUID();
    setItems(old => [...old, { id, parent, side, text: 'Nouvelle possibilité' }]); setSelected(id); };
  const positions = useMemo(() => layout(items), [items]);
  const nodes = items.filter(i => positions[i.id]).map(i => ({ id: i.id, type: 'branch', position: positions[i.id], draggable: false,
    data: { text: i.text, selected: selected === i.id, rename, add, select: setSelected } }));
  const edges = items.filter(i => i.parent && positions[i.id] && positions[i.parent]).map(i => ({
    id: 'e-' + i.id, source: i.parent, target: i.id, type: 'smoothstep', style: { stroke: '#8ba5d2', strokeWidth: 2 } }));
  const remove = () => { if (selected === 'root' || !confirm('Supprimer cette branche et ses sous-branches ?')) return;
    const gone = new Set([selected]); let changed = true;
    while (changed) { changed = false; for (const i of items) if (!gone.has(i.id) && gone.has(i.parent)) { gone.add(i.id); changed = true; } }
    setItems(old => old.filter(i => !gone.has(i.id))); setSelected('root'); };
  const exportJSON = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'branchlab.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  return <div className="app">
    <style>{`
      *{box-sizing:border-box} html,body,#root{width:100%;height:100%;margin:0} body{font-family:system-ui,sans-serif}
      .app{height:100vh;height:100dvh;display:flex;flex-direction:column;background:#f4f7fd}
      .bar{padding:10px 14px;background:#fff;border-bottom:1px solid #dae1f0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .bar strong{margin-right:auto} .bar button{border:1px solid #d1daea;border-radius:8px;padding:7px 10px;background:#fff;cursor:pointer}
      .canvas{flex:1;min-height:0} .branch{width:220px;min-height:80px;background:#fff;border:2px solid #d3dded;border-radius:12px;padding:13px;position:relative;box-shadow:0 3px 12px #20345a12}
      .branch.root{background:#edf3ff}.branch.selected{border-color:#5683eb}
      .branch textarea{width:100%;min-height:46px;border:0;resize:none;background:transparent;text-align:center;outline:none;color:#223456;font:600 13px/1.4 system-ui}
      .plus{position:absolute;width:27px;height:27px;border-radius:50%;border:1px solid #a6bceb;background:white;color:#2860d4;cursor:pointer;font-size:19px;line-height:1}
      .plus.left{left:-14px;top:36%}.plus.right{right:-14px;top:36%}.plus.bottom{bottom:-15px;left:calc(50% - 13px)} .plus:hover{background:#326bdf;color:white}
    `}</style>
    <div className="bar"><strong>🌿 BranchLab — prototype</strong><button onClick={exportJSON}>Exporter</button>
      <button disabled={selected === 'root'} onClick={remove}>Supprimer la branche</button>
      <button onClick={() => { if (confirm('Recommencer la carte ?')) { setItems(START); setSelected('root'); } }}>Réinitialiser</button></div>
    <div className="canvas"><ReactFlow nodes={nodes} edges={edges} nodeTypes={TYPES} fitView
      fitViewOptions={{ padding: 0.3 }} nodesDraggable={false} nodesConnectable={false} panOnScroll zoomOnScroll={false} panOnDrag>
      <Background gap={22} size={1} color="#d3deee" /><Controls showInteractive={false} />
    </ReactFlow></div>
  </div>;
}
