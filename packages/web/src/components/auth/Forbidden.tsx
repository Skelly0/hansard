export function Forbidden() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-sm">
        <div className="text-2xl text-accent-moderation mb-3">✦</div>
        <h1 className="text-display mb-2">Out of bounds</h1>
        <p className="text-body text-text-secondary">
          You don't have access to this part of the chamber.
        </p>
        <p className="text-mono text-text-tertiary text-xs mt-6">
          If this seems wrong, ask staff to check your permissions.
        </p>
      </div>
    </div>
  );
}
