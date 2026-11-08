// The zoom writing window: a box on the page, and a big strip along the bottom of the
// screen where writing lands in that box. Its own ink view mirrors the main one.
import UIKit

final class ZoomWriter: NSObject, UIGestureRecognizerDelegate {
  weak var owner: QuillCanvasView?
  let pad = UIView()
  private let art = UIImageView()
  let ink: InkView
  private let dim = CAShapeLayer()
  private let frameLine = CAShapeLayer()
  private let margin = UIView()
  private let controls = UIStackView()
  var rect: CGRect = .zero
  var capturing = false
  private var dragFrom: CGPoint?
  private var padHeight: CGFloat = 0

  init(owner: QuillCanvasView) {
    self.owner = owner
    ink = InkView(document: owner.document)
    super.init()
    pad.backgroundColor = .white
    pad.clipsToBounds = true
    pad.layer.borderWidth = 1
    pad.layer.borderColor = UIColor(red: 0.8, green: 0.83, blue: 0.9, alpha: 1).cgColor
    art.contentMode = .scaleToFill
    pad.addSubview(art)
    margin.backgroundColor = UIColor(red: 0.25, green: 0.42, blue: 0.95, alpha: 0.2)
    margin.isUserInteractionEnabled = false
    pad.addSubview(ink)
    pad.addSubview(margin)
    dim.fillRule = .evenOdd
    dim.fillColor = UIColor(white: 0, alpha: 0.09).cgColor
    frameLine.fillColor = nil
    frameLine.strokeColor = UIColor(red: 0.25, green: 0.42, blue: 0.95, alpha: 1).cgColor
    frameLine.lineWidth = 2
    controls.axis = .horizontal
    controls.spacing = 2
    controls.backgroundColor = .white
    controls.layer.cornerRadius = 12
    controls.isLayoutMarginsRelativeArrangement = true
    controls.layoutMargins = UIEdgeInsets(top: 2, left: 6, bottom: 2, right: 6)
    let items: [(String, String, Selector)] = [
      ("arrow.left", "Zoom window back", #selector(back)), ("arrow.right", "Zoom window forward", #selector(forward)),
      ("return", "Zoom window new line", #selector(newLine)), ("xmark", "Close zoom window", #selector(close)),
    ]
    for (icon, label, action) in items {
      let b = UIButton(type: .system)
      b.setImage(UIImage(systemName: icon), for: .normal)
      b.tintColor = UIColor(red: 0.23, green: 0.26, blue: 0.32, alpha: 1)
      b.accessibilityLabel = label
      b.contentEdgeInsets = UIEdgeInsets(top: 8, left: 10, bottom: 8, right: 10)
      b.addTarget(self, action: action, for: .touchUpInside)
      controls.addArrangedSubview(b)
    }
    pad.addSubview(controls)
  }

  func attach() {
    guard let o = owner else { return }
    o.layer.addSublayer(dim)
    o.layer.addSublayer(frameLine)
    o.addSubview(pad)
    o.ink.mirror = ink
    let z = max(0.01, o.canvas.zoomScale)
    let w = o.bounds.width * 0.5 / z
    let at = CGPoint(x: (o.canvas.contentOffset.x + o.bounds.width * 0.1) / z, y: (o.canvas.contentOffset.y + o.bounds.height * 0.3) / z)
    layout()
    move(to: CGRect(x: at.x, y: at.y, width: w, height: w * padHeight / max(1, o.bounds.width)))
  }

  func detach() {
    owner?.ink.mirror = nil
    dim.removeFromSuperlayer()
    frameLine.removeFromSuperlayer()
    pad.removeFromSuperview()
    ink.penUp()
  }

  func layout() {
    guard let o = owner else { return }
    padHeight = (o.bounds.height * 0.32).rounded()
    pad.frame = CGRect(x: 0, y: o.bounds.height - padHeight, width: o.bounds.width, height: padHeight)
    art.frame = pad.bounds
    ink.frame = pad.bounds
    margin.frame = CGRect(x: pad.bounds.width * 0.86, y: 0, width: pad.bounds.width * 0.14, height: padHeight)
    let size = controls.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
    controls.frame = CGRect(x: pad.bounds.width - size.width - 10, y: 8, width: size.width, height: size.height)
    o.bringSubviewToFront(pad)
    syncBox()
  }

  /// The box on the page, wherever the page has scrolled to.
  func syncBox() {
    guard let o = owner, !rect.isEmpty else { return }
    let r = o.pageHost.convert(rect, to: o)
    let shade = UIBezierPath(rect: CGRect(x: 0, y: 0, width: o.bounds.width, height: o.bounds.height - padHeight))
    shade.append(UIBezierPath(roundedRect: r, cornerRadius: 6))
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    dim.path = shade.cgPath
    frameLine.path = UIBezierPath(roundedRect: r, cornerRadius: 6).cgPath
    CATransaction.commit()
  }

  func move(to r: CGRect) {
    guard let o = owner else { return }
    var n = r
    let content = o.pageHost.bounds
    n.origin.x = max(content.minX, min(content.maxX - n.width, n.origin.x))
    n.origin.y = max(content.minY, min(content.maxY - n.height, n.origin.y))
    rect = n
    syncBox()
    refresh()
  }

  /// Redraws what's under the writing strip.
  func refresh() {
    guard let o = owner, pad.bounds.width > 1, !rect.isEmpty else { return }
    let r = rect
    let size = pad.bounds.size
    let k = size.width / r.width
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 2
    fmt.opaque = true
    art.image = UIGraphicsImageRenderer(size: size, format: fmt).image { c in
      UIColor.white.setFill()
      c.fill(CGRect(origin: .zero, size: size))
      c.cgContext.scaleBy(x: k, y: k)
      for (i, f) in o.frames.enumerated() where f.intersects(r) && i < o.specs.count {
        c.cgContext.saveGState()
        c.cgContext.translateBy(x: f.minX - r.minX, y: f.minY - r.minY)
        PageArt.draw(o.specs[i], in: c.cgContext)
        o.drawPictures(onPage: f, in: c.cgContext)
        o.drawTexts(onPage: f, in: c.cgContext)
        c.cgContext.restoreGState()
      }
    }
    ink.setPad(rect: r, size: size)
  }

  func contains(viewPoint p: CGPoint) -> Bool {
    guard let o = owner else { return false }
    return o.pageHost.convert(rect, to: o).insetBy(dx: -8, dy: -8).contains(p)
  }

  /// Where a touch in the strip lands on the page. nil: it isn't in the strip.
  func map(_ t: UITouch) -> CGPoint? {
    guard capturing else { return nil }
    let p = t.preciseLocation(in: pad)
    let k = rect.width / max(1, pad.bounds.width)
    return CGPoint(x: rect.minX + p.x * k, y: rect.minY + p.y * k)
  }

  func strokeEnded(_ bounds: CGRect) {
    if bounds.maxX > rect.minX + rect.width * 0.86 { forward() }
  }

  @objc func back() { move(to: rect.offsetBy(dx: -rect.width * 0.7, dy: 0)) }

  @objc func forward() {
    guard let o = owner else { return }
    if rect.maxX >= o.pageHost.bounds.maxX - 1 { newLine() } else { move(to: rect.offsetBy(dx: rect.width * 0.7, dy: 0)) }
  }

  @objc func newLine() {
    var n = rect
    n.origin.x = owner?.pageHost.bounds.minX ?? 0
    n.origin.y += n.height * 0.9
    move(to: n)
  }

  @objc func close() {
    owner?.onSelectionAction(["action": "zoomClosed"])
    owner?.setZoomWindow(false)
  }

  /// A finger on the box drags it; elsewhere on the page a tap moves it there.
  func drag(_ g: UIPanGestureRecognizer) {
    guard let o = owner else { return }
    let p = g.location(in: o.pageHost)
    switch g.state {
    case .began: dragFrom = p
    case .changed:
      if let f = dragFrom { move(to: rect.offsetBy(dx: p.x - f.x, dy: p.y - f.y)); dragFrom = p }
    default: dragFrom = nil
    }
  }
}

extension QuillCanvasView {
  func setZoomWindow(_ on: Bool) {
    if on {
      guard zoomWriter == nil, bounds.width > 1 else { return }
      let z = ZoomWriter(owner: self)
      zoomWriter = z
      z.attach()
      keyboardInset = z.pad.frame.height
      zoomPan.isEnabled = true
    } else {
      zoomWriter?.detach()
      zoomWriter = nil
      keyboardInset = 0
      zoomPan.isEnabled = false
    }
    refreshZoomInset()
  }

  @objc func onZoomPan(_ g: UIPanGestureRecognizer) { zoomWriter?.drag(g) }
}

// MARK: - Pinching

/// A pinch moves the pages with Core Animation and the ink with Metal, and the two reach the
/// screen at different moments: the writing lagged behind the page and ran off its edge. So
/// during a pinch the ink is a picture on each page, and they can't come apart.
extension QuillCanvasView {
  private func inkPicture(_ strokes: [InkStroke], page f: CGRect) -> CGImage? {
    let k: CGFloat = 3
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = k
    fmt.opaque = false
    let inside = strokes.filter { $0.bounds.intersects(f) }
    if inside.isEmpty { return nil }
    return UIGraphicsImageRenderer(size: f.size, format: fmt).image { InkRaster.draw(inside, rect: f, in: $0.cgContext) }.cgImage
  }

  private func nearPages(_ reach: Int = 3) -> ClosedRange<Int>? {
    guard !frames.isEmpty else { return nil }
    let i = currentPage()
    return max(0, i - reach)...min(frames.count - 1, i + reach)
  }

  private func trimInkPictures() {
    guard let wide = nearPages(4) else { return }
    let keep = Set(wide.compactMap { $0 < specs.count ? specs[$0].id : nil })
    for id in inkPictures.keys where !keep.contains(id) { inkPictures[id] = nil }
  }

  private func pictureIsCurrent(_ i: Int) -> Bool {
    guard let pic = inkPictures[specs[i].id] else { return false }
    return !document.changed(frames[i], since: pic.version)
  }

  /// Keeps the pictures ready, so a pinch starts without a pause: after each save, on opening a note
  /// and on reaching a new page. Only pages whose own ink changed are redone.
  func refreshInkPictures() {
    guard let near = nearPages(), !zoomPreviewing else { return }
    trimInkPictures()
    ink.prepare(document.strokes.filter { s in near.contains { frames[$0].intersects(s.bounds) } })
    pictureRun += 1
    let run = pictureRun
    let version = document.version
    let strokes = document.strokes.filter { !$0.lifted }
    let jobs = near.filter { $0 < specs.count && !pictureIsCurrent($0) }.map { (specs[$0].id, frames[$0]) }
    if jobs.isEmpty { return }
    DispatchQueue.global(qos: .utility).async { [weak self] in
      for (id, f) in jobs {
        // A newer round makes this one pointless.
        var live = false
        DispatchQueue.main.sync { live = self?.pictureRun == run }
        guard live, let self else { return }
        let image = autoreleasepool { self.inkPicture(strokes, page: f) }
        DispatchQueue.main.async {
          if !self.document.changed(f, since: version) { self.inkPictures[id] = (version, image) }
        }
      }
    }
  }

  /// Soon after arriving on a page, but not for every page passed on the way.
  func refreshInkPicturesSoon() {
    pictureSoon?.cancel()
    let w = DispatchWorkItem { [weak self] in self?.refreshInkPictures() }
    pictureSoon = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: w)
  }

  /// What's on screen now, in page coordinates.
  private func visibleContent() -> CGRect { canvas.convert(canvas.bounds, to: pageHost) }

  /// A sharp picture of the ink on screen, at this zoom, made while nothing's happening. A pinch then
  /// starts looking exactly as it did, instead of a page-sized picture stretched (which looked jagged).
  func refreshInkPatch() {
    guard !zoomPreviewing, glide == nil, !frames.isEmpty, canvas.bounds.width > 1 else { return }
    let z = canvas.zoomScale
    let seen = visibleContent()
    if let p = inkPatch, abs(p.zoom - z) < z * 0.001, p.rect.contains(seen), !document.changed(p.rect, since: p.version) { return }
    let rect = seen.insetBy(dx: -seen.width * 0.12, dy: -seen.height * 0.12).integral
    let screen = window?.screen.scale ?? UIScreen.main.scale
    let density = min(z * screen, 4096 / max(1, max(rect.width, rect.height)))
    patchRun += 1
    let run = patchRun, version = document.version
    let strokes = document.strokes.filter { !$0.lifted && $0.bounds.intersects(rect) }
    if strokes.isEmpty { inkPatch = (rect, z, version, nil); return }
    DispatchQueue.global(qos: .utility).async { [weak self] in
      let fmt = UIGraphicsImageRendererFormat()
      fmt.scale = density
      fmt.opaque = false
      let image = autoreleasepool {
        UIGraphicsImageRenderer(size: rect.size, format: fmt).image { InkRaster.draw(strokes, rect: rect, in: $0.cgContext) }.cgImage
      }
      DispatchQueue.main.async {
        guard let self, run == self.patchRun, !self.document.changed(rect, since: version) else { return }
        self.inkPatch = (rect, z, version, image)
      }
    }
  }

  /// The pictures for zooming are redrawn once writing has paused, not after every stroke, so they
  /// never take time from the stroke being written.
  func refreshAfterWriting() {
    writingIdle?.cancel()
    let w = DispatchWorkItem { [weak self] in
      guard let self else { return }
      if self.capture != nil || self.canvas.pencilDown { self.refreshAfterWriting(); return }
      self.refreshInkPictures()
      self.refreshInkPatch()
    }
    writingIdle = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: w)
  }

