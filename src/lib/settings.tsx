// App preferences (AsyncStorage) + the colour theme.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import type { FavPen, PenType, ShapeKind } from './model';

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
  eraser: 'stroke' | 'partial'; eraserSize: number;
  textSize: number;
  recentColors: string[];
  shapeKind: ShapeKind;
  tapeColor: string;
  favPens: FavPen[];
  inkKind: InkTool;          // the PencilKit tool picked in the editor
  inkSize: number;           // 0 | 1 | 2
  penStyle: PenStyle;        // which pen the Pen tool uses
  textSizeIdx: number;       // 0 | 1 | 2
  fingerDraws: boolean;      // off: fingers scroll and zoom, only Apple Pencil writes
  driveSync?: boolean;       // on: a note is saved to the Quill folder in Google Drive when you leave it
  gamesUnlocked?: boolean;   // the Games tab, unlocked with a redeem code
};
export type InkTool = 'pen' | 'marker' | 'eraser' | 'lasso' | 'text';
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
  const dark = s.theme === 'dark' || (s.theme === 'system' && sys === 'dark');
  return dark ? DARK : LIGHT;
}
