import React from 'react';

interface BrokeifyLogoProps {
  size?: number;
  className?: string;
}

/**
 * Custom <BrokeifyLogo /> SVG Component:
 * Renders the sleek Brokeify green circular disc mark with glowing emerald outer ring,
 * dashed vinyl groove, inner ring, and bright emerald center core.
 */
export const BrokeifyLogo: React.FC<BrokeifyLogoProps> = ({
  size = 34,
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
      aria-label="Brokeify green circle disc logo"
    >
      <defs>
        <radialGradient id="brokeifyDiscGlow" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#00ff66" stopOpacity="0.22" />
          <stop offset="70%" stopColor="#09090b" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#09090b" stopOpacity="1" />
        </radialGradient>
      </defs>

      {/* Outer Dark Vinyl Circle with Glowing Green Ring */}
      <circle
        cx="60"
        cy="60"
        r="54"
        fill="url(#brokeifyDiscGlow)"
        stroke="#00ff66"
        strokeWidth="3.5"
        strokeOpacity="0.85"
      />

      {/* Dashed Track Groove Ring */}
      <circle
        cx="60"
        cy="60"
        r="39"
        fill="none"
        stroke="#27272a"
        strokeWidth="2"
        strokeDasharray="6 5"
      />

      {/* Inner Accent Ring */}
      <circle
        cx="60"
        cy="60"
        r="23"
        fill="none"
        stroke="#10b981"
        strokeWidth="2"
        strokeOpacity="0.55"
      />

      {/* Bright Green Center Core */}
      <circle cx="60" cy="60" r="8.5" fill="#00ff66" />
    </svg>
  );
};
