'use client';

import React from 'react';
import { Building2 } from 'lucide-react';

export default function FirmBadge({ firmName, firmCode }: { firmName?: string | null; firmCode?: string | null }) {
  if (!firmName) return null;
  return (
    <span
      title={firmCode ? `${firmName} (${firmCode})` : firmName}
      className="inline-flex items-center gap-1 text-[10px] font-600 px-1.5 py-0.5 rounded-full bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border border-violet-100 dark:border-violet-800"
    >
      <Building2 size={9} /> {firmName}
    </span>
  );
}