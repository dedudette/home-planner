import type { AccountView } from '../domain/billing/account';
import { formatEuro, planPriceLine, planTitle } from '../domain/billing/plans';
import { formatDate } from './planView';

/**
 * What the subscription section of the account screen says and offers, as plain functions of the SERVER's answer (`GET /api/account`).
 * Nothing here reads localStorage, the address bar or the device clock to decide anything: the plan, status, dates, access and allowance
 * all come from the server, which gets them from its database and the payment provider's confirmed state. A function returns words and a
 * list of actions the screen may show; whether an action actually works is decided by the server again when it is pressed.
 */
export type SubAction = 'portal' | 'cancel' | 'resume' | 'finish-payment' | 'check-status';
export type Tone = 'good' | 'info' | 'warn' | 'error';

export interface SubPanel {
  /** False when there is no subscription record to talk about (no plan was ever bought, or only an abandoned checkout). */
  show: boolean;
  tone: Tone;
  headline: string;
  /** The plan and its price in the words used everywhere ("Monthly · €25/month"), or null. */
  planLine: string | null;
  lines: string[];
  actions: SubAction[];
  /** Why the actions are missing, when the only reason is that the provider is not available on this server. */
  actionsUnavailable: string | null;
}

const STATUS: Record<string, string> = {
  active: 'active', past_due: 'payment overdue', unpaid: 'unpaid', incomplete: 'waiting for the payment to be completed', canceled: 'ended', paused: 'paused', incomplete_expired: 'not completed',
};
export const statusLabel = (status: string): string => STATUS[status] ?? status.replace(/_/g, ' ');

const PAID_FEATURES = 'AI suggestions and cloud backup are paused';
const KEPT = 'Your plan on this device, your data export, billing and account deletion all keep working.';

export interface PanelOpts { locale?: string; timeZone?: string }

export const subscriptionPanel = (a: AccountView, opts: PanelOpts = {}): SubPanel => {
  const e = a.entitlement;
  const s = a.subscription;
  const d = (iso: string): string => formatDate(iso, opts);
  const none: SubPanel = { show: false, tone: 'info', headline: '', planLine: null, lines: [], actions: [], actionsUnavailable: null };
  if (!s) return none;

  const planLine = `${planTitle(s.plan)} · ${planPriceLine(s.plan)}`;
  const amount = formatEuro(s.amountCents);
  const per = s.plan === 'annual' ? 'once a year' : 'every month';
  const stripeManaged = s.provider === 'stripe';
  // Managing needs the payment provider on this server. Without it the subscription is shown as it is and nothing offers a change.
  const manage = stripeManaged && a.billing.available;
  const canPortal = manage && a.billing.canManage;
  const base = { show: true, planLine, actionsUnavailable: null as string | null };
  const withManage = (actions: SubAction[], extra: Partial<SubPanel> = {}): SubPanel => ({
    ...base, tone: 'info', headline: '', lines: [], ...extra,
    actions: manage ? actions.filter((x) => x !== 'portal' || canPortal) : [],
    actionsUnavailable: manage ? null : stripeManaged ? 'billing-unavailable' : 'other-provider',
  });

  switch (e.state) {
    case 'paid-active':
      return withManage(['portal', 'cancel'], {
        tone: 'good', headline: `${planTitle(s.plan)} plan is active`,
        lines: [`It renews automatically on ${d(s.currentPeriodEnd)} and you will be charged ${amount} ${per}.`, 'Cancelling keeps your access until the end of the period you paid for, and nothing more is charged.'],
      });
    case 'cancellation-scheduled':
      return withManage(['resume', 'portal'], {
        tone: 'info', headline: `Your plan ends on ${d(s.currentPeriodEnd)}`,
        lines: ['You keep full access until then and you will not be charged again.', `Changed your mind? You can resume it any time before ${d(s.currentPeriodEnd)}.`],
      });
    case 'payment-action-required':
      return withManage(['finish-payment', 'check-status'], {
        tone: 'warn', headline: 'Your payment needs one more step',
        lines: ['Your bank asked you to confirm the first payment. Until it is confirmed your subscription is not active and paid features stay paused.', 'Finish it on the secure payment page, then check the status here. Nothing is assumed: this page changes only when the payment provider confirms it.'],
      });
    case 'past-due': {
      if (e.reason === 'renewal-not-confirmed') {
        return withManage(['check-status', 'portal'], {
          tone: 'warn', headline: 'We could not confirm your latest renewal',
          lines: [`Your last paid period ended on ${d(s.currentPeriodEnd)} and the payment provider has not confirmed a new one yet. ${PAID_FEATURES} until it does.`, KEPT],
        });
      }
      return withManage(['portal', 'check-status'], {
        tone: 'warn', headline: 'Your last payment did not go through',
        lines: e.access === 'full' && e.accessEndsAt
          ? [`The payment provider will try again. Your access continues until ${d(e.accessEndsAt)}. Update your payment method to keep it.`]
          : [`The payment provider is still trying, but the grace period has ended, so ${PAID_FEATURES}. Update your payment method and access returns as soon as the payment goes through.`, KEPT],
      });
    }
    case 'unpaid':
      return withManage(['portal', 'check-status'], {
        tone: 'error', headline: 'Payments stopped, so your subscription is paused',
        lines: [`The payment provider gave up after several tries, so ${PAID_FEATURES}. Open the billing page to pay the open invoice or update your payment method.`, KEPT],
      });
    case 'suspended':
      return withManage(['portal'], {
        tone: 'warn', headline: 'Access is paused while a payment dispute is open',
        lines: [`A payment dispute is open with your bank, so ${PAID_FEATURES} until it is decided. This app cannot resolve a dispute.`, KEPT],
      });
    case 'expired': {
      const ended = d(s.currentPeriodEnd);
      const why = e.reason === 'refunded' ? 'Your subscription was refunded, so it ended and access was withdrawn.'
        : e.reason === 'paused' ? 'Your subscription is paused at the payment provider.'
        : s.status === 'canceled' || e.reason === 'cancelled' ? `Your subscription ended (the paid period ran to ${ended}).`
        : `Your subscription ended on ${ended}.`;
      return withManage(['portal'], {
        tone: 'info', headline: e.reason === 'paused' ? 'Your subscription is paused' : 'Your subscription has ended',
        lines: [why, `${PAID_FEATURES}. ${KEPT}`, ...(e.canSubscribe ? ['You can choose a plan again below. Nothing is charged until you pay on the secure payment page.'] : [])],
      });
    }
    default:
      // trial-active, trial-expired and eligible-not-started have no subscription to describe: the trial and plans sections cover them.
      return none;
  }
};

