// What the Pencil does on the page: writing (with shape lock and the ruler),
// erasing, the lasso, and undo.
import UIKit
import UIKit.UIGestureRecognizerSubclass

/// One change to the ink, for undo.
struct InkEdit {
  var removed: [InkStroke]
  var added: [InkStroke]
  var objects: (before: InkObjects, after: InkObjects)? = nil
}

enum InkMode { case write, erase, lasso, tape, laser, comment }

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
    // The system took the Pencil's touch back: what was written stays. (A cancelled finger
    // is usually the start of a two-finger scroll, so that one is dropped.)
    if a.type == .direct { owner?.inkCancelled() } else { owner?.inkEnded(a, event) }
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
  private var lastSpeed: Float = 0
  private var storedX: Float, storedY: Float
  var moveAnchor: CGPoint
  var lastMoveTime: TimeInterval
  var triedSnap = false
  var snap: (points: [CGPoint], closed: Bool, centre: CGPoint, anchor: CGPoint)?
  var rulerEdge: CGFloat?
  let startedAt = Date().timeIntervalSince1970   // when it was written, to line up with a recording

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
    // Light enough that the line lands where the tip was drawn: heavier filtering
    // made the ink visibly shift just after it appeared.
    if !first { lastSpeed += (speed - lastSpeed) * 0.2 }
    let tau = 1 / (2 * Float.pi * (pen.stabilize ? 7 : 24 + 0.2 * speed))
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
    if hypot(fx - storedX, fy - storedY) * zoom >= 1 {
      wet.append(InkPoint(x: fx, y: fy, r: r, a: a))
      storedX = fx; storedY = fy
    }
  }

  /// Redraws the end of the line, out to the Pencil and where it's heading.
  func refresh(predicted: [CGPoint]) {
    var ahead = [InkPoint(x: rawX, y: rawY, r: r, a: a)]
    // Barely moving: a guess at where the Pencil is going is only noise, and it makes the tip flicker.
    if lastSpeed > 150 {
      let reach = 20 / zoom
      for p in predicted {
        let x = Float(p.x), y = Float(p.y)
        if hypot(x - rawX, y - rawY) > reach { break }
        ahead.append(InkPoint(x: x, y: y, r: r, a: a))
      }
    }
    wet.refresh(ahead: ahead)
  }

  /// The finished line.
  func finishedPoints() -> [InkPoint] {
    if snap != nil { return wet.pts }
    var pts = wet.pts
    if let last = pts.last, hypot(last.x - rawX, last.y - rawY) > 0.05 { pts.append(InkPoint(x: rawX, y: rawY, r: r, a: a)) }
    return pts
  }
}

/// A ruler to draw along: two fingers move and turn it; the Pencil follows its edge.
final class RulerView: UIView, UIGestureRecognizerDelegate {
  private let length: CGFloat = 2600
  private let thickness: CGFloat = 112
  private var angle: CGFloat = 0

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
    angle += g.rotation
    g.rotation = 0
    setNeedsDisplay()
  }

  override func draw(_ rect: CGRect) {
    guard let c = UIGraphicsGetCurrentContext() else { return }
    c.setFillColor(UIColor(red: 0.965, green: 0.965, blue: 0.98, alpha: 0.86).cgColor)
    c.fill(bounds)
    let ink = UIColor(red: 0.2, green: 0.23, blue: 0.3, alpha: 1)
    c.setFillColor(ink.cgColor)
    c.fill(CGRect(x: 0, y: 0, width: length, height: 1))
    c.fill(CGRect(x: 0, y: thickness - 1, width: length, height: 1))
    // Inches counted out from the middle, an eighth at a time.
    let eighth: CGFloat = 16, mid = length / 2
    let label: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 13), .foregroundColor: ink]
    for side in [-1, 1] as [CGFloat] {
      var i = 0
      while CGFloat(i) * eighth < mid {
        let x = mid + side * CGFloat(i) * eighth
        let h: CGFloat = i % 8 == 0 ? 20 : i % 4 == 0 ? 14 : 8
        c.fill(CGRect(x: x, y: 0, width: 1, height: h))
        c.fill(CGRect(x: x, y: thickness - h, width: 1, height: h))
        if i % 8 == 0 && i > 0 {
          let n = "\(i / 8)" as NSString
          let w = n.size(withAttributes: label).width
          n.draw(at: CGPoint(x: x - w / 2, y: 24), withAttributes: label)
          c.saveGState()
          c.translateBy(x: x, y: thickness - 24)
          c.rotate(by: .pi)
          n.draw(at: CGPoint(x: -w / 2, y: 0), withAttributes: label)
          c.restoreGState()
        }
        i += 1
      }
    }
    // The dial, showing how far it's turned.
    let r: CGFloat = 32
    let dial = CGRect(x: mid - r, y: thickness / 2 - r, width: r * 2, height: r * 2)
    c.saveGState()
    c.setShadow(offset: CGSize(width: 0, height: 1), blur: 5, color: UIColor(white: 0, alpha: 0.35).cgColor)
    c.setFillColor(UIColor.white.cgColor)
    c.fillEllipse(in: dial)
    c.restoreGState()
    c.setStrokeColor(ink.cgColor)
    c.setLineWidth(1)
    for k in 0..<36 {
      let t = CGFloat(k) * .pi / 18, inner = r - (k % 9 == 0 ? 9 : 5)
      c.move(to: CGPoint(x: mid + cos(t) * inner, y: thickness / 2 + sin(t) * inner))
      c.addLine(to: CGPoint(x: mid + cos(t) * r, y: thickness / 2 + sin(t) * r))
    }
    c.strokePath()
    var degrees = Int((angle * 180 / .pi).rounded()) % 360
    if degrees < 0 { degrees += 360 }
    let text = "\(degrees)°" as NSString
    let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: ink]
    let size = text.size(withAttributes: attrs)
    text.draw(at: CGPoint(x: mid - size.width / 2, y: thickness / 2 - size.height / 2), withAttributes: attrs)
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
    // Long enough to cover the pause between words, when a resting hand would move the page.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.7, execute: w)
  }

  func inkBegan(_ t: UITouch, _ event: UIEvent) {
    guard isLoaded else { return }
    if t.type != .direct { holdPageStill() }   // a writing finger still lets two fingers scroll
    let p = location(t)
    switch inkMode {
    case .write: beginStroke(t, event, p)
    case .erase: beginErase(p)
    case .lasso: beginLasso(p)
    case .tape: beginTape(p)
    case .laser: laserDown = true; beginLaser(p)
    case .comment: break
    }
  }

  func inkMoved(_ t: UITouch, _ event: UIEvent) {
    guard isLoaded else { return }
    switch inkMode {
    case .write: moveStroke(t, event)
    case .erase: moveErase((event.coalescedTouches(for: t) ?? [t]).map { location($0) })
    case .lasso: moveLasso(location(t))
    case .tape: moveTape(location(t))
    case .laser: moveLaser(location(t))
    case .comment: break
    }
  }

  func inkEnded(_ t: UITouch, _ event: UIEvent) {
    guard isLoaded else { return }
    switch inkMode {
    case .write: endStroke(t, event)
    case .erase: endErase()
    case .lasso: endLasso()
    case .tape: endTape(location(t))
    case .laser: laserDown = false
    case .comment: if t.type != .direct { tappedForComment(at: location(t)) }   // a finger tap arrives by its own route
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
    if inkMode == .tape { tapeDraft?.removeFromSuperview(); tapeDraft = nil }
    laserDown = false
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
    // A writing finger tapping tape is revealing it, not leaving a dot.
    if t.type == .direct && tapeAt(p) != nil { return }
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
    ink.lastInputTime = samples.last?.timestamp ?? t.timestamp
    if ink.stats.on {
      let now = CACurrentMediaTime()
      if !first && now - ink.stats.lastMove > 0.05 { ink.stats.stalls += 1 }
      ink.stats.lastMove = now
      ink.stats.samples += samples.count
    }
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
    if ink.stats.on, let text = ink.stats.report(now: CACurrentMediaTime()) { showStats(text) }
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
    let stroke = InkStroke(pts: c.finishedPoints(), rgb: c.pen.rgb, kind: c.pen.kind, seq: c.wet.seq, ts: c.startedAt)
    document.apply(removed: [], added: [stroke])
    record(InkEdit(removed: [], added: [stroke]))
    ink.wet = nil
    ink.settle([stroke])
    ink.drawNow(finishing: true)
    ink.penUp()
  }

  // MARK: - Undo

  func record(_ e: InkEdit) {
    undoStack.append(e)
    redoStack.removeAll()
    inkChanged()
    checkLastPage()
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
    if let o = e.objects { restoreObjects(o.before) }
    redoStack.append(e)
    ink.setNeedsInk(rebuild: true)
    markDirty()
    emitState()
  }

  func redo() {
    clearSelection()
    guard let e = redoStack.popLast() else { return }
    document.apply(removed: e.removed, added: e.added)
    if let o = e.objects { restoreObjects(o.after) }
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
    eraseTape(at: p, radius: radius)
    for s in document.strokes {
      if eraserMode == "hl" && s.kind != .marker { continue }
      guard let left = s.erased(from: from, to: p, radius: radius) else { continue }
      gone.append(s)
      if eraserMode != "stroke" { parts.append(contentsOf: left) }   // "stroke": the whole line goes
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
    objectsChanged()
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

  // MARK: - Speed readout

  func setInkStats(_ on: Bool) {
    ink.stats.on = on
    statsLabel.removeFromSuperview()
    guard on else { return }
    statsLabel.numberOfLines = 0
    statsLabel.font = .monospacedDigitSystemFont(ofSize: 13, weight: .semibold)
    statsLabel.textColor = .white
    statsLabel.backgroundColor = UIColor(white: 0.1, alpha: 0.8)
    statsLabel.layer.cornerRadius = 8
    statsLabel.layer.masksToBounds = true
    statsLabel.isUserInteractionEnabled = false
    addSubview(statsLabel)
    showStats("Write something to measure the ink")
  }

  private func showStats(_ text: String) {
    statsLabel.text = text
    let size = statsLabel.sizeThatFits(CGSize(width: bounds.width - 40, height: 200))
    statsLabel.frame = CGRect(x: 12, y: 12, width: size.width + 8, height: size.height + 6)
  }

  // MARK: - Ruler

  /// Automated tests only (launch argument -QuillTestPinch 1): turning on the ruler runs
  /// the zoom in and out, the way a pinch does, about the middle of the screen.
  private func testZoomSweep() {
    let f = currentFit()
    let start = CACurrentMediaTime()
    let steps = 480
    var i = 0
    func step() {
      guard window != nil else { return }
      if i >= steps {
        canvas.setZoomScale(f * 0.5, animated: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
          self.canvas.setZoomScale(f, animated: true)
          DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            NSLog("Quill zoom sweep done in %.1f s", CACurrentMediaTime() - start)
            self.onSelectionAction(["action": "message", "text": "Zoom sweep done"])
          }
        }
        return
      }
      let t = Double(i) / Double(steps) * 3 * 2 * .pi
      let z = f * CGFloat(0.5 + 1.75 * (1 - cos(t)))   // 0.5x to 4x, three times
      let w = canvas.bounds.size
      let cx = (canvas.contentOffset.x + w.width / 2) / canvas.zoomScale
      let cy = (canvas.contentOffset.y + w.height / 2) / canvas.zoomScale
      canvas.setZoomScale(z, animated: false)
      canvas.contentOffset = CGPoint(x: cx * z - w.width / 2, y: cy * z - w.height / 2)
      i += 1
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0 / 60) { step() }
    }
    step()
  }

  func setRuler(_ on: Bool) {
    if on && UserDefaults.standard.double(forKey: "QuillTestPinch") > 0 { testZoomSweep() }
    if !on { ruler?.removeFromSuperview(); ruler = nil; return }
    guard ruler == nil else { return }
    let r = RulerView()
    r.center = CGPoint(x: bounds.midX, y: bounds.midY)
    addSubview(r)
    ruler = r
  }
}