  func refreshInkPatchSoon() {
    patchSoon?.cancel()
    let w = DispatchWorkItem { [weak self] in self?.refreshInkPatch() }
    patchSoon = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: w)
  }

  private func showPatch() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    guard let p = inkPatch, let image = p.image, abs(p.zoom - canvas.zoomScale) < p.zoom * 0.01,
          !document.changed(p.rect, since: p.version) else {
      patchLayer.isHidden = true
      inkLowView.layer.mask = nil
      return
    }
    patchLayer.frame = p.rect
    patchLayer.contents = image
    patchLayer.isHidden = false
    let hole = CAShapeLayer()
    let path = UIBezierPath(rect: inkLowView.bounds)
    path.append(UIBezierPath(rect: p.rect))
    hole.path = path.cgPath
    hole.fillRule = .evenOdd
    inkLowView.layer.mask = hole
    GestureLog.add("sharp picture used")
  }

  private func hidePatch() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    patchLayer.isHidden = true
    patchLayer.contents = nil
    inkLowView.layer.mask = nil
    CATransaction.commit()
  }

  /// After a pinch: glides back to the page width if it ended near it or smaller, and back from
  /// too far in. Driven frame by frame, so the pages, the pictures and everything on them stay together.
  func settleZoom() -> Bool {
    guard glide == nil, !canvas.isDragging, !canvas.isZooming else { return false }
    let f = currentFit(), z = canvas.zoomScale
    let target: CGFloat
    if z < f * 1.08 && abs(z - f) > f * 0.003 { target = f }
    else if z > f * 5 { target = f * 5 }
    else { return false }
    let mid = CGPoint(x: canvas.bounds.width / 2, y: canvas.bounds.height / 2)
    let off0 = canvas.contentOffset
    let cp0 = CGPoint(x: (off0.x + mid.x) / z, y: (off0.y + mid.y) / z)
    let content = CGSize(width: canvas.contentSize.width / z, height: canvas.contentSize.height / z)
    let size1 = CGSize(width: content.width * target, height: content.height * target)
    let padX = max(0, (canvas.bounds.width - size1.width) / 2)
    let top = canvas.contentInset.top, bottom = canvas.contentInset.bottom
    var off1 = CGPoint(x: cp0.x * target - mid.x, y: cp0.y * target - mid.y)
    off1.x = min(max(off1.x, -padX), max(-padX, size1.width - canvas.bounds.width + padX))
    off1.y = min(max(off1.y, -top), max(-top, size1.height - canvas.bounds.height + bottom))
    let cp1 = CGPoint(x: (off1.x + mid.x) / target, y: (off1.y + mid.y) / target)
    GestureLog.add("glide to \(Int(target / f * 100))%")
    glide = ZoomGlide(duration: 0.32, step: { [weak self] e in
      guard let self else { return }
      let zz = z + (target - z) * e
      let cp = CGPoint(x: cp0.x + (cp1.x - cp0.x) * e, y: cp0.y + (cp1.y - cp0.y) * e)
      self.canvas.setZoomScale(zz, animated: false)
      self.canvas.contentOffset = CGPoint(x: cp.x * zz - mid.x, y: cp.y * zz - mid.y)
    }, done: { [weak self] in
      guard let self else { return }
      self.glide = nil
      self.updateTextScale()
      self.pinchEnded()
    })
    return true
  }

  func stopGlide() {
    guard let g = glide else { return }
    g.stop()
    glide = nil
  }

  func pinchBegan() {
    guard !zoomPreviewing, let near = nearPages() else { return }
    let began = CACurrentMediaTime()
    defer { GestureLog.add("pinch setup \(Int((CACurrentMediaTime() - began) * 1000)) ms") }
    trimInkPictures()
    pictureRun += 1
    zoomPreviewing = true
    let version = document.version
    let strokes = document.strokes.filter { !$0.lifted }
    // Only what's on screen has to be right this instant; the rest follow without holding up the pinch.
    let visibleArea = canvas.convert(canvas.bounds, to: pageHost)
    var later: [Int] = []
    for i in near where i < pageViewList.count {
      let id = specs[i].id
      if !pictureIsCurrent(i) {
        if frames[i].intersects(visibleArea) {
          inkPictures[id] = (version, inkPicture(strokes, page: frames[i]))
        } else { later.append(i) }
      }
      pageViewList[i].showInk(inkPictures[id]?.image, in: inkLowView)
    }
    let run = pictureRun
    if !later.isEmpty {
      let jobs = later.map { ($0, specs[$0].id, frames[$0]) }
      DispatchQueue.global(qos: .userInitiated).async { [weak self] in
        for (i, id, f) in jobs {
          guard let self else { return }
          let image = autoreleasepool { self.inkPicture(strokes, page: f) }
          DispatchQueue.main.async {
            guard run == self.pictureRun, self.zoomPreviewing, i < self.pageViewList.count else { return }
            self.inkPictures[id] = (version, image)
            self.pageViewList[i].showInk(image, in: self.inkLowView)
          }
        }
      }
    }
    showPatch()
    ink.dropPlate()
    ink.blank()
  }

  func pinchEnded() {
    guard zoomPreviewing else { return }
    // A pinch usually ends still sliding or with a finger down. The pictures stay on the pages until
    // everything has come to rest, because they can't come apart from them.
    if glide != nil || canvas.isZooming || canvas.isZoomBouncing || canvas.isDragging || canvas.isDecelerating {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.03) { [weak self] in self?.pinchEnded() }
      return
    }
    zoomPreviewing = false
    GestureLog.add("at rest, ink back")
    refreshZoomInset()     // places the ink for where the pinch ended
    // The pictures go once the sharp ink is on the screen (with a limit, in case that's never reported).
    let clear = { [weak self] in
      guard let self, !self.zoomPreviewing else { return }
      self.pageViewList.forEach { $0.showInk(nil, in: self.inkLowView) }
      self.hidePatch()
      self.refreshInkPatchSoon()
    }
    ink.resume(onShown: clear)
    let g = ink.showGeneration
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
      guard let self, !self.zoomPreviewing else { return }
      if g == self.ink.showGeneration && !self.ink.paused { self.ink.reveal() }
      clear()
    }
  }
}

/// Runs a short eased change once per screen update.
final class ZoomGlide {
  private var link: CADisplayLink?
  private let start = CACurrentMediaTime()
  private let duration: CFTimeInterval
  private let step: (CGFloat) -> Void
  private let done: () -> Void

  init(duration: CFTimeInterval, step: @escaping (CGFloat) -> Void, done: @escaping () -> Void) {
    self.duration = duration
    self.step = step
    self.done = done
    let l = CADisplayLink(target: self, selector: #selector(tick))
    l.add(to: .main, forMode: .common)
    link = l
  }

  @objc private func tick() {
    let t = min(1, (CACurrentMediaTime() - start) / duration)
    let e = 1 - pow(1 - t, 3)
    step(CGFloat(e))
    if t >= 1 {
      stop()
      done()
    }
  }

  func stop() {
    link?.invalidate()
    link = nil
  }
}

// MARK: - The zoom log

/// What happened to gestures, kept on the iPad, so a bad zoom can be looked at instead of guessed at.
/// Only times and event names; nothing that's written. Settings > Share zoom report sends it.
enum GestureLog {
  private static var lines: [String] = []
  private static var saving = false
  private static var link: CADisplayLink?
  private static let ticker = Ticker()
  private static var lastTick: CFTimeInterval = 0
  private static let started = CACurrentMediaTime()

