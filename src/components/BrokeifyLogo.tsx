import React from 'react';

interface BrokeifyLogoProps {
  size?: number;
  className?: string;
}

/**
 * Custom <BrokeifyLogo /> SVG Component:
 * Renders a dark circular badge with neon emerald (#10b981) and purple (#a855f7) soundwaves
 * where the top wave is crooked and taped to the rim with a strip of silver duct tape,
 * plus a slashed $ symbol inside.
 */
export const BrokeifyLogo: React.FC<BrokeifyLogoProps> = ({
  size = 40,
  className = '',
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 select-none ${className}`}
      role="img"
      aria-label="Brokeify logo: dark badge with emerald and purple soundwaves, crooked top wave held by silver duct tape, and slashed dollar sign"
    >
      <defs>
        <linearGradient
          id="brokeifyBadgeGrad"
          x1="0"
          y1="0"
          x2="120"
          y2="120"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#09090b" />
          <stop offset="100%" stopColor="#18181b" />
        </linearGradient>
        <linearGradient
          id="silverDuctTape"
          x1="0"
          y1="0"
          x2="40"
          y2="16"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#e4e4e7" />
          <stop offset="50%" stopColor="#a1a1aa" />
          <stop offset="100%" stopColor="#d4d4d8" />
        </linearGradient>
      </defs>

      {/* Outer Dark Circular Badge */}
      <circle
        cx="60"
        cy="60"
        r="56"
        fill="url(#brokeifyBadgeGrad)"
        stroke="#27272a"
        strokeWidth="4"
      />
      <circle
        cx="60"
        cy="60"
        r="50"
        stroke="#10b981"
        strokeWidth="1.5"
        strokeOpacity="0.4"
        strokeDasharray="6 4"
      />

      {/* Bottom Soundwave (Purple #a855f7) */}
      <path
        d="M 32 78 Q 60 65 88 78"
        stroke="#a855f7"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />

      {/* Middle Soundwave (Neon Emerald #10b981) */}
      <path
        d="M 25 60 Q 60 45 95 60"
        stroke="#10b981"
        strokeWidth="6.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* Top Soundwave (Crooked on the right & taped to the rim) */}
      <path
        d="M 23 41 Q 54 22 97 50"
        stroke="#10b981"
        strokeWidth="6.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* Slashed $ Symbol Inside */}
      <g transform="translate(60, 68)">
        <text
          x="0"
          y="14"
          textAnchor="middle"
          fill="#f4f4f5"
          fontFamily="monospace"
          fontWeight="800"
          fontSize="34"
        >
          $
        </text>
        <line
          x1="-16"
          y1="18"
          x2="16"
          y2="-15"
          stroke="#f43f5e"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </g>

      {/* Strip of Silver Duct Tape Taping the Crooked Wave to the Rim */}
      <g transform="translate(75, 19) rotate(29)">
        <rect
          x="0"
          y="0"
          width="33"
          height="13.5"
          rx="1.5"
          fill="url(#silverDuctTape)"
          stroke="#52525b"
          strokeWidth="1"
        />
        <line
          x1="6"
          y1="0"
          x2="6"
          y2="13.5"
          stroke="#71717a"
          strokeWidth="0.75"
          strokeOpacity="0.55"
        />
        <line
          x1="16"
          y1="0"
          x2="16"
          y2="13.5"
          stroke="#71717a"
          strokeWidth="0.75"
          strokeOpacity="0.55"
        />
        <line
          x1="26"
          y1="0"
          x2="26"
          y2="13.5"
          stroke="#71717a"
          strokeWidth="0.75"
          strokeOpacity="0.55"
        />
      </g>
    </svg>
  );
};
