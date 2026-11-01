import { useState } from 'react';
import { AVATAR_PARTS, type Avatar as AvatarData, type AvatarPart } from '@inkling/shared';
import { Avatar, HAIR_COLORS, SKIN_TONES, resolveLook } from './Avatar';

interface Tab {
  id: string;
  label: string;
  part: AvatarPart;
  /** Colour parts show swatches; shape parts show a tiny face with that option applied. */
  swatches?: (i: number) => string;
}

const TABS: Tab[] = [
  { id: 'hair', label: 'Hair', part: 'hair' },
  { id: 'hairColor', label: 'Hair colour', part: 'hairColor', swatches: (i) => HAIR_COLORS[i]! },
  { id: 'skin', label: 'Skin', part: 'skin', swatches: (i) => SKIN_TONES[i]! },
  { id: 'eyes', label: 'Eyes', part: 'eyes' },
  { id: 'brows', label: 'Brows', part: 'brows' },
  { id: 'face', label: 'Mouth', part: 'face' },
  { id: 'beard', label: 'Facial hair', part: 'beard' },
  { id: 'accessory', label: 'Extras', part: 'accessory' },
  { id: 'color', label: 'Backdrop', part: 'color', swatches: (i) => `var(--avatar-${i})` },
];

/** Preset looks, a quick way to start from a presentation and tweak from there. */
const PRESETS: { label: string; look: Partial<AvatarData> }[] = [
  { label: 'Short hair', look: { hair: 1, beard: 0, accessory: 0, brows: 1 } },
  { label: 'Long hair', look: { hair: 3, beard: 0, accessory: 0, brows: 2 } },
  { label: 'Bearded', look: { hair: 11, beard: 2, accessory: 0, brows: 3 } },
];

const roll = (n: number) => Math.floor(Math.random() * n);

export function randomAvatar(): AvatarData {
  const out = {} as Record<AvatarPart, number>;
  for (const k of Object.keys(AVATAR_PARTS) as AvatarPart[]) out[k] = roll(AVATAR_PARTS[k]);
  // Keep it friendly: most faces go without facial hair and with no accessory.
  if (Math.random() < 0.7) out.beard = 0;
  if (Math.random() < 0.5) out.accessory = 0;
  return out;
}

interface Props {
  avatar: AvatarData;
  onChange: (a: AvatarData) => void;
}

export function AvatarEditor({ avatar, onChange }: Props) {
  const [tabId, setTabId] = useState('hair');
  const tab = TABS.find((t) => t.id === tabId)!;
  const look = resolveLook(avatar);
  const set = (part: AvatarPart, value: number) => onChange({ ...look, [part]: value });

  return (
    <div className="editor">
      <div className="editor-stage">
        <Avatar {...look} size={112} />
        <div className="editor-quick">
          <button
            type="button"
            className="editor-chip"
            aria-label="Randomise face"
            onClick={() => onChange(randomAvatar())}
          >
            🎲 Randomise
          </button>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="editor-chip"
              onClick={() => onChange({ ...look, ...p.look })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="editor-tabs" role="tablist" aria-label="Face part">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tabId}
            className="editor-tab"
            onClick={() => setTabId(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="editor-options" role="radiogroup" aria-label={tab.label}>
        {Array.from({ length: AVATAR_PARTS[tab.part] }, (_, i) => {
          const on = look[tab.part] === i;
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${tab.label} ${i + 1}`}
              className={tab.swatches ? 'swatch' : 'editor-opt'}
              style={tab.swatches ? { background: tab.swatches(i) } : undefined}
              onClick={() => set(tab.part, i)}
            >
              {!tab.swatches && <Avatar {...look} {...{ [tab.part]: i }} size={44} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
