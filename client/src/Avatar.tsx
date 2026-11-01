import { useId, type ReactNode } from 'react';
import { AVATAR_PARTS, type Avatar as AvatarData, type AvatarPart } from '@inkling/shared';

export const SKIN_TONES = [
  '#ffe0c7',
  '#f6c9a3',
  '#e8b07c',
  '#d29a68',
  '#b97a4a',
  '#8d5524',
  '#6b3e1f',
  '#4a2b15',
  '#b7e3a0',
  '#c9b6f2',
];

export const HAIR_COLORS = [
  '#2b2118',
  '#4a3020',
  '#7a4b2a',
  '#a8431f',
  '#d9622b',
  '#e8c35a',
  '#f1e6c0',
  '#a7a7a7',
  '#ff6fae',
  '#4a7cff',
];

/** Features keep one dark ink in both themes so faces read the same on any backdrop. */
const INK = '#2b2118';

type Look = Record<AvatarPart, number>;

const norm = (v: number | undefined, size: number) =>
  Number.isInteger(v) ? (((v as number) % size) + size) % size : 0;

export function resolveLook(a: AvatarData): Look {
  const out = {} as Look;
  for (const k of Object.keys(AVATAR_PARTS) as AvatarPart[]) out[k] = norm(a[k], AVATAR_PARTS[k]);
  return out;
}