export interface AllowanceView {
  kind: 'none' | 'trial' | 'paid';
  limit: number;
  used: number;
  remaining: number;
  /** 0..1 share used, for the bar. */
  share: number;
  headline: string;
  detail: string;
  /** For assistive technology on the bar. */
  valueText: string;
}

/** The AI allowance exactly as the server reports it. The limit is the configured number, never a constant in this file. */
export const allowanceView = (a: AccountView, opts: PanelOpts = {}): AllowanceView => {
  const al = a.allowance;
  const e = a.entitlement;
  if (!al) {
    const why = e.state === 'trial-expired' ? 'Your trial has ended.'
      : e.state === 'eligible-not-started' ? 'You have not started a trial or a subscription.'
      : e.state === 'payment-action-required' ? 'Your first payment is not confirmed yet.'
      : e.state === 'past-due' || e.state === 'unpaid' ? 'Your last payment did not go through.'
      : e.state === 'suspended' ? 'A payment dispute is open.'
      : e.state === 'expired' ? 'Your subscription has ended.'
      : 'There is no active trial or subscription.';
    return { kind: 'none', limit: 0, used: 0, remaining: 0, share: 0, headline: 'AI features are paused', detail: `${why} AI suggestions need an active trial or subscription. Nothing is charged for them, and the rest of the app keeps working.`, valueText: 'AI features are paused' };
  }
  const reset = formatDate(al.resetsAt, opts);
  const share = al.limit > 0 ? Math.min(1, Math.max(0, al.used / al.limit)) : 1;
  const left = `${al.remaining} of ${al.limit} AI requests left`;
  const used = `${al.used} used`;
  if (al.kind === 'trial') {
    return {
      kind: 'trial', limit: al.limit, used: al.used, remaining: al.remaining, share, headline: `${left} in your trial`,
      detail: `${used}. The trial allowance is for the whole trial and it ends on ${reset}. Subscribers get a separate monthly allowance. Unused requests do not carry over.`,
      valueText: `${al.used} of ${al.limit} used, ${al.remaining} left`,
    };
  }
  return {
    kind: 'paid', limit: al.limit, used: al.used, remaining: al.remaining, share, headline: `${left} this month`,
    detail: `${used}. The allowance resets on ${reset}. The monthly and the annual plan have the same allowance: ${al.limit} requests every month, even if you pay once a year. Unused requests do not carry over, and when they run out AI features pause until the reset. You are never charged extra for them.`,
    valueText: `${al.used} of ${al.limit} used, ${al.remaining} left, resets ${reset}`,
  };
};

/** The words of the confirmation before cancelling. It repeats the exact date, because "until the end of the period" is not a date. */
export const cancelConfirmation = (a: AccountView, opts: PanelOpts = {}): string[] => {
  const s = a.subscription;
  if (!s) return [];
  const end = formatDate(s.currentPeriodEnd, opts);
  return [
    `Your subscription will not renew. You keep full access until ${end}, and you will not be charged again.`,
    'Your data is kept. You can resume the subscription before then, or choose a plan again after it ends.',
  ];
};
