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
    AsyncFunction("enhanceImage") { (src: String, dst: String, mode: String) throws -> Bool in
      return try OnDevice.enhance(src, to: dst, mode: mode)
    }

    // Apple's on-device model (no internet): its state, and one answer.
    Function("localAIStatus") { () -> String in
      return OnDevice.aiStatus()
    }

    AsyncFunction("localAI") { (instructions: String, prompt: String) async throws -> String in
      return try await OnDevice.ask(instructions: instructions, prompt: prompt)
    }

    // A PDF's page sizes and some of its text, straight from the file.
    AsyncFunction("pdfInfo") { (path: String, maxText: Int) throws -> [String: Any] in
      return try PdfInfo.read(path, maxText: maxText)
    }

    // A recording as timed lines of text.
    AsyncFunction("transcribe") { (path: String, promise: Promise) in
      Transcriber.run(path) { result in
        switch result {
        case .success(let lines): promise.resolve(lines)
        case .failure(let e): promise.reject("E_TRANSCRIBE", e.localizedDescription)
        }
      }
    }

    View(QuillCanvasView.self) {
      Events("onDrawingChange", "onPageChange", "onPencilTap", "onSelectionAction", "onInkTapped", "onLastPageUsed")

      Prop("autoPage") { (view: QuillCanvasView, on: Bool) in
        view.autoPage = on
        view.checkLastPage()
      }

      Prop("inkTaps") { (view: QuillCanvasView, on: Bool) in
        view.setInkTaps(on)
      }

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

      Prop("shapeSnap") { (view: QuillCanvasView, on: Bool) in
        view.shapeSnap = on
      }

      Prop("inkStats") { (view: QuillCanvasView, on: Bool) in
        view.setInkStats(on)
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

      AsyncFunction("pageIsEmpty") { (view: QuillCanvasView, index: Int) -> Bool in
        return view.pageIsEmpty(index)
      }.runOnQueue(.main)

      AsyncFunction("resizePage") { (view: QuillCanvasView, index: Int, delta: Double) in
        view.resizePage(index, delta: delta)
      }.runOnQueue(.main)

      AsyncFunction("styleSelection") { (view: QuillCanvasView, color: String, width: Double, style: String) in
        view.styleSelection(color: color, width: width, style: style)
      }.runOnQueue(.main)

      AsyncFunction("setComment") { (view: QuillCanvasView, id: String, text: String) in
        view.setComment(id: id, text: text)
      }.runOnQueue(.main)

      AsyncFunction("movePage") { (view: QuillCanvasView, from: Int, to: Int) in
        view.movePage(from: from, to: to)
      }.runOnQueue(.main)

      AsyncFunction("duplicatePage") { (view: QuillCanvasView, index: Int) in
        view.duplicatePage(index)
      }.runOnQueue(.main)

      AsyncFunction("addPicture") { (view: QuillCanvasView, file: String, width: Double, height: Double) in
        view.addPicture(file, width: width, height: height)
      }.runOnQueue(.main)

      AsyncFunction("paste") { (view: QuillCanvasView) in
        view.paste()
      }.runOnQueue(.main)

      AsyncFunction("setAllTape") { (view: QuillCanvasView, shown: Bool) in
        view.setAllTape(shown: shown)
      }.runOnQueue(.main)

      AsyncFunction("clearTape") { (view: QuillCanvasView) in
        view.clearTape()
      }.runOnQueue(.main)

      AsyncFunction("flash") { (view: QuillCanvasView, page: Int, x: Double, y: Double, w: Double, h: Double) in
        view.flash(page: page, x: x, y: y, w: w, h: h)
      }.runOnQueue(.main)

      AsyncFunction("setReplay") { (view: QuillCanvasView, cut: Double, from: Double, to: Double) in
        view.setReplay(cut: cut, from: from, to: to)
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
