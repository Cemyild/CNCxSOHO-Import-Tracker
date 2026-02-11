import React from 'react';

interface DistributionStatusBadgeProps {
  status: string;
}

export function DistributionStatusBadge({ status }: DistributionStatusBadgeProps) {
  let bgColor = '';
  let textColor = 'text-white';
  
  switch(status) {
    case 'pending_distribution':
      bgColor = 'bg-yellow-500';
      break;
    case 'partially_distributed':
      bgColor = 'bg-blue-500';
      break;
    case 'fully_distributed':
      bgColor = 'bg-green-500';
      break;
    default:
      bgColor = 'bg-gray-500';
  }
  
  return (
    <span className={`${bgColor} ${textColor} px-2 py-1 rounded-full text-xs font-medium capitalize`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}