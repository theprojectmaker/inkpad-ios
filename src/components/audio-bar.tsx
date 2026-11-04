// Notability-style audio: record a class while you write; every stroke remembers
// when it was written. On playback, ink written later shows faintly and fills in
// as it plays; tap ink to hear what was being said; read and search a transcript.
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder } from 'expo-audio';
import { requireNativeModule } from 'expo-modules-core';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, Text, View, type GestureResponderEvent } from 'react-native';

import { fsx } from '@/lib/fsx';
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

/** The recording's words with the second each line starts at (on the iPad where it can be). */
export async function transcribe(noteId: string, r: Recording): Promise<{ t: number; text: string }[]> {
  const native = requireNativeModule<{ transcribe(path: string): Promise<{ t: number; text: string }[]> }>('QuillCanvas');
  return native.transcribe(decodeURIComponent(fsx.uri(notePath(noteId, r.file)).replace(/^file:\/\//, '')));
}

export function useNoteAudio(noteId: string, onError: (msg: string) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer(null, { updateInterval: 150 });
  const status = useAudioPlayerStatus(player);
  const [rec, setRec] = useState<{ id: string; started: number } | null>(null);
  const recRef = useRef(rec); recRef.current = rec;
  const [loaded, setLoaded] = useState<Recording | null>(null);
  const [now, setNow] = useState(Date.now());
  const [rate, setRate] = useState(1);

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [rec]);

  const start = useCallback(async () => {
    try {
      const p = await requestRecordingPermissionsAsync();
      if (!p.granted) { onError('Allow the microphone for Quill in Settings to record.'); return false; }
      if (player.playing) player.pause();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRec({ id: uid('r'), started: Date.now() });
      return true;
    } catch (e) { onError("Couldn't start recording: " + String((e as Error)?.message ?? e)); return false; }
  }, [player, recorder, onError]);

  /** Stops and moves the audio into the note folder. */
  const stop = useCallback(async (): Promise<Recording | null> => {
    const r = recRef.current;
    if (!r) return null;
    setRec(null);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri) throw new Error('no file');
      const file = `rec_${r.id}.m4a`;
      await fsx.copyIn(uri, notePath(noteId, file));
      return { id: r.id, file, dur: Date.now() - r.started, created: r.started };
    } catch (e) { onError("Couldn't save the recording: " + String((e as Error)?.message ?? e)); return null; }
  }, [recorder, noteId, onError]);

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

  return { rec, recElapsed: rec ? now - rec.started : 0, loaded, status, rate, start, stop, load, unload, toggle, seek, play, cycleRate };
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
      <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: t.line }}>
        <View style={{ width: `${f * 100}%`, height: 4, borderRadius: 2, backgroundColor: t.accent }} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: `${f * 100}%`, marginLeft: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: t.accent }} />
    </View>
  );
}

