// What the Pencil does on the page: writing (with shape lock and the ruler),
// erasing, the lasso, and undo.
import UIKit
import UIKit.UIGestureRecognizerSubclass

/// One change to the ink, for undo.
struct InkEdit {
  var removed: [InkStroke]
  var added: [InkStroke]
}

enum InkMode { case write, erase, lasso }

/// Reports the Pencil (and a finger, if allowed) the instant it touches, with no waiting.
final class InkGesture: UIGestureRecognizer {
  weak var owner: QuillCanvasView?
  private var active: UITouch?
  private var startedAt: TimeInterval = 0

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    guard active == nil, let t = touches.first else {
      // A second finger right after the first means scrolling, not writing.
      if let a = active, a.type == .direct, event.timestamp - startedAt < 0.2 {
        owner?.inkCancelled()
        state = .cancelled
      } else {
        touches.forEach { ignore($0, for: event) }
      }
      return
    }
    if t.type == .direct && t.majorRadius > 40 { state = .failed; return }   // a palm
    active = t
    startedAt = event.timestamp
    state = .began
    owner?.inkBegan(t, event)
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let a = active, touches.contains(a) else { return }
    state = .changed
    owner?.inkMoved(a, event)
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let a = active, touches.contains(a) else { return }
    owner?.inkEnded(a, event)
    state = .ended
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let a = active, touches.contains(a) else { return }
    owner?.inkCancelled()
    state = .cancelled
  }

  override func reset() { active = nil }
}

/// A stroke while it's being written: steadies the raw points and applies the pen.
final class PenCapture {
  let pen: InkPen
  let wet: WetInk
  let zoom: Float
  private var fx: Float, fy: Float, rawX: Float, rawY: Float
  private var lastT: TimeInterval
  private var r: Float = 0, a: Float = 1
  private var dirX: Float = 1, dirY: Float = 0
  private var storedX: Float, storedY: Float
  var moveAnchor: CGPoint
  var lastMoveTime: TimeInterval
  var triedSnap = false
  var snap: (points: [CGPoint], closed: Bool, centre: CGPoint, anchor: CGPoint)?
  var rulerEdge: CGFloat?

  init(pen: InkPen, seq: UInt32, zoom: CGFloat, at p: CGPoint, time: TimeInterval) {
    self.pen = pen
    self.zoom = Float(max(0.01, zoom))
    wet = WetInk(rgb: pen.rgb, kind: pen.kind, seq: seq)
    fx = Float(p.x); fy = Float(p.y); rawX = fx; rawY = fy
    storedX = fx; storedY = fy
    lastT = time
    moveAnchor = p
    lastMoveTime = CACurrentMediaTime()
  }

  private func pressure(force: Float, speed: Float) -> Float {
    if force > 0 { return min(1, force * 2.2) }
    return max(0.25, 0.6 - speed / 3000 * 0.35)   // a finger has no pressure: slow is a little heavier
  }

  /// One real sample from the Pencil.
  func add(_ p: CGPoint, force: Float, altitude: Float, time: TimeInterval, first: Bool) {
    let x = Float(p.x), y = Float(p.y)
    let dt = Float(max(0.001, time - lastT))
    let speed = hypot(x - rawX, y - rawY) * zoom / dt
    lastT = time
    // Holds a slow line steady without making a fast one lag.
    let tau = 1 / (2 * Float.pi * (12 + 0.1 * speed))
    let k = first ? 1 : 1 / (1 + tau / dt)
    let oldX = fx, oldY = fy
    fx += (x - fx) * k
    fy += (y - fy) * k
    rawX = x; rawY = y
    let mx = fx - oldX, my = fy - oldY, moved = hypot(mx, my)
    if moved > 0.05 {
      dirX += (mx / moved - dirX) * 0.25
      dirY += (my / moved - dirY) * 0.25
      let l = max(0.001, hypot(dirX, dirY))
      dirX /= l; dirY /= l
    }
    let want = pen.shape(p: pressure(force: force, speed: speed), dirX: dirX, dirY: dirY, altitude: altitude)
    if first {
      r = pen.tapers ? want.r * 0.6 : want.r
      a = want.a
      wet.append(InkPoint(x: fx, y: fy, r: r, a: a))
      return
    }
    let ease = 1 - exp(-dt / 0.02)
    r += (want.r - r) * ease
    a += (want.a - a) * ease
    if hypot(fx - storedX, fy - storedY) * zoom >= 0.5 {
      wet.append(InkPoint(x: fx, y: fy, r: r, a: a))
      storedX = fx; storedY = fy
    }
  }

  /// Redraws the end of the line, out to the Pencil and where it's heading.
  func refresh(predicted: [CGPoint]) {
    var ahead = [InkPoint(x: rawX, y: rawY, r: r, a: a)]
    for p in predicted { ahead.append(InkPoint(x: Float(p.x), y: Float(p.y), r: r, a: a)) }
    wet.refresh(ahead: ahead)
  }

  /// The finished line.
  func finishedPoints() -> [InkPoint] {
    if snap != nil { return wet.pts }
    var pts = wet.pts
    if let last = pts.last, hypot(last.x - rawX, last.y - rawY) > 0.05 { pts.append(InkPoint(x: rawX, y: rawY, r: r, a: a)) }
    if pen.tapers && pts.count > 2 {
      let reach = max(4, pen.width * 3)
      var run: Float = 0
      var i = pts.count - 1
      while i > 0 && run < reach {
        pts[i].r *= 0.35 + 0.65 * run / reach
        run += hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
        i -= 1
      }
    }
    return pts
  }
}

/// A ruler to draw along: two fingers move and turn it; the Pencil follows its edge.
final class RulerView: UIView, UIGestureRecognizerDelegate {
  private let length: CGFloat = 2600
  private let thickness: CGFloat = 92

  override init(frame: CGRect) {
    super.init(frame: frame)
    bounds = CGRect(x: 0, y: 0, width: length, height: thickness)
    isOpaque = false
    backgroundColor = .clear
    let move = UIPanGestureRecognizer(target: self, action: #selector(onMove(_:)))
    let turn = UIRotationGestureRecognizer(target: self, action: #selector(onTurn(_:)))
    for g in [move, turn] as [UIGestureRecognizer] {
      g.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
      g.delegate = self
      addGestureRecognizer(g)
    }
  }

  required init?(coder: NSCoder) { fatalError() }

  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

  @objc private func onMove(_ g: UIPanGestureRecognizer) {
    let d = g.translation(in: superview)
    center = CGPoint(x: center.x + d.x, y: center.y + d.y)
    g.setTranslation(.zero, in: superview)
  }

  @objc private func onTurn(_ g: UIRotationGestureRecognizer) {
    transform = transform.rotated(by: g.rotation)
    g.rotation = 0
  }

  override func draw(_ rect: CGRect) {
    guard let c = UIGraphicsGetCurrentContext() else { return }
    c.setFillColor(UIColor(white: 0.12, alpha: 0.62).cgColor)
    c.fill(bounds)
    c.setFillColor(UIColor(white: 1, alpha: 0.85).cgColor)
    var x: CGFloat = 0, i = 0
    while x < length {
      let h: CGFloat = i % 10 == 0 ? 18 : i % 5 == 0 ? 12 : 7
      c.fill(CGRect(x: x, y: 0, width: 1, height: h))
      c.fill(CGRect(x: x, y: thickness - h, width: 1, height: h))
      x += 10; i += 1
    }
  }

  /// The edge a stroke starting here should follow, if it's close enough.
  func edge(near p: CGPoint) -> CGFloat? {
    guard p.y > -30, p.y < thickness + 30 else { return nil }
    return p.y < thickness / 2 ? 0 : thickness
  }
}

extension QuillCanvasView {
  // MARK: - Touches

  private func location(_ t: UITouch) -> CGPoint { t.preciseLocation(in: pageHost) }

  /// The page stays still while writing. A palm that had started to scroll is put back.
  private func holdPageStill() {
    scrollBack?.cancel()
    scrollBack = nil
    let palm = canvas.isDragging
    canvas.panGestureRecognizer.isEnabled = false
    canvas.pinchGestureRecognizer?.isEnabled = false
    canvas.setContentOffset(palm ? dragStartOffset : canvas.contentOffset, animated: false)
  }

  private func letPageMove() {
    scrollBack?.cancel()
    let w = DispatchWorkItem { [weak self] in
      self?.canvas.panGestureRecognizer.isEnabled = true
      self?.canvas.pinchGestureRecognizer?.isEnabled = true
    }
    scrollBack = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25, execute: w)
  }

  func inkBegan(_ t: UITouch, _ event: UIEvent) {
    guard isLoaded else { return }
    holdPageStill()
    let p = location(t)
    switch inkMode {
    case .write: beginStroke(t, event, p)
    case .erase: beginErase(p)
    case .lasso: beginLasso(p)
    }
  }

  func inkMoved(_ t: UITouch, _ event: UIEvent) {
    guard isLoaded else { return }
    switch inkMode {
    case .write: moveStroke(t, event)
    case .erase: moveErase((event.coalescedTouches(for: t) ?? [t]).map { location($0) })
    case .lasso: moveLasso(location(t))
    }
  }

  func inkEnded(_ t: UITouch, _ event: UIEvent) {
    guard isLoaded else { return }
    switch inkMode {
    case .write: endStroke(t, event)
    case .erase: endErase()
    case .lasso: endLasso()
    }
    letPageMove()
  }

  func inkCancelled() {
    capture = nil
    ink.wet = nil
    ink.penUp()
    ink.setNeedsInk()
    if inkMode == .erase { endErase() }
    if inkMode == .lasso { endLasso() }
    letPageMove()
  }

  // MARK: - Writing

  private func onRuler(_ p: CGPoint, _ edge: CGFloat) -> CGPoint {
    guard let ruler else { return p }
    var q = ruler.convert(pageHost.convert(p, to: self), from: self)
    q.y = edge
    return pageHost.convert(ruler.convert(q, to: self), from: self)
  }

  private func beginStroke(_ t: UITouch, _ event: UIEvent, _ p: CGPoint) {
    let c = PenCapture(pen: pen, seq: document.nextSeq(), zoom: canvas.zoomScale, at: p, time: t.timestamp)
    if let ruler { c.rulerEdge = ruler.edge(near: ruler.convert(pageHost.convert(p, to: self), from: self)) }
    capture = c
    ink.wet = c.wet
    ink.penDown()
    feed(c, t, event, first: true)
  }

  private func moveStroke(_ t: UITouch, _ event: UIEvent) {
    guard let c = capture else { return }
    feed(c, t, event, first: false)
  }

  private func feed(_ c: PenCapture, _ t: UITouch, _ event: UIEvent, first: Bool) {
    let samples = event.coalescedTouches(for: t) ?? [t]
    for (i, s) in samples.enumerated() {
      var p = location(s)
      if let e = c.rulerEdge { p = onRuler(p, e) }
      let force = s.type == .pencil && s.maximumPossibleForce > 0 ? Float(s.force / s.maximumPossibleForce) : 0
      let altitude = s.type == .pencil ? Float(s.altitudeAngle) : Float.pi / 2
      if c.snap == nil { c.add(p, force: force, altitude: altitude, time: s.timestamp, first: first && i == 0) }
      let onScreen = hypot(p.x - c.moveAnchor.x, p.y - c.moveAnchor.y) * canvas.zoomScale
      if onScreen > 4 {
        c.moveAnchor = p
        c.lastMoveTime = CACurrentMediaTime()
        c.triedSnap = false
      }
    }
    var now = location(samples.last ?? t)
    if let e = c.rulerEdge { now = onRuler(now, e) }
    if c.snap != nil {
      reshapeSnap(c, to: now)
    } else {
      var ahead = (event.predictedTouches(for: t) ?? []).map { location($0) }
      if let e = c.rulerEdge { ahead = ahead.map { onRuler($0, e) } }
      c.refresh(predicted: ahead)
    }
    ink.drawNow()
  }

  /// Runs every display frame while the Pencil is down: has it been held still long enough?
  func inkTick() {
    guard shapeSnap, let c = capture, c.snap == nil, !c.triedSnap, c.rulerEdge == nil, c.pen.kind != .marker,
          CACurrentMediaTime() - c.lastMoveTime >= ShapeSnap.holdTime else { return }
    c.triedSnap = true
    let pts = c.wet.pts.map { CGPoint(x: CGFloat($0.x), y: CGFloat($0.y)) }
    guard let o = ShapeSnap.outline(pts), let anchor = pts.last else { return }
    let box = o.points.reduce(CGRect.null) { $0.union(CGRect(origin: $1, size: .zero)) }
    c.snap = (o.points, o.closed, CGPoint(x: box.midX, y: box.midY), anchor)
    setSnapped(c, o.points)
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
    ink.drawNow()
  }

  /// After a snap the Pencil keeps control: it drags the end of a line, or sizes a shape.
  private func reshapeSnap(_ c: PenCapture, to p: CGPoint) {
    guard let s = c.snap else { return }
    if !s.closed {
      setSnapped(c, [s.points[0], p])
    } else {
      let k = ShapeSnap.dist(p, s.centre) / max(1, ShapeSnap.dist(s.anchor, s.centre))
      setSnapped(c, s.points.map { CGPoint(x: s.centre.x + ($0.x - s.centre.x) * k, y: s.centre.y + ($0.y - s.centre.y) * k) })
    }
  }

  private func setSnapped(_ c: PenCapture, _ outline: [CGPoint]) {
    let pts = c.wet.pts
    let n = Float(max(1, pts.count))
    let r = pts.reduce(Float(0)) { $0 + $1.r } / n
    let a = pts.reduce(Float(0)) { $0 + $1.a } / n
    c.wet.reset(ShapeSnap.dense(outline).map { InkPoint(x: Float($0.x), y: Float($0.y), r: r, a: a) })
  }

  private func endStroke(_ t: UITouch, _ event: UIEvent) {
    guard let c = capture else { return }
    if c.snap == nil {
      var p = location(t)
      if let e = c.rulerEdge { p = onRuler(p, e) }
      let force = t.type == .pencil && t.maximumPossibleForce > 0 ? Float(t.force / t.maximumPossibleForce) : 0
      c.add(p, force: force, altitude: t.type == .pencil ? Float(t.altitudeAngle) : Float.pi / 2, time: t.timestamp, first: false)
    }
    capture = nil
    let stroke = InkStroke(pts: c.finishedPoints(), rgb: c.pen.rgb, kind: c.pen.kind, seq: c.wet.seq)
    document.apply(removed: [], added: [stroke])
    record(InkEdit(removed: [], added: [stroke]))
    ink.wet = nil
    ink.settle([stroke])
    ink.drawNow()
    ink.penUp()
  }

  // MARK: - Undo

  private func record(_ e: InkEdit) {
    undoStack.append(e)
    redoStack.removeAll()
    inkChanged()
  }

  func inkChanged() {
    markDirty()
    let now = CACurrentMediaTime()
    if now - lastEmit > 0.25 || undoStack.count <= 1 { lastEmit = now; emitState() }
  }

  func undo() {
    clearSelection()
    guard let e = undoStack.popLast() else { return }
    document.apply(removed: e.added, added: e.removed)
    redoStack.append(e)
    ink.setNeedsInk(rebuild: true)
    markDirty()
    emitState()
  }

  func redo() {
    clearSelection()
    guard let e = redoStack.popLast() else { return }
    document.apply(removed: e.removed, added: e.added)
    undoStack.append(e)
    ink.setNeedsInk(rebuild: true)
    markDirty()
    emitState()
  }

  // MARK: - Eraser

  private var eraserRadius: CGFloat { eraserWidth / 2 / max(0.2, canvas.zoomScale / max(0.05, currentFit())) }

  private func beginErase(_ p: CGPoint) {
    eraseLast = p
    eraseRemoved = []
    eraseAdded = []
    eraseStep(to: p)
    showEraser(at: p)
  }

  private func moveErase(_ points: [CGPoint]) {
    points.forEach { eraseStep(to: $0) }
    if let p = points.last { showEraser(at: p) }
  }

  private func eraseStep(to p: CGPoint) {
    let from = eraseLast
    eraseLast = p
    let radius = eraserRadius
    var gone: [InkStroke] = [], parts: [InkStroke] = []
    for s in document.strokes {
      guard let left = s.erased(from: from, to: p, radius: radius) else { continue }
      gone.append(s)
      parts.append(contentsOf: left)
    }
    if gone.isEmpty { return }
    document.apply(removed: gone, added: parts)
    // Pieces cut twice in one sweep count once in the undo.
    for s in gone {
      if let i = eraseAdded.firstIndex(where: { $0 === s }) { eraseAdded.remove(at: i) } else { eraseRemoved.append(s) }
    }
    eraseAdded.append(contentsOf: parts)
    ink.setNeedsInk(rebuild: true)
  }

  private func endErase() {
    eraserRing.isHidden = true
    if eraseRemoved.isEmpty && eraseAdded.isEmpty { return }
    record(InkEdit(removed: eraseRemoved, added: eraseAdded))
    eraseRemoved = []
    eraseAdded = []
  }

  private func showEraser(at p: CGPoint) {
    let c = pageHost.convert(p, to: self)
    let r = eraserRadius * canvas.zoomScale
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    eraserRing.isHidden = false
    eraserRing.path = UIBezierPath(ovalIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)).cgPath
    CATransaction.commit()
  }

