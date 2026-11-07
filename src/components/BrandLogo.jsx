import React from 'react';

/**
 * Vektorski znak ErgVibe kazete / zamašnjaka (bez pozadine).
 * Kad je `spinning={true}` (npr. dok trenažer vrti), unutarnji zupčanici lagano rotiraju.
 */
export default function BrandLogo({
  size = 40,
  spinning = false,
  accentColor = 'var(--accent-hex, #a3e635)',
  className = '',
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 select-none ${className}`}
      aria-label="ErgVibe Logo"
    >
      {/* Vanjski 12-segmentni prsten zamašnjaka */}
      <circle
        cx="50"
        cy="50"
        r="44"
        stroke="#636875"
        strokeWidth="4.6"
        strokeDasharray="19.8 3.24"
        transform="rotate(-8 50 50)"
      />

      {/* Tanki tehnički prsten vodilice */}
      <circle
        cx="50"
        cy="50"
        r="37.2"
        stroke="#464a56"
        strokeWidth="2.1"
      />

      {/* Rotirajući središnji sklop kazete s 2 istaknuta Acid Volt zuba */}
      <g className={spinning ? 'origin-center animate-spin-flywheel' : 'origin-center'}>
        {/* Srednji vanjski zupčanik */}
        <circle
          cx="50"
          cy="50"
          r="30.8"
          stroke="#9ea3b0"
          strokeWidth="4.8"
          strokeDasharray="12.9 3.22"
          transform="rotate(-12 50 50)"
        />
        {/* Srednji unutarnji zupčanik */}
        <circle
          cx="50"
          cy="50"
          r="23.5"
          stroke="#d0d4de"
          strokeWidth="4.8"
          strokeDasharray="9.2 3.1"
          transform="rotate(-12 50 50)"
        />

        {/* Prepoznatljivi dvostruki Volt segment u gornjem desnom kvadrantu */}
        <path
          d="M 67.7 24.8 A 30.8 30.8 0 0 1 80.5 45.8"
          stroke={accentColor}
          strokeWidth="5.5"
          strokeDasharray="12.5 3.1"
        />
        <path
          d="M 63.5 30.8 A 23.5 23.5 0 0 1 73.3 46.8"
          stroke={accentColor}
          strokeWidth="5.5"
          strokeDasharray="9.2 2.9"
        />
      </g>

      {/* Unutarnji ležaj glavčine s dva tehnička proreza */}
      <circle
        cx="50"
        cy="50"
        r="15"
        stroke="#f4f5f8"
        strokeWidth="4.8"
        strokeDasharray="41.8 5.3"
        transform="rotate(-42 50 50)"
      />
    </svg>
  );
}
