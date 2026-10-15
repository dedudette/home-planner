import { useApp } from '../../state/store';
import { I } from '../../ui/icons';
import { Button, PageHead, Segmented } from '../../ui/primitives';
import { navigate, useRoute } from '../../ui/router';
import { PlanTab } from './PlanTab';
import { PrefsTab } from './PrefsTab';
import { RecipesTab } from './RecipesTab';
import { ShoppingTab } from './ShoppingTab';

type Tab = 'plan' | 'recipes' | 'shopping' | 'prefs';
const TABS: { value: Tab; label: string }[] = [{ value: 'plan', label: 'Plan' }, { value: 'recipes', label: 'Recipes' }, { value: 'shopping', label: 'Shopping' }, { value: 'prefs', label: 'Preferences' }];

/** Meals and shopping: plan a week, browse recipes, make shopping lists from the plan, say what suits you. */
export const Meals = () => {
  const route = useRoute();
  const { openSheet } = useApp();
  const raw = route.query.get('tab');
  const tab: Tab = TABS.some((t) => t.value === raw) ? (raw as Tab) : 'plan';
  return (
    <div className="page">
      <PageHead title="Meals & shopping" sub="Plan what you eat, keep recipes, and shop from your plan."
        action={<Button variant="soft" icon={I.list} onClick={() => openSheet({ kind: 'shopGen' })}>Shopping list</Button>} />
      <Segmented<Tab> label="Meals sections" value={tab} onChange={(t) => navigate(`meals?tab=${t}`)} options={TABS} />
      {tab === 'plan' && <PlanTab />}
      {tab === 'recipes' && <RecipesTab />}
      {tab === 'shopping' && <ShoppingTab listId={route.query.get('list')} />}
      {tab === 'prefs' && <PrefsTab />}
    </div>
  );
};
