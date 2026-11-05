// The writing surface: a scroll view with the note's pages stacked inside, scaled
// with the zoom, and Quill's own ink on top (see InkView and CanvasInk).
import ExpoModulesCore
import PencilKit
import UIKit

struct ToolSpec: Record {
  @Field var kind: String = "pen"   // pen | fountain | pencil | monoline | marker | eraser | lasso
  @Field var color: String = "#111111"
  @Field var width: Double = 3
  @Field var mode: String = ""      // eraser: partial | stroke | hl; lasso: free | box; text: the font
  @Field var bold: Bool = false
  @Field var angle: Double = 40     // calligraphy
  @Field var stabilize: Bool = false
  @Field var italic: Bool = false
  @Field var underline: Bool = false
}

struct LegacyStroke: Record {
  @Field var pts: [Double] = []     // x, y, pressure, ... in canvas coordinates
  @Field var color: String = "#111111"
  @Field var w: Double = 2
  @Field var hl: Bool = false
}

/// A typed text box, in canvas coordinates.
struct TextBox: Codable, Equatable {
  var id: String
  var x: Double
  var y: Double
  var w: Double
  var text: String
  var size: Double
  var color: String
  var font: String? = nil
  var bold: Bool? = nil
  var italic: Bool? = nil
  var underline: Bool? = nil
  var rtf: String? = nil          // the formatting, word by word
  var fill: String? = nil
  var border: String? = nil       // none | lined | grid
  var borderWidth: Double? = nil
  var borderColor: String? = nil
  var locked: Bool? = nil
}

/// Fingers scroll and zoom; a finger on a lasso selection moves that instead.
final class InkScrollView: UIScrollView {
  var blocksPan: ((CGPoint) -> Bool)?

  override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
    if g === panGestureRecognizer, let blocksPan, blocksPan(g.location(in: self)) { return false }
    return super.gestureRecognizerShouldBegin(g)
  }
}

