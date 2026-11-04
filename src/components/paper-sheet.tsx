// Choosing paper: for a new note (with page size) or for one page of a note.
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { PaperPicker } from '@/components/paper-picker';
import { Button, Sheet } from '@/components/ui';
import type { PageSizeId, PaperColor, PaperStyle } from '@/lib/model';

export function PaperSheet({ visible, title, confirm, style, color, size, withSize, onClose, onDone }: {
  visible: boolean; title: string; confirm: string; style?: PaperStyle; color?: PaperColor; size?: PageSizeId; withSize?: boolean;
  onClose: () => void; onDone: (style: PaperStyle, color: PaperColor, size?: PageSizeId) => void;
}) {
  const [st, setSt] = useState<PaperStyle>(style ?? 'lined');
  const [co, setCo] = useState<PaperColor>(color ?? 'white');
  const [sz, setSz] = useState<PageSizeId>(size ?? 'letter');
  useEffect(() => {
    if (!visible) return;
    setSt(style ?? 'lined');
    setCo(color ?? 'white');
    setSz(size ?? 'letter');
  }, [visible, style, color, size]);
  return (
    <Sheet visible={visible} onClose={onClose} title={title} width={560}>
      <PaperPicker style={st} color={co} size={sz} onSize={withSize ? setSz : undefined} onChange={(s, c) => { setSt(s); setCo(c); }} />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <Button title="Cancel" onPress={onClose} />
        <Button title={confirm} kind="primary" onPress={() => onDone(st, co, sz)} />
      </View>
    </Sheet>
  );
}
