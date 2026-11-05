// Things to look up, all on the iPad and all offline: formulas, the periodic table, a unit converter,
// math symbols to copy, and Apple's dictionary.
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, useToast } from '@/components/ui';
import { copyText, defineWord } from '@/lib/ondevice';
import { useTheme } from '@/lib/settings';
import { convert, CONVERT } from '@/lib/study-logic';

const BLUE = '#3F6AF2';

const FORMULAS: { title: string; rows: [string, string][] }[] = [
  { title: 'Geometry: area', rows: [['Rectangle', 'A = l × w'], ['Square', 'A = s²'], ['Triangle', 'A = ½ × b × h'], ['Parallelogram', 'A = b × h'], ['Trapezoid', 'A = ½ × (b₁ + b₂) × h'], ['Rhombus', 'A = ½ × d₁ × d₂'], ['Circle', 'A = π × r²'], ['Sector', 'A = (θ / 360) × π × r²'], ['Regular polygon', 'A = ½ × apothem × perimeter']] },
  { title: 'Geometry: lengths and angles', rows: [['Circumference', 'C = 2 × π × r'], ['Arc length', 'L = (θ / 360) × 2 × π × r'], ['Pythagorean theorem', 'a² + b² = c²'], ['Triangle angles', 'sum = 180°'], ['Polygon interior angles', 'sum = (n − 2) × 180°'], ['Polygon exterior angles', 'sum = 360°'], ['45-45-90 triangle', 'sides x, x, x√2'], ['30-60-90 triangle', 'sides x, x√3, 2x'], ['Distance', 'd = √((x₂ − x₁)² + (y₂ − y₁)²)'], ['Midpoint', 'M = ((x₁ + x₂) / 2, (y₁ + y₂) / 2)'], ['Circle equation', '(x − h)² + (y − k)² = r²']] },
  { title: 'Geometry: solids', rows: [['Rectangular prism', 'V = l × w × h'], ['Cylinder', 'V = π × r² × h'], ['Cone', 'V = ⅓ × π × r² × h'], ['Pyramid', 'V = ⅓ × B × h'], ['Sphere', 'V = (4/3) × π × r³'], ['Sphere surface', 'SA = 4 × π × r²'], ['Cylinder surface', 'SA = 2πr² + 2πrh']] },
  { title: 'Trigonometry', rows: [['Sine', 'sin θ = opposite / hypotenuse'], ['Cosine', 'cos θ = adjacent / hypotenuse'], ['Tangent', 'tan θ = opposite / adjacent'], ['Identity', 'sin²θ + cos²θ = 1'], ['Law of sines', 'a / sin A = b / sin B = c / sin C'], ['Law of cosines', 'c² = a² + b² − 2ab × cos C']] },
  { title: 'Algebra', rows: [['Slope', 'm = (y₂ − y₁) / (x₂ − x₁)'], ['Slope-intercept', 'y = mx + b'], ['Point-slope', 'y − y₁ = m(x − x₁)'], ['Quadratic formula', 'x = (−b ± √(b² − 4ac)) / 2a'], ['Difference of squares', 'a² − b² = (a + b)(a − b)'], ['Perfect square', '(a + b)² = a² + 2ab + b²'], ['Exponents', 'aᵐ × aⁿ = aᵐ⁺ⁿ'], ['Percent change', '(new − old) / old × 100']] },
  { title: 'Business', rows: [['Profit', 'revenue − expenses'], ['Simple interest', 'I = P × r × t'], ['Compound interest', 'A = P(1 + r/n)ⁿᵗ'], ['Break-even units', 'fixed costs / (price − variable cost)'], ['Markup', '(price − cost) / cost × 100']] },
  { title: 'Biology and chemistry', rows: [['Photosynthesis', '6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂'], ['Cellular respiration', 'C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O + energy'], ['Density', 'd = m / V'], ['Hardy-Weinberg', 'p² + 2pq + q² = 1']] },
];

const SYMBOLS = '± × ÷ ≠ ≈ ≤ ≥ √ ∛ ² ³ ⁿ π θ α β γ Δ ∞ ° ∠ △ ⊥ ∥ ≅ ∼ ∴ ∈ ∪ ∩ ∑ ½ ⅓ ¼ ⅔ ¾ → ← ↔ ₁ ₂ ₃'.split(' ');

