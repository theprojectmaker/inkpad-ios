import ExpoModulesCore
import UIKit
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
    // iCloud sync (see ICloudSync.swift). These wait on iCloud, so they run off the main thread.
    AsyncFunction("icloudStatus") { () -> String in ICloudSync.status() }
    AsyncFunction("icloudPushDir") { (rel: String, cloudRel: String) -> Int in ICloudSync.pushDir(rel, to: cloudRel) }
    AsyncFunction("icloudPullDir") { (cloudRel: String, rel: String) -> Int in ICloudSync.pullDir(cloudRel, to: rel) }
    AsyncFunction("icloudReadText") { (cloudRel: String) -> String? in ICloudSync.readText(cloudRel) }
    AsyncFunction("icloudWriteText") { (cloudRel: String, text: String) -> Bool in ICloudSync.writeText(cloudRel, text) }
    AsyncFunction("icloudRemove") { (cloudRel: String) in ICloudSync.remove(cloudRel) }

    Function("gestureLogPath") { () -> String in
      return GestureLog.path
    }

    Function("localAIStatus") { () -> String in
      return OnDevice.aiStatus()
    }

    AsyncFunction("localAI") { (instructions: String, prompt: String) async throws -> String in
      return try await OnDevice.ask(instructions: instructions, prompt: prompt)
    }

    Function("speak") { (text: String) in Speak.say(text) }
    Function("stopSpeaking") { Speak.stop() }
    AsyncFunction("defineWord") { (word: String) in
      guard let vc = self.appContext?.utilities?.currentViewController() else { return }
      Speak.define(word, from: vc)
    }.runOnQueue(.main)

    // A picture made smaller, as a JPEG.
    AsyncFunction("imageShrink") { (src: String, dst: String, maxSide: Double, quality: Double, wantBase64: Bool) throws -> [String: Any] in
      return try ImageShrink.run(src: src, dst: dst, maxSide: maxSide, quality: quality, wantBase64: wantBase64)
    }

    // A PDF's page sizes and some of its text, straight from the file.
    AsyncFunction("pdfInfo") { (path: String, maxText: Int) throws -> [String: Any] in
      return try PdfInfo.read(path, maxText: maxText)
    }

    AsyncFunction("pdfCover") { (path: String, dst: String, width: Double) -> Bool in
      return PdfInfo.cover(path, to: dst, width: width)
    }

    // The recorder: sound to a file, and words as they're said.
    AsyncFunction("recStart") { (path: String, promise: Promise) in
      LiveRecorder.shared.start(path: path) { error in
        if let error { promise.reject("E_RECORD", error.localizedDescription) } else { promise.resolve(nil) }
      }
    }.runOnQueue(.main)

    Function("recPoll") { (since: Int) -> [String: Any] in
      return LiveRecorder.shared.poll(since: since)
    }

    Function("recPause") { (on: Bool) in
      LiveRecorder.shared.setPaused(on)
    }

    AsyncFunction("recStop") { (promise: Promise) in
      LiveRecorder.shared.stop { promise.resolve($0) }
    }.runOnQueue(.main)

    // Apple's colour picker; resolves with a hex colour, or nothing if closed.
    AsyncFunction("pickColor") { (start: String, promise: Promise) in
      guard let vc = self.appContext?.utilities?.currentViewController() else { promise.resolve(""); return }
      ColorPick.show(start: start, from: vc) { promise.resolve($0) }
    }.runOnQueue(.main)

    // Puts text on the clipboard.
    AsyncFunction("copyText") { (text: String) in
      UIPasteboard.general.string = text
    }.runOnQueue(.main)

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

      Prop("zoomWindow") { (view: QuillCanvasView, on: Bool) in
        view.setZoomWindow(on)
      }

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

      Prop("scribble") { (view: QuillCanvasView, on: Bool) in
        view.scribble = on
      }

      Prop("scratchOut") { (view: QuillCanvasView, on: Bool) in
        view.scratchOut = on
      }

      Prop("straightMarker") { (view: QuillCanvasView, on: Bool) in
        view.straightMarker = on
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

      // For a look at the page in passing (Record to Notes): nothing being typed gets closed.
      AsyncFunction("pageShot") { (view: QuillCanvasView, index: Int, path: String, width: Double, promise: Promise) in
        view.pageThumbAsync(index, path: path, width: width, quiet: true) { promise.resolve($0) }
      }.runOnQueue(.main)

      AsyncFunction("pageThumb") { (view: QuillCanvasView, index: Int, path: String, width: Double, promise: Promise) in
        view.pageThumbAsync(index, path: path, width: width, quiet: false) { promise.resolve($0) }
      }.runOnQueue(.main)

      AsyncFunction("deletePage") { (view: QuillCanvasView, index: Int) in
        view.deletePage(index)
      }.runOnQueue(.main)

      AsyncFunction("insertPageSpace") { (view: QuillCanvasView, after: Int, height: Double, resized: Double?) in
        view.insertPageSpace(after: after, height: height, resized: resized ?? 0)
      }.runOnQueue(.main)

      AsyncFunction("pageIsEmpty") { (view: QuillCanvasView, index: Int) -> Bool in
        return view.pageIsEmpty(index)
      }.runOnQueue(.main)

      AsyncFunction("resizePage") { (view: QuillCanvasView, index: Int, delta: Double) in
        view.resizePage(index, delta: delta)
      }.runOnQueue(.main)

      AsyncFunction("fillSelection") { (view: QuillCanvasView, color: String) -> Int in
        return view.fillSelection(color: color)
      }.runOnQueue(.main)

      AsyncFunction("styleSelection") { (view: QuillCanvasView, color: String, width: Double, style: String) in
        view.styleSelection(color: color, width: width, style: style)
      }.runOnQueue(.main)

      AsyncFunction("setComment") { (view: QuillCanvasView, id: String, text: String) in
        view.setComment(id: id, text: text)
      }.runOnQueue(.main)

      AsyncFunction("addPageText") { (view: QuillCanvasView, page: Int, text: String) in
        view.addPageText(page: page, text: text)
      }.runOnQueue(.main)

      AsyncFunction("replaceSelectionWithGraph") { (view: QuillCanvasView, axes: [[[Double]]], curve: [[[Double]]], caption: String) in
        view.replaceSelection(axes: axes, curve: curve, caption: caption)
      }.runOnQueue(.main)

      AsyncFunction("commentList") { (view: QuillCanvasView) -> [[String: Any]] in
        return view.commentList()
      }.runOnQueue(.main)

      AsyncFunction("replaceSelection") { (view: QuillCanvasView, text: String) in
        view.replaceSelection(text: text)
      }.runOnQueue(.main)

      AsyncFunction("movePage") { (view: QuillCanvasView, from: Int, to: Int) in
        view.movePage(from: from, to: to)
      }.runOnQueue(.main)

      AsyncFunction("selectPage") { (view: QuillCanvasView, index: Int) in
        view.selectPage(index)
      }.runOnQueue(.main)

      AsyncFunction("clearPageInk") { (view: QuillCanvasView, index: Int) in
        view.clearPageInk(index)
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

      AsyncFunction("compass") { (view: QuillCanvasView, what: String) in
        if what == "circle" { view.compassFullCircle() } else { view.compassReset() }
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