export function AudioBar({ audio, noteId, recs, onStartRec, onStopRec, onDelete, onTranscript, onClose }: {
  audio: NoteAudio; noteId: string; recs: Recording[]; onStartRec: () => void; onStopRec: () => void; onDelete: (id: string) => void; onTranscript: () => void; onClose: () => void;
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

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: 16, alignItems: 'center', zIndex: 6 }}>
      <View style={{ width: '100%', maxWidth: 820, height: 54, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderRadius: 27, backgroundColor: t.elev,
        borderWidth: t.dark ? 1 : 0, borderColor: t.line, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}>
        {recording ? (
          <Pressable onPress={onStopRec} accessibilityLabel="Stop recording" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: '#E5322D' }}>
            <View style={{ width: 11, height: 11, borderRadius: 2, backgroundColor: '#fff' }} />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14, fontVariant: ['tabular-nums'] }}>{fmtTime(audio.recElapsed)}</Text>
          </Pressable>
        ) : (
          <Pressable onPress={onStartRec} accessibilityLabel="Record" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: pressed ? t.chip : t.card, borderWidth: 1, borderColor: t.line })}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#E5322D' }} />
            <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }}>Record</Text>
          </Pressable>
        )}
        {cur && !recording ? (
          <>
            <IconButton name="gobackward.15" label="Back 15 seconds" onPress={() => audio.seek(Math.max(0, pos - 15000))} />
            <IconButton name={audio.status.playing ? 'pause.fill' : 'play.fill'} label={audio.status.playing ? 'Pause' : 'Play'} onPress={audio.toggle} />
            <IconButton name="goforward.15" label="Forward 15 seconds" onPress={() => audio.seek(Math.min(dur, pos + 15000))} />
            <Text style={{ color: t.sub, fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 38, textAlign: 'right' }}>{fmtTime(pos)}</Text>
            <Scrubber pos={pos} dur={dur} onSeek={audio.seek} />
            <Text style={{ color: t.sub, fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 38 }}>{fmtTime(dur)}</Text>
            <Pressable onPress={audio.cycleRate} accessibilityLabel="Playback speed" style={{ paddingHorizontal: 8, height: 30, borderRadius: 8, justifyContent: 'center', backgroundColor: t.chip }}>
              <Text style={{ color: t.text, fontSize: 13, fontWeight: '700' }}>{audio.rate}×</Text>
            </Pressable>
          </>
        ) : (
          <Text style={{ flex: 1, color: t.faint, fontSize: 13, paddingHorizontal: 6 }} numberOfLines={1}>
            {recording ? 'Write as usual: your ink is linked to the recording.' : 'Record a class while you write. On playback the ink replays with it.'}
          </Text>
        )}
        {recs.length > 1 && !recording ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, maxWidth: 130 }} contentContainerStyle={{ gap: 4, alignItems: 'center' }}>
            {recs.map((r, i) => (
              <Pressable key={r.id} onPress={() => audio.load(r)} accessibilityLabel={`Recording ${i + 1}`} style={{ height: 28, minWidth: 28, paddingHorizontal: 8, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: cur?.id === r.id ? t.accent : t.chip }}>
                <Text style={{ color: cur?.id === r.id ? '#fff' : t.text, fontSize: 12, fontWeight: '700' }}>{i + 1}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {cur && !recording ? (
          <>
            <IconButton name="text.quote" label="Transcript" onPress={onTranscript} />
            {Platform.OS !== 'web' ? <IconButton name="square.and.arrow.up" label="Share audio" onPress={() => Sharing.shareAsync(fsx.uri(notePath(noteId, cur.file)), { mimeType: 'audio/mp4', UTI: 'public.mpeg-4-audio' }).catch(() => {})} /> : null}
            <IconButton name="trash" label="Delete recording" onPress={() => onDelete(cur.id)} />
          </>
        ) : null}
        {!recording ? <IconButton name="xmark" label="Close audio" onPress={onClose} /> : null}
      </View>
    </View>
  );
}

/** What was said: tap a line to hear it. */
export function TranscriptPanel({ rec, busy, pos, onMake, onSeek, onClose }: {
  rec: Recording; busy: boolean; pos: number; onMake: () => void; onSeek: (ms: number) => void; onClose: () => void;
}) {
  const t = useTheme();
  const lines = rec.transcript;
  return (
    <View style={{ width: 340, backgroundColor: t.side, borderLeftWidth: 1, borderLeftColor: t.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10, paddingLeft: 16 }}>
        <Text style={{ flex: 1, color: t.text, fontSize: 17, fontWeight: '700' }}>Transcript</Text>
        <IconButton name="xmark" label="Close transcript" onPress={onClose} />
      </View>
      {!lines ? (
        <View style={{ alignItems: 'center', padding: 24, gap: 14 }}>
          <Icon name="text.quote" size={30} color={t.faint} />
          <Text style={{ color: t.sub, fontSize: 14, textAlign: 'center' }}>Turns this recording into text you can read and search. Done on the iPad when it can be.</Text>
          {busy ? <ActivityIndicator color={t.accent} /> : (
            <Pressable onPress={onMake} accessibilityLabel="Make transcript" style={({ pressed }) => ({ height: 42, paddingHorizontal: 20, borderRadius: 21, backgroundColor: t.accent, justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Make transcript</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList data={lines} keyExtractor={(_, i) => String(i)} contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 90 }}
          ListEmptyComponent={<Text style={{ color: t.faint, fontSize: 14, textAlign: 'center', marginTop: 20 }}>No words were heard in this recording.</Text>}
          renderItem={({ item, index }) => {
            const next = lines[index + 1]?.t ?? Infinity;
            const on = pos / 1000 >= item.t && pos / 1000 < next;
            return (
              <Pressable onPress={() => onSeek(item.t * 1000)} style={{ flexDirection: 'row', gap: 10, padding: 8, borderRadius: 8, backgroundColor: on ? t.accent + '22' : 'transparent' }}>
                <Text style={{ color: t.faint, fontSize: 12, width: 36, marginTop: 2, fontVariant: ['tabular-nums'] }}>{fmtTime(item.t * 1000)}</Text>
                <Text style={{ flex: 1, color: t.text, fontSize: 15, lineHeight: 21 }}>{item.text}</Text>
              </Pressable>
            );
          }} />
      )}
    </View>
  );
}
