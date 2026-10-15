'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import ClientOrganisations from '../task-management/components/ClientOrganisations';

export default function ClientsPage() {
  const { effectiveUserId } = useAuth();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    if (!effectiveUserId) return;
    createClient()
      .from('user_profiles')
      .select('role')
      .eq('id', effectiveUserId)
      .maybeSingle()
      .then(({ data }) => setRole((data?.role as string) || 'employee'));
  }, [effectiveUserId]);

  if (role === null) {
    return <div className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading…</div>;
  }

  return (
    <div className="p-4 sm:p-6">
      <ClientOrganisations
        variant="page"
        canManage={role === 'director' || role === 'manager'}
      />
    </div>
  );
}