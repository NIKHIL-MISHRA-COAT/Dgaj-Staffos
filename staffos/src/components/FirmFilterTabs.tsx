'use client';

import React from 'react';
import { Building2, Layers } from 'lucide-react';
import { VisibleFirm } from '@/lib/useVisibleFirms';

interface FirmFilterTabsProps {
  firms: VisibleFirm[];
  selectedFirmId: 'all' | string;
  onSelect: (firmId: 'all' | string) => void;
}

/**
 * Drop this in anywhere a list should be filterable by firm (User
 * Management, All Tasks, Attendance Audit, etc.). Renders nothing if the
 * caller only has one visible firm — nothing to filter, so no clutter for
 * regular subsidiary employees/managers.
 */
export default function FirmFilterTabs({ firms, selectedFirmId, onSelect }: FirmFilterTabsProps) {
  if (firms.length <= 1) return null;

  return (
    <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
      <button
        onClick={() => onSelect('all')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-600 whitespace-nowrap border transition-colors ${
          selectedFirmId === 'all'
            ? 'bg-violet-600 text-white border-violet-600'
            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
        }`}
      >
        <Layers size={12} /> All Firms
      </button>
      {firms.map((f) => (
        <button
          key={f.id}
          title={f.name}
          onClick={() => onSelect(f.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-600 whitespace-nowrap border transition-colors ${
            selectedFirmId === f.id
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          <Building2 size={12} /> {f.code || f.name}
        </button>
      ))}
    </div>
  );
}