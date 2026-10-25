// Notability-style audio: record a lecture while you write; every stroke is
// stamped with its moment in the recording. On playback, ink written later
// shows faint and fills in as the audio plays; tap ink to jump the audio there.
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder } from 'expo-audio';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View, type GestureResponderEvent } from 'react-native';

import { fsx } from '@/lib/fsx';
import { type NoteDoc, type Recording, uid } from '@/lib/model';
import { loadDoc, notePath, saveDoc } from '@/lib/noteio';
import { useTheme } from '@/lib/settings';
import type { Replay } from '@/lib/skia-render';
import { IconButton } from './ui';

export const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(r).padStart(2, '0');
};

const RATES = [1, 1.25, 1.5, 2, 0.75];

export function useNoteAudio(onError: (msg: string) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer(null, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);
  const [rec, setRec] = useState<{ id: string; noteId: string; started: number } | null>(null);
  const recRef = useRef(rec); recRef.current = rec;
  const [loaded, setLoaded] = useState<{ noteId: string; rec: Recording } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [rate, setRate] = useState(1);

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [rec]);

  const start = useCallback(async (noteId: string) => {
    try {
      const p = await requestRecordingPermissionsAsync();
      if (!p.granted) { onError('Allow microphone access in Settings to record.'); return false; }
      if (player.playing) player.pause();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRec({ id: uid('r'), noteId, started: Date.now() });
      return true;
    } catch (e) { onError("Couldn't start recording: " + String((e as Error)?.message ?? e)); return false; }
  }, [player, recorder, onError]);

  /** Stops and copies the audio into the note folder. */
  const stop = useCallback(async (): Promise<{ noteId: string; rec: Recording } | null> => {
    const r = recRef.current;
    if (!r) return null;
    setRec(null);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri) throw new Error('no file');
      const file = `rec_${r.id}.${Platform.OS === 'web' ? 'webm' : 'm4a'}`;
      await fsx.copyIn(uri, notePath(r.noteId, file));
      return { noteId: r.noteId, rec: { id: r.id, file, dur: Date.now() - r.started, created: r.started } };
    } catch (e) { onError("Couldn't save the recording: " + String((e as Error)?.message ?? e)); return null; }
  }, [recorder, onError]);

  const load = useCallback((noteId: string, r: Recording) => {
    if (loaded?.rec.id === r.id) return;
    player.replace({ uri: fsx.uri(notePath(noteId, r.file)) });
    player.setPlaybackRate(rate);
    setLoaded({ noteId, rec: r });
  }, [loaded, player, rate]);

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

  const cycleRate = useCallback(() => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    try { player.setPlaybackRate(next); } catch {}
  }, [rate, player]);

  // For stamping strokes: only ink in the note being recorded gets a time.
  const stampFor = useCallback((noteId: string) => () => {
    const r = recRef.current;
    return r && r.noteId === noteId ? [r.id, Date.now() - r.started] as [string, number] : null;
  }, []);

  const replayFor = (noteId: string): Replay => (loaded && loaded.noteId === noteId ? { rec: loaded.rec.id, ms: status.currentTime * 1000 } : null);

  return { rec, recElapsed: rec ? now - rec.started : 0, loaded, status, rate, start, stop, load, unload, toggle, seek, cycleRate, stampFor, replayFor };
}

export type NoteAudio = ReturnType<typeof useNoteAudio>;

/** Adds a finished recording to a note that isn't open in a pane any more. */
export async function addRecordingOnDisk(noteId: string, r: Recording) {
  const d = await loadDoc(noteId);
  if (!d) return 0;
  const nd: NoteDoc = { ...d, recordings: [...(d.recordings ?? []), r] };
  await saveDoc(nd);
  return nd.recordings!.length;
}

function Scrubber({ pos, dur, onSeek }: { pos: number; dur: number; onSeek: (ms: number) => void }) {
  const t = useTheme();
  const w = useRef(1);
  const at = (e: GestureResponderEvent) => onSeek(Math.max(0, Math.min(1, e.nativeEvent.locationX / w.current)) * dur);
  const f = dur > 0 ? Math.max(0, Math.min(1, pos / dur)) : 0;
  return (
    <View onLayout={(e) => { w.current = Math.max(1, e.nativeEvent.layout.width); }} style={{ flex: 1, height: 30, justifyContent: 'center', minWidth: 120 }}
      onStartShouldSetResponder={() => true} onResponderGrant={at} onResponderMove={at}>
      <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: t.line }}>
        <View style={{ width: `${f * 100}%`, height: 4, borderRadius: 2, backgroundColor: t.accent }} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: `${f * 100}%`, marginLeft: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: t.accent }} />
    </View>
  );
}