const ELEMENTS = 'H Hydrogen,He Helium,Li Lithium,Be Beryllium,B Boron,C Carbon,N Nitrogen,O Oxygen,F Fluorine,Ne Neon,Na Sodium,Mg Magnesium,Al Aluminum,Si Silicon,P Phosphorus,S Sulfur,Cl Chlorine,Ar Argon,K Potassium,Ca Calcium,Sc Scandium,Ti Titanium,V Vanadium,Cr Chromium,Mn Manganese,Fe Iron,Co Cobalt,Ni Nickel,Cu Copper,Zn Zinc,Ga Gallium,Ge Germanium,As Arsenic,Se Selenium,Br Bromine,Kr Krypton,Rb Rubidium,Sr Strontium,Y Yttrium,Zr Zirconium,Nb Niobium,Mo Molybdenum,Tc Technetium,Ru Ruthenium,Rh Rhodium,Pd Palladium,Ag Silver,Cd Cadmium,In Indium,Sn Tin,Sb Antimony,Te Tellurium,I Iodine,Xe Xenon,Cs Cesium,Ba Barium,La Lanthanum,Ce Cerium,Pr Praseodymium,Nd Neodymium,Pm Promethium,Sm Samarium,Eu Europium,Gd Gadolinium,Tb Terbium,Dy Dysprosium,Ho Holmium,Er Erbium,Tm Thulium,Yb Ytterbium,Lu Lutetium,Hf Hafnium,Ta Tantalum,W Tungsten,Re Rhenium,Os Osmium,Ir Iridium,Pt Platinum,Au Gold,Hg Mercury,Tl Thallium,Pb Lead,Bi Bismuth,Po Polonium,At Astatine,Rn Radon,Fr Francium,Ra Radium,Ac Actinium,Th Thorium,Pa Protactinium,U Uranium,Np Neptunium,Pu Plutonium,Am Americium,Cm Curium,Bk Berkelium,Cf Californium,Es Einsteinium,Fm Fermium,Md Mendelevium,No Nobelium,Lr Lawrencium,Rf Rutherfordium,Db Dubnium,Sg Seaborgium,Bh Bohrium,Hs Hassium,Mt Meitnerium,Ds Darmstadtium,Rg Roentgenium,Cn Copernicium,Nh Nihonium,Fl Flerovium,Mc Moscovium,Lv Livermorium,Ts Tennessine,Og Oganesson'
  .split(',').map((x, i) => { const [sym, name] = x.split(' '); return { n: i + 1, sym, name }; });

type Tab = 'Formulas' | 'Elements' | 'Units' | 'Symbols' | 'Dictionary';

