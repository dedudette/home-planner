import { formatEuro, PLANS, type PlanId } from '../../src/domain/billing/plans';

/**
 * Plain-text emails. They state facts the server holds (dates, plan, amount) and a link where the person can act. Nothing here is
 * urgent-sounding or guilt-based, and nothing includes anything from the person's plan, meals, journal or health data.
 */
export interface Rendered { subject: string; text: string }

const date = (iso: string): string => new Date(iso).toISOString().slice(0, 10);
const sign = 'CleanFlow';

export const verifyEmail = (url: string): Rendered => ({
  subject: 'Confirm your email for CleanFlow',
  text: `Hello,\n\nPlease confirm your email address to finish creating your CleanFlow account:\n\n${url}\n\nThe link works for 24 hours. If you did not create an account, you can ignore this email and nothing will happen.\n\n${sign}`,
});

export const resetPassword = (url: string): Rendered => ({
  subject: 'Reset your CleanFlow password',
  text: `Hello,\n\nSomeone asked to reset the password for this CleanFlow account. If it was you, choose a new password here:\n\n${url}\n\nThe link works for one hour. If you did not ask, ignore this email: your password stays as it is.\n\n${sign}`,
});

export type NoticeKind = 'trial-ending' | 'payment-failed' | 'payment-action-required' | 'cancellation-scheduled' | 'subscription-started' | 'renewal-upcoming' | 'access-ended';

export interface NoticePayload { plan?: PlanId; endsAt?: string; periodEnd?: string; amountCents?: number; manageUrl: string }

export const notice = (kind: NoticeKind, p: NoticePayload): Rendered => {
  const plan = p.plan ? PLANS[p.plan] : null;
  switch (kind) {
    case 'trial-ending':
      return { subject: 'Your CleanFlow trial ends soon', text: `Hello,\n\nYour 14-day trial ends on ${date(p.endsAt!)}. No card was taken and nothing will be charged. After that day the app asks you to choose a subscription (monthly €25/month, or annual €255/year, charged once a year) to keep using it; your data stays safe and you can export or delete it at any time.\n\nSubscriptions: ${p.manageUrl}\n\n${sign}` };
    case 'subscription-started':
      return { subject: 'Your CleanFlow subscription is active', text: `Hello,\n\nYour ${plan!.id} subscription is active: ${plan!.chargeLabel}, renewing automatically until you cancel. You can see invoices, change plan or cancel at any time, and cancelling keeps access until the end of the period you paid for.\n\nManage: ${p.manageUrl}\n\n${sign}` };
    case 'renewal-upcoming':
      return { subject: `Your CleanFlow ${plan!.id} subscription renews on ${date(p.periodEnd!)}`, text: `Hello,\n\nYour ${plan!.id} subscription renews on ${date(p.periodEnd!)} for ${formatEuro(plan!.cents)}. To change plan or cancel before then:\n\n${p.manageUrl}\n\n${sign}` };
    case 'payment-failed':
      return { subject: 'Your CleanFlow payment did not go through', text: `Hello,\n\nWe could not take your last subscription payment. You can update your payment method here, and the payment will be tried again:\n\n${p.manageUrl}\n\nYour data is safe either way.\n\n${sign}` };
    case 'payment-action-required':
      return { subject: 'Your bank needs you to confirm a CleanFlow payment', text: `Hello,\n\nYour bank asks you to confirm the latest subscription payment. You can finish it here:\n\n${p.manageUrl}\n\n${sign}` };
    case 'cancellation-scheduled':
      return { subject: 'Your CleanFlow subscription will end', text: `Hello,\n\nYour subscription is set to end on ${date(p.periodEnd!)}. You keep full access until then and will not be charged again. Your data stays in place, and you can export it or resubscribe whenever you like.\n\nManage: ${p.manageUrl}\n\n${sign}` };
    case 'access-ended':
      return { subject: 'Your CleanFlow subscription has ended', text: `Hello,\n\nYour subscription has ended. Your data is kept, and you can export or delete it at any time. To pick up where you left off, choose a subscription here:\n\n${p.manageUrl}\n\n${sign}` };
  }
};
