// Notability-style audio: record a class while you write; every stroke remembers when it was
// written. On playback, ink written later shows faintly and fills in as it plays; tap ink to hear
// what was being said. The words appear as they're said, and Record to Notes also keeps notes.
import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { requireNativeModule } from 'expo-modules-core';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, Text, View, type GestureResponderEvent } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { fsx } from '@/lib/fsx';
import type { LiveNotes, NotesSource } from '@/lib/livenotes';
import { liveNow, pauseLive, startLive, stopLive, useLive } from '@/lib/liverec';
import { type Recording, uid } from '@/lib/model';
import { notePath } from '@/lib/noteio';
import { useTheme } from '@/lib/settings';
import { Icon, IconButton } from './ui';

export const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(r).padStart(2, '0');
};

const RATES = [1, 1.25, 1.5, 2, 0.75];
const BLUE = '#3F6AF2';
const RED = '#E5322D';
const plainPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));

/** The recording's words with the second each line starts at (on the iPad where it can be). */
export async function transcribe(noteId: string, r: Recording): Promise<{ t: number; text: string }[]> {
  const native = requireNativeModule<{ transcribe(path: string): Promise<{ t: number; text: string }[]> }>('QuillCanvas');
  return native.transcribe(plainPath(fsx.uri(notePath(noteId, r.file))));
}

export function useNoteAudio(noteId: string, onError: (msg: string) => void) {
  const player = useAudioPlayer(null, { updateInterval: 150 });
  const status = useAudioPlayerStatus(player);
  const [rec, setRec] = useState<{ id: string; started: number } | null>(null);
  const recRef = useRef(rec); recRef.current = rec;
  const [loaded, setLoaded] = useState<Recording | null>(null);
  const [rate, setRate] = useState(1);
  const [marks, setMarks] = useState<number[]>([]);
  const mark = useCallback(() => setMarks((m) => [...m, liveNow().elapsed]), []);
  const marksRef = useRef(marks); marksRef.current = marks;

  const stopping = useRef<Promise<unknown> | null>(null);
  const start = useCallback(async () => {
    try {
      await stopping.current;
      const p = await requestRecordingPermissionsAsync();
      if (!p.granted) { onError('Allow the microphone for Quill in Settings to record.'); return false; }
      if (player.playing) player.pause();
      const id = uid('r');
      await startLive(plainPath(fsx.uri(notePath(noteId, `rec_${id}.m4a`))));
      setMarks([]);
      setRec({ id, started: Date.now() });
      return true;
    } catch (e) { onError("Couldn't start recording: " + String((e as Error)?.message ?? e)); return false; }
  }, [player, noteId, onError]);

  /** Stops. The sound is already in the note's folder. */
  const stop = useCallback(async (): Promise<Recording | null> => {
    const r = recRef.current;
    if (!r) return null;
    setRec(null);
    const work = (async (): Promise<Recording | null> => {
      try {
        const out = await stopLive();
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
        return { id: r.id, file: `rec_${r.id}.m4a`, dur: out.dur || Date.now() - r.started, created: r.started, transcript: out.lines, marks: marksRef.current, pauses: out.pauses };
      } catch (e) { onError("Couldn't save the recording: " + String((e as Error)?.message ?? e)); return null; }
    })();
    stopping.current = work;
    return work;
  }, [onError]);

  const load = useCallback((r: Recording) => {
    if (loaded?.id === r.id) return;
    player.replace({ uri: fsx.uri(notePath(noteId, r.file)) });
    player.setPlaybackRate(rate);
    setLoaded(r);
  }, [loaded, player, rate, noteId]);

  const unload = useCallback(() => { try { player.pause(); } catch {} setLoaded(null); }, [player]);

  const toggle = useCallback(() => {
    if (!loaded) return;
    if (status.playing) player.pause();
    else {
      if (status.duration > 0 && status.currentTime >= status.duration - 0.2) player.seekTo(0);
      player.play();
    }
  }, [loaded, status.playing, status.duration, status.currentTime, player]);

  const seek = useCallback((ms: number) => { player.seekTo(Math.max(0, ms / 1000)); }, [player]);
  const play = useCallback(() => { try { player.play(); } catch {} }, [player]);

  const cycleRate = useCallback(() => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    try { player.setPlaybackRate(next); } catch {}
  }, [rate, player]);

  return { rec, loaded, status, rate, marks, mark, start, stop, load, unload, toggle, seek, play, cycleRate };
}