  static var path: String {
    let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    return d.appendingPathComponent("quill-gesture.log").path
  }

  static func add(_ s: String) {
    lines.append(String(format: "%8.2f  ", CACurrentMediaTime() - started) + s)
    if lines.count > 1500 { lines.removeFirst(300) }
    if saving { return }
    saving = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
      saving = false
      let text = lines.joined(separator: "\n") + "\n"
      let to = path
      DispatchQueue.global(qos: .utility).async { try? text.write(toFile: to, atomically: true, encoding: .utf8) }
    }
  }

  /// While a pinch runs, notes any screen update that came late.
  static var watching = false {
    didSet {
      link?.invalidate()
      link = nil
      guard watching else { return }
      lastTick = 0
      let l = CADisplayLink(target: ticker, selector: #selector(Ticker.tick(_:)))
      l.add(to: .main, forMode: .common)
      link = l
    }
  }

  private final class Ticker: NSObject {
    @objc func tick(_ l: CADisplayLink) {
      if GestureLog.lastTick > 0 {
        let gap = (l.timestamp - GestureLog.lastTick) * 1000
        if gap > 34 { GestureLog.add("slow frame \(Int(gap)) ms") }
      }
      GestureLog.lastTick = l.timestamp
    }
  }
}

// MARK: - The colour wheel

/// Apple's colour picker, answering with a hex colour (empty if closed without one).
final class ColorPick: NSObject, UIColorPickerViewControllerDelegate {
  static var current: ColorPick?
  private let done: (String) -> Void
  private var picked = ""

  init(done: @escaping (String) -> Void) { self.done = done }

  static func show(start: String, from vc: UIViewController, done: @escaping (String) -> Void) {
    let session = ColorPick(done: done)
    current = session
    let p = UIColorPickerViewController()
    p.selectedColor = UIColor(hex: start)
    p.supportsAlpha = false
    p.delegate = session
    vc.present(p, animated: true)
  }

  func colorPickerViewControllerDidSelectColor(_ c: UIColorPickerViewController) {
    let rgb = c.selectedColor.inkRGB
    picked = String(format: "#%02X%02X%02X", rgb & 255, rgb >> 8 & 255, rgb >> 16 & 255)
  }

  func colorPickerViewControllerDidFinish(_ c: UIColorPickerViewController) {
    done(picked)
    ColorPick.current = nil
  }
}