  // MARK: - Lasso

  private func beginLasso(_ p: CGPoint) {
    if !selection.isEmpty {
      if beginDragSelection(at: p) { return }
      clearSelection()
    }
    lassoPts = [p]
    lassoLayer.isHidden = false
    drawLassoLine()
  }

  private func moveLasso(_ p: CGPoint) {
    if selDrag != nil { dragSelection(to: p); return }
    lassoPts.append(p)
    drawLassoLine()
  }

  private func endLasso() {
    if selDrag != nil { selDrag = nil; return }
    lassoLayer.isHidden = true
    defer { lassoPts = [] }
    guard lassoPts.count > 3 else { return }
    let area = CGMutablePath()
    area.addLines(between: lassoPts)
    area.closeSubpath()
    let box = area.boundingBoxOfPath
    let picked = document.strokes.filter { s in
      guard s.bounds.intersects(box) else { return false }
      let inside = s.pts.reduce(0) { $0 + (area.contains(CGPoint(x: CGFloat($1.x), y: CGFloat($1.y))) ? 1 : 0) }
      return inside * 2 >= s.pts.count
    }
    select(picked)
  }

  private func drawLassoLine() {
    let path = CGMutablePath()
    path.addLines(between: lassoPts.map { pageHost.convert($0, to: self) })
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    lassoLayer.path = path
    CATransaction.commit()
  }

