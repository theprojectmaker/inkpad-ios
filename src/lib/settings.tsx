// App preferences (AsyncStorage) + the colour theme.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

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
  penType: 'fountain' | 'ball';
  hlStraight: boolean;      // highlighter lines snap straight
  tabs: string[];           // open note tabs
  penColor: string; penWidth: number;
  hlColor: string; hlWidth: number;
  eraser: 'stroke' | 'partial'; eraserSize: number;
  textSize: number;
  recentColors: string[];
};

const DEFAULTS: Settings = {
  theme: 'system', view: 'grid', sort: 'updated',
  pencilOnly: false, pencilSeen: false, pressure: true, smoothing: 0.4, holdToShape: true, penType: 'fountain', hlStraight: true,
  tabs: [],
  penColor: '#111111', penWidth: 2,
  hlColor: '#FFE14D', hlWidth: 16,
  eraser: 'partial', eraserSize: 14,
  textSize: 18,
  recentColors: [],
};

const KEY = 'inkpad.settings.v1';

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
  dark: false, bg: '#F6F5F2', side: '#EEEDE8', card: '#FFFFFF', elev: '#FFFFFF', text: '#17181C', sub: '#5E616B', faint: '#9A9DA6',
  line: '#E1E0DA', accent: '#2563EB', accentText: '#FFFFFF', danger: '#DC2626', desk: '#E7E6E1', bar: '#FBFBF9', chip: '#ECEBE6',
};
const DARK: Theme = {
  dark: true, bg: '#121316', side: '#18191D', card: '#1F2025', elev: '#26272D', text: '#F1F2F4', sub: '#A6A9B2', faint: '#6C707A',
  line: '#2E3036', accent: '#5B8CFF', accentText: '#FFFFFF', danger: '#F87171', desk: '#0C0D0F', bar: '#1A1B1F', chip: '#2A2B31',
};

export function useTheme(): Theme {
  const { s } = useSettings();
  const sys = useColorScheme();
  const dark = s.theme === 'dark' || (s.theme === 'system' && sys === 'dark');
  return dark ? DARK : LIGHT;
}
