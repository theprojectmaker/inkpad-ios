// App preferences (AsyncStorage) + the colour theme.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import type { FavPen, PageSizeId, PaperColor, PaperStyle, PenType, ShapeKind } from './model';

export type Sort = 'updated' | 'created' | 'title';
export type Settings = {
  theme: 'system' | 'light' | 'dark';
  view: 'grid' | 'list';
  sort: Sort;
  pencilOnly: boolean;      // fingers scroll, only Apple Pencil draws
  pencilSeen: boolean;      // turned pencilOnly on automatically once
  pressure: boolean;
  smoothing: number;        // 0..1
  holdToShape: boolean;
  penType: PenType;
  hlStraight: boolean;      // highlighter lines snap straight
  tabs: string[];           // open note tabs
  penColor: string; penWidth: number;
  hlColor: string; hlWidth: number;
  eraser: 'stroke' | 'partial' | 'hl'; eraserSize: number;
  textSize: number;
  recentColors: string[];
  shapeKind: ShapeKind;
  tapeColor: string;
  favPens: FavPen[];
  favs: FavTool[];            // the pens saved in the floating pen bar
  tk?: Record<string, Partial<ToolKit>>;
  toolOrder?: string[];      // the Toolbox: order of the tools
  toolHidden?: string[];     // and the ones taken off the toolbar
  measureMode?: 'ruler' | 'length' | 'area' | 'angle';
  measureScale?: { perPoint: number; unit: string };   // from Calibrate scale
  myTemplates?: string[];
  nibAngle?: number;         // calligraphy
  nibSteady?: boolean;
  autoPage?: boolean;        // a blank page appears when you write on the last one (on by default)
  showFavs?: boolean;        // that bar is on screen (on by default)
  lastTool?: InkTool;        // for the Pencil double-tap
  lassoBox?: boolean;        // the lasso draws a rectangle
  tapeSize?: number;         // 0 | 1 | 2
  textFont?: string;         // system | serif | mono | hand | round
  textBold?: boolean;
  textItalic?: boolean;
  textUnderline?: boolean;
  defaultPaper?: { style: PaperStyle; color: PaperColor; size?: PageSizeId };
  inkKind: InkTool;          // the PencilKit tool picked in the editor
  inkSize: number;           // 0 | 1 | 2
  penStyle: PenStyle;        // which pen the Pen tool uses
  textSizeIdx: number;       // 0 | 1 | 2
  fingerDraws: boolean;      // off: fingers scroll and zoom, only Apple Pencil writes
  inkStats?: boolean;        // numbers on the page: how fast the ink is
  driveSync?: boolean;       // on: a note is saved to the Quill folder in Google Drive when you leave it
  toolDock?: 'top' | 'bottom' | 'left' | 'right';   // which edge of the screen the toolbar sits on
  brushType?: 'brushpen' | 'feltTip' | 'crayon' | 'chisel' | 'watercolor' | 'spray';
  shapeType?: 'line' | 'arrow' | 'double' | 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'star' | 'check' | 'cross' | 'axes';
  shapeLock?: boolean;       // lines to 15 degree steps, square boxes, round circles
  shapeFill?: boolean;
  streamline?: number;       // 0 to 1: how much pens smooth the hand's wobble
  scribble?: boolean;        // Pencil handwriting in a text box turns into typing (on unless turned off)
  scratchOut?: boolean;      // scribbling back and forth over writing deletes it (off unless turned on)
  scheduleUnlocked?: boolean;   // the real Studento schedule, linked with a code
  gamesUnlocked?: boolean;   // the Games tab, unlocked with a redeem code
};
export type InkTool = 'pen' | 'pencil' | 'marker' | 'eraser' | 'lasso' | 'text' | 'tape' | 'laser' | 'hand' | 'calligraphy' | 'comment' | 'measure' | 'compass' | 'shape' | 'brush';
export type PenLine = 'even' | 'pressure' | 'dash' | 'dot';
/** What each tool remembers: its colours, three sizes (1-12) and line style. */
export type ToolKit = { colors: string[]; color: number; sizes: number[]; size: number; line: PenLine };
export type FavTool = { kind: 'pen' | 'marker'; style: PenStyle; color: string; size: number };
export type PenStyle = 'pen' | 'felt' | 'fountain' | 'pencil';

const DEFAULTS: Settings = {
  theme: 'system', view: 'grid', sort: 'updated',
  pencilOnly: false, pencilSeen: false, pressure: true, smoothing: 0.4, holdToShape: true, penType: 'fountain', hlStraight: true,
  tabs: [],
  penColor: '#111111', penWidth: 1.8,
  hlColor: '#FFE14D', hlWidth: 20,
  eraser: 'partial', eraserSize: 14,
  textSize: 18,
  recentColors: [],
  shapeKind: 'arrow',
  tapeColor: '#F7B731',
  favPens: [],
  favs: [
    { kind: 'pen', style: 'pen', color: '#111111', size: 1 },
    { kind: 'pen', style: 'pen', color: '#1E5EFF', size: 1 },
    { kind: 'pen', style: 'pen', color: '#E5322D', size: 1 },
    { kind: 'marker', style: 'pen', color: '#FFE14D', size: 1 },
  ],
  inkKind: 'pen', inkSize: 1, fingerDraws: false, penStyle: 'pen', textSizeIdx: 1,
};

const KEY = 'inkpad.settings.v1';   // key kept from the app's first name (Inkpad) so settings survive the rename

type Ctx = { s: Settings; set: (patch: Partial<Settings>) => void; loaded: boolean };
const SettingsCtx = createContext<Ctx>({ s: DEFAULTS, set: () => {}, loaded: false });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      if (v) { try { setS({ ...DEFAULTS, ...JSON.parse(v) }); } catch {} }
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  const set = useCallback((patch: Partial<Settings>) => {
    setS((prev) => {
      const next = { ...prev, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {}); }, 300);
      return next;
    });
  }, []);

  const v = useMemo(() => ({ s, set, loaded }), [s, set, loaded]);
  return <SettingsCtx.Provider value={v}>{children}</SettingsCtx.Provider>;
}

export const useSettings = () => useContext(SettingsCtx);

export type Theme = {
  dark: boolean;
  bg: string; side: string; card: string; elev: string; text: string; sub: string; faint: string;
  line: string; accent: string; accentText: string; danger: string; desk: string; bar: string; chip: string;
};

const LIGHT: Theme = {
  dark: false, bg: '#FFFFFF', side: '#F4F4F6', card: '#FFFFFF', elev: '#FFFFFF', text: '#1C1C1E', sub: '#636366', faint: '#8E8E93',
  line: '#E5E5EA', accent: '#007AFF', accentText: '#FFFFFF', danger: '#FF3B30', desk: '#EBEBEF', bar: '#F9F9FB', chip: '#EFEFF4',
};
const DARK: Theme = {
  dark: true, bg: '#000000', side: '#161618', card: '#1C1C1E', elev: '#2C2C2E', text: '#F2F2F7', sub: '#AEAEB2', faint: '#8E8E93',
  line: '#2C2C2E', accent: '#0A84FF', accentText: '#FFFFFF', danger: '#FF453A', desk: '#0A0A0B', bar: '#121214', chip: '#2C2C2E',
};

export function useTheme(): Theme {
  const { s } = useSettings();
  const sys = useColorScheme();
  // The app is light like the recordings, unless Dark is picked on purpose.
  const dark = s.theme === 'dark' && sys != null;
  return dark ? DARK : LIGHT;
}
