import type { AppData, EnergyLevel, ISODate, Task } from './types';

export const dayEnergyOf = (data: AppData, date: ISODate): EnergyLevel => (data.dayEnergy?.date === date ? data.dayEnergy.level : 'ok');

/**
 * The ONE low-energy safety rule. Every place that can put a task in front of the user (the day's plan, Quick wins, "I only have X
 * minutes", Just 5 minutes, challenges, routines, room lists) asks this question, so a hard or vigorous task can never slip through
 * a side door on a day the user said they have little to give.
 *
 * On a low-energy day a task must be easy or medium, and never vigorous. Other energy levels restrict nothing.
 */
export const energyOk = (t: Pick<Task, 'difficulty' | 'intensity'>, energy: EnergyLevel): boolean =>
  energy !== 'low' || (t.intensity !== 'vigorous' && t.difficulty <= 2);
