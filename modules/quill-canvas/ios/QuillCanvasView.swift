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

final class QuillCanvasView: ExpoView, PKCanvasViewDelegate {
  let canvas = PKCanvasView()
  private let pageHost = UIView()          // page backgrounds, in canvas coordinates
  private var pageViews: [PageTileView] = []
  private(set) var specs: [PageSpec] = []
  private(set) var frames: [CGRect] = []
  private var pagesKey = ""
  private var contentW: CGFloat = 612
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
    canvas.tool = PKInkingTool(.pen, color: .black, width: 3)
    addSubview(canvas)

    pageHost.isUserInteractionEnabled = false
    pageHost.layer.anchorPoint = .zero
    canvas.insertSubview(pageHost, at: 0)
  }

  // MARK: - Layout and zoom

  override func layoutSubviews() {
    super.layoutSubviews()
    canvas.frame = bounds
    if bounds.width > 1 && abs(bounds.width - lastWidth) > 0.5 {
      lastWidth = bounds.width
      fitWidth()
    }
  }

  private func fitScale() -> CGFloat { max(0.05, (bounds.width - 40) / max(1, contentW)) }

  /// Page width fills the screen (with a small margin).
  func fitWidth() {
    guard bounds.width > 1 else { return }
    let f = fitScale()
    canvas.minimumZoomScale = f * 0.5
    canvas.maximumZoomScale = f * 6
    canvas.setZoomScale(f, animated: false)
    applyZoom()
    if !fitted {
      fitted = true
      canvas.contentOffset = CGPoint(x: -canvas.contentInset.left, y: -canvas.contentInset.top)
    }
  }

  private func applyZoom() {
    let z = canvas.zoomScale
    pageHost.transform = CGAffineTransform(scaleX: z, y: z)
    pageHost.layer.position = .zero
    let size = CGSize(width: contentW * z, height: contentH * z)
    if canvas.contentSize != size { canvas.contentSize = size }
    let padX = max(0, (bounds.width - size.width) / 2)
    let inset = UIEdgeInsets(top: 20, left: padX, bottom: 160, right: padX)
    if canvas.contentInset != inset { canvas.contentInset = inset }
  }

  func scrollViewDidZoom(_ scrollView: UIScrollView) { applyZoom() }

  // MARK: - Pages

  func setPages(_ ps: [PageSpec]) {
    let key = ps.map { "\($0.id)|\($0.kind)|\($0.file)|\($0.index)|\($0.w)x\($0.h)|\($0.bg)|\($0.marks.count)" }.joined(separator: ";")
    if key == pagesKey { return }
    pagesKey = key
    specs = ps
    contentW = CGFloat(ps.map { $0.w }.max() ?? 612)
    var y: CGFloat = 0
    var fs: [CGRect] = []
    for p in ps {
      fs.append(CGRect(x: (contentW - CGFloat(p.w)) / 2, y: y, width: CGFloat(p.w), height: CGFloat(p.h)))
      y += CGFloat(p.h) + gap
    }
    frames = fs
    contentH = max(1, y - gap)

    pageViews.forEach { $0.removeFromSuperview() }
    pageViews = zip(ps, fs).map { p, f in
      let v = PageTileView(spec: p)
      v.frame = f
      v.layer.shadowColor = UIColor.black.cgColor
      v.layer.shadowOpacity = 0.12
      v.layer.shadowRadius = 6
      v.layer.shadowOffset = CGSize(width: 0, height: 2)
      v.layer.shadowPath = UIBezierPath(rect: CGRect(origin: .zero, size: f.size)).cgPath
      pageHost.addSubview(v)
      return v
    }
    pageHost.transform = .identity
    pageHost.bounds = CGRect(x: 0, y: 0, width: contentW, height: contentH)
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
  }

  func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
    guard loaded else { return }
    dirty = true
    scheduleSave()
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
    guard loaded, dirty, let path = drawingPath, !path.isEmpty else { return }
    dirty = false
    let data = canvas.drawing.dataRepresentation()
    let count = canvas.drawing.strokes.count
    let write = {
      let url = URL(fileURLWithPath: path)
      try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try? data.write(to: url, options: .atomic)
    }
    if sync {
      write()
      emitState(strokes: count)
    } else {
      DispatchQueue.global(qos: .utility).async {
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
    case "monoline":
      if #available(iOS 17.0, *) { canvas.tool = PKInkingTool(.monoline, color: color, width: w) }
      else { canvas.tool = PKInkingTool(.pen, color: color, width: w) }
    default:
      canvas.tool = PKInkingTool(.pen, color: color, width: w)
    }
  }

  func setFingerDraws(_ on: Bool) { canvas.drawingPolicy = on ? .anyInput : .pencilOnly }
  func setRuler(_ on: Bool) { canvas.isRulerActive = on }

  func undo() { canvas.undoManager?.undo(); emitState() }
  func redo() { canvas.undoManager?.redo(); emitState() }

  // MARK: - Export

  /// The whole note as a PDF: each page's background with its ink on top.
  func exportPdf(_ path: String) throws {
    saveNow(sync: true)
    let drawing = canvas.drawing
    let first = frames.first ?? CGRect(x: 0, y: 0, width: 612, height: 792)
    let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: first.size))
    let url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    var images: [UIImage] = []
    UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
      images = frames.map { drawing.image(from: $0, scale: 3) }
    }
    try renderer.writePDF(to: url) { ctx in
      for (i, p) in specs.enumerated() {
        let r = CGRect(x: 0, y: 0, width: p.w, height: p.h)
        ctx.beginPage(withBounds: r, pageInfo: [:])
        PageArt.draw(p, in: ctx.cgContext)
        if i < images.count { images[i].draw(in: r) }
      }
    }
  }

  /// A small picture of the first page for the library.
  func snapshot(_ path: String, width: Double) -> Bool {
    guard let p = specs.first, let f = frames.first else { return false }
    let k = CGFloat(width) / CGFloat(p.w)
    let size = CGSize(width: CGFloat(p.w) * k, height: CGFloat(p.h) * k)
    var ink: UIImage?
    UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
      ink = canvas.drawing.image(from: f, scale: k * 2)
    }
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 2
    let img = UIGraphicsImageRenderer(size: size, format: fmt).image { ctx in
      ctx.cgContext.scaleBy(x: k, y: k)
      PageArt.draw(p, in: ctx.cgContext)
      ink?.draw(in: CGRect(x: 0, y: 0, width: p.w, height: p.h))
    }
    guard let data = img.jpegData(compressionQuality: 0.8) else { return false }
    let url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    return (try? data.write(to: url, options: .atomic)) != nil
  }

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