export default function Reference() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('Formulas');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('Length');
  const [value, setValue] = useState('1');
  const [from, setFrom] = useState('in');
  const [to, setTo] = useState('cm');
  const [word, setWord] = useState('');

  const copy = (text: string) => { copyText(text); toast(`Copied ${text}`); };
  const needle = q.trim().toLowerCase();
  const formulas = useMemo(() => FORMULAS.map((g) => ({ ...g, rows: g.rows.filter(([a, b]) => !needle || g.title.toLowerCase().includes(needle) || a.toLowerCase().includes(needle) || b.toLowerCase().includes(needle)) })).filter((g) => g.rows.length), [needle]);
  const elements = useMemo(() => ELEMENTS.filter((e) => !needle || e.name.toLowerCase().includes(needle) || e.sym.toLowerCase() === needle || String(e.n) === needle), [needle]);
  const units = Object.keys(CONVERT[kind]);
  const amount = Number(value);
  const result = value.trim() && Number.isFinite(amount) ? convert(kind, amount, from, to) : null;
  const pick = (k: string) => { setKind(k); const u = Object.keys(CONVERT[k]); setFrom(u[0]); setTo(u[1]); };

  const chipRow = (list: string[], cur: string, set: (v: string) => void) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6 }}>
      {list.map((x) => (
        <Pressable key={x} accessibilityLabel={x} onPress={() => set(x)} style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', backgroundColor: cur === x ? `${BLUE}1F` : t.chip }}>
          <Text style={{ color: cur === x ? BLUE : t.text, fontSize: 14, fontWeight: '500' }}>{x}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }}>
        <IconButton name="arrow.left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <Text style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '700', marginLeft: 6 }}>Reference</Text>
      </View>
      <View style={{ paddingHorizontal: 16, gap: 10, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
        {chipRow(['Formulas', 'Elements', 'Units', 'Symbols', 'Dictionary'], tab, (v) => { setTab(v as Tab); setQ(''); })}
        {tab === 'Formulas' || tab === 'Elements' ? (
          <TextInput accessibilityLabel="Search" value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={t.faint} autoCorrect={false} style={{ height: 40, borderRadius: 10, backgroundColor: t.chip, paddingHorizontal: 12, color: t.text, fontSize: 15 }} />
        ) : null}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, marginTop: 10 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60, gap: 8, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
        {tab === 'Formulas' ? formulas.map((g) => (
          <View key={g.title} style={{ marginBottom: 10 }}>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '700', marginBottom: 6 }}>{g.title}</Text>
            {g.rows.map(([a, b]) => (
              <Pressable key={a} accessibilityLabel={`${a}: ${b}`} onPress={() => copy(b)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: t.line }}>
                <Text style={{ width: 180, color: t.sub, fontSize: 14 }}>{a}</Text>
                <Text style={{ flex: 1, color: t.text, fontSize: 16 }}>{b}</Text>
              </Pressable>
            ))}
          </View>
        )) : null}

        {tab === 'Elements' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {elements.map((e) => (
              <Pressable key={e.n} accessibilityLabel={`${e.name}, ${e.n}`} onPress={() => copy(e.sym)} style={{ width: 86, height: 76, borderRadius: 10, padding: 6, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: t.faint, fontSize: 11 }}>{e.n}</Text>
                <Text style={{ color: t.text, fontSize: 20, fontWeight: '700' }}>{e.sym}</Text>
                <Text numberOfLines={1} style={{ color: t.sub, fontSize: 10.5 }}>{e.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {tab === 'Units' ? (
          <View style={{ gap: 12 }}>
            {chipRow(Object.keys(CONVERT), kind, pick)}
            <TextInput accessibilityLabel="Amount" value={value} onChangeText={setValue} keyboardType="numbers-and-punctuation" style={{ height: 48, borderRadius: 10, backgroundColor: t.chip, paddingHorizontal: 12, color: t.text, fontSize: 20 }} />
            <Text style={{ color: t.sub, fontSize: 13 }}>From</Text>
            {chipRow(units, from, setFrom)}
            <Text style={{ color: t.sub, fontSize: 13 }}>To</Text>
            {chipRow(units, to, setTo)}
            <Text style={{ color: t.text, fontSize: 30, fontWeight: '700', marginTop: 8 }}>{result == null ? '—' : `${Number(result.toPrecision(7))} ${to}`}</Text>
          </View>
        ) : null}

        {tab === 'Symbols' ? (
          <>
            <Text style={{ color: t.sub, fontSize: 14 }}>Tap one to copy it, then paste it into a text box.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {SYMBOLS.map((x) => (
                <Pressable key={x} accessibilityLabel={`Copy ${x}`} onPress={() => copy(x)} style={{ width: 56, height: 56, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: t.card, borderWidth: 1, borderColor: t.line }}>
                  <Text style={{ color: t.text, fontSize: 22 }}>{x}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {tab === 'Dictionary' ? (
          <View style={{ gap: 10 }}>
            <TextInput accessibilityLabel="Word to look up" value={word} onChangeText={setWord} onSubmitEditing={() => word.trim() && defineWord(word.trim())} returnKeyType="search" placeholder="Look up a word" placeholderTextColor={t.faint} style={{ height: 46, borderRadius: 10, backgroundColor: t.chip, paddingHorizontal: 12, color: t.text, fontSize: 16 }} />
            <Pressable accessibilityLabel="Look up" disabled={!word.trim()} onPress={() => defineWord(word.trim())} style={{ height: 42, borderRadius: 10, backgroundColor: word.trim() ? BLUE : t.chip, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: word.trim() ? '#fff' : t.faint, fontSize: 15, fontWeight: '600' }}>Look up</Text>
            </Pressable>
            <Text style={{ color: t.sub, fontSize: 13 }}>Uses the iPad's own dictionary. Add more languages from its Manage button.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
