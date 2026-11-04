// The writing canvas: Quill's own ink engine (see modules/quill-canvas). Ink,
// eraser, lasso, ruler, palm rejection, scrolling and zoom are all native.
// The browser preview has none of that, so it shows a note instead.
import { requireNativeViewManager } from 'expo-modules-core';
import { forwardRef, type ComponentType, type Ref } from 'react';
import { Platform, Text, View, type ViewProps } from 'react-native';

export type CanvasMark = { x: number; y: number; w: number; h: number; r: number; color: string };
export type CanvasPage = { id: string; w: number; h: number; bg: string; kind: 'paper' | 'pdf' | 'image'; file: string; index: number; marks: CanvasMark[] };
export type LegacyStroke = { pts: number[]; color: string; w: number; hl: boolean };
export type CanvasState = { canUndo: boolean; canRedo: boolean; strokes: number };

export type CanvasHandle = {
  undo(): Promise<void>;
  redo(): Promise<void>;
  save(): Promise<void>;
  focus(): Promise<void>;
  fitWidth(): Promise<void>;
  exportPdf(path: string): Promise<void>;
  snapshot(path: string, width: number): Promise<boolean>;
  scrollToPage(index: number): Promise<void>;
  pageThumb(index: number, path: string, width: number): Promise<boolean>;
  deletePage(index: number): Promise<void>;
  endTextEdit(): Promise<void>;
  insertPageSpace(after: number, height: number): Promise<void>;
  pageIsEmpty(index: number): Promise<boolean>;
  resizePage(index: number, delta: number): Promise<void>;
  styleSelection(color: string, width: number, style: string): Promise<void>;
  setComment(id: string, text: string): Promise<void>;
  movePage(from: number, to: number): Promise<void>;
  duplicatePage(index: number): Promise<void>;
  addPicture(file: string, width: number, height: number): Promise<void>;
  paste(): Promise<void>;
  setAllTape(shown: boolean): Promise<void>;
  clearTape(): Promise<void>;
  flash(page: number, x: number, y: number, w: number, h: number): Promise<void>;
  setReplay(cut: number, from: number, to: number): Promise<void>;
};

export type ToolKind = 'felt' | 'pen' | 'fountain' | 'pencil' | 'monoline' | 'marker' | 'eraser' | 'lasso' | 'text' | 'tape' | 'laser' | 'hand' | 'comment' | 'measure';
export type CanvasTool = { kind: ToolKind; color: string; width: number; mode?: string; bold?: boolean; angle?: number; stabilize?: boolean; italic?: boolean; underline?: boolean };

type Props = ViewProps & {
  pages: CanvasPage[];
  tool: CanvasTool;
  fingerDraws?: boolean;
  ruler?: boolean;
  inkStats?: boolean;        // the on-screen readout of how fast the ink is
  shapeSnap?: boolean;       // hold the Pencil at the end of a stroke: it snaps to a line or shape
  drawingPath: string;
  textsPath: string;
  onPageChange?: (e: { nativeEvent: { page: number; count: number } }) => void;
  legacy?: LegacyStroke[];
  onDrawingChange?: (e: { nativeEvent: CanvasState }) => void;
  onPencilTap?: (e: { nativeEvent: { action: string } }) => void;
  onSelectionAction?: (e: { nativeEvent: { action: string; id?: string; path?: string; text?: string; width?: number; height?: number } }) => void;
  zoomWindow?: boolean;      // the zoom writing window
  autoPage?: boolean;        // says when the last page has been written on
  onLastPageUsed?: () => void;
  inkTaps?: boolean;         // a finger tapping ink reports when it was written
  onInkTapped?: (e: { nativeEvent: { ts: number } }) => void;
};

/** Pages are stacked top to bottom with this gap (must match QuillCanvasView.swift). */
export const PAGE_GAP = 28;

let Native: ComponentType<Props & { ref?: Ref<CanvasHandle> }> | null = null;
if (Platform.OS === 'ios') {
  try { Native = requireNativeViewManager('QuillCanvas'); } catch { Native = null; }
}

export const canvasAvailable = () => !!Native;

export const QuillCanvas = forwardRef<CanvasHandle, Props>(function QuillCanvas(props, ref) {
  if (!Native) {
    return (
      <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#ECECEE' }, props.style]}>
        <Text style={{ fontSize: 17, color: '#555', textAlign: 'center' }}>Writing uses Apple Pencil on the iPad app.</Text>
      </View>
    );
  }
  return <Native {...props} ref={ref} />;
});
