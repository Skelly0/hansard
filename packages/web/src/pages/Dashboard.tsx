export function Dashboard() {
  const metrics = [
    { label: 'Active Tickets', value: '—', color: 'text-accent-tickets' },
    { label: 'Open Bills', value: '—', color: 'text-accent-bills' },
    { label: 'Upcoming Votes', value: '—', color: 'text-accent-voting' },
    { label: 'Active Players', value: '—', color: 'text-accent-players' },
    { label: 'Offices Held', value: '—', color: 'text-accent-offices' },
    { label: 'Simulation Tick', value: '—', color: 'text-accent-simulation' },
  ];

  return (
    <div className="p-8">
      <h1 className="text-display mb-2">Dashboard</h1>
      <p className="text-body-sm text-text-tertiary mb-8">The morning briefing.</p>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-10">
        {metrics.map((m) => (
          <div key={m.label} className="card border-l-border-subtle">
            <p className="text-label-ui text-text-tertiary mb-2">{m.label}</p>
            <p className={`text-mono text-2xl font-normal ${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Activity Feed */}
      <div className="max-w-2xl">
        <h2 className="text-heading-1 mb-4">Recent Activity</h2>
        <div className="card border-l-accent-primary">
          <p className="text-body text-text-secondary italic">
            No activity yet. Events from across all systems will appear here.
          </p>
        </div>
      </div>
    </div>
  );
}