export type NoteAudio = ReturnType<typeof useNoteAudio>;

function Scrubber({ pos, dur, onSeek }: { pos: number; dur: number; onSeek: (ms: number) => void }) {
  const t = useTheme();
  const w = useRef(1);
  const at = (e: GestureResponderEvent) => onSeek(Math.max(0, Math.min(1, e.nativeEvent.locationX / w.current)) * dur);
  const f = dur > 0 ? Math.max(0, Math.min(1, pos / dur)) : 0;
  return (
    <View onLayout={(e) => { w.current = Math.max(1, e.nativeEvent.layout.width); }} style={{ flex: 1, height: 30, justifyContent: 'center', minWidth: 100 }}
      accessibilityLabel="Recording position" onStartShouldSetResponder={() => true} onResponderGrant={at} onResponderMove={at}>
      <View pointerEvents="none" style={{ height: 3, borderRadius: 2, backgroundColor: t.line }}>
        <View style={{ width: `${f * 100}%`, height: 3, borderRadius: 2, backgroundColor: BLUE }} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: `${f * 100}%`, marginLeft: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: BLUE }} />
    </View>
  );
}

/** One bar of the sound meter: moves softly, so a teacher's voice doesn't make it jump around. */
function MeterBar({ level, shape }: { level: number; shape: number }) {
  const h = useSharedValue(4);
  useEffect(() => { h.value = withTiming(4 + level * shape * 18, { duration: 180 }); }, [level, shape, h]);
  const style = useAnimatedStyle(() => ({ height: h.value }));
  return <Animated.View style={[{ width: 3, borderRadius: 2, backgroundColor: RED }, style]} />;
}

function Meter() {
  const { level, paused } = useLive();
  const l = paused ? 0 : level;
  return (
    <View accessibilityLabel="Sound level" style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 26, paddingHorizontal: 4 }}>
      {[0.55, 0.85, 1, 0.7, 0.45].map((shape, i) => <MeterBar key={i} level={l} shape={shape} />)}
    </View>
  );
}

function RecordingBar({ onStop, onMark, toNotes, panelOpen, onPanel }: { onStop: () => void; onMark: () => void; toNotes: boolean; panelOpen: boolean; onPanel: () => void }) {
  const t = useTheme();
  const live = useLive();
  const lastLine = live.lines.length ? live.lines[live.lines.length - 1].text : '';
  const words = live.partial || lastLine;
  const hint = live.note || (live.paused ? 'Paused' : words || (live.speech === 'off' ? 'Recording. Live text is off: allow Speech Recognition in Settings.' : 'Listening…'));
  return (
    <>
      <Pressable onPress={onStop} accessibilityLabel="Stop recording" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 13, borderRadius: 18, backgroundColor: RED }}>
        <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#fff' }} />
        <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14, fontVariant: ['tabular-nums'] }}>{fmtTime(live.elapsed)}</Text>
      </Pressable>
      <IconButton name={live.paused ? 'record.circle' : 'pause.fill'} label={live.paused ? 'Resume recording' : 'Pause recording'} onPress={() => pauseLive(!live.paused)} color="#3B4252" />
      <Meter />
      <Text numberOfLines={1} ellipsizeMode="head" style={{ flex: 1, color: words && !live.note ? t.text : t.faint, fontSize: 14, paddingHorizontal: 6 }}>{hint}</Text>
      <IconButton name="bookmark" label="Mark this moment" onPress={onMark} color="#3B4252" />
      <IconButton name={toNotes ? 'sparkles' : 'text.quote'} label={toNotes ? 'Show live notes' : 'Show the words'} active={panelOpen} onPress={onPanel} color={panelOpen ? undefined : '#3B4252'} />
    </>
  );
}

export function AudioBar({ audio, noteId, recs, toNotes, panelOpen, onPanel, onStartRec, onStopRec, onDelete, onClose }: {
  audio: NoteAudio; noteId: string; recs: Recording[]; toNotes: boolean; panelOpen: boolean; onPanel: () => void;
  onStartRec: (toNotes: boolean) => void; onStopRec: () => void; onDelete: (id: string) => void; onClose: () => void;
}) {
  const t = useTheme();
  const cur = audio.loaded;
  const recording = !!audio.rec;

  // Opens on the newest recording.
  useEffect(() => {
    if (!recording && !cur && recs.length) audio.load(recs[recs.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs.length, recording]);

  const dur = cur ? Math.max(cur.dur, audio.status.duration * 1000) : 0;
  const pos = cur ? audio.status.currentTime * 1000 : 0;

  const startButton = (label: string, a11y: string, toNotesNow: boolean, solid: boolean, icon?: string) => (
    <Pressable onPress={() => onStartRec(toNotesNow)} accessibilityLabel={a11y} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 7, height: 36, paddingHorizontal: 13, borderRadius: 18, opacity: pressed ? 0.75 : 1, backgroundColor: solid ? BLUE : t.chip })}>
      {icon ? <Icon name={icon} size={15} color="#fff" /> : <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: RED }} />}
      {label ? <Text style={{ color: solid ? '#fff' : t.text, fontWeight: '600', fontSize: 14 }}>{label}</Text> : null}
    </Pressable>
  );

  return (
    <Animated.View entering={FadeIn.duration(130)} pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: 16, alignItems: 'center', zIndex: 6 }}>
      <View style={{ width: cur || recording ? '100%' : undefined, maxWidth: 760, height: 52, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, borderRadius: 16, backgroundColor: t.elev,
        borderWidth: t.dark ? 1 : 0, borderColor: t.line, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
        {recording ? <RecordingBar onStop={onStopRec} onMark={audio.mark} toNotes={toNotes} panelOpen={panelOpen} onPanel={onPanel} /> : cur ? (
          <>
            {startButton('', 'Record', false, false)}
            <IconButton name="gobackward.15" label="Back 15 seconds" onPress={() => audio.seek(Math.max(0, pos - 15000))} />
            <IconButton name={audio.status.playing ? 'pause.fill' : 'play.fill'} label={audio.status.playing ? 'Pause' : 'Play'} onPress={audio.toggle} />
            <IconButton name="goforward.15" label="Forward 15 seconds" onPress={() => audio.seek(Math.min(dur, pos + 15000))} />
            <Text style={{ color: t.sub, fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 38, textAlign: 'right' }}>{fmtTime(pos)}</Text>
            <Scrubber pos={pos} dur={dur} onSeek={audio.seek} />
            <Text style={{ color: t.sub, fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 38 }}>{fmtTime(dur)}</Text>
            <Pressable onPress={audio.cycleRate} accessibilityLabel="Playback speed" style={{ paddingHorizontal: 8, height: 28, borderRadius: 8, justifyContent: 'center', backgroundColor: t.chip }}>
              <Text style={{ color: t.text, fontSize: 13, fontWeight: '600' }}>{audio.rate}×</Text>
            </Pressable>
            {recs.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, maxWidth: 110 }} contentContainerStyle={{ gap: 4, alignItems: 'center' }}>
                {recs.map((r, i) => (
                  <Pressable key={r.id} onPress={() => audio.load(r)} accessibilityLabel={`Recording ${i + 1}`} style={{ height: 26, minWidth: 26, paddingHorizontal: 7, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: cur.id === r.id ? BLUE : t.chip }}>
                    <Text style={{ color: cur.id === r.id ? '#fff' : t.text, fontSize: 12, fontWeight: '600' }}>{i + 1}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            <IconButton name="text.quote" label="Transcript" active={panelOpen} onPress={onPanel} />
            {Platform.OS !== 'web' ? <IconButton name="square.and.arrow.up" label="Share audio" onPress={() => Sharing.shareAsync(fsx.uri(notePath(noteId, cur.file)), { mimeType: 'audio/mp4', UTI: 'public.mpeg-4-audio' }).catch(() => {})} /> : null}
            <IconButton name="trash" label="Delete recording" onPress={() => onDelete(cur.id)} />
            <IconButton name="xmark" label="Close audio" onPress={onClose} />
          </>
        ) : (
          <>
            {startButton('Record', 'Record', false, false)}
            {startButton('Record to Notes', 'Record to Notes', true, true, 'sparkles')}
            <IconButton name="xmark" label="Close audio" onPress={onClose} />
          </>
        )}
      </View>
    </Animated.View>
  );
}

const SOURCE: Record<NotesSource, string> = { online: 'Using AI online', device: 'Using AI on this iPad', basic: 'Offline: picking out the key points' };

function Tabs({ tabs, at, onPick }: { tabs: string[]; at: number; onPick: (i: number) => void }) {
  const t = useTheme();
  const x = useSharedValue(at);
  const w = useRef(0);
  const [width, setWidth] = useState(0);
  useEffect(() => { x.value = withTiming(at, { duration: 150 }); }, [at, x]);
  const slider = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * (width / tabs.length) }] }));
  return (
    <View onLayout={(e) => { w.current = e.nativeEvent.layout.width; setWidth(w.current); }} style={{ flexDirection: 'row', height: 32, marginHorizontal: 14, marginBottom: 8, borderRadius: 9, backgroundColor: t.chip, padding: 2 }}>
      {width ? <Animated.View style={[{ position: 'absolute', top: 2, left: 2, bottom: 2, width: width / tabs.length - 4, borderRadius: 7, backgroundColor: t.elev, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }, slider]} /> : null}
      {tabs.map((label, i) => (
        <Pressable key={label} onPress={() => onPick(i)} accessibilityLabel={label} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: i === at ? t.text : t.sub, fontSize: 13, fontWeight: '600' }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function SaidList({ lines, partial, pos, onSeek, empty }: { lines: { t: number; text: string }[]; partial?: string; pos: number; onSeek: (ms: number) => void; empty: string }) {
  const t = useTheme();
  return (
    <FlatList data={lines} keyExtractor={(_, i) => String(i)} contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 90 }}
      ListEmptyComponent={partial ? null : <Text style={{ color: t.faint, fontSize: 14, textAlign: 'center', marginTop: 20, paddingHorizontal: 16 }}>{empty}</Text>}
      ListFooterComponent={partial ? <Text style={{ color: t.sub, fontSize: 15, lineHeight: 21, padding: 8 }}>{partial}</Text> : null}
      renderItem={({ item, index }) => {
        const next = lines[index + 1]?.t ?? Infinity;
        const on = pos / 1000 >= item.t && pos / 1000 < next;
        return (
          <Pressable onPress={() => onSeek(item.t * 1000)} style={{ flexDirection: 'row', gap: 10, padding: 8, borderRadius: 8, backgroundColor: on ? BLUE + '1F' : 'transparent' }}>
            <Text style={{ color: t.faint, fontSize: 12, width: 36, marginTop: 2, fontVariant: ['tabular-nums'] }}>{fmtTime(item.t * 1000)}</Text>
            <Text style={{ flex: 1, color: t.text, fontSize: 15, lineHeight: 21 }}>{item.text}</Text>
          </Pressable>
        );
      }} />
  );
}

/** Notes and words for a class, while it's being recorded and after. */
export function ClassPanel({ live, toNotes, rec, busy, pos, marks, onMake, onSeek, onClose }: {
  live: LiveNotes | null; toNotes: boolean; rec: Recording | null; busy: boolean; pos: number; marks?: number[]; onMake: () => void; onSeek: (ms: number) => void; onClose: () => void;
}) {
  const t = useTheme();
  const words = useLive();
  const recording = !!live;
  const notes = live ? live.notes : rec?.notes ?? [];
  const hasNotes = recording ? toNotes : !!rec?.notes;
  const [tab, setTab] = useState(0);
  const showing = hasNotes ? tab : 1;
  const lines = recording ? words.lines : rec?.transcript;

  return (
    <Animated.View entering={FadeIn.duration(130)} style={{ width: 340, backgroundColor: t.side, borderLeftWidth: 1, borderLeftColor: t.line, paddingTop: 76 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingLeft: 16, paddingBottom: 6 }}>
        <Text style={{ flex: 1, color: t.text, fontSize: 17, fontWeight: '600' }}>{hasNotes ? 'Class notes' : 'Transcript'}</Text>
        <IconButton name="xmark" label="Close transcript" onPress={onClose} />
      </View>
      {hasNotes ? <Tabs tabs={['Notes', 'What was said']} at={tab} onPick={setTab} /> : null}
      {marks?.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 8 }} contentContainerStyle={{ paddingHorizontal: 14, gap: 6 }}>
          {marks.map((m, i) => (
            <Animated.View key={i} entering={FadeIn.duration(200)}>
              <Pressable accessibilityLabel={`Mark at ${fmtTime(m)}`} onPress={() => { if (!recording) onSeek(m); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 26, paddingHorizontal: 9, borderRadius: 13, backgroundColor: t.chip }}>
                <Icon name="bookmark.fill" size={10} color={BLUE} />
                <Text style={{ color: t.text, fontSize: 12, fontVariant: ['tabular-nums'] }}>{fmtTime(m)}</Text>
              </Pressable>
            </Animated.View>
          ))}
        </ScrollView>
      ) : null}

      {showing === 0 ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 90, gap: 10 }}>
          {live?.now ? (
            <Animated.View key={live.now} entering={FadeIn.duration(260)} style={{ padding: 12, borderRadius: 12, backgroundColor: BLUE + '14' }}>
              <Text style={{ color: BLUE, fontSize: 12, fontWeight: '600', marginBottom: 4 }}>Right now</Text>
              <Text style={{ color: t.text, fontSize: 15, lineHeight: 21 }}>{live.now}</Text>
            </Animated.View>
          ) : null}
          {notes.map((n, i) => (
            <Animated.View key={`${i}-${n.text}`} entering={FadeIn.duration(200)}>
              <Pressable onPress={() => { if (!recording) onSeek(n.t * 1000); }} accessibilityLabel={n.text} style={{ flexDirection: 'row', gap: 8, paddingVertical: 2 }}>
                <Text style={{ color: t.faint, fontSize: 15, lineHeight: 21 }}>•</Text>
                <Text style={{ flex: 1, color: t.text, fontSize: 15, lineHeight: 21 }}>{n.text}</Text>
              </Pressable>
            </Animated.View>
          ))}
          {!notes.length ? (
            <Text style={{ color: t.faint, fontSize: 14, lineHeight: 20, marginTop: 8 }}>
              {recording ? 'Keep writing as usual. Notes appear here as the teacher talks, and go on a page in this note when you stop.' : 'No notes came out of this recording.'}
            </Text>
          ) : null}
          {live?.busy ? <ActivityIndicator color={t.faint} style={{ alignSelf: 'flex-start' }} /> : null}
          {live?.source ? <Text style={{ color: t.faint, fontSize: 12, marginTop: 4 }}>{SOURCE[live.source]}</Text> : null}
        </ScrollView>
      ) : lines || recording ? (
        <SaidList lines={lines ?? []} partial={recording ? words.partial : undefined} pos={recording ? -1 : pos} onSeek={(ms) => { if (!recording) onSeek(ms); }}
          empty={recording ? 'Words appear here as they’re said.' : 'No words were heard in this recording.'} />
      ) : (
        <View style={{ alignItems: 'center', padding: 24, gap: 14 }}>
          <Icon name="text.quote" size={28} color={t.faint} />
          <Text style={{ color: t.sub, fontSize: 14, textAlign: 'center' }}>Turns this recording into text you can read and search.</Text>
          {busy ? <ActivityIndicator color={BLUE} /> : (
            <Pressable onPress={onMake} accessibilityLabel="Make transcript" style={({ pressed }) => ({ height: 40, paddingHorizontal: 18, borderRadius: 10, backgroundColor: BLUE, justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Make transcript</Text>
            </Pressable>
          )}
        </View>
      )}
    </Animated.View>
  );
}
