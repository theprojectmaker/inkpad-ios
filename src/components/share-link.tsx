// Share settings: a link to a PDF copy of this note, which people can read and comment on.
// Nothing leaves the iPad until "Create link" is tapped. Links last 30 days and can be stopped.
import { fetch as sendFile } from 'expo/fetch';
import { File } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, Text, View } from 'react-native';

import { APP_TOKEN } from '@/lib/ai';
import { fsx } from '@/lib/fsx';
import { useLibrary } from '@/lib/library';
import { copyText } from '@/lib/ondevice';
import { useTheme } from '@/lib/settings';
import { Sheet, useToast } from './ui';

const SITE = 'https://quill-study.pages.dev';
const OFF = "Sharing links aren't available right now. Send the PDF instead.";

type Viewer = { name: string; text: string; at: number };

async function upload(pdfPath: string, title: string, link?: { id: string; secret: string }) {
  const q = `title=${encodeURIComponent(title)}${link ? `&id=${link.id}&secret=${encodeURIComponent(link.secret)}` : ''}`;
  const bytes = await new File(fsx.uri(pdfPath)).bytes();
  const r = await sendFile(`${SITE}/api/share?${q}`, { method: 'POST', headers: { 'content-type': 'application/pdf', 'x-quill-app': APP_TOKEN }, body: bytes });
  const d = await r.json().catch(() => null);
  if (!d) throw new Error(OFF);
  if (!d.ok) throw new Error(d.error || OFF);
  return d as { id: string; secret: string; url: string; expires: number };
}

export function ShareLinkSheet({ visible, noteId, title, makePdf, onSendPdf, onClose }: {
  visible: boolean; noteId: string; title: string; makePdf: () => Promise<string>; onSendPdf: () => void; onClose: () => void;
}) {
  const t = useTheme();
  const lib = useLibrary();
  const { toast } = useToast();
  const link = lib.meta(noteId)?.link;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [comments, setComments] = useState<Viewer[]>([]);

  useEffect(() => {
    if (!visible) return;
    setError('');
    setComments([]);
    if (!link) return;
    if (link.expires < Date.now()) { lib.updateNote(noteId, { link: undefined }); return; }
    fetch(`${SITE}/api/share/${link.id}?secret=${encodeURIComponent(link.secret)}`)
      .then(async (r) => {
        if (r.status === 404) { lib.updateNote(noteId, { link: undefined }); return; }
        const d = await r.json();
        if (d.ok) setComments(d.comments);
      }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const send = async (again: boolean) => {
    setBusy(true);
    setError('');
    try {
      const path = await makePdf();
      const d = await upload(path, title, again ? link : undefined);
      lib.updateNote(noteId, { link: { id: d.id, secret: d.secret, url: d.url, expires: d.expires } });
      if (again) toast('The link now shows this version.');
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      setError(/network|fetch|connection/i.test(msg) ? 'No internet connection. Try again when you\'re online.' : msg);
    } finally { setBusy(false); }
  };

  const stop = async () => {
    if (!link) return;
    setBusy(true);
    try {
      const r = await fetch(`${SITE}/api/share/${link.id}?secret=${encodeURIComponent(link.secret)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('no');
      lib.updateNote(noteId, { link: undefined });
      toast('Sharing stopped. The link no longer works.');
    } catch { setError("Couldn't stop sharing without internet, so the link still works. Try again when you're online."); }
    finally { setBusy(false); }
  };

  const btn = (label: string, onPress: () => void, solid = false, danger = false) => (
    <Pressable key={label} accessibilityLabel={label} onPress={onPress} disabled={busy} style={({ pressed }) => ({ height: 42, borderRadius: 10, justifyContent: 'center', alignItems: 'center', opacity: pressed || busy ? 0.6 : 1, backgroundColor: solid ? '#3F6AF2' : t.chip })}>
      <Text style={{ color: solid ? '#fff' : danger ? t.danger : t.text, fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );

  return (
    <Sheet visible={visible} onClose={onClose} title="Share settings" width={440}>
      <View style={{ gap: 10 }}>
        {link ? (
          <>
            <Text selectable numberOfLines={2} style={{ color: t.text, fontSize: 14, padding: 10, borderRadius: 10, backgroundColor: t.chip }}>{link.url}</Text>
            <Text style={{ color: t.sub, fontSize: 13 }}>Anyone with this link can read a copy of this note and comment until {new Date(link.expires).toLocaleDateString([], { month: 'long', day: 'numeric' })}. Later changes only show after you update it.</Text>
            {btn('Share link', () => { Share.share({ url: link.url, message: link.url }).catch(() => {}); }, true)}
            {btn('Copy link', () => { copyText(link.url); toast('Link copied'); })}
            {btn('Update the shared copy', () => send(true))}
            {comments.length ? (
              <View>
                <Text style={{ color: t.text, fontSize: 15, fontWeight: '600', marginTop: 6, marginBottom: 6 }}>Comments from the link</Text>
                <ScrollView style={{ maxHeight: 180 }} contentContainerStyle={{ gap: 8 }}>
                  {comments.map((c, i) => (
                    <View key={i}>
                      <Text style={{ color: t.sub, fontSize: 12 }}>{c.name} · {new Date(c.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</Text>
                      <Text style={{ color: t.text, fontSize: 15 }}>{c.text}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            ) : null}
            {btn('Stop sharing', stop, false, true)}
          </>
        ) : (
          <>
            <Text style={{ color: t.sub, fontSize: 14, lineHeight: 20 }}>Creates a link to a PDF copy of this note on the internet. Anyone who has the link can read it and leave comments, for 30 days or until you stop sharing.</Text>
            {btn('Create link', () => send(false), true)}
          </>
        )}
        {btn('Send a PDF instead', () => { onClose(); onSendPdf(); })}
        {busy ? <ActivityIndicator color={t.faint} /> : null}
        {error ? <Text style={{ color: t.danger, fontSize: 14 }}>{error}</Text> : null}
      </View>
    </Sheet>
  );
}
