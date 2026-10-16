import type { MealsData, ShoppingData } from './types';

export const emptyMeals = (): MealsData => ({
  prefs: {
    diet: 'any', avoid: [], dislikes: [], household: 1, equipment: [], maxPrepMinutes: null, budgetFriendly: false, simple: false,
    // Breakfast, lunch and dinner are on and a snack is off. No time is set: a time is only ever one the person chose.
    slots: { breakfast: { on: true, time: null }, lunch: { on: true, time: null }, dinner: { on: true, time: null }, snack: { on: false, time: null } },
  },
  dishes: [], plan: [], favourites: [], recents: [],
});

export const emptyShopping = (): ShoppingData => ({ lists: [], pantry: [] });