  private func select(_ strokes: [InkStroke]) {
    selection = strokes
    guard !strokes.isEmpty else { selPan.isEnabled = false; selTap.isEnabled = false; return }
    strokes.forEach { $0.lifted = true }
    selBox = strokes.reduce(CGRect.null) { $0.union($1.bounds) }
    ink.liftedTransform = .identity
    selPan.isEnabled = true
    selTap.isEnabled = true
    ink.setNeedsInk(rebuild: true)
    placeSelectionUI()
  }

  /// Lets go of the selection, leaving it where it was moved to.
  func clearSelection() {
    guard !selection.isEmpty else { return }
    let t = ink.liftedTransform
    let picked = selection
    picked.forEach { $0.lifted = false }
    selection = []
    selDrag = nil
    ink.liftedTransform = .identity
    selPan.isEnabled = false
    selTap.isEnabled = false
    selOutline.isHidden = true
    selHandle.isHidden = true
    selBar.isHidden = true
    if t != .identity {
      let moved = picked.map { $0.moved(t) }
      document.apply(removed: picked, added: moved)
      record(InkEdit(removed: picked, added: moved))
    }
    ink.setNeedsInk(rebuild: true)
  }

  private func selectionRect() -> CGRect { selBox.applying(ink.liftedTransform) }

