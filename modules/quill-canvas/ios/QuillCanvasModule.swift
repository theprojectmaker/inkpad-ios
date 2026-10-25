import ExpoModulesCore

public final class QuillCanvasModule: Module {
  public func definition() -> ModuleDefinition {
    Name("QuillCanvas")

    View(QuillCanvasView.self) {
      Events("onDrawingChange")

      Prop("pages") { (view: QuillCanvasView, pages: [PageSpec]) in
        view.setPages(pages)
      }

      Prop("drawingPath") { (view: QuillCanvasView, path: String) in
        view.drawingPath = path
      }

      Prop("legacy") { (view: QuillCanvasView, legacy: [LegacyStroke]) in
        view.legacy = legacy
      }

      Prop("tool") { (view: QuillCanvasView, tool: ToolSpec) in
        view.setTool(tool)
      }

      Prop("fingerDraws") { (view: QuillCanvasView, on: Bool) in
        view.setFingerDraws(on)
      }

      Prop("ruler") { (view: QuillCanvasView, on: Bool) in
        view.setRuler(on)
      }

      OnViewDidUpdateProps { (view: QuillCanvasView) in
        view.loadIfReady()
      }

      AsyncFunction("undo") { (view: QuillCanvasView) in
        view.undo()
      }.runOnQueue(.main)

      AsyncFunction("redo") { (view: QuillCanvasView) in
        view.redo()
      }.runOnQueue(.main)

      AsyncFunction("save") { (view: QuillCanvasView) in
        view.saveNow(sync: true)
      }.runOnQueue(.main)

      AsyncFunction("focus") { (view: QuillCanvasView) in
        view.focusCanvas()
      }.runOnQueue(.main)

      AsyncFunction("fitWidth") { (view: QuillCanvasView) in
        view.fitWidth()
      }.runOnQueue(.main)

      AsyncFunction("exportPdf") { (view: QuillCanvasView, path: String) throws in
        try view.exportPdf(path)
      }.runOnQueue(.main)

      AsyncFunction("snapshot") { (view: QuillCanvasView, path: String, width: Double) -> Bool in
        return view.snapshot(path, width: width)
      }.runOnQueue(.main)
    }
  }
}
