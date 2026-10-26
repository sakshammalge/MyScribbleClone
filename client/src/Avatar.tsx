import { AVATAR_COLORS, AVATAR_FACES, type Avatar as AvatarData } from '@inkling/shared';

/** Little ink-blob mascot: colour from the palette, face from six expressions. */
export function Avatar({ color, face, size = 48 }: AvatarData & { size?: number }) {
  const c = ((color % AVATAR_COLORS) + AVATAR_COLORS) % AVATAR_COLORS;
  const f = ((face % AVATAR_FACES) + AVATAR_FACES) % AVATAR_FACES;
  const eye = { fill: 'var(--color-ink)' };
  const mouths = [
    <path
      key="m"
      d="M20 33q6 6 12 0"
      stroke="var(--color-ink)"
      strokeWidth="2.5"
      fill="none"
      strokeLinecap="round"
    />,
    <ellipse key="m" cx="26" cy="34" rx="3.5" ry="4.5" fill="var(--color-ink)" />,
    <path
      key="m"
      d="M21 34h10"
      stroke="var(--color-ink)"
      strokeWidth="2.5"
      strokeLinecap="round"
    />,
    <path key="m" d="M19 32q7 9 14 0z" fill="var(--color-ink)" />,
    <path
      key="m"
      d="M20 35q6-6 12 0"
      stroke="var(--color-ink)"
      strokeWidth="2.5"
      fill="none"
      strokeLinecap="round"
    />,
    <path
      key="m"
      d="M20 33q3 4 6 0q3 4 6 0"
      stroke="var(--color-ink)"
      strokeWidth="2.5"
      fill="none"
      strokeLinecap="round"
    />,
  ];
  const eyes =
    f === 4 ? (
      <>
        <path
          d="M16 24q3-4 6 0M30 24q3-4 6 0"
          stroke="var(--color-ink)"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
        />
      </>
    ) : (
      <>
        <circle cx="19" cy="24" r={f === 1 ? 4 : 3} {...eye} />
        <circle cx="33" cy="24" r={f === 1 ? 4 : 3} {...eye} />
      </>
    );
  return (
    <svg
      className="avatar"
      width={size}
      height={size}
      viewBox="0 0 52 52"
      role="img"
      aria-label="avatar"
      style={{ ['--blob' as string]: `var(--avatar-${c})` }}
    >
      <path
        d="M26 3c12 0 23 8 23 22 0 8-3 12-5 16-2 5-8 8-18 8S9 46 7 41C4 36 3 31 3 25 3 11 14 3 26 3z"
        fill="var(--blob)"
        stroke="var(--color-ink)"
        strokeWidth="2.5"
      />
      {eyes}
      {mouths[f]}
    </svg>
  );
}
