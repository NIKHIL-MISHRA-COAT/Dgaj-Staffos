'use client';

import { usePathname } from 'next/navigation';
import AppLayout from '@/components/AppLayout';

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <AppLayout activePath={pathname}>{children}</AppLayout>;
}
