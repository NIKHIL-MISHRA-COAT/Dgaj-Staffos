'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';

export interface VisibleFirm {
  id: string;
  name: string;
  code: string;
}

/**
 * Returns the firms the current user can see, driven by
 * get_visible_firm_ids() (own firm, plus subsidiaries if at a holding firm,
 * plus anything explicitly shared via firm_data_sharing).
 *
 * - `firms`: the list, always including their own firm first.
 * - `showFilter`: true only when there's more than one firm to choose from —
 *   pages should hide the All/FirmA/FirmB tabs entirely when this is false,
 *   since a single-firm user has nothing to filter.
 */
export function useVisibleFirms() {
  const { effectiveUserId } = useAuth();
  const supabase = createClient();
  const [firms, setFirms] = useState<VisibleFirm[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!effectiveUserId) { setLoading(false); return; }
    setLoading(true);

    const { data: visibleIds } = await supabase.rpc('get_visible_firm_ids', {
      p_user_id: effectiveUserId,
      p_module: 'all',
    });

    if (!visibleIds || visibleIds.length === 0) {
      setFirms([]);
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from('firms')
      .select('id, name, code')
      .in('id', visibleIds)
      .order('name');

    setFirms((data as VisibleFirm[]) || []);
    setLoading(false);
  }, [effectiveUserId]);

  useEffect(() => { load(); }, [load]);

  return { firms, loading, showFilter: firms.length > 1, refetch: load };
}