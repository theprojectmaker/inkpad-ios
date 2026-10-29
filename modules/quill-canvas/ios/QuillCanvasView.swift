// The writing surface: Apple's PencilKit canvas (ink, eraser, lasso, ruler,
// palm rejection, scrolling and pinch-zoom are all PencilKit's), with the
// note's pages stacked underneath and scaled with the zoom.
import ExpoModulesCore
import PencilKit
import UIKit

struct ToolSpec: Record {
  @Field var kind: String = "pen"   // pen | fountain | pencil | monoline | marker | eraser | lasso
  @Field var color: String = "#111111"
  @Field var width: Double = 3
}

struct LegacyStroke: Record {
  @Field var pts: [Double] = []     // x, y, pressure, ... in canvas coordinates
  @Field var color: String = "#111111"
  @Field var w: Double = 2
  @Field var hl: Bool = false
}

/// A typed text box, in canvas coordinates.
struct TextBox: Codable {
  var id: String
  var x: Double
  var y: Double
  var w: Double
  var text: String
  var size: Double
  var color: String
}

final class QuillCanvasView: ExpoView, PKCanvasViewDelegate, UITextViewDelegate, UIGestureRecognizerDelegate {
  let canvas = PKCanvasView()
  let pageHost = UIView()                  // page backgrounds, in canvas coordinates
  let textHost = UIView()                  // typed text (under the ink except while typing), same coordinates
  var texts: [TextBox] = []
  var labels: [String: UILabel] = [:]
  var textsPath: String?
  var textMode = false
  var textColor = "#111111"
  var textSize: Double = 18
  var editor: UITextView?
  var editingId: String?
  var dragId: String?
  var dragStart: CGPoint = .zero
  private var lastPage = -1
  /// Where the user last scrolled to. An undo/redo (ours or Apple's 3-finger
  /// gesture) must never move the page, so we put the view back here.
  private var stableOffset: CGPoint?
  let onPageChange = EventDispatcher()
  lazy var tapGR = UITapGestureRecognizer(target: self, action: #selector(onTextTap(_:)))
  lazy var panGR = UIPanGestureRecognizer(target: self, action: #selector(onTextPan(_:)))
  lazy var undoTap: UITapGestureRecognizer = { let g = UITapGestureRecognizer(target: self, action: #selector(onUndoTap)); g.numberOfTouchesRequired = 2; return g }()
  lazy var redoTap: UITapGestureRecognizer = { let g = UITapGestureRecognizer(target: self, action: #selector(onRedoTap)); g.numberOfTouchesRequired = 3; return g }()
  private let hud = UILabel()
  private var pageViews: [PageTileView] = []
  private(set) var specs: [PageSpec] = []
  private(set) var frames: [CGRect] = []
  private var pagesKey = ""
  private var contentW: CGFloat = 612
  private var lastFit: CGFloat = 0           // the fit-width zoom last time (to keep the user's zoom on resize)
  var keyboardInset: CGFloat = 0             // room for the keyboard while typing in a text box
  private let saveQueue = DispatchQueue(label: "quill.canvas.save")  // every drawing write, in order
  private var pageViewsById: [String: (key: String, view: PageTileView)] = [:]
  private var lastEmit: CFTimeInterval = 0
  private var contentH: CGFloat = 792
  private let gap: CGFloat = 28
  private var lastWidth: CGFloat = 0
  private var fitted = false

  var drawingPath: String?
  var legacy: [LegacyStroke] = []
  private var loaded = false
  private var saveWork: DispatchWorkItem?
  private var dirty = false

  let onDrawingChange = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = UIColor(red: 0.925, green: 0.925, blue: 0.935, alpha: 1)

    canvas.delegate = self
    canvas.backgroundColor = .clear
    canvas.isOpaque = false
    canvas.overrideUserInterfaceStyle = .light      // black ink stays black on the paper
    canvas.drawingPolicy = .pencilOnly              // Pencil draws, fingers scroll and zoom
    canvas.alwaysBounceVertical = true
    canvas.contentInsetAdjustmentBehavior = .never
    canvas.showsVerticalScrollIndicator = true
    canvas.scrollsToTop = false                    // tapping the top of the screen must never jump to page 1
    canvas.tool = PKInkingTool(.pen, color: .black, width: 3)
    addSubview(canvas)

    pageHost.isUserInteractionEnabled = false
    pageHost.layer.anchorPoint = .zero
    canvas.insertSubview(pageHost, at: 0)

    textHost.layer.anchorPoint = .zero
    textHost.isUserInteractionEnabled = false
    canvas.addSubview(textHost)
    tapGR.isEnabled = false
    tapGR.delegate = self
    canvas.addGestureRecognizer(tapGR)
    panGR.isEnabled = false
    panGR.delegate = self
    panGR.maximumNumberOfTouches = 1
    textHost.addGestureRecognizer(panGR)
    // No finger-tap undo: a hand resting on the screen while writing counted as a
    // two-finger tap and undid what was just written. Undo/redo are the buttons only.
    hud.font = .systemFont(ofSize: 15, weight: .semibold)
    hud.textColor = .white
    hud.textAlignment = .center
    hud.backgroundColor = UIColor(white: 0.1, alpha: 0.78)
    hud.layer.cornerRadius = 17
    hud.layer.masksToBounds = true
    hud.alpha = 0
    addSubview(hud)
    NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(appBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
  }

  deinit { NotificationCenter.default.removeObserver(self) }

  @objc private func onUndoTap() {
    let can = canvas.undoManager?.canUndo ?? false
    if can { undo() }
    flash(can ? "Undo" : "Nothing to undo")
  }

  @objc private func onRedoTap() {
    let can = canvas.undoManager?.canRedo ?? false
    if can { redo() }
    flash(can ? "Redo" : "Nothing to redo")
  }

  /// A small "Undo" / "Redo" bubble, so a finger tap gives feedback.
  private func flash(_ text: String) {
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
    hud.text = text
    let w = hud.intrinsicContentSize.width + 34
    hud.frame = CGRect(x: (bounds.width - w) / 2, y: 18, width: w, height: 34)
    bringSubviewToFront(hud)
    hud.layer.removeAllAnimations()
    hud.alpha = 1
    UIView.animate(withDuration: 0.35, delay: 0.7, options: [.beginFromCurrentState], animations: { self.hud.alpha = 0 })
  }

  /// Leaving the app saves everything, including a text box still being typed.
  @objc private func appBackground() { saveNow(sync: true) }

  /// The keyboard never covers the text box being typed in.
  @objc private func keyboardChanged(_ n: Notification) {
    guard let win = window else { return }
    let end = (n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect) ?? .zero
    let mine = convert(bounds, to: win)
    let overlap = n.name == UIResponder.keyboardWillHideNotification ? 0 : max(0, mine.maxY - end.minY)
    keyboardInset = overlap
    applyZoom()
    if overlap > 0, let ed = editor, ed.superview != nil {
      let r = textHost.convert(ed.frame, to: canvas).insetBy(dx: 0, dy: -24)
      canvas.scrollRectToVisible(r, animated: true)
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in if let s = self { s.stableOffset = s.canvas.contentOffset } }
    }
  }

  // MARK: - Layout and zoom

  override func layoutSubviews() {
    super.layoutSubviews()
    canvas.frame = bounds
    placeTextHost()
    if bounds.width > 1 && abs(bounds.width - lastWidth) > 0.5 {
      lastWidth = bounds.width
      refit(keepZoom: true)
    }
  }

  private func fitScale() -> CGFloat { max(0.05, (bounds.width - 40) / max(1, contentW)) }

  /// Page width fills the screen (with a small margin).
  func fitWidth() { refit(keepZoom: false) }

  /// Fits the page to a new width. With keepZoom (rotation, side panels opening)
  /// your zoom level and the spot you were looking at stay put; nothing jumps.
  private func refit(keepZoom: Bool) {
    guard bounds.width > 1 else { return }
    let f = fitScale()
    let oldZ = max(0.01, canvas.zoomScale)
    let ratio = keepZoom && fitted && lastFit > 0 ? oldZ / lastFit : 1
    let topY = (canvas.contentOffset.y + canvas.contentInset.top) / oldZ   // content point at the top of the screen
    lastFit = f
    canvas.minimumZoomScale = f * 0.5
    canvas.maximumZoomScale = f * 6
    canvas.setZoomScale(min(f * 6, max(f * 0.5, f * ratio)), animated: false)
    applyZoom()
    let z = canvas.zoomScale
    if !fitted {
      fitted = true
      canvas.contentOffset = CGPoint(x: -canvas.contentInset.left, y: -canvas.contentInset.top)
      // Automated tests only (launch argument -QuillTestZoom 3): open already zoomed in.
      let testZoom = UserDefaults.standard.double(forKey: "QuillTestZoom")
      if testZoom > 1 {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
          guard let self else { return }
          self.canvas.setZoomScale(f * CGFloat(testZoom), animated: false)
          self.applyZoom()
          self.canvas.contentOffset = CGPoint(x: self.canvas.contentSize.width * 0.12, y: self.canvas.contentSize.height * 0.04)
          self.stableOffset = self.canvas.contentOffset
        }
      }
    } else {
      let maxY = max(-canvas.contentInset.top, canvas.contentSize.height - canvas.bounds.height + canvas.contentInset.bottom)
      let y = min(maxY, max(-canvas.contentInset.top, topY * z - canvas.contentInset.top))
      let maxX = max(-canvas.contentInset.left, canvas.contentSize.width - canvas.bounds.width + canvas.contentInset.right)
      let x = min(maxX, max(-canvas.contentInset.left, canvas.contentOffset.x))
      canvas.contentOffset = CGPoint(x: x, y: y)
    }
    stableOffset = canvas.contentOffset
    updateTextScale()
    lastPage = -1
    reportPage()
  }

  private func applyZoom() {
    let z = canvas.zoomScale
    pageHost.transform = CGAffineTransform(scaleX: z, y: z)
    pageHost.layer.position = .zero
    textHost.transform = CGAffineTransform(scaleX: z, y: z)
    textHost.layer.position = .zero
    let size = CGSize(width: contentW * z, height: contentH * z)
    if canvas.contentSize != size { canvas.contentSize = size }
    let padX = max(0, (bounds.width - size.width) / 2)
    let inset = UIEdgeInsets(top: 20, left: padX, bottom: 160 + keyboardInset, right: padX)
    if canvas.contentInset != inset { canvas.contentInset = inset }
  }

  func scrollViewDidZoom(_ scrollView: UIScrollView) { applyZoom() }

  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    if scrollView === canvas && (canvas.isTracking || canvas.isDecelerating || canvas.isZooming || canvas.isZoomBouncing) {
      stableOffset = canvas.contentOffset
    }
    reportPage()
  }

  func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) {
    if scrollView === canvas { stableOffset = canvas.contentOffset }
  }

  func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) {
    if scrollView === canvas { stableOffset = canvas.contentOffset; updateTextScale() }
  }

  /// Puts the view back where the user had it if something other than the user moved it.
  func holdScroll() {
    applyZoom()
    guard let off = stableOffset, !canvas.isTracking, !canvas.isDecelerating, !canvas.isZooming else { return }
    let d = abs(canvas.contentOffset.y - off.y) + abs(canvas.contentOffset.x - off.x)
    if d > 2 { canvas.setContentOffset(off, animated: false) }
  }

  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    if gestureRecognizer === panGR { return panStartsOnBox() }
    return super.gestureRecognizerShouldBegin(gestureRecognizer)
  }

  /// Which page is in the middle of the screen.
  func currentPage() -> Int {
    let z = max(0.01, canvas.zoomScale)
    let mid = (canvas.contentOffset.y + canvas.bounds.height * 0.4) / z
    for (i, f) in frames.enumerated() where mid < f.maxY + gap / 2 { return i }
    return max(0, frames.count - 1)
  }

  private func reportPage() {
    guard !frames.isEmpty else { return }
    let i = currentPage()
    if i == lastPage { return }
    lastPage = i
    onPageChange(["page": i, "count": frames.count])
  }

  func scrollToPage(_ i: Int) {
    guard i >= 0, i < frames.count else { return }
    let z = canvas.zoomScale
    let maxY = max(-canvas.contentInset.top, canvas.contentSize.height - canvas.bounds.height + canvas.contentInset.bottom)
    let y = min(maxY, frames[i].minY * z - 16)
    stableOffset = CGPoint(x: canvas.contentOffset.x, y: y)
    canvas.setContentOffset(CGPoint(x: canvas.contentOffset.x, y: y), animated: true)
  }

  // MARK: - Pages

  func setPages(_ ps: [PageSpec]) {
    let key = ps.map { "\($0.id)|\($0.kind)|\($0.file)|\($0.index)|\($0.w)x\($0.h)|\($0.bg)|\($0.marks.count)" }.joined(separator: ";")
    if key == pagesKey { return }
    pagesKey = key
    specs = ps
    let oldW = contentW
    contentW = CGFloat(ps.map { $0.w }.max() ?? 612)
    // Pages are centred on the widest one; if that changed, move the ink and text with them.
    if loaded && abs(contentW - oldW) > 0.01 { shiftAll(dx: (contentW - oldW) / 2) }
    var y: CGFloat = 0
    var fs: [CGRect] = []
    for p in ps {
      fs.append(CGRect(x: (contentW - CGFloat(p.w)) / 2, y: y, width: CGFloat(p.w), height: CGFloat(p.h)))
      y += CGFloat(p.h) + gap
    }
    frames = fs
    contentH = max(1, y - gap)

    // Pages that didn't change keep their view (and its drawn tiles), so nothing flashes.
    var keep: [String: (key: String, view: PageTileView)] = [:]
    pageViews = zip(ps, fs).map { p, f in
      let k = "\(p.kind)|\(p.file)|\(p.index)|\(p.w)x\(p.h)|\(p.bg)|\(p.marks.count)"
      if let old = pageViewsById[p.id], old.key == k {
        old.view.frame = f
        old.view.layer.shadowPath = UIBezierPath(rect: CGRect(origin: .zero, size: f.size)).cgPath
        keep[p.id] = old
        return old.view
      }
      let v = PageTileView(spec: p)
      keep[p.id] = (k, v)
      v.frame = f
      v.layer.shadowColor = UIColor.black.cgColor
      v.layer.shadowOpacity = 0.12
      v.layer.shadowRadius = 6
      v.layer.shadowOffset = CGSize(width: 0, height: 2)
      v.layer.shadowPath = UIBezierPath(rect: CGRect(origin: .zero, size: f.size)).cgPath
      pageHost.addSubview(v)
      return v
    }
    for (id, old) in pageViewsById where keep[id] == nil || keep[id]!.view !== old.view { old.view.removeFromSuperview() }
    pageViewsById = keep
    pageHost.transform = .identity
    pageHost.bounds = CGRect(x: 0, y: 0, width: contentW, height: contentH)
    textHost.transform = .identity
    textHost.bounds = CGRect(x: 0, y: 0, width: contentW, height: contentH)
    lastPage = -1
    DispatchQueue.main.async { [weak self] in self?.reportPage() }
    if bounds.width > 1 {
      if fitted { canvas.minimumZoomScale = fitScale() * 0.5; canvas.maximumZoomScale = fitScale() * 6; applyZoom() } else { fitWidth() }
    }
  }

  // MARK: - Drawing file

  /// Called once every prop has arrived: load the saved drawing (or convert old ink).
  func loadIfReady() {
    guard !loaded, let path = drawingPath, !path.isEmpty, !specs.isEmpty else { return }
    loaded = true
    if let data = FileManager.default.contents(atPath: path), let d = try? PKDrawing(data: data) {
      canvas.drawing = d
    } else if !legacy.isEmpty {
      canvas.drawing = QuillCanvasView.drawing(from: legacy)
      dirty = true
      scheduleSave()
    }
    legacy = []
    if let tp = textsPath, let data = FileManager.default.contents(atPath: tp), let boxes = try? JSONDecoder().decode([TextBox].self, from: data) {
      texts = boxes
      renderTexts()
    }
  }

  func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
    guard loaded else { return }
    dirty = true
    scheduleSave()
    let now = CACurrentMediaTime()
    if now - lastEmit > 0.25 { lastEmit = now; emitState() }
    holdScroll()
    DispatchQueue.main.async { [weak self] in self?.holdScroll() }
  }

  private func scheduleSave() {
    saveWork?.cancel()
    let w = DispatchWorkItem { [weak self] in self?.saveNow(sync: false) }
    saveWork = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.7, execute: w)
  }

  func saveNow(sync: Bool) {
    saveWork?.cancel()
    saveWork = nil
    if sync { commitEdit() }
    guard loaded, dirty, let path = drawingPath, !path.isEmpty else { return }
    dirty = false
    let drawing = canvas.drawing          // a value copy; turned into bytes off the main thread
    let count = drawing.strokes.count
    let write = {
      let data = drawing.dataRepresentation()
      let url = URL(fileURLWithPath: path)
      try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try? data.write(to: url, options: .atomic)
    }
    if sync {
      saveQueue.sync { write() }
      emitState(strokes: count)
    } else {
      saveQueue.async {
        write()
        DispatchQueue.main.async { [weak self] in self?.emitState(strokes: count) }
      }
    }
  }

  func emitState(strokes: Int? = nil) {
    onDrawingChange([
      "canUndo": canvas.undoManager?.canUndo ?? false,
      "canRedo": canvas.undoManager?.canRedo ?? false,
      "strokes": strokes ?? canvas.drawing.strokes.count,
    ])
  }

  // MARK: - Tool palette

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { saveNow(sync: true) }
  }

  func focusCanvas() {}

  /// The app's own toolbar picks the tool (no Apple tool palette).
  func setTool(_ t: ToolSpec) {
    let color = UIColor(hex: t.color)
    let w = CGFloat(t.width)
    setTextMode(t.kind == "text")
    if t.kind == "text" {
      textColor = t.color
      textSize = t.width
      return
    }
    switch t.kind {
    case "eraser":
      canvas.tool = PKEraserTool(.bitmap, width: max(4, w))
    case "lasso":
      canvas.tool = PKLassoTool()
    case "pencil":
      canvas.tool = PKInkingTool(.pencil, color: color, width: w)
    case "marker":
      canvas.tool = PKInkingTool(.marker, color: color, width: w)
    case "fountain":
      if #available(iOS 17.0, *) { canvas.tool = PKInkingTool(.fountainPen, color: color, width: w) }
      else { canvas.tool = PKInkingTool(.pen, color: color, width: w) }
    case "felt":
      canvas.tool = PKInkingTool(.pen, color: color, width: w)
    case "monoline":
      if #available(iOS 17.0, *) { canvas.tool = PKInkingTool(.monoline, color: color, width: w) }
      else { canvas.tool = PKInkingTool(.pen, color: color, width: w) }
    default:
      canvas.tool = PKInkingTool(.pen, color: color, width: w)
    }
  }

  func setFingerDraws(_ on: Bool) { canvas.drawingPolicy = on ? .anyInput : .pencilOnly }
  func setRuler(_ on: Bool) { canvas.isRulerActive = on }

  func undo() { keepingScroll { canvas.undoManager?.undo() } }
  func redo() { keepingScroll { canvas.undoManager?.redo() } }

  private func keepingScroll(_ action: () -> Void) {
    if stableOffset == nil { stableOffset = canvas.contentOffset }
    action()
    holdScroll()
    DispatchQueue.main.async { [weak self] in self?.holdScroll(); self?.emitState() }
  }

  // MARK: - Export

  /// The whole note as a PDF: each page's background with its ink on top.
  func exportPdf(_ path: String) throws {
    saveNow(sync: true)
    let drawing = canvas.drawing
    let first = frames.first ?? CGRect(x: 0, y: 0, width: 612, height: 792)
    let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: first.size))
    let url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    // One page at a time, so a long note never needs every page in memory at once.
    try renderer.writePDF(to: url) { ctx in
      for (i, p) in specs.enumerated() {
        autoreleasepool {
          let r = CGRect(x: 0, y: 0, width: p.w, height: p.h)
          ctx.beginPage(withBounds: r, pageInfo: [:])
          PageArt.draw(p, in: ctx.cgContext)
          if i < frames.count {
            var ink: UIImage?
            UITraitCollection(userInterfaceStyle: .light).performAsCurrent { ink = drawing.image(from: frames[i], scale: 2) }
            ink?.draw(in: r)
            drawTexts(onPage: frames[i], in: ctx.cgContext)
          }
        }
      }
    }
  }

  /// A small picture of the first page for the library.
  func snapshot(_ path: String, width: Double) -> Bool { pageThumb(0, path: path, width: width) }

  // MARK: - Ink from the old app

  static func drawing(from legacy: [LegacyStroke]) -> PKDrawing {
    var strokes: [PKStroke] = []
    for s in legacy {
      let n = s.pts.count / 3
      if n < 1 { continue }
      var pts: [PKStrokePoint] = []
      pts.reserveCapacity(n)
      for i in 0..<n {
        let p = CGFloat(s.pts[i * 3 + 2])
        let w = CGFloat(s.w) * (s.hl ? 1 : (0.6 + 0.8 * min(1, max(0, p))))
        pts.append(PKStrokePoint(
          location: CGPoint(x: s.pts[i * 3], y: s.pts[i * 3 + 1]),
          timeOffset: TimeInterval(i) * 0.008,
          size: CGSize(width: max(0.5, w), height: max(0.5, w)),
          opacity: 1, force: max(0.1, p), azimuth: 0, altitude: .pi / 2))
      }
      let path = PKStrokePath(controlPoints: pts, creationDate: Date())
      let ink = PKInk(s.hl ? .marker : .pen, color: UIColor(hex: s.color))
      strokes.append(PKStroke(ink: ink, path: path, transform: .identity, mask: nil))
    }
    return PKDrawing(strokes: strokes)
  }
}
