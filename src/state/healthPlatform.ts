import { createCapgoAdapter, type HealthPluginLike } from '../domain/health/capgo';
import type { HealthAdapter } from '../domain/health/adapter';

/**
 * The health service of this device, if there is one: Apple Health in the iPhone app, Health Connect in the Android app. In a browser
 * there is none, and the screens say so instead of offering a switch that could not work. The plugin is loaded only in the phone apps.
 */
export const getHealthAdapter = async (): Promise<HealthAdapter | null> => {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
  if (cap?.isNativePlatform?.() !== true) return null;
  const platform = cap.getPlatform?.();
  if (platform !== 'ios' && platform !== 'android') return null;
  try {
    const { Health } = await import('@capgo/capacitor-health');
    return createCapgoAdapter(Health as unknown as HealthPluginLike, platform === 'ios' ? 'healthkit' : 'health-connect');
  } catch { return null; }
};
