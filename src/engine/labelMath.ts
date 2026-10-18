// A packaged food read off its label by the mother: what the printed carbs are for (per 100 g, per 100 ml, per
// serving, per piece) and how much Layan has, turned into the carbs on her plate. A number that cannot be right for
// that basis is a problem to show, never silently used (the dose page only ever sees the confirmed total).
export type LabelBasis = 'per100g' | 'per100ml' | 'serving' | 'piece';
export type LabelProblem = 'carbs' | 'amount' | 'too_much';

export const isPer100 = (b: LabelBasis) => b === 'per100g' || b === 'per100ml';

export function labelCarbs(basis: LabelBasis, carbs: number | null, amount: number | null): { total: number | null; problem: LabelProblem | null } {
  if (carbs === null || !Number.isFinite(carbs) || carbs < 0 || carbs > (isPer100(basis) ? 100 : 150)) return { total: null, problem: 'carbs' };
  if (amount === null || !Number.isFinite(amount) || amount <= 0 || amount > (isPer100(basis) ? 2000 : 20)) return { total: null, problem: 'amount' };
  const total = Math.round((isPer100(basis) ? (carbs * amount) / 100 : carbs * amount) * 10) / 10;
  return total > 250 ? { total, problem: 'too_much' } : { total, problem: null };
}
