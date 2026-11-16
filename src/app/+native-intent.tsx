// The share extension opens the app with a private link (inkpad://dataUrl=...).
// It is not a screen, so send it to the library; ShareReceiver then imports the files.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (path.includes('dataUrl=')) return '/';
  // "Continue to Quill note" from the Share to Quill screen: ShareReceiver imports what it left and opens the note.
  if (/^(inkpad:\/\/)?\/?import\b/.test(path)) return '/';
  return path;
}
