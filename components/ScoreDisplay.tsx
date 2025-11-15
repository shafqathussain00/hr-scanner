import React from 'react';

interface ScoreDisplayProps {
  score: number;
  label: string;
  size?: 'small' | 'large';
}

export const ScoreDisplay: React.FC<ScoreDisplayProps> = ({ score, label, size = 'small' }) => {
  const isLarge = size === 'large';
  const radius = isLarge ? 40 : 28;
  const strokeWidth = isLarge ? 8 : 6;
  const normalizedRadius = radius - strokeWidth / 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  const getScoreColor = (value: number) => {
    if (value >= 85) return 'text-green-600 dark:text-green-400';
    if (value >= 70) return 'text-yellow-500 dark:text-yellow-400';
    if (value >= 50) return 'text-orange-500 dark:text-orange-400';
    return 'text-red-500 dark:text-red-400';
  };

  const getStrokeColor = (value: number) => {
    if (value >= 85) return 'stroke-green-500 dark:stroke-green-400';
    if (value >= 70) return 'stroke-yellow-400';
    if (value >= 50) return 'stroke-orange-400';
    return 'stroke-red-400';
  };

  const scoreColor = getScoreColor(score);
  const strokeColor = getStrokeColor(score);
  const dimension = radius * 2;
  const textSize = isLarge ? 'text-2xl' : 'text-lg';
  const labelTextSize = isLarge ? 'text-sm' : 'text-xs';

  return (
    <div className="flex flex-col items-center justify-center space-y-1">
      <div className="relative inline-flex items-center justify-center">
        <svg height={dimension} width={dimension} className="transform -rotate-90">
          <circle
            className="stroke-gray-200 dark:stroke-gray-700"
            strokeWidth={strokeWidth}
            stroke="currentColor"
            fill="transparent"
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
          <circle
            className={`${strokeColor} transition-all duration-1000 ease-in-out`}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference + ' ' + circumference}
            style={{ strokeDashoffset }}
            strokeLinecap="round"
            stroke="currentColor"
            fill="transparent"
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
        </svg>
        <span className={`absolute ${textSize} font-bold ${scoreColor}`}>
          {Math.round(score)}%
        </span>
      </div>
      <p className={`${labelTextSize} font-medium text-brand-subtext text-center dark:text-gray-400`}>{label}</p>
    </div>
  );
};