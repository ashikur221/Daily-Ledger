/**
 * Financial Goal Planning Engine
 * Computes deterministic goal feasibility based on actual verified net cash flow and liquid savings.
 */
function calculateGoalFeasibility({
  targetAmount,
  goalName = 'Financial Goal',
  targetMonths = 12,
  allocatedSavings = 0,
  financialContext,
}) {
  const target = parseFloat(targetAmount) || 0;
  const months = Math.max(1, parseInt(targetMonths, 10) || 12);
  const currentSavings = Math.max(0, parseFloat(allocatedSavings) || 0);

  const m = financialContext.metrics;
  const liquidFunds = m.totalLiquid || 0;
  const netCashFlow = m.netCashFlow || 0;

  // Preserve emergency buffer: recommend keeping at least 3 months of basic expenses or ৳15,000
  const monthlyExpenseEst = Math.max(5000, m.totalExpense > 0 ? m.totalExpense / 3 : 10000);
  const emergencyBuffer = Math.min(liquidFunds * 0.4, monthlyExpenseEst * 2);
  const safeDeployableLiquid = Math.max(0, liquidFunds - emergencyBuffer);

  const remainingTarget = Math.max(0, target - currentSavings);
  const requiredMonthlySavings = months > 0 ? remainingTarget / months : remainingTarget;

  // Historical monthly net flow estimate
  const estimatedMonthlyFreeCash = Math.max(0, netCashFlow > 0 ? netCashFlow / 3 : 0);

  let feasibility = 'Achievable';
  let advice = '';

  if (remainingTarget === 0) {
    feasibility = 'Completed';
    advice = 'Your allocated savings already satisfy this goal target!';
  } else if (requiredMonthlySavings <= estimatedMonthlyFreeCash * 0.7) {
    feasibility = 'Very Comfortable';
    advice = 'Based on your positive cash flow, this goal is comfortably achievable without straining daily needs.';
  } else if (requiredMonthlySavings <= estimatedMonthlyFreeCash) {
    feasibility = 'Achievable';
    advice = 'This goal is achievable if you consistently save your current monthly net surplus.';
  } else if (requiredMonthlySavings <= estimatedMonthlyFreeCash * 1.5) {
    feasibility = 'Ambitious';
    advice = 'This goal will require tightening non-essential categories (such as dining or lifestyle) to increase your monthly savings rate.';
  } else {
    feasibility = 'Requires Extended Timeline';
    const suggestedMonths = Math.ceil(remainingTarget / Math.max(1000, estimatedMonthlyFreeCash || 3000));
    advice = `At current savings rates, achieving ৳${target.toLocaleString('en-US')} is challenging within ${months} months. We recommend extending your timeline to ~${suggestedMonths} months.`;
  }

  const completionDate = new Date();
  completionDate.setMonth(completionDate.getMonth() + months);

  return {
    goalName,
    targetAmount: target,
    currentSavings,
    remainingTarget,
    targetMonths: months,
    requiredMonthlySavings: Math.round(requiredMonthlySavings),
    estimatedCompletionDate: completionDate.toLocaleDateString('en-GB', {
      month: 'short',
      year: 'numeric',
    }),
    feasibility,
    advice,
    emergencyBufferPreserved: Math.round(emergencyBuffer),
    safeDeployableLiquid: Math.round(safeDeployableLiquid),
  };
}

module.exports = {
  calculateGoalFeasibility,
};
