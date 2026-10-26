import { BRUSH_SIZES, PALETTE } from '@inkling/shared';

export type ToolChoice = 'brush' | 'eraser' | 'fill';

interface ToolbarProps {
  tool: ToolChoice;
  color: number;
  size: number;
  canUndo: boolean;
  onTool: (t: ToolChoice) => void;
  onColor: (c: number) => void;
  onSize: (s: number) => void;
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
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
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

/** The drawer's pencil case: tools, sizes, colours, undo and clear. */
export function Toolbar(p: ToolbarProps) {
  return (
    <div className="case" role="toolbar" aria-label="Drawing tools">
      <div className="case-group" role="group" aria-label="Tool">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="tool"
            aria-label={t.label}
            aria-pressed={p.tool === t.id}
            title={`${t.label} (${t.key})`}
            onClick={() => p.onTool(t.id)}
          >
            <Icon d={t.icon} />
          </button>
        ))}
      </div>

      <div className="case-group" role="group" aria-label="Brush size">
        {BRUSH_SIZES.map((px, i) => (
          <button
            key={px}
            type="button"
            className="size"
            aria-label={`Size ${i + 1}`}
            aria-pressed={p.size === i}
            onClick={() => p.onSize(i)}
          >
            <span style={{ width: Math.max(5, px * 0.6), height: Math.max(5, px * 0.6) }} />
          </button>
        ))}
      </div>

      <div className="swatches" role="group" aria-label="Colour">
        {PALETTE.map((hex, i) => (
          <button
            key={hex}
            type="button"
            className="swatch"
            style={{ background: hex }}
            aria-label={`Colour ${hex}`}
            aria-pressed={p.color === i && p.tool !== 'eraser'}
            onClick={() => p.onColor(i)}
          />
        ))}
      </div>

      <div className="case-group" role="group" aria-label="History">
        <button
          type="button"
          className="tool wide"
          onClick={p.onUndo}
          disabled={!p.canUndo}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          type="button"
          className="tool wide danger"
          onClick={p.onClear}
          disabled={!p.canUndo}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
