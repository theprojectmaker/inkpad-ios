// Just enough Markdown for the AI's study answers: headings, bullet and
// numbered lists, paragraphs, **bold** and *italic*.
import { Text, View } from 'react-native';

import { useTheme } from '@/lib/settings';

function Inline({ text, color, size, weight }: { text: string; color: string; size: number; weight?: '400' | '600' | '700' | '800' }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).filter(Boolean);
  return (
    <Text style={{ color, fontSize: size, lineHeight: size * 1.45, fontWeight: weight ?? '400' }}>
      {parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <Text key={i} style={{ fontWeight: '700' }}>{p.slice(2, -2)}</Text>
        : p.startsWith('*') && p.endsWith('*') && p.length > 2 ? <Text key={i} style={{ fontStyle: 'italic' }}>{p.slice(1, -1)}</Text>
          : <Text key={i}>{p}</Text>))}
    </Text>
  );
}

export function Markdown({ text }: { text: string }) {
  const t = useTheme();
  const out: React.ReactNode[] = [];
  text.replace(/\r/g, '').split('\n').forEach((raw, i) => {
    const line = raw.trimEnd();
    if (!line.trim()) { out.push(<View key={i} style={{ height: 6 }} />); return; }
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      const lvl = m[1].length;
      out.push(<View key={i} style={{ marginTop: lvl === 1 ? 2 : 10, marginBottom: 4 }}><Inline text={m[2]} color={t.text} size={lvl === 1 ? 20 : lvl === 2 ? 16 : 15} weight={lvl === 1 ? '800' : '700'} /></View>);
    } else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
      out.push(
        <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 3, paddingLeft: 2 }}>
          <Text style={{ color: t.accent, fontSize: 15, lineHeight: 21 }}>•</Text>
          <View style={{ flex: 1 }}><Inline text={m[1]} color={t.text} size={15} /></View>
        </View>,
      );
    } else if ((m = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) {
      out.push(
        <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 3 }}>
          <Text style={{ color: t.sub, fontSize: 15, lineHeight: 21, fontWeight: '600', minWidth: 18 }}>{m[1]}.</Text>
          <View style={{ flex: 1 }}><Inline text={m[2]} color={t.text} size={15} /></View>
        </View>,
      );
    } else {
      out.push(<View key={i} style={{ marginBottom: 4 }}><Inline text={line} color={t.text} size={15} /></View>);
    }
  });
  return <View>{out}</View>;
}
