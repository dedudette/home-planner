import { workoutDemands, workoutImpact, workoutMinutes, workoutNeeds } from '../../domain/movement/planner';
import type { MoveType, Workout } from '../../domain/movement/types';
import { Tag } from '../../ui/primitives';

export const TYPE_LABEL: Record<MoveType, string> = { walking: 'Walking', mobility: 'Mobility', gentle: 'Gentle', strength: 'Strength', stretching: 'Stretching', dance: 'Dance' };
export const LEVEL_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' } as const;
export const EQUIP_LABEL: Record<string, string> = { mat: 'a mat', chair: 'a chair', wall: 'a wall', 'light-weights': 'light weights', 'resistance-band': 'a resistance band', stairs: 'stairs' };
export const AVOID_LABEL: Record<string, string> = { jumping: 'Jumping', kneeling: 'Kneeling', floor: 'Getting down to the floor', 'wrist-load': 'Weight on my wrists', 'standing-balance': 'Standing on one leg or balancing' };

export const WorkoutTags = ({ w }: { w: Workout }) => (
  <div className="row wrap" style={{ gap: 6 }}>
    <Tag>{workoutMinutes(w)} min</Tag><Tag>{TYPE_LABEL[w.type]}</Tag><Tag>{LEVEL_LABEL[w.level]}</Tag>
    {workoutImpact(w) === 'low' ? <Tag kind="green">Low impact</Tag> : <Tag>Higher impact</Tag>}
    {workoutNeeds(w).length === 0 ? <Tag>No equipment</Tag> : <Tag>Needs {workoutNeeds(w).map((n) => EQUIP_LABEL[n]).join(', ')}</Tag>}
    {w.source === 'personal' && <Tag kind="lav">Yours</Tag>}
    {workoutDemands(w).includes('floor') && <Tag>Floor work</Tag>}
  </div>
);