  private func handleHit(_ p: CGPoint) -> Bool {
    let r = selectionRect()
    return hypot(p.x - r.maxX, p.y - r.maxY) * canvas.zoomScale < 34
  }

  /// Starts moving (inside the box) or sizing (its corner handle). False if `p` missed both.
  private func beginDragSelection(at p: CGPoint) -> Bool {
    let r = selectionRect()
    if handleHit(p) {
      selDrag = (p, ink.liftedTransform, true)
    } else if r.insetBy(dx: -12 / canvas.zoomScale, dy: -12 / canvas.zoomScale).contains(p) {
      selDrag = (p, ink.liftedTransform, false)
    } else {
      return false
    }
    return true
  }

  private func dragSelection(to p: CGPoint) {
    guard let d = selDrag else { return }
    if d.sizing {
      // Sizes from the opposite corner, keeping the proportions.
      let r = selBox.applying(d.base)
      let k = max(0.1, max((p.x - r.minX) / max(1, r.width), (p.y - r.minY) / max(1, r.height)))
      let about = CGPoint(x: r.minX, y: r.minY)
      ink.liftedTransform = d.base
        .concatenating(CGAffineTransform(translationX: -about.x, y: -about.y))
        .concatenating(CGAffineTransform(scaleX: k, y: k))
        .concatenating(CGAffineTransform(translationX: about.x, y: about.y))
    } else {
      ink.liftedTransform = d.base.concatenating(CGAffineTransform(translationX: p.x - d.from.x, y: p.y - d.from.y))
    }
    placeSelectionUI()
    ink.drawNow()
  }

