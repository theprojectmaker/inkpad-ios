import ExpoModulesCore
import VisionKit

public final class QuillCanvasModule: Module {
  private var scan: ScanSession?

  public func definition() -> ModuleDefinition {
    Name("QuillCanvas")

    // Apple's document camera; resolves with the scanned page images (empty if cancelled).
    AsyncFunction("scanDocument") { (enhance: Bool, promise: Promise) in
      guard VNDocumentCameraViewController.isSupported else { promise.reject("E_SCAN", "This iPad can't scan documents."); return }
      guard let vc = self.appContext?.utilities?.currentViewController() else { promise.reject("E_SCAN", "Couldn't open the camera."); return }
      let session = ScanSession(promise: promise, enhance: enhance) { [weak self] in self?.scan = nil }
      self.scan = session
      let cam = VNDocumentCameraViewController()
      cam.delegate = session
      vc.present(cam, animated: true)
    }.runOnQueue(.main)

    // The AI's clean copy (HTML) as Letter-size PDF pages; returns the page count.
    AsyncFunction("htmlToPdf") { (html: String, path: String) throws -> Int in
      return try PrintHTML.pdf(html, to: path)
    }.runOnQueue(.main)

    // Reads printed and handwritten text from a picture, on the iPad (works offline).
    AsyncFunction("readText") { (path: String) throws -> [String: Any] in
      return try OnDevice.readText(path)
    }

    // A cleaned-up, sharper copy of a page picture.
    AsyncFunction("enhanceImage") { (src: String, dst: String) throws -> Bool in
      return try OnDevice.enhance(src, to: dst)
    }

    // Apple's on-device model (no internet): its state, and one answer.
    Function("localAIStatus") { () -> String in
      return OnDevice.aiStatus()
    }

    AsyncFunction("localAI") { (instructions: String, prompt: String) async throws -> String in
      return try await OnDevice.ask(instructions: instructions, prompt: prompt)
    }

    View(QuillCanvasView.self) {
      Events("onDrawingChange", "onPageChange")

      Prop("pages") { (view: QuillCanvasView, pages: [PageSpec]) in
        view.setPages(pages)
      }

      Prop("drawingPath") { (view: QuillCanvasView, path: String) in
        view.drawingPath = path
      }

      Prop("legacy") { (view: QuillCanvasView, legacy: [LegacyStroke]) in
        view.legacy = legacy
      }

      Prop("textsPath") { (view: QuillCanvasView, path: String) in
        view.textsPath = path
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

      AsyncFunction("scrollToPage") { (view: QuillCanvasView, index: Int) in
        view.scrollToPage(index)
      }.runOnQueue(.main)

      AsyncFunction("pageThumb") { (view: QuillCanvasView, index: Int, path: String, width: Double) -> Bool in
        return view.pageThumb(index, path: path, width: width)
      }.runOnQueue(.main)

      AsyncFunction("deletePage") { (view: QuillCanvasView, index: Int) in
        view.deletePage(index)
      }.runOnQueue(.main)

      AsyncFunction("insertPageSpace") { (view: QuillCanvasView, after: Int, height: Double) in
        view.insertPageSpace(after: after, height: height)
      }.runOnQueue(.main)

      AsyncFunction("endTextEdit") { (view: QuillCanvasView) in
        view.commitEdit()
      }.runOnQueue(.main)

      AsyncFunction("snapshot") { (view: QuillCanvasView, path: String, width: Double) -> Bool in
        return view.snapshot(path, width: width)
      }.runOnQueue(.main)
    }
  }
}
