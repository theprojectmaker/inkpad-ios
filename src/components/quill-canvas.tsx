// The writing canvas: Apple's PencilKit (see modules/quill-canvas). Ink,
// eraser, lasso, ruler, palm rejection, scrolling and zoom are all native.
// The browser preview has no PencilKit, so it shows a note instead.
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
};

export type ToolKind = 'felt' | 'pen' | 'fountain' | 'pencil' | 'monoline' | 'marker' | 'eraser' | 'lasso' | 'text';
export type CanvasTool = { kind: ToolKind; color: string; width: number };

type Props = ViewProps & {
  pages: CanvasPage[];
  tool: CanvasTool;
  fingerDraws?: boolean;
  ruler?: boolean;
  drawingPath: string;
  textsPath: string;
  onPageChange?: (e: { nativeEvent: { page: number; count: number } }) => void;
  legacy?: LegacyStroke[];
  onDrawingChange?: (e: { nativeEvent: CanvasState }) => void;
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
