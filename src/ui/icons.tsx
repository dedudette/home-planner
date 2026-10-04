import {
  AlarmClock, AlertTriangle, ArrowRight, BarChart3, Bath, BatteryLow, Bed, Calendar, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight,
  CircleDot, Clock, CookingPot, Droplets, Flame, Hammer, Heart, Home, Info, Layers, Leaf, ListChecks, Menu as MenuIcon, Minus, Moon, MoreHorizontal,
  Package, Pause, PawPrint, Pencil, Play, Plus, Repeat, RotateCcw, Scale, Settings, ShieldAlert, Shirt, SkipForward, Smile, Sofa, Sparkles, Sprout,
  Sun, Timer, Trash2, Undo2, Users, Warehouse, Wind, X, Baby, Building2, DoorOpen, Laptop, TreePine, Mountain, Archive, Store, Hand,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RoomKind } from '../domain/types';

export type IconType = LucideIcon;

export const I = {
  alarm: AlarmClock, alert: AlertTriangle, arrow: ArrowRight, chart: BarChart3, bath: Bath, battery: BatteryLow, bed: Bed, cal: Calendar,
  calDays: CalendarDays, check: Check, checkCircle: CheckCircle2, left: ChevronLeft, right: ChevronRight, dot: CircleDot, clock: Clock,
  pot: CookingPot, drop: Droplets, flame: Flame, hammer: Hammer, heart: Heart, home: Home, info: Info, layers: Layers, leaf: Leaf, list: ListChecks,
  menu: MenuIcon, minus: Minus, moon: Moon, more: MoreHorizontal, package: Package, pause: Pause, paw: PawPrint, pencil: Pencil, play: Play,
  plus: Plus, repeat: Repeat, undo: RotateCcw, undo2: Undo2, scale: Scale, settings: Settings, shield: ShieldAlert, shirt: Shirt, skip: SkipForward,
  smile: Smile, sofa: Sofa, sparkles: Sparkles, sprout: Sprout, sun: Sun, timer: Timer, trash: Trash2, users: Users, garage: Warehouse, wind: Wind,
  x: X, baby: Baby, building: Building2, door: DoorOpen, laptop: Laptop, tree: TreePine, mountain: Mountain, archive: Archive, store: Store, hand: Hand,
} as const;

export const ROOM_ICON: Record<RoomKind, IconType> = {
  kitchen: CookingPot, bathroom: Bath, bedroom: Bed, living: Sofa, dining: CookingPot, office: Laptop, hallway: DoorOpen, laundry: Shirt,
  storage: Archive, balcony: Sun, garage: Warehouse, basement: Mountain, attic: Home, other: Layers, home: Home,
};
