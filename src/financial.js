const MONEY_SCALE = 1000;
const MONEY_DECIMALS = 3;

function decimalToMinor(value) {
  if (value === null || value === undefined || value === "") return 0;
  const raw = String(value).trim().replace(/,/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return 0;
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ""] = unsigned.split(".");
  const padded = (fraction + "000").slice(0, MONEY_DECIMALS);
  const roundedExtra =
    fraction.length > MONEY_DECIMALS && Number(fraction[MONEY_DECIMALS]) >= 5 ? 1 : 0;
  const minor =
    Number(whole || 0) * MONEY_SCALE +
    Number(padded || 0) +
    roundedExtra;
  return negative ? -minor : minor;
}

export function toMoneyMinor(value) {
  return decimalToMinor(value);
}

export function fromMoneyMinor(minor) {
  return Number(minor || 0) / MONEY_SCALE;
}

export function formatMoneyMinor(minor) {
  const value = Number.isFinite(Number(minor)) ? Math.trunc(Number(minor)) : 0;
  const negative = value < 0;
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute / MONEY_SCALE);
  const fraction = absolute % MONEY_SCALE;
  const fractionText = String(fraction)
    .padStart(MONEY_DECIMALS, "0")
    .replace(/0+$/, "");
  const numberText = `${whole.toLocaleString("en-BD")}${fractionText ? `.${fractionText}` : ""}`;
  return `${negative ? "-৳" : "৳"}${numberText}`;
}

export function formatMoney(value) {
  return formatMoneyMinor(decimalToMinor(value));
}

