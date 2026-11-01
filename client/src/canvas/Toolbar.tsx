import { BRUSH_SIZES, PALETTE } from '@inkling/shared';
import { useEffect, useRef, useState } from 'react';

export type ToolChoice = 'brush' | 'eraser' | 'fill' | 'line' | 'rect' | 'ellipse';

interface ToolbarProps {
  tool: ToolChoice;
  color: number;
  size: number;
  filled: boolean;
  canUndo: boolean;
  onTool: (t: ToolChoice) => void;
  onColor: (c: number) => void;
  onSize: (s: number) => void;
  onFilled: (f: boolean) => void;
  onUndo: () => void;
  onClear: () => void;
}

const TOOLS: { id: ToolChoice; label: string; key: string; icon: string }[] = [
  {
    id: 'brush',
    label: 'Brush',
    key: 'B',
    icon: 'M4 20c3-1 5-3 5-5l8-8-3-3-8 8c-2 0-4 2-5 5zM15 4l3-1 3 3-1 3z',
  },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: 'M8 20h12M5 15l9-9 5 5-8 8H7zM9 11l5 5' },
  {
    id: 'fill',
    label: 'Fill',
    key: 'F',
    icon: 'M5 12l7-8 7 8-7 7zM20 17c0 1-1 2-1 3a1 1 0 002 0c0-1-1-2-1-3z',
  },
  { id: 'line', label: 'Line', key: 'L', icon: 'M4 20L20 4' },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: 'M4 6h16v12H4z' },
  {
    id: 'ellipse',
    label: 'Ellipse',
    key: 'O',
    icon: 'M12 5c5 0 9 3 9 7s-4 7-9 7-9-3-9-7 4-7 9-7z',
  },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const PEN_TOOLS = TOOLS.slice(0, 3);
const SHAPE_TOOLS = TOOLS.slice(3);

type Panel = 'shape' | 'size' | 'color';

const UNDO_ICON = 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3';
const CLEAR_ICON = 'M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6';

/**
 * The drawer's pencil case, one row exactly as wide as the sheet: tools, sizes, colours, undo and
 * clear. When the row is too narrow (phones), shapes, size and colour fold into small popovers.
 */
export function Toolbar(p: ToolbarProps) {
  const [open, setOpen] = useState<Panel | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (panel: Panel) => setOpen((cur) => (cur === panel ? null : panel));
  const shape = SHAPE_TOOLS.find((t) => t.id === p.tool);
  const pickTool = (t: ToolChoice) => {
    p.onTool(t);
    setOpen(null);
  };

  return (
    <div className="case" role="toolbar" aria-label="Drawing tools" ref={root}>
      <div className="case-group" role="group" aria-label="Tool">
        {PEN_TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="tool"
            aria-label={t.label}
            aria-pressed={p.tool === t.id}
            title={`${t.label} (${t.key})`}
            onClick={() => pickTool(t.id)}
          >
            <Icon d={t.icon} />
          </button>
        ))}
      </div>

      <div className="pop" data-open={open === 'shape'}>
        <button
          type="button"
          className="tool pop-trigger"
          aria-label="Shapes"
          aria-haspopup="true"
          aria-expanded={open === 'shape'}
          aria-pressed={!!shape}
          onClick={() => toggle('shape')}
        >
          <Icon d={(shape ?? SHAPE_TOOLS[1]!).icon} />
        </button>
        <div className="pop-panel case-group" role="group" aria-label="Shapes">
          {SHAPE_TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="tool"
              aria-label={t.label}
              aria-pressed={p.tool === t.id}
              title={`${t.label} (${t.key})`}
              onClick={() => pickTool(t.id)}
            >
              <Icon d={t.icon} />
            </button>
          ))}
          <button
            type="button"
            className="tool"
            aria-label="Solid"
            aria-pressed={p.filled}
            title="Fill shapes with colour"
            onClick={() => p.onFilled(!p.filled)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <rect
                x="4"
                y="6"
                width="16"
                height="12"
                rx="1"
                fill={p.filled ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray={p.filled ? undefined : '3 2.5'}
              />
            </svg>
          </button>
        </div>
      </div>

      <span className="sep" aria-hidden="true" />

      <div className="pop" data-open={open === 'size'}>
        <button
          type="button"
          className="tool pop-trigger"
          aria-label="Pick brush size"
          aria-haspopup="true"
          aria-expanded={open === 'size'}
          onClick={() => toggle('size')}
        >
          <span
            className="dot"
            style={{ width: 6 + p.size * 3, height: 6 + p.size * 3 }}
            aria-hidden="true"
          />
        </button>
        <div className="pop-panel case-group" role="group" aria-label="Brush size">
          {BRUSH_SIZES.map((px, i) => (
            <button
              key={px}
              type="button"
              className="size"
              aria-label={`Size ${i + 1}`}
              aria-pressed={p.size === i}
              onClick={() => {
                p.onSize(i);
                setOpen(null);
              }}
            >
              <span style={{ width: Math.max(5, px * 0.5), height: Math.max(5, px * 0.5) }} />
            </button>
          ))}
        </div>
      </div>

      <span className="sep" aria-hidden="true" />

      <div className="pop pop-colors" data-open={open === 'color'}>
        <button
          type="button"
          className="tool pop-trigger"
          aria-label="Pick colour"
          aria-haspopup="true"
          aria-expanded={open === 'color'}
          onClick={() => toggle('color')}
        >
          <span
            className="dot ring"
            style={{ background: PALETTE[p.color], width: 20, height: 20 }}
            aria-hidden="true"
          />
        </button>
        <div className="pop-panel swatches" role="group" aria-label="Colour">
          {PALETTE.map((hex, i) => (
            <button
              key={hex}
              type="button"
              className="swatch"
              style={{ background: hex }}
              aria-label={`Colour ${hex}`}
              aria-pressed={p.color === i && p.tool !== 'eraser'}
              onClick={() => {
                p.onColor(i);
                setOpen(null);
              }}
            />
          ))}
        </div>
      </div>

      <span className="sep" aria-hidden="true" />

      <div className="case-group history" role="group" aria-label="History">
        <button
          type="button"
          className="tool"
          aria-label="Undo"
          onClick={p.onUndo}
          disabled={!p.canUndo}
          title="Undo (Ctrl+Z)"
        >
          <Icon d={UNDO_ICON} />
        </button>
        <button
          type="button"
          className="tool danger"
          aria-label="Clear"
          title="Clear the sheet"
          onClick={p.onClear}
          disabled={!p.canUndo}
        >
          <Icon d={CLEAR_ICON} />
        </button>
      </div>
    </div>
  );
}