const line = {
  stroke: INK,
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function hairBack(style: number, c: string): ReactNode {
  switch (style) {
    case 3:
      return <path d="M13 36Q11 11 32 11Q53 11 51 36L52 58L12 58Z" fill={c} {...line} />;
    case 4:
      return <path d="M13 36Q11 11 32 11Q53 11 51 36L51 47Q32 53 13 47Z" fill={c} {...line} />;
    case 5:
      return (
        <g fill={c} {...line}>
          <circle cx="32" cy="22" r="17" />
          <circle cx="17" cy="29" r="9" />
          <circle cx="47" cy="29" r="9" />
          <circle cx="22" cy="14" r="9" />
          <circle cx="42" cy="14" r="9" />
        </g>
      );
    case 8:
      return (
        <ellipse cx="52" cy="38" rx="5" ry="11" transform="rotate(-12 52 38)" fill={c} {...line} />
      );
    case 9:
      return (
        <g fill={c} {...line}>
          <circle cx="11" cy="38" r="7" />
          <circle cx="53" cy="38" r="7" />
        </g>
      );
    case 10:
      return <circle cx="32" cy="9" r="7" fill={c} {...line} />;
    default:
      return null;
  }
}

function hairFront(style: number, c: string): ReactNode {
  const cap = (d: string) => <path d={d} fill={c} {...line} />;
  switch (style) {
    case 1:
    case 8:
    case 9:
    case 10:
      return cap('M15 33Q13 13 32 13Q51 13 49 33Q44 22 32 22Q20 22 15 33Z');
    case 2:
      return cap('M16 31Q17 16 32 16Q47 16 48 31Q44 24 32 24Q20 24 16 31Z');
    case 3:
    case 4:
      return cap('M14 34Q12 12 32 12Q52 12 50 34Q47 23 38 21Q30 26 20 25Q16 28 14 34Z');
    case 5:
      return cap('M18 26Q32 16 46 26Q42 21 32 21Q22 21 18 26Z');
    case 6:
      return cap('M26 23Q26 6 32 6Q38 6 38 23Q32 17 26 23Z');
    case 7:
      return cap('M15 31L14 16L22 21L25 10L32 20L37 9L41 20L48 13L49 31Q44 22 32 22Q20 22 15 31Z');
    case 11:
      return cap('M15 33Q11 11 34 11Q51 11 49 33Q47 20 28 22Q18 24 15 33Z');
    default:
      return null;
  }
}

function eyes(style: number): ReactNode {
  const xs = [25.5, 38.5];
  const y = 33;
  switch (style) {
    case 1:
      return xs.map((x) => (
        <g key={x}>
          <ellipse cx={x} cy={y} rx="4.2" ry="5" fill="#fff" {...line} strokeWidth={1.6} />
          <circle cx={x} cy={y + 0.5} r="2.3" fill={INK} />
          <circle cx={x + 0.9} cy={y - 0.8} r="0.8" fill="#fff" />
        </g>
      ));
    case 2:
      return xs.map((x) => (
        <path
          key={x}
          d={`M${x - 3.5} ${y + 1.5}Q${x} ${y - 4} ${x + 3.5} ${y + 1.5}`}
          fill="none"
          {...line}
        />
      ));
    case 3:
      return xs.map((x) => (
        <g key={x}>
          <path d={`M${x - 3.5} ${y}H${x + 3.5}`} {...line} />
          <path d={`M${x - 3} ${y}Q${x} ${y + 3.5} ${x + 3} ${y}Z`} fill={INK} />
        </g>
      ));
    case 4:
      return (
        <>
          <circle cx={xs[0]} cy={y} r="2.4" fill={INK} />
          <path
            d={`M${xs[1]! - 3.5} ${y + 1.5}Q${xs[1]} ${y - 4} ${xs[1]! + 3.5} ${y + 1.5}`}
            fill="none"
            {...line}
          />
        </>
      );
    case 5:
      return xs.map((x, i) => (
        <g key={x}>
          <circle cx={x} cy={y} r="2.4" fill={INK} />
          <path
            d={
              i === 0
                ? `M${x - 3} ${y - 2}L${x - 5} ${y - 4}M${x - 3.5} ${y}L${x - 6} ${y}`
                : `M${x + 3} ${y - 2}L${x + 5} ${y - 4}M${x + 3.5} ${y}L${x + 6} ${y}`
            }
            {...line}
            strokeWidth={1.5}
          />
        </g>
      ));
    default:
      return xs.map((x) => <circle key={x} cx={x} cy={y} r="2.4" fill={INK} />);
  }
}

function brows(style: number, hair: string): ReactNode {
  if (style === 0) return null;
  const s = {
    stroke: hair === '#f1e6c0' || hair === '#e8c35a' ? '#a8812b' : hair,
    strokeWidth: 2.4,
    strokeLinecap: 'round',
    fill: 'none',
  } as const;
  const d =
    style === 1
      ? ['M21 27H30', 'M34 27H43']
      : style === 2
        ? ['M21 28Q25.5 24 30 27', 'M34 27Q38.5 24 43 28']
        : ['M21 25L30 28', 'M43 25L34 28'];
  return (
    <>
      <path d={d[0]} {...s} />
      <path d={d[1]} {...s} />
    </>
  );
}

function mouth(f: number): ReactNode {
  switch (f) {
    case 1:
      return <ellipse cx="32" cy="46" rx="3.2" ry="4" fill={INK} />;
    case 2:
      return <path d="M27 46H37" {...line} />;
    case 3:
      return <path d="M24 44Q32 55 40 44Z" fill="#fff" {...line} strokeWidth={1.8} />;
    case 4:
      return <path d="M27 46Q33 48 38 43" fill="none" {...line} />;
    case 5:
      return (
        <>
          <path d="M26 44Q32 52 38 44Z" fill="#d6455d" {...line} strokeWidth={1.8} />
          <path d="M30 48.5Q32 54 34.5 48.5Z" fill="#ff8fa3" />
        </>
      );
    default:
      return <path d="M26 44Q32 51 38 44" fill="none" {...line} />;
  }
}

function beard(style: number, c: string): ReactNode {
  switch (style) {
    case 1:
      return (
        <path
          d="M24 42Q28 38 32 41Q36 38 40 42Q36 44 32 42.5Q28 44 24 42Z"
          fill={c}
          {...line}
          strokeWidth={1.6}
        />
      );
    case 2:
      return (
        <>
          <path d="M15 38Q15 57 32 57Q49 57 49 38Q46 49 32 49Q18 49 15 38Z" fill={c} {...line} />
          <path
            d="M24 42Q28 38 32 41Q36 38 40 42Q36 44 32 42.5Q28 44 24 42Z"
            fill={c}
            {...line}
            strokeWidth={1.6}
          />
        </>
      );
    case 3:
      return <ellipse cx="32" cy="52" rx="4.5" ry="3.5" fill={c} {...line} strokeWidth={1.6} />;
    default:
      return null;
  }
}

function accessory(kind: number): { under?: ReactNode; over?: ReactNode } {
  switch (kind) {
    case 1:
      return {
        over: (
          <g fill="rgb(255 255 255 / 35%)" {...line} strokeWidth={1.8}>
            <circle cx="25.5" cy="33" r="6.5" />
            <circle cx="38.5" cy="33" r="6.5" />
            <path d="M31 32Q32 31 33 32" />
            <path d="M19 32L15 30M45 32L49 30" />
          </g>
        ),
      };
    case 2:
      return {
        over: (
          <g fill={INK} {...line} strokeWidth={1.8}>
            <rect x="18" y="29" width="13" height="9" rx="3" />
            <rect x="33" y="29" width="13" height="9" rx="3" />
            <path d="M31 32H33" />
          </g>
        ),
      };
    case 3:
      return {
        over: (
          <g {...line}>
            <path d="M14 26Q13 7 32 7Q51 7 50 26Z" fill="#d6455d" />
            <rect x="12" y="23" width="40" height="7" rx="3.5" fill="#a8334a" />
            <circle cx="32" cy="6" r="3" fill="#fff" strokeWidth={1.6} />
          </g>
        ),
      };
    case 4:
      return {
        over: (
          <path
            d="M14.5 26Q32 15 49.5 26"
            fill="none"
            stroke="#3cc7b0"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
        ),
      };
    case 5:
      return {
        over: (
          <g fill="#ffd23f" {...line} strokeWidth={1.4}>
            <circle cx="14.5" cy="44" r="2.6" />
            <circle cx="49.5" cy="44" r="2.6" />
          </g>
        ),
      };
    case 6:
      return {
        over: (
          <g {...line}>
            <path d="M32 -1L44 20H20Z" fill="#c779ff" />
            <circle cx="32" cy="-1" r="3.2" fill="#ffd23f" strokeWidth={1.6} />
            <path d="M25 14L38 14" stroke="#ffd23f" strokeWidth="2" />
          </g>
        ),
      };
    default:
      return {};
  }
}

/** A drawn face. Every part is picked from a small catalogue, so it syncs as plain indexes. */
export function Avatar({ size = 48, ...data }: AvatarData & { size?: number }) {
  const clipId = useId();
  const l = resolveLook(data);
  const skin = SKIN_TONES[l.skin]!;
  const hair = HAIR_COLORS[l.hairColor]!;
  const acc = accessory(l.accessory);
  return (
    <svg
      className="avatar"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="avatar"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="32" cy="32" r="31" />
        </clipPath>
      </defs>
      <circle cx="32" cy="32" r="31" fill={`var(--avatar-${l.color})`} />
      <g clipPath={`url(#${clipId})`}>
        {hairBack(l.hair, hair)}
        <path d="M8 66Q10 52 32 52Q54 52 56 66Z" fill="rgb(30 26 66 / 55%)" {...line} />
        <rect x="26" y="46" width="12" height="9" rx="3" fill={skin} {...line} />
        <ellipse cx="15" cy="37" rx="3" ry="4.5" fill={skin} {...line} />
        <ellipse cx="49" cy="37" rx="3" ry="4.5" fill={skin} {...line} />
        <ellipse cx="32" cy="35" rx="17.5" ry="19.5" fill={skin} {...line} />
        <path
          d="M30 39Q32 42 34 39"
          fill="none"
          stroke={INK}
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.6"
        />
        <circle cx="21" cy="41" r="3" fill="#ff7a8a" opacity="0.28" />
        <circle cx="43" cy="41" r="3" fill="#ff7a8a" opacity="0.28" />
        {brows(l.brows, hair)}
        {eyes(l.eyes)}
        {mouth(l.face)}
        {beard(l.beard, hair)}
        {hairFront(l.hair, hair)}
        {acc.over}
      </g>
      <circle cx="32" cy="32" r="31" fill="none" stroke={INK} strokeWidth="2" />
    </svg>
  );
}
