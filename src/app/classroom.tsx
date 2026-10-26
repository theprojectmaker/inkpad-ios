// Classroom: just your assignments from Google Classroom (to do / missing /
// done). Tap one to open it on Google's page; "Take notes" starts a Quill note.
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmSheet, Icon, IconButton, useToast } from '@/components/ui';
import { type Assignment, cached, type ClassroomData, connect, connectedEmail, disconnect, fetchAssignments, isConfigured, openAssignment, openWebsite, type Status } from '@/lib/classroom';
import { useLibrary } from '@/lib/library';
import { FOLDER_COLORS } from '@/lib/model';
import { useTheme } from '@/lib/settings';

const TABS: { id: Status; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'missing', label: 'Missing' },
  { id: 'done', label: 'Done' },
];

const dueLabel = (due?: number) => {
  if (due == null) return 'No due date';
  const d = new Date(due), now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diff === 0) return `Due today, ${time}`;
  if (diff === 1) return `Due tomorrow, ${time}`;
  if (diff === -1) return `Was due yesterday`;
  if (diff > 1 && diff < 7) return `Due ${d.toLocaleDateString([], { weekday: 'long' })}, ${time}`;
  return `${diff < 0 ? 'Was due' : 'Due'} ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
};

const courseColor = (id: string) => FOLDER_COLORS[Math.abs([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % FOLDER_COLORS.length];

export default function ClassroomScreen() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const lib = useLibrary();
  const { toast } = useToast();
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [ready, setReady] = useState<boolean | null>(null);
  const [data, setData] = useState<ClassroomData | null>(null);
  const [tab, setTab] = useState<Status>('todo');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [signOut, setSignOut] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setData(await fetchAssignments()); }
    catch (e: any) {
      if (e?.relogin) { setEmail(null); }
      setErr(String(e?.message ?? e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    (async () => {
      const [em, ok, c] = await Promise.all([connectedEmail(), isConfigured(), cached()]);
      setReady(ok); setEmail(em); if (c) setData(c);
      if (em && ok) load();
    })();
  }, [load]);

  const doConnect = async () => {
    try { const em = await connect(); setEmail(em); load(); }
    catch (e: any) { if (String(e?.message) !== 'cancelled') toast(String(e?.message ?? e)); }
  };

  const lists = useMemo(() => {
    const items = data?.items ?? [];
    const by = (s: Status) => items.filter((a) => a.status === s);
    return {
      todo: by('todo').sort((a, b) => (a.due ?? 9e15) - (b.due ?? 9e15)),
      missing: by('missing').sort((a, b) => (b.due ?? 0) - (a.due ?? 0)),
      done: by('done').sort((a, b) => (b.due ?? 0) - (a.due ?? 0)),
    };
  }, [data]);

  // A note for this assignment, filed under a subject named after the class.
  const takeNotes = async (a: Assignment) => {
    let folder = lib.lib.folders.find((f) => f.name === a.course)?.id;
    if (!folder) folder = lib.addFolder(a.course);
    const id = await lib.createNote({ folderId: folder, kind: 'paper', title: a.title, paper: { style: 'lined', color: 'white', size: 'letter' } });
    router.push(`/note/${id}`);
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, height: 52, gap: 4 }}>
      <IconButton name="chevron.left" label="Back to notes" onPress={back} />
      <Icon name="graduationcap" size={20} color={t.accent} />
      <Text style={{ flex: 1, marginLeft: 6, color: t.text, fontSize: 22, fontWeight: '800' }}>Classroom</Text>
      {email ? (
        <Pressable onPress={() => setSignOut(true)} style={{ paddingHorizontal: 10, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: t.chip, marginRight: 6 }}>
          <Text numberOfLines={1} style={{ color: t.sub, fontSize: 12.5, fontWeight: '600', maxWidth: 220 }}>{email}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (ready === null || email === undefined) {
    return <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>{header}<ActivityIndicator style={{ marginTop: 60 }} color={t.accent} /></View>;
  }

  if (!email) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
        {header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 14 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: t.accent + '1A', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="graduationcap" size={32} color={t.accent} />
          </View>
          <Text style={{ color: t.text, fontSize: 22, fontWeight: '800' }}>Your assignments, in Quill</Text>
          <Text style={{ color: t.sub, fontSize: 15, textAlign: 'center', maxWidth: 420, lineHeight: 21 }}>
            Connect the Google account you use for Classroom. Quill can only see your classes and your own assignments — nothing else, and it can't change anything.
          </Text>
          {ready ? (
            <Pressable onPress={doConnect} style={({ pressed }) => ({ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingHorizontal: 22, borderRadius: 23, backgroundColor: t.accent, opacity: pressed ? 0.8 : 1 })}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Connect Google Classroom</Text>
            </Pressable>
          ) : (
            <Text style={{ color: t.danger, fontSize: 14, textAlign: 'center', maxWidth: 420 }}>Classroom isn't switched on yet: the Google sign-in for Quill still needs its one-time setup.</Text>
          )}
          {err ? <Text style={{ color: t.danger, fontSize: 14, textAlign: 'center', maxWidth: 420 }}>{err}</Text> : null}
          <View style={{ height: 1, width: 260, backgroundColor: t.line, marginTop: 14 }} />
          <Text style={{ color: t.sub, fontSize: 14, textAlign: 'center', maxWidth: 420, lineHeight: 20 }}>
            Google says "Access blocked"? Some schools don't let apps connect. This works with any account:
          </Text>
          <Pressable onPress={() => openWebsite('todo')} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 20, borderRadius: 22, backgroundColor: t.chip, opacity: pressed ? 0.8 : 1 })}>
            <Icon name="safari" size={16} color={t.accent} />
            <Text style={{ color: t.accent, fontSize: 15, fontWeight: '700' }}>Open my assignments on Classroom</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const list = lists[tab];
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
      {header}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 10 }}>
        {TABS.map((x) => {
          const on = tab === x.id, n = lists[x.id].length;
          return (
            <Pressable key={x.id} onPress={() => setTab(x.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: on ? t.accent : t.chip }}>
              <Text style={{ color: on ? '#fff' : t.text, fontSize: 14, fontWeight: '700' }}>{x.label}</Text>
              <Text style={{ color: on ? '#ffffffcc' : x.id === 'missing' && n ? t.danger : t.faint, fontSize: 13, fontWeight: '700' }}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
      {err ? <Text style={{ color: t.danger, fontSize: 14, paddingHorizontal: 20, paddingBottom: 8 }}>{err}</Text> : null}
      <FlatList data={list} keyExtractor={(a) => a.courseId + ':' + a.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 10 }}
        ListEmptyComponent={!loading ? (
          <Text style={{ color: t.sub, fontSize: 15, textAlign: 'center', marginTop: 60 }}>
            {tab === 'todo' ? 'Nothing due. Nice.' : tab === 'missing' ? 'No missing work.' : 'Nothing turned in yet.'}
          </Text>
        ) : null}
        renderItem={({ item: a }) => {
          const overdue = a.status === 'missing';
          return (
            <Pressable onPress={() => openAssignment(a)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, backgroundColor: pressed ? t.chip : t.card, borderWidth: 1, borderColor: t.line })}>
              <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: courseColor(a.courseId) + '22' }}>
                <Icon name={a.type === 'SHORT_ANSWER_QUESTION' || a.type === 'MULTIPLE_CHOICE_QUESTION' ? 'questionmark.circle' : 'doc.text'} size={19} color={courseColor(a.courseId)} />
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: t.faint, fontSize: 12, fontWeight: '700' }}>{a.course.toUpperCase()}</Text>
                <Text numberOfLines={2} style={{ color: t.text, fontSize: 16, fontWeight: '600', marginTop: 2 }}>{a.title}</Text>
                <Text style={{ color: overdue ? t.danger : t.sub, fontSize: 13, marginTop: 3 }}>
                  {a.status === 'done' ? (a.grade != null && a.points ? `Graded ${a.grade}/${a.points}` : 'Turned in') : dueLabel(a.due)}
                  {a.status !== 'done' && a.points ? ` · ${a.points} pts` : ''}
                </Text>
              </View>
              {a.status !== 'done' ? (
                <Pressable onPress={() => takeNotes(a)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 11, borderRadius: 16, backgroundColor: t.chip }}>
                  <Icon name="square.and.pencil" size={14} color={t.accent} />
                  <Text style={{ color: t.accent, fontSize: 13, fontWeight: '700' }}>Take notes</Text>
                </Pressable>
              ) : null}
              <Icon name="chevron.right" size={14} color={t.faint} />
            </Pressable>
          );
        }} />
      <ConfirmSheet visible={signOut} title="Disconnect Google Classroom?" message="Quill forgets your Google sign-in. Your notes stay." confirm="Disconnect" onCancel={() => setSignOut(false)}
        onConfirm={async () => { setSignOut(false); await disconnect(); setEmail(null); setData(null); }} />
    </View>
  );
}
