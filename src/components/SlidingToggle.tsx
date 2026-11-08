import React from 'react';

interface SlidingToggleProps {
  checked: boolean;
  onChange: (nextChecked: boolean) => void;
  label?: string;
  sublabel?: string;
  ariaLabel?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  testId?: string;
}

/**
 * Sleek, high-visibility sliding pill toggle switch:
 * Glowing #10b981 emerald green with the knob slid right when ON,
 * dark zinc #27272a with the knob slid left when OFF.
 */
export const SlidingToggle: React.FC<SlidingToggleProps> = ({
  checked,
  onChange,
  label,
  sublabel,
  ariaLabel,
  disabled = false,
  size = 'md',
  className = '',
  testId,
}) => {
  const isSm = size === 'sm';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel || label || 'Toggle switch'}
      data-testid={testId}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`group inline-flex items-center gap-3 text-left select-none transition-opacity min-h-[40px] ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
    >
      <span
        className={`relative inline-flex shrink-0 items-center rounded-full border transition-colors duration-200 ${
          isSm ? 'h-6 w-11' : 'h-7 w-12'
        } ${
          checked
            ? 'bg-[#10b981] border-emerald-400/80 shadow-[0_0_12px_rgba(16,185,129,0.45)]'
            : 'bg-[#27272a] border-zinc-700'
        }`}
      >
        <span
          className={`inline-block rounded-full bg-white shadow-md transform transition-transform duration-200 ${
            isSm ? 'h-4 w-4' : 'h-5 w-5'
          } ${
            checked
              ? isSm
                ? 'translate-x-5'
                : 'translate-x-5.5'
              : 'translate-x-1'
          }`}
        />
      </span>
      {(label || sublabel) && (
        <span className="flex flex-col min-w-0">
          {label && (
            <span className="text-xs font-semibold text-zinc-100 group-hover:text-white whitespace-nowrap">
              {label}
            </span>
          )}
          {sublabel && (
            <span className="text-[11px] text-zinc-400 whitespace-nowrap">
              {sublabel}
            </span>
          )}
        </span>
      )}
    </button>
  );
};