function uniqueParticipantIds(match) {
  // The persisted participant records are the only authoritative source of
  // financial participation. `selectedPlayers` is a legacy compatibility field
  // and must never re-charge players who are not in `participants`.
  const participants = Array.isArray(match?.participants)
    ? match.participants
    : [];
  const ids = [];
  const seen = new Set();

  for (const participant of participants) {
    const id = String(participant?.playerId ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

function totalMatchCostMinor(match) {
  const total = decimalToMinor(match?.totalAmount);
  return total >= 0 ? total : 0;
}

/**
 * Financial participation is defined ONLY by match.participants.
 * The participant array is the persisted selected-player list for a match.
 */
export function isPlayerSelected(match, playerId) {
  const id = String(playerId ?? "").trim();
  if (!id) return false;
  return uniqueParticipantIds(match).includes(id);
}

/**
 * Calculate one player's share of this match in minor units.
 *
 * We use integer minor units (1/1000 of a taka). When the total cannot be
 * divided evenly, the remainder minor units are assigned deterministically
 * to the first selected players in the persisted participant order. This
 * guarantees that all player shares sum EXACTLY to totalMatchCost.
 */
function participantFeeOverrideMinor(participant, totalMinor) {
  if (!participant || participant.feeOverride === null || participant.feeOverride === undefined || participant.feeOverride === "") {
    return null;
  }

  const override = decimalToMinor(participant.feeOverride);
  if (!Number.isSafeInteger(override) || override < 0 || override > totalMinor) return null;
  return override;
}

/**
 * Calculate every participating player's fee in minor units.
 *
 * Custom `feeOverride` values are match-participant scoped. They are treated
 * as fixed shares first; every participant without an override shares the
 * exact remaining amount. The remainder is distributed in persisted
 * participant order so the final sum always equals the match total exactly.
 *
 * Invalid/inconsistent historical override data is ignored and the engine
 * safely falls back to the automatic equal allocation for that match.
 */
export function calculatePlayerMatchFees(match) {
  if (!match || match.deleted) return new Map();

  const ids = uniqueParticipantIds(match);
  if (!ids.length) return new Map();

  const totalMinor = totalMatchCostMinor(match);
  if (totalMinor <= 0) return new Map(ids.map((id) => [id, 0]));

  const participants = Array.isArray(match.participants) ? match.participants : [];
  const byId = new Map(
    participants.map((participant) => [String(participant?.playerId ?? "").trim(), participant]),
  );
  const overrides = new Map();
  let fixedTotal = 0;

  for (const id of ids) {
    const override = participantFeeOverrideMinor(byId.get(id), totalMinor);
    if (override === null) continue;
    overrides.set(id, override);
    fixedTotal += override;
  }

  // A saved document should never reach this state because the admin editor
  // validates it before writing. Falling back keeps reads safe for old/manual
  // documents without ever producing a sum larger than the match total.
  if (fixedTotal > totalMinor || (overrides.size === ids.length && fixedTotal !== totalMinor)) {
    overrides.clear();
    fixedTotal = 0;
  }

  const automaticIds = ids.filter((id) => !overrides.has(id));
  const result = new Map(overrides);

  if (!automaticIds.length) return result;

  const remainingMinor = totalMinor - fixedTotal;
  const baseShare = Math.floor(remainingMinor / automaticIds.length);
  const remainder = remainingMinor % automaticIds.length;

  automaticIds.forEach((id, index) => {
    result.set(id, baseShare + (index < remainder ? 1 : 0));
  });

  return result;
}

export function calculatePlayerMatchFee(match, playerId) {
  if (!match || match.deleted) return 0;
  return calculatePlayerMatchFees(match).get(String(playerId ?? "").trim()) || 0;
}

/**
 * Payments currently live on the selected player's match participant record.
 * A missing/non-numeric/negative payment is treated as zero.
 */
export function calculatePlayerMatchPayment(match, playerId) {
  if (!match || match.deleted) return 0;

  const participant = (match.participants || []).find(
    (item) => String(item?.playerId ?? "").trim() === String(playerId ?? "").trim(),
  );
  if (!participant) return 0;

  const paid = decimalToMinor(participant.paid);
  return paid > 0 ? paid : 0;
}

export function isValidFinancialMatch(match) {
  const rawParticipants = Array.isArray(match?.participants) ? match.participants : [];
  const ids = uniqueParticipantIds(match);
  return Boolean(
    match &&
      !match.deleted &&
      rawParticipants.length > 0 &&
      ids.length > 0 &&
      ids.length === rawParticipants.length &&
      totalMatchCostMinor(match) >= 0,
  );
}

export function isValidCompletedMatch(match, completedPredicate) {
  return (
    isValidFinancialMatch(match) &&
    (typeof completedPredicate !== "function" || completedPredicate(match))
  );
}

export function calculatePlayerMatchFinancials(player, match, payments = [], previousBalance = 0) {
  const playerId = String(player?.id ?? player ?? "").trim();
  const previousBalanceMinor = Number.isFinite(Number(previousBalance))
    ? Math.trunc(Number(previousBalance))
    : decimalToMinor(previousBalance);
  const selected = isPlayerSelected(match, playerId);

  if (!match || match.deleted || !selected) {
    return {
      selected: false,
      matchFee: 0,
      cashPaid: 0,
      previousCreditUsed: 0,
      totalApplied: 0,
      remainingDue: Math.max(0, -previousBalanceMinor),
      remainingCredit: Math.max(0, previousBalanceMinor),
      balance: previousBalanceMinor,
      status: "NOT PARTICIPATED",
    };
  }

  const matchFee = calculatePlayerMatchFee(match, playerId);
  const cashPaidFromMatch = calculatePlayerMatchPayment(match, playerId);
  const externalPayment = Array.isArray(payments)
    ? payments.reduce((sum, payment) => {
        const paymentPlayerId = String(payment?.playerId ?? payment?.player?.id ?? "").trim();
        const paymentMatchId = payment?.matchId == null ? null : String(payment.matchId);
        if (paymentPlayerId !== playerId) return sum;
        if (paymentMatchId !== null && paymentMatchId !== String(match.id)) return sum;
        const value = decimalToMinor(payment?.amount ?? payment?.paid ?? 0);
        return sum + Math.max(0, value);
      }, 0)
    : 0;

  const cashPaid = cashPaidFromMatch + externalPayment;
  const previousCreditUsed = Math.min(Math.max(0, previousBalanceMinor), matchFee);
  const cashUsed = Math.min(cashPaid, Math.max(0, matchFee - previousCreditUsed));
  const totalApplied = previousCreditUsed + cashUsed;
  const remainingDue = Math.max(0, matchFee - totalApplied);
  const balance = previousBalanceMinor - matchFee + cashPaid;
  const remainingCredit = Math.max(0, balance);

  return {
    selected: true,
    matchFee,
    cashPaid,
    previousCreditUsed,
    totalApplied,
    remainingDue,
    remainingCredit,
    balance,
    status: totalApplied >= matchFee ? "PAID" : "UNPAID",
  };
}

export function calculatePlayerMatchBalance(match, playerId) {
  if (!isValidFinancialMatch(match) || !isPlayerSelected(match, playerId)) return 0;
  return calculatePlayerMatchPayment(match, playerId) - calculatePlayerMatchFee(match, playerId);
}

/**
 * Calculate a player's final running balance in minor units.
 *
 * Display convention:
 *   negative = due
 *   zero     = fully settled
 *   positive = credit/advance
 *
 * For every completed match:
 *   newBalance = previousBalance - fee + payment
 *
 * An unselected player contributes exactly zero to the current match, so
 * their previous balance is preserved unchanged.
 */
export function calculatePlayerBalance(playerId, matches, payments = []) {
  const orderedMatches = Array.isArray(matches)
    ? [...matches].sort(
        (a, b) =>
          String(a?.date || "").localeCompare(String(b?.date || "")) ||
          String(a?.startTime || a?.time || "").localeCompare(
            String(b?.startTime || b?.time || ""),
          ) ||
          String(a?.id || "").localeCompare(String(b?.id || "")),
      )
    : [];

  let balanceMinor = 0;

  for (const match of orderedMatches) {
    if (!isValidFinancialMatch(match)) continue;
    if (!isPlayerSelected(match, playerId)) continue;

    balanceMinor += calculatePlayerMatchBalance(match, playerId);
  }

  // `payments` is reserved for a future standalone payment collection.
  // Do not apply it here while payments are already stored on match
  // participants, otherwise payments would be double-counted.
  void payments;

  return balanceMinor;
}

/**
 * Full player ledger used by profile/list/report views so every screen has
 * the same source of truth.
 */
export function getPlayerFinancials(matches, playerId, completedPredicate) {
  const rows = [];
  let totalFeesMinor = 0;
  let totalPaidMinor = 0;
  let goals = 0;
  let runningBalanceMinor = 0;

  const orderedMatches = Array.isArray(matches)
    ? [...matches].sort(
        (a, b) =>
          String(a?.date || "").localeCompare(String(b?.date || "")) ||
          String(a?.startTime || a?.time || "").localeCompare(
            String(b?.startTime || b?.time || ""),
          ) ||
          String(a?.id || "").localeCompare(String(b?.id || "")),
      )
    : [];

  for (const match of orderedMatches) {
    if (!isValidCompletedMatch(match, completedPredicate)) continue;
    if (!isPlayerSelected(match, playerId)) continue;

    const feeMinor = calculatePlayerMatchFee(match, playerId);
    const paidMinor = calculatePlayerMatchPayment(match, playerId);
    const balanceImpactMinor = calculatePlayerMatchBalance(match, playerId);
    runningBalanceMinor += balanceImpactMinor;

    const matchGoals = Math.max(
      0,
      Number(match?.result?.scorers?.[playerId] || 0) || 0,
    );

    totalFeesMinor += feeMinor;
    totalPaidMinor += paidMinor;
    goals += matchGoals;

    rows.push({
      match,
      feeMinor,
      paidMinor,
      matchBalanceMinor: balanceImpactMinor,
      balanceAfterMinor: runningBalanceMinor,
      goals: matchGoals,
    });
  }

  return {
    matches: rows.length,
    goals,
    totalFeesMinor,
    totalPaidMinor,
    balanceMinor: totalFeesMinor * -1 + totalPaidMinor,
    rows,
  };
}

// Backward-compatible helpers for existing imports.
// These now require player-specific allocation to avoid accidentally treating
// total match cost as every player's fee.
export function participantPaymentMinor(participant) {
  if (!participant) return 0;
  const paid = decimalToMinor(participant.paid);
  return paid > 0 ? paid : 0;
}

export function matchBalanceMinor(match, playerId) {
  return calculatePlayerMatchBalance(match, playerId);
}

export const MONEY_SCALE_MINOR = MONEY_SCALE;
