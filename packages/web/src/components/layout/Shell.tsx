import React, { useState } from 'react';
import { Sidebar } from './Sidebar';

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      <main
        className="flex-1 transition-[margin-left] duration-200"
        style={{ marginLeft: collapsed ? 56 : 220 }}
      >
        {children}
      </main>
    </div>
  );
}