  /// A finger can move a selection too (fingers otherwise scroll the page).
  func selectionWantsTouch(at viewPoint: CGPoint) -> Bool {
    guard !selection.isEmpty else { return false }
    let p = pageHost.convert(viewPoint, from: self)
    return handleHit(p) || selectionRect().contains(p)
  }

  @objc func onSelPan(_ g: UIPanGestureRecognizer) {
    let p = g.location(in: pageHost)
    switch g.state {
    case .began: _ = beginDragSelection(at: p)
    case .changed: dragSelection(to: p)
    default: selDrag = nil
    }
  }

  @objc func onSelTap(_ g: UITapGestureRecognizer) {
    if !selectionWantsTouch(at: g.location(in: self)) { clearSelection() }
  }

  @objc func onSelDelete() {
    let picked = selection
    picked.forEach { $0.lifted = false }
    ink.liftedTransform = .identity
    selection = []
    clearSelectionUI()
    document.apply(removed: picked, added: [])
    record(InkEdit(removed: picked, added: []))
    ink.setNeedsInk(rebuild: true)
  }

  @objc func onSelDuplicate() {
    let picked = selection
    let t = ink.liftedTransform
    clearSelection()
    let source = picked.map { t == .identity ? $0 : $0.moved(t) }
    let shift = CGAffineTransform(translationX: 24, y: 24)
    let copies = source.map { s -> InkStroke in
      let m = s.moved(shift)
      return InkStroke(pts: m.pts, rgb: m.rgb, kind: m.kind, seq: document.nextSeq())
    }
    document.apply(removed: [], added: copies)
    record(InkEdit(removed: [], added: copies))
    select(copies)
  }

