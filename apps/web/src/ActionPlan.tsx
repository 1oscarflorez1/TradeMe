import type { PlanStep } from './types';

export function ActionPlan({ plan }: { plan: PlanStep[] }) {
  if (!plan || plan.length === 0) {
    return <p className="muted">Sin plan todavía.</p>;
  }
  return (
    <ol className="plan">
      {plan.map((s) => (
        <li key={s.step} className="plan-step">
          <span className="plan-title">{s.title}</span>
          {s.detail && <span className="plan-detail">{s.detail}</span>}
        </li>
      ))}
    </ol>
  );
}