export function AudioBar({ audio, noteId, doc, onStartRec, onStopRec, onDelete }: {
  audio: NoteAudio; noteId: string; doc: NoteDoc | null; onStartRec: () => void; onStopRec: () => void; onDelete: (id: string) => void;
}) {
  const t = useTheme();
  const recs = doc?.recordings ?? [];
  const cur = audio.loaded && audio.loaded.noteId === noteId ? audio.loaded.rec : null;
  const recording = !!audio.rec;
  const recHere = audio.rec?.noteId === noteId;

  // Open the newest recording by default.
  useEffect(() => {
    if (!recording && !cur && recs.length) audio.load(noteId, recs[recs.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, recs.length, recording]);

  const dur = cur ? Math.max(cur.dur, audio.status.duration * 1000) : 0;
  const pos = cur ? audio.status.currentTime * 1000 : 0;

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: 16, alignItems: 'center', zIndex: 6 }}>
    <View style={{ width: '100%', maxWidth: 780, height: 54, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderRadius: 27, backgroundColor: t.elev,
      borderWidth: t.dark ? 1 : 0, borderColor: t.line, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}>
      {recording ? (
        <Pressable onPress={onStopRec} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: '#E5322D' }}>
          <View style={{ width: 11, height: 11, borderRadius: 2, backgroundColor: '#fff' }} />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14, fontVariant: ['tabular-nums'] }}>{fmtTime(audio.recElapsed)}</Text>
          <Text style={{ color: '#ffffffcc', fontSize: 13 }}>{recHere ? 'Recording' : 'Recording in another note'}</Text>
        </Pressable>
      ) : (
        <Pressable onPress={onStartRec} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: pressed ? t.chip : t.card, borderWidth: 1, borderColor: t.line })}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#E5322D' }} />
          <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }}>Record</Text>
        </Pressable>
      )}
      {cur ? (
        <>
          <IconButton name={audio.status.playing ? 'pause.fill' : 'play.fill'} label={audio.status.playing ? 'Pause' : 'Play'} onPress={audio.toggle} />
          <Text style={{ color: t.sub, fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 40 }}>{fmtTime(pos)}</Text>
          <Scrubber pos={pos} dur={dur} onSeek={audio.seek} />
          <Text style={{ color: t.sub, fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 40 }}>{fmtTime(dur)}</Text>
          <Pressable onPress={audio.cycleRate} style={{ paddingHorizontal: 8, height: 30, borderRadius: 8, justifyContent: 'center', backgroundColor: t.chip }}>
            <Text style={{ color: t.text, fontSize: 13, fontWeight: '700' }}>{audio.rate}×</Text>
          </Pressable>
        </>
      ) : (
        <Text style={{ flex: 1, color: t.faint, fontSize: 13 }} numberOfLines={1}>
          {recording ? 'Write as usual: your ink is linked to the audio.' : 'Record a class while you write. Play it back and the ink replays with it.'}
        </Text>
      )}
      {recs.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, maxWidth: 260 }} contentContainerStyle={{ gap: 6, alignItems: 'center' }}>
          {recs.map((r, i) => (
            <Pressable key={r.id} onPress={() => audio.load(noteId, r)} style={{ height: 30, paddingHorizontal: 10, borderRadius: 15, justifyContent: 'center', backgroundColor: cur?.id === r.id ? t.accent : t.chip }}>
              <Text style={{ color: cur?.id === r.id ? '#fff' : t.text, fontSize: 12, fontWeight: '600' }}>#{i + 1} · {fmtTime(r.dur)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {cur ? (
        <>
          {Platform.OS !== 'web' ? <IconButton name="square.and.arrow.up" label="Share audio" onPress={() => Sharing.shareAsync(fsx.uri(notePath(noteId, cur.file)), { mimeType: 'audio/mp4', UTI: 'public.mpeg-4-audio' }).catch(() => {})} /> : null}
          <IconButton name="trash" label="Delete recording" onPress={() => { audio.unload(); onDelete(cur.id); }} />
        </>
      ) : null}
    </View>
    </View>
  );
}