  private func clearSelectionUI() {
    selPan.isEnabled = false
    selTap.isEnabled = false
    selOutline.isHidden = true
    selHandle.isHidden = true
    selBar.isHidden = true
  }

  /// Keeps the box, handle and buttons on the selection as it or the page moves.
  func placeSelectionUI() {
    guard !selection.isEmpty else { return }
    let r = pageHost.convert(selectionRect(), to: self).insetBy(dx: -6, dy: -6)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    selOutline.isHidden = false
    selOutline.path = UIBezierPath(roundedRect: r, cornerRadius: 6).cgPath
    selHandle.isHidden = false
    selHandle.path = UIBezierPath(ovalIn: CGRect(x: r.maxX - 9, y: r.maxY - 9, width: 18, height: 18)).cgPath
    CATransaction.commit()
    selBar.isHidden = false
    bringSubviewToFront(selBar)
    let size = selBar.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
    let x = max(8, min(bounds.width - size.width - 8, r.midX - size.width / 2))
    let y = r.minY - size.height - 10 > 8 ? r.minY - size.height - 10 : min(bounds.height - size.height - 8, r.maxY + 16)
    selBar.frame = CGRect(x: x, y: y, width: size.width, height: size.height)
  }

  func makeSelectionUI() {
    for l in [lassoLayer, selOutline] {
      l.fillColor = nil
      l.strokeColor = tintBlue.cgColor
      l.lineWidth = 1.5
      l.lineDashPattern = [6, 5]
      l.isHidden = true
      layer.addSublayer(l)
    }
    selHandle.fillColor = UIColor.white.cgColor
    selHandle.strokeColor = tintBlue.cgColor
    selHandle.lineWidth = 2
    selHandle.isHidden = true
    layer.addSublayer(selHandle)
    eraserRing.fillColor = UIColor(white: 1, alpha: 0.35).cgColor
    eraserRing.strokeColor = UIColor(white: 0.25, alpha: 0.7).cgColor
    eraserRing.lineWidth = 1
    eraserRing.isHidden = true
    layer.addSublayer(eraserRing)

    selBar.axis = .horizontal
    selBar.spacing = 4
    selBar.backgroundColor = UIColor(white: 0.12, alpha: 0.92)
    selBar.layer.cornerRadius = 18
    selBar.isLayoutMarginsRelativeArrangement = true
    selBar.layoutMargins = UIEdgeInsets(top: 0, left: 8, bottom: 0, right: 8)
    selBar.isHidden = true
    for (title, action) in [("Duplicate", #selector(onSelDuplicate)), ("Delete", #selector(onSelDelete))] {
      let b = UIButton(type: .system)
      b.setTitle(title, for: .normal)
      b.setTitleColor(.white, for: .normal)
      b.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
      b.contentEdgeInsets = UIEdgeInsets(top: 8, left: 10, bottom: 8, right: 10)
      b.addTarget(self, action: action, for: .touchUpInside)
      selBar.addArrangedSubview(b)
    }
    addSubview(selBar)
  }

  private var tintBlue: UIColor { UIColor(red: 0, green: 0.48, blue: 1, alpha: 1) }

  // MARK: - Ruler

  func setRuler(_ on: Bool) {
    if !on { ruler?.removeFromSuperview(); ruler = nil; return }
    guard ruler == nil else { return }
    let r = RulerView()
    r.center = CGPoint(x: bounds.midX, y: bounds.midY)
    r.transform = CGAffineTransform(rotationAngle: -.pi / 12)
    addSubview(r)
    ruler = r
  }
}