final class QuillCanvasView: ExpoView, UIScrollViewDelegate, UITextViewDelegate, UIGestureRecognizerDelegate {
  let canvas = InkScrollView()
  private let zoomView = UIView()          // what the scroll view zooms; pages and ink follow its scale
  let pageHost = UIView()                  // page backgrounds, in canvas coordinates
  let textHost = UIView()                  // typed text (under the ink except while typing), same coordinates
  let document = InkDocument()
  lazy var ink = InkView(document: document)
  lazy var inkGesture: InkGesture = { let g = InkGesture(target: nil, action: nil); g.owner = self; return g }()
  var pen = InkPen()
  var inkMode = InkMode.write
  var eraserWidth: CGFloat = 20
  var capture: PenCapture?
  var undoStack: [InkEdit] = []
  var redoStack: [InkEdit] = []
  var eraseLast: CGPoint = .zero
  var eraseRemoved: [InkStroke] = []
  var eraseAdded: [InkStroke] = []
  let eraserRing = CAShapeLayer()
  var lassoPts: [CGPoint] = []
  let lassoLayer = CAShapeLayer()
  var selection: [InkStroke] = []
  var selBox: CGRect = .null
  var selTexts: [String] = []
  var selPics: [String] = []
  var selDrag: (from: CGPoint, base: CGAffineTransform, mode: SelDragMode)?
  let selOutline = CAShapeLayer()
  let selHandle = CAShapeLayer()
  let selBar = UIStackView()
  lazy var selPan: UIPanGestureRecognizer = {
    let g = UIPanGestureRecognizer(target: self, action: #selector(onSelPan(_:)))
    g.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
    g.delegate = self
    g.isEnabled = false
    return g
  }()
  lazy var selTap: UITapGestureRecognizer = {
    let g = UITapGestureRecognizer(target: self, action: #selector(onSelTap(_:)))
    g.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
    g.cancelsTouchesInView = false
    g.delegate = self
    g.isEnabled = false
    return g
  }()
  let pictureHost = UIView()               // photos, above the page and under the ink
  let tapeHost = UIView()                  // tape, on top of the ink
  var pics: [PictureObj] = []
  var picViews: [String: UIImageView] = [:]
  var tapes: [TapeObj] = []
  var tapeViews: [String: UIView] = [:]
  var tapeStart: CGPoint = .zero
  var tapeDraft: UIView?
  var tapeColor = "#F7B731"
  var tapeWidth: CGFloat = 26
  var eraserMode = "partial"
  var lassoBox = false
  var textFont = "system"
  var textBold = false
  var textItalic = false
  var textUnderline = false
  var comments: [CommentObj] = []
  let sizeLabel = UILabel()
  var boxBar: UIStackView?
  lazy var formatBar: UIView = makeFormatBar()
  var zoomWriter: ZoomWriter?
  var zoomPreviewing = false
  var compassPlaced = false
  var compassCentre = CGPoint.zero
  var compassRadius: CGFloat = 0
  var compassAngle: CGFloat = 0
  var compassStart: CGFloat = 0
  var compassSweep: CGFloat = 0
  var compassLast: CGFloat = 0
  var compassGrab = CompassGrab.none
  let compassLayer = CALayer()
  let compassGuide = CAShapeLayer()
  let compassArms = CAShapeLayer()
  let compassLabel = CATextLayer()
  var lastZoomEnd: TimeInterval = 0
  var inkPictures: [String: (version: Int, image: CGImage?)] = [:]
  var pageViewList: [PageTileView] { pageViews }
  var measureMode = "length"
  var measureStart: CGPoint = .zero
  let measureLayer = CAShapeLayer()
  lazy var zoomPan: UIPanGestureRecognizer = {
    let g = UIPanGestureRecognizer(target: self, action: #selector(onZoomPan(_:)))
    g.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
    g.maximumNumberOfTouches = 1
    g.delegate = self
    g.isEnabled = false
    return g
  }()
  var pinViews: [String: UILabel] = [:]
  var objBase = InkObjects(texts: [], pics: [], tapes: [])   // text, photos and tape as of the last undo step
  var laserPts: [(CGPoint, CFTimeInterval)] = []
  var laserBreaks: [Int] = []
  var laserDown = false
  var laserLink: CADisplayLink?
  let laserLayer = CAShapeLayer()
  lazy var tapeTap: UITapGestureRecognizer = {
    let g = UITapGestureRecognizer(target: self, action: #selector(onTapeTap(_:)))
    g.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
    g.cancelsTouchesInView = false
    g.delegate = self
    return g
  }()
  lazy var inkTapGR: UITapGestureRecognizer = {
    let g = UITapGestureRecognizer(target: self, action: #selector(onInkTap(_:)))
    g.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
    g.cancelsTouchesInView = false
    g.delegate = self
    g.isEnabled = false
    return g
  }()
  let onPencilTap = EventDispatcher()
  let onLastPageUsed = EventDispatcher()
  var autoPage = false
  var lastPageAsked = -1
  let onSelectionAction = EventDispatcher()
  let onInkTapped = EventDispatcher()
  var ruler: RulerView?
  let statsLabel = UILabel()
  var dragStartOffset: CGPoint = .zero
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
  let onPageChange = EventDispatcher()
  lazy var tapGR = UITapGestureRecognizer(target: self, action: #selector(onTextTap(_:)))
  lazy var panGR = UIPanGestureRecognizer(target: self, action: #selector(onTextPan(_:)))
  private var pageViews: [PageTileView] = []
  private var pageSeams: [UIView] = []
  private var pageEdges: [UIView] = []
  var handMode = false
  var laserColor = UIColor(red: 1, green: 0.16, blue: 0.2, alpha: 1)
  private(set) var specs: [PageSpec] = []
  private(set) var frames: [CGRect] = []
  private var pagesKey = ""
  private var contentW: CGFloat = 612
  private var lastFit: CGFloat = 0           // the fit-width zoom last time (to keep the user's zoom on resize)
  var keyboardInset: CGFloat = 0             // room for the keyboard while typing in a text box
  private let saveQueue = DispatchQueue(label: "quill.canvas.save")  // every drawing write, in order
  private var pageViewsById: [String: (key: String, view: PageTileView)] = [:]
  var lastEmit: CFTimeInterval = 0
  var scrollBack: DispatchWorkItem?
  var shapeSnap = true
  private var fingerDraws = false
  private var contentH: CGFloat = 792
  private let gap: CGFloat = 28
  private var lastWidth: CGFloat = 0
  private var fitted = false

  var drawingPath: String?
  var legacy: [LegacyStroke] = []
  private var loaded = false
  var isLoaded: Bool { loaded }
  private var saveWork: DispatchWorkItem?
  private var dirty = false

  let onDrawingChange = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    isMultipleTouchEnabled = true
    backgroundColor = UIColor(red: 0.957, green: 0.961, blue: 0.973, alpha: 1)

    canvas.delegate = self
    canvas.backgroundColor = .clear
    canvas.alwaysBounceVertical = true
    canvas.contentInsetAdjustmentBehavior = .never
    canvas.showsVerticalScrollIndicator = true
    canvas.scrollsToTop = false                    // tapping the top of the screen must never jump to page 1
    canvas.delaysContentTouches = false
    canvas.blocksPan = { [weak self] p in
      guard let self else { return false }
      let at = self.canvas.convert(p, to: self)
      return self.selectionWantsTouch(at: at) || (self.zoomWriter?.contains(viewPoint: at) ?? false)
    }
    addSubview(canvas)

    zoomView.isUserInteractionEnabled = false
    canvas.addSubview(zoomView)

    pageHost.isUserInteractionEnabled = false
    pageHost.layer.anchorPoint = .zero
    canvas.addSubview(pageHost)

    textHost.layer.anchorPoint = .zero
    textHost.isUserInteractionEnabled = false
    canvas.addSubview(textHost)
    canvas.addSubview(ink)
    pictureHost.isUserInteractionEnabled = false
    pageHost.addSubview(pictureHost)
    tapeHost.layer.anchorPoint = .zero
    tapeHost.isUserInteractionEnabled = false
    canvas.addSubview(tapeHost)
    ink.onLinkTick = { [weak self] in self?.inkTick() }

    tapGR.isEnabled = false
    tapGR.delegate = self
    canvas.addGestureRecognizer(tapGR)
    panGR.isEnabled = false
    panGR.delegate = self
    panGR.maximumNumberOfTouches = 1
    textHost.addGestureRecognizer(panGR)

    // The Pencil only ever writes; scrolling and zooming are for fingers.
    // (The pinch recognizer only exists once there's a zoom range.)
    canvas.minimumZoomScale = 0.5
    canvas.maximumZoomScale = 6
    let fingers = [UITouch.TouchType.direct, .indirect, .indirectPointer].map { NSNumber(value: $0.rawValue) }
    canvas.panGestureRecognizer.allowedTouchTypes = fingers
    canvas.pinchGestureRecognizer?.allowedTouchTypes = fingers

    inkGesture.cancelsTouchesInView = false
    inkGesture.delaysTouchesBegan = false
    inkGesture.delaysTouchesEnded = false
    inkGesture.delegate = self
    inkGesture.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.pencil.rawValue)]
    addGestureRecognizer(inkGesture)
    addGestureRecognizer(selPan)
    addGestureRecognizer(selTap)
    addGestureRecognizer(tapeTap)
    addGestureRecognizer(inkTapGR)
    addGestureRecognizer(zoomPan)
    let pencil = UIPencilInteraction()
    pencil.delegate = self
    addInteraction(pencil)
    makeSelectionUI()

    NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(appBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
  }

  deinit { NotificationCenter.default.removeObserver(self) }

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
    }
  }

  // MARK: - Layout and zoom

  override func layoutSubviews() {
    super.layoutSubviews()
    canvas.frame = bounds
    zoomWriter?.layout()
    placeTextHost()
    syncInk()
    if bounds.width > 1 && abs(bounds.width - lastWidth) > 0.5 {
      lastWidth = bounds.width
      refit(keepZoom: true)
    }
  }

  func currentFit() -> CGFloat { fitScale() }

  private func fitScale() -> CGFloat {
    let across = bounds.width / max(1, contentW)
    // A very long page (a tall scan) would come out tiny, so those just fill the width.
    guard let h = frames.first?.height, h > 1, h <= contentW * 1.6 else { return max(0.05, across) }
    return max(0.05, min(across, bounds.height / h))
  }

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
        }
      }
    } else {
      let maxY = max(-canvas.contentInset.top, canvas.contentSize.height - canvas.bounds.height + canvas.contentInset.bottom)
      let y = min(maxY, max(-canvas.contentInset.top, topY * z - canvas.contentInset.top))
      let maxX = max(-canvas.contentInset.left, canvas.contentSize.width - canvas.bounds.width + canvas.contentInset.right)
      let x = min(maxX, max(-canvas.contentInset.left, canvas.contentOffset.x))
      canvas.contentOffset = CGPoint(x: x, y: y)
    }
    updateTextScale()
    lastPage = -1
    reportPage()
    syncInk()
  }

  func refreshZoomInset() { applyZoom() }

  private func applyZoom() {
    let z = canvas.zoomScale
    let tf = CGAffineTransform(scaleX: z, y: z)
    if pageHost.transform != tf || pageHost.layer.position != .zero {
      pageHost.transform = tf
      pageHost.layer.position = .zero
    }
    if textHost.transform != tf || textHost.layer.position != .zero {
      textHost.transform = tf
      textHost.layer.position = .zero
    }
    if tapeHost.transform != tf || tapeHost.layer.position != .zero {
      tapeHost.transform = tf
      tapeHost.layer.position = .zero
      keepPinsUpright()
    }
    let content = CGRect(x: 0, y: 0, width: contentW, height: contentH)
    if zoomView.bounds != content { zoomView.bounds = content }
    let middle = CGPoint(x: contentW * z / 2, y: contentH * z / 2)
    if zoomView.center != middle { zoomView.center = middle }
    let size = CGSize(width: contentW * z, height: contentH * z)
    if canvas.contentSize != size { canvas.contentSize = size }
    let padX = max(0, (bounds.width - size.width) / 2)
    // Room at the top for the floating toolbar; the page scrolls under it.
    let inset = UIEdgeInsets(top: 84, left: padX, bottom: 160 + keyboardInset, right: padX)
    if canvas.contentInset != inset { canvas.contentInset = inset }
    syncInk()
  }

  /// The ink covers exactly what's on screen, and moves with the pages in the same frame.
  private func syncInk() {
    ink.scrolled(to: canvas.bounds, zoom: canvas.zoomScale)
    placeSelectionUI()
    placeBoxBar()
    zoomWriter?.syncBox()
  }

  func viewForZooming(in scrollView: UIScrollView) -> UIView? { zoomView }

  func scrollViewDidZoom(_ scrollView: UIScrollView) { applyZoom() }

  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    syncInk()
    reportPage()
  }

  func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
    dragStartOffset = canvas.contentOffset
    if fingerDraws || inkMode == .compass { inkGesture.fingerGesturing() }
    ink.moving = true
    syncInk()
  }

  func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
    if !decelerate { settleInk() }
  }

  func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { settleInk() }

  /// The page has stopped: the ink goes back to covering just the screen.
  func settleInk() {
    guard ink.moving else { return }
    ink.moving = false
    syncInk()
  }

  func scrollViewWillBeginZooming(_ scrollView: UIScrollView, with view: UIView?) {
    inkGesture.fingerGesturing()
    pinchBegan()
  }

  func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) {
    updateTextScale()
    lastZoomEnd = CACurrentMediaTime()
    pinchEnded()
  }

  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    if gestureRecognizer === panGR { return panStartsOnBox() }
    if gestureRecognizer === selPan { return selectionWantsTouch(at: selPan.location(in: self)) }
    if gestureRecognizer === zoomPan { return zoomWriter?.contains(viewPoint: zoomPan.location(in: self)) ?? false }
    return super.gestureRecognizerShouldBegin(gestureRecognizer)
  }

  /// Buttons stay buttons, and a finger on the ruler moves the ruler.
  func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    // A button on the lasso bar is a button: it must not count as tapping away from the selection.
    if let v = touch.view, v.isDescendant(of: selBar) { return false }
    if let v = touch.view, let bar = boxBar, v.isDescendant(of: bar) { return false }
    if g !== inkGesture, let z = zoomWriter, let v = touch.view, v.isDescendant(of: z.pad) { return false }
    if g === inkGesture {
      if touch.view is UIControl { return false }
      if touch.type == .direct && touch.view is RulerView { return false }
    }
    return true
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
    // Zoomed all the way out, about four pages show.
    for (k, v) in pageViews.enumerated() {
      let away = abs(k - i)
      if away <= 3 { v.setNear(true) } else if away > 7 { v.setNear(false) }
    }
    onPageChange(["page": i, "count": frames.count])
  }

  func scrollToPage(_ i: Int) {
    guard i >= 0, i < frames.count else { return }
    let z = canvas.zoomScale
    let maxY = max(-canvas.contentInset.top, canvas.contentSize.height - canvas.bounds.height + canvas.contentInset.bottom)
    let y = min(maxY, frames[i].minY * z - 16)
    canvas.setContentOffset(CGPoint(x: canvas.contentOffset.x, y: y), animated: true)
  }

  // MARK: - Pages

  func setPages(_ ps: [PageSpec]) {
    // The marks count isn't enough: two papers can have as many lines at different places.
    let sig = { (p: PageSpec) -> String in "\(p.marks.count)/\(p.marks.reduce(0.0) { $0 + $1.x * 3 + $1.y * 7 + $1.r })/\(p.marks.first?.color ?? "")" }
    let key = ps.map { "\($0.id)|\($0.kind)|\($0.file)|\($0.index)|\($0.w)x\($0.h)|\($0.bg)|\(sig($0))" }.joined(separator: ";")
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
      let k = "\(p.kind)|\(p.file)|\(p.index)|\(p.w)x\(p.h)|\(p.bg)|\(sig(p))"
      if let old = pageViewsById[p.id], old.key == k {
        old.view.frame = f
        keep[p.id] = old
        return old.view
      }
      let v = PageTileView(spec: p)
      keep[p.id] = (k, v)
      v.frame = f
      pageHost.addSubview(v)
      return v
    }
    for (id, old) in pageViewsById where keep[id] == nil || keep[id]!.view !== old.view { old.view.removeFromSuperview() }
    pageViewsById = keep
    // Between pages: white, with one thin line across the middle.
    pageSeams.forEach { $0.removeFromSuperview() }
    pageSeams = []
    let line = UIColor(red: 0.72, green: 0.76, blue: 0.84, alpha: 1)
    for (a, b) in zip(fs, fs.dropFirst()) {
      let left = min(a.minX, b.minX), width = max(a.width, b.width)
      let seam = UIView(frame: CGRect(x: left, y: a.maxY, width: width, height: b.minY - a.maxY))
      seam.backgroundColor = .white
      let rule = UIView(frame: CGRect(x: 0, y: (b.minY - a.maxY) / 2 - 0.3, width: width, height: 0.6))
      rule.backgroundColor = line
      seam.addSubview(rule)
      pageHost.addSubview(seam)
      pageSeams.append(seam)
    }
    // The page's edges when zoomed out.
    for (i, x) in [CGFloat(0), contentW - 0.5].enumerated() {
      let edge = pageEdges.count > i ? pageEdges[i] : { () -> UIView in let v = UIView(); pageHost.addSubview(v); pageEdges.append(v); return v }()
      edge.backgroundColor = line
      edge.frame = CGRect(x: x, y: 0, width: 0.5, height: max(1, y - gap))
      pageHost.bringSubviewToFront(edge)
    }
    pageHost.transform = .identity
    pageHost.bounds = CGRect(x: 0, y: 0, width: contentW, height: contentH)
    textHost.transform = .identity
    textHost.bounds = CGRect(x: 0, y: 0, width: contentW, height: contentH)
    tapeHost.transform = .identity
    tapeHost.bounds = CGRect(x: 0, y: 0, width: contentW, height: contentH)
    pictureHost.frame = CGRect(x: 0, y: 0, width: contentW, height: contentH)
    pageHost.bringSubviewToFront(pictureHost)
    lastPage = -1
    DispatchQueue.main.async { [weak self] in self?.reportPage() }
    if bounds.width > 1 {
      if fitted { canvas.minimumZoomScale = fitScale() * 0.5; canvas.maximumZoomScale = fitScale() * 6; applyZoom() } else { fitWidth() }
    }
  }

  // MARK: - Drawing file

  /// Called once every prop has arrived: load the saved ink (or convert older ink).
  func loadIfReady() {
    guard !loaded, let path = drawingPath, !path.isEmpty, !specs.isEmpty else { return }
    loaded = true
    if let data = FileManager.default.contents(atPath: inkPath(path)), let saved = InkFile.decode(data) {
      document.load(saved)
    } else if let data = FileManager.default.contents(atPath: path), let d = try? PKDrawing(data: data) {
      // Written before this ink engine. The old file is left as it was.
      document.load(InkImport.strokes(from: d))
      markDirty()
    } else if !legacy.isEmpty {
      document.load(InkImport.strokes(from: legacy))
      markDirty()
    }
    legacy = []
    ink.setNeedsInk(rebuild: true)
    if let tp = textsPath, let data = FileManager.default.contents(atPath: tp), let boxes = try? JSONDecoder().decode([TextBox].self, from: data) {
      texts = boxes
      renderTexts()
    }
    loadExtras()
  }

  /// Where the ink is kept, next to the drawing file of older notes.
  private func inkPath(_ path: String) -> String {
    URL(fileURLWithPath: path).deletingPathExtension().appendingPathExtension("qink").path
  }

  func markDirty() {
    dirty = true
    scheduleSave()
  }

  /// Saving waits for a real pause (never between two quick strokes).
  private func scheduleSave() {
    saveWork?.cancel()
    let w = DispatchWorkItem { [weak self] in
      guard let self else { return }
      if self.capture != nil { self.scheduleSave(); return }   // Pencil still down
      self.saveNow(sync: false)
    }
    saveWork = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0, execute: w)
  }

  func saveNow(sync: Bool) {
    saveWork?.cancel()
    saveWork = nil
    if sync { commitEdit(); clearSelection() }
    guard loaded, dirty, let path = drawingPath, !path.isEmpty else { return }
    dirty = false
    let strokes = document.strokes         // strokes never change once made; turned into bytes off the main thread
    let count = strokes.count
    let file = inkPath(path)
    let write = {
      let data = InkFile.encode(strokes)
      let url = URL(fileURLWithPath: file)
      try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try? data.write(to: url, options: .atomic)
    }
    if sync {
      saveQueue.sync { write() }
      emitState(strokes: count)
    } else {
      saveQueue.async {
        write()
        DispatchQueue.main.async { [weak self] in
          self?.emitState(strokes: count)
          self?.refreshInkPictures()
        }
      }
    }
  }

  func emitState(strokes: Int? = nil) {
    onDrawingChange([
      "canUndo": !undoStack.isEmpty,
      "canRedo": !redoStack.isEmpty,
      "strokes": strokes ?? document.strokes.count,
    ])
  }

  // MARK: - Tool palette

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { saveNow(sync: true) }
  }

  func focusCanvas() {}

  /// The app's own toolbar picks the tool.
  func setTool(_ t: ToolSpec) {
    let w = CGFloat(t.width)
    setTextMode(t.kind == "text")
    if t.kind == "text" {
      textColor = t.color
      textSize = t.width
      textFont = t.mode.isEmpty ? "system" : t.mode
      textBold = t.bold
      textItalic = t.italic
      textUnderline = t.underline
      restyleEditor()
      clearSelection()
      selTap.isEnabled = false
      return
    }
    // Navigate: nothing writes; the Pencil scrolls too.
    handMode = t.kind == "hand"
    inkGesture.isEnabled = !handMode
    let scrollers: [UITouch.TouchType] = handMode ? [.direct, .indirect, .indirectPointer, .pencil] : [.direct, .indirect, .indirectPointer]
    canvas.panGestureRecognizer.allowedTouchTypes = scrollers.map { NSNumber(value: $0.rawValue) }
    updatePanFingers()
    if handMode { clearSelection(); selTap.isEnabled = false; return }
    let mode: InkMode = t.kind == "eraser" ? .erase : t.kind == "lasso" ? .lasso : t.kind == "tape" ? .tape : t.kind == "laser" ? .laser : t.kind == "comment" ? .comment : t.kind == "measure" ? .measure : t.kind == "compass" ? .compass : .write
    if mode != .lasso { clearSelection() }
    inkMode = mode
    applyFingerRules()
    drawCompass()
    selTap.isEnabled = mode == .lasso
    if mode == .erase { eraserWidth = max(4, w); eraserMode = t.mode.isEmpty ? "partial" : t.mode }
    if mode == .lasso { lassoBox = t.mode == "box" }
    if mode == .tape { tapeColor = t.color; tapeWidth = w }
    if mode == .laser { laserColor = UIColor(hex: t.color) }
    if mode == .measure { measureMode = t.mode } else { measureLayer.path = nil }
    if mode == .write || mode == .compass { pen = InkPen(type: t.kind == "felt" ? "pen" : t.kind, rgb: UIColor(hex: t.color).inkRGB, width: Float(w), style: t.mode, angle: Float(t.angle), stabilize: t.stabilize) }
  }

  func setFingerDraws(_ on: Bool) {
    fingerDraws = on
    applyFingerRules()
  }

  /// The compass works with a finger as well as the Pencil, whatever the writing setting is.
  private func applyFingerRules() {
    let finger = fingerDraws || inkMode == .compass
    inkGesture.allowedTouchTypes = (finger ? [UITouch.TouchType.pencil, .direct] : [UITouch.TouchType.pencil]).map { NSNumber(value: $0.rawValue) }
    updatePanFingers()
  }

  /// When a finger writes, scrolling takes two (except while typing).
  func updatePanFingers() { canvas.panGestureRecognizer.minimumNumberOfTouches = (fingerDraws || inkMode == .compass) && !textMode && !handMode ? 2 : 1 }

  // MARK: - Export

  /// The whole note as a PDF: each page's background with its ink on top.
  func exportPdf(_ path: String) throws {
    saveNow(sync: true)
    let strokes = document.strokes
    let first = frames.first ?? CGRect(x: 0, y: 0, width: 612, height: 792)
    let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: first.size))
    let url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    // One page at a time, so a long note never needs every page in memory at once.
    try renderer.writePDF(to: url) { ctx in
      var count = specs.count
      while count > 1, specs[count - 1].kind == "paper", pageIsEmpty(count - 1) { count -= 1 }
      for (i, p) in specs.prefix(count).enumerated() {
        autoreleasepool {
          let r = CGRect(x: 0, y: 0, width: p.w, height: p.h)
          ctx.beginPage(withBounds: r, pageInfo: [:])
          PageArt.draw(p, in: ctx.cgContext)
          if i < frames.count {
            drawPictures(onPage: frames[i], in: ctx.cgContext)
            InkRaster.image(strokes, rect: frames[i], scale: 3)?.draw(in: r)
            drawTexts(onPage: frames[i], in: ctx.cgContext)
          }
        }
      }
    }
  }

  /// A small picture of the first page for the library.
  func snapshot(_ path: String, width: Double) -> Bool { pageThumb(0, path: path, width: width) }
}
