'use client';

import dynamic from 'next/dynamic';

const AppSettings = dynamic(() => import('./components/AppSettings'), { ssr: false });

export default function AppSettingsPage() {
  return (
          <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <AppSettings />
      </div>
    
  );
}
