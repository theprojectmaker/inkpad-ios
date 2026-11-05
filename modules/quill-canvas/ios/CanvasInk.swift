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

enum InkMode { case write, erase, lasso, tape, laser, comment, measure, compass }

/// Reports the Pencil (and a finger, if allowed) the instant it touches, with no waiting.
///
/// A finger isn't known to be drawing straight away, because it may be the first half of a pinch.
/// It counts once it has moved a little or stayed down a moment, and any second finger ends it.
final class InkGesture: UIGestureRecognizer {
  weak var owner: QuillCanvasView?
  private var active: UITouch?
  private var startedAt: TimeInterval = 0
  private var told = false              // the owner knows about this touch
  private var downAt: CGPoint = .zero
  private var lastEvent: UIEvent?
  private var wait: DispatchWorkItem?

  private static let fingerWait: TimeInterval = 0.12
  private static let fingerMove: CGFloat = 10
  /// A finger stroke younger than this is thrown away when a second finger lands.
  private static let youngStroke: TimeInterval = 1

  private func begin(_ t: UITouch, _ event: UIEvent) {
    wait?.cancel()
    wait = nil
    told = true
    state = .began
    owner?.inkBegan(t, event)
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    guard active == nil, let t = touches.first else {
      guard let a = active, a.type == .direct else {
        touches.forEach { ignore($0, for: event) }
        return
      }
      // Two fingers are never writing.
      if told {
        if event.timestamp - startedAt < Self.youngStroke { owner?.inkCancelled() } else { owner?.inkEnded(a, event) }
        state = .cancelled
      } else {
        state = .failed
      }
      return
    }
    if t.type == .direct {
      if touches.count > 1 || t.majorRadius > 40 { state = .failed; return }   // two fingers, or a palm
      if owner?.fingerMayDraw(t) != true { state = .failed; return }
    }
    active = t
    startedAt = event.timestamp
    lastEvent = event
    if t.type != .direct { begin(t, event); return }
    downAt = t.location(in: view)
    let w = DispatchWorkItem { [weak self] in
      guard let self, let a = self.active, !self.told, let e = self.lastEvent else { return }
      self.begin(a, e)
    }
    wait = w
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.fingerWait, execute: w)
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let a = active, touches.contains(a) else { return }
    lastEvent = event
    if !told {
      let p = a.location(in: view)
      if hypot(p.x - downAt.x, p.y - downAt.y) >= Self.fingerMove { begin(a, event) }
      return
    }
    state = .changed
    owner?.inkMoved(a, event)
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let a = active, touches.contains(a) else { return }
    if !told { begin(a, event) }     // a quick tap is a dot
    owner?.inkEnded(a, event)
    state = .ended
  }

  /// The page has started zooming or scrolling: a finger stops writing.
  func fingerGesturing() {
    guard let a = active, a.type == .direct else { return }
    if told { owner?.inkCancelled(); state = .cancelled } else { state = .failed }
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let a = active, touches.contains(a) else { return }
    // The system took the Pencil's touch back: what was written stays. (A cancelled finger
    // is usually the start of a two-finger scroll, so that one is dropped.)
    if !told { state = .cancelled; return }
    if a.type == .direct { owner?.inkCancelled() } else { owner?.inkEnded(a, event) }
    state = .cancelled
  }

  override func reset() {
    wait?.cancel()
    wait = nil
    active = nil
    told = false
    lastEvent = nil
  }
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
  var page: CGRect = .infinite     // the stroke stays on this page
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

  private func location(_ t: UITouch) -> CGPoint { zoomWriter?.map(t) ?? t.preciseLocation(in: pageHost) }

  /// The page stays still while writing. A palm that had started to scroll is put back.
  private func holdPageStill() {
    scrollBack?.cancel()
    scrollBack = nil
    let palm = canvas.isDragging
    settleInk()
    if zoomPreviewing { DispatchQueue.main.async { [weak self] in self?.pinchEnded() } }
    canvas.panGestureRecognizer.isEnabled = false
    canvas.pinchGestureRecognizer?.isEnabled = false
    canvas.setContentOffset(palm ? dragStartOffset : canvas.contentOffset, animated: false)
  }

  private func letPageMove() {
    scrollBack?.cancel()
    // Two fingers scroll and zoom straight away. One touch can't, for long enough to cover the
    // pause between words, when a resting hand would move the page.
    canvas.panGestureRecognizer.isEnabled = true
    canvas.pinchGestureRecognizer?.isEnabled = true
    canvas.panGestureRecognizer.minimumNumberOfTouches = 2
    let w = DispatchWorkItem { [weak self] in self?.updatePanFingers() }
    scrollBack = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.7, execute: w)
  }

  /// The page under a point, if there is one: there's nowhere to write beside or between pages.
  private func pageRect(at p: CGPoint) -> CGRect? { frames.first { $0.contains(p) } }

  /// Not right after a zoom (fingers rarely lift together), and writing has to start on a page.
  func fingerMayDraw(_ t: UITouch) -> Bool {
    if CACurrentMediaTime() - lastZoomEnd < 0.3 { return false }
    if inkMode == .write && pageRect(at: location(t)) == nil { return false }
    return true
  }

  func inkBegan(_ t: UITouch, _ event: UIEvent) {
    guard isLoaded else { return }
    if t.type != .direct { holdPageStill() }   // a writing finger still lets two fingers scroll
    if let z = zoomWriter { z.capturing = z.pad.bounds.contains(t.location(in: z.pad)) }
    let p = location(t)
    switch inkMode {
    case .write: beginStroke(t, event, p)
    case .erase: beginErase(p)
    case .lasso: beginLasso(p)
    case .tape: beginTape(p)
    case .laser: laserDown = true; beginLaser(p)
    case .comment: break
    case .measure:
      if measureMode == "angle" { angleBegan(p) } else { measureStart = p }
    case .compass: compassBegan(p)
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
    case .measure: drawMeasure(to: location(t))
    case .compass: compassMoved(location(t))
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
    case .measure: finishMeasure(at: location(t))
    case .compass: compassEnded()
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
    compassGrab = .none
    drawCompass()
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
    guard let onPage = pageRect(at: p) else { return }
    let c = PenCapture(pen: pen, seq: document.nextSeq(), zoom: canvas.zoomScale, at: p, time: t.timestamp)
    if let ruler { c.rulerEdge = ruler.edge(near: ruler.convert(pageHost.convert(p, to: self), from: self)) }
    c.page = onPage
    capture = c
    ink.wet = c.wet
    ink.penDown()
    feed(c, t, event, first: true)
  }

  private func moveStroke(_ t: UITouch, _ event: UIEvent) {
    guard let c = capture else {
      // It came back onto a page: writing carries on from there.
      let p = location(t)
      if pageRect(at: p) != nil { beginStroke(t, event, p) }
      return
    }
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
      // Off the page: the stroke ends at its edge.
      if c.snap == nil && !c.page.contains(p) {
        c.add(CGPoint(x: min(c.page.maxX, max(c.page.minX, p.x)), y: min(c.page.maxY, max(c.page.minY, p.y))), force: force, altitude: altitude, time: s.timestamp, first: false)
        finishStroke(c)
        return
      }
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
      ahead = ahead.filter { c.page.contains($0) }
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
      if !c.page.contains(p) { p = CGPoint(x: min(c.page.maxX, max(c.page.minX, p.x)), y: min(c.page.maxY, max(c.page.minY, p.y))) }
      c.add(p, force: force, altitude: t.type == .pencil ? Float(t.altitudeAngle) : Float.pi / 2, time: t.timestamp, first: false)
    }
    finishStroke(c)
  }

  private func finishStroke(_ c: PenCapture) {
    capture = nil
    let stroke = InkStroke(pts: c.finishedPoints(), rgb: c.pen.rgb, kind: c.pen.kind, seq: c.wet.seq, ts: c.startedAt)
    document.apply(removed: [], added: [stroke])
    record(InkEdit(removed: [], added: [stroke]))
    ink.wet = nil
    ink.settle([stroke])
    ink.drawNow(finishing: true)
    ink.penUp()
    if zoomWriter?.capturing == true { zoomWriter?.strokeEnded(stroke.bounds) }
  }

  // MARK: - Measuring

  /// First drag: from the point along one side. Second drag: the other side, from the same point.
  private func angleBegan(_ p: CGPoint) {
    if angleArmA == nil || angleArmB != nil {
      angleVertex = p
      angleArmA = nil
      angleArmB = nil
      angleSecond = false
    } else { angleSecond = true }
  }

  private func drawAngle(to p: CGPoint) {
    if angleSecond { angleArmB = p } else { angleArmA = p }
    let v = pageHost.convert(angleVertex, to: self)
    let path = UIBezierPath()
    for arm in [angleArmA, angleArmB].compactMap({ $0 }) {
      path.move(to: v)
      path.addLine(to: pageHost.convert(arm, to: self))
    }
    var label = "Now drag the other side"
    if let a = angleArmA, let b = angleArmB {
      let first = atan2(a.y - angleVertex.y, a.x - angleVertex.x), second = atan2(b.y - angleVertex.y, b.x - angleVertex.x)
      var d = second - first
      while d > .pi { d -= 2 * .pi }
      while d < -.pi { d += 2 * .pi }
      path.append(UIBezierPath(arcCenter: v, radius: 34, startAngle: first, endAngle: second, clockwise: d > 0))
      label = String(format: "%.1f°", abs(d) * 180 / .pi)
    }
    if measureLayer.superlayer == nil {
      measureLayer.fillColor = nil
      measureLayer.strokeColor = UIColor(red: 0.25, green: 0.42, blue: 0.95, alpha: 1).cgColor
      measureLayer.lineWidth = 2
      layer.addSublayer(measureLayer)
    }
    measureLayer.path = path.cgPath
    if angleLabel.superlayer == nil {
      layer.addSublayer(angleLabel)
      angleLabel.foregroundColor = UIColor(red: 0.25, green: 0.42, blue: 0.95, alpha: 1).cgColor
      angleLabel.fontSize = 15
      angleLabel.font = UIFont.systemFont(ofSize: 15, weight: .semibold)
      angleLabel.contentsScale = UIScreen.main.scale
      angleLabel.alignmentMode = .center
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    angleLabel.isHidden = false
    angleLabel.string = label
    angleLabel.frame = CGRect(x: v.x - 90, y: v.y + 40, width: 180, height: 22)
    CATransaction.commit()
  }

  private func drawMeasure(to p: CGPoint) {
    if measureMode == "ruler" { return }
    if measureMode == "angle" { drawAngle(to: p); return }
    let a = pageHost.convert(measureStart, to: self), b = pageHost.convert(p, to: self)
    let path = UIBezierPath()
    if measureMode == "area" {
      path.append(UIBezierPath(rect: CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(a.x - b.x), height: abs(a.y - b.y))))
    } else {
      path.move(to: a)
      path.addLine(to: b)
      let t = atan2(b.y - a.y, b.x - a.x)
      for (tip, dir) in [(a, t), (b, t + .pi)] {
        path.move(to: CGPoint(x: tip.x + cos(dir + 0.45) * 12, y: tip.y + sin(dir + 0.45) * 12))
        path.addLine(to: tip)
        path.addLine(to: CGPoint(x: tip.x + cos(dir - 0.45) * 12, y: tip.y + sin(dir - 0.45) * 12))
      }
    }
    if measureLayer.superlayer == nil {
      measureLayer.fillColor = nil
      measureLayer.strokeColor = UIColor(red: 0.25, green: 0.42, blue: 0.95, alpha: 1).cgColor
      measureLayer.lineWidth = 2
      layer.addSublayer(measureLayer)
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    measureLayer.path = path.cgPath
    CATransaction.commit()
  }

  private func finishMeasure(at p: CGPoint) {
    if measureMode == "ruler" { return }
    if measureMode == "angle" { drawAngle(to: p); return }
    drawMeasure(to: p)
    let w = abs(p.x - measureStart.x), h = abs(p.y - measureStart.y)
    if hypot(w, h) * canvas.zoomScale < 8 { measureLayer.path = nil; return }
    onSelectionAction(["action": "measured", "text": measureMode, "width": measureMode == "area" ? Double(w) : Double(hypot(w, h)), "height": Double(h)])
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
    e.removed.forEach { $0.lifted = false }
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
    e.added.forEach { $0.lifted = false }
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
    pinchBegan()
    let steps = 480
    var i = 0
    func step() {
      guard window != nil else { return }
      if i >= steps {
        pinchEnded()
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

// MARK: - The compass

enum CompassGrab { case none, needle, leg, arc }

/// Points around a circle, close enough together to look smooth at any zoom up to the maximum.
func compassPoints(centre c: CGPoint, radius r: CGFloat, from start: CGFloat, sweep: CGFloat) -> [CGPoint] {
  let n = max(2, Int(ceil(abs(sweep) * max(r, 1) / 1.5)) + 1)
  return (0..<n).map { i in
    let a = start + sweep * CGFloat(i) / CGFloat(n - 1)
    return CGPoint(x: c.x + cos(a) * r, y: c.y + sin(a) * r)
  }
}

/// Only what's on the page gets drawn; a circle running off it comes back as separate pieces.
func compassRuns(_ pts: [CGPoint], inside page: CGRect) -> [[CGPoint]] {
  var runs: [[CGPoint]] = []
  var cur: [CGPoint] = []
  for p in pts {
    if page.contains(p) { cur.append(p) } else if !cur.isEmpty { runs.append(cur); cur = [] }
  }
  if !cur.isEmpty { runs.append(cur) }
  return runs.filter { $0.count > 1 }
}

extension QuillCanvasView {
  private var compassTip: CGPoint { CGPoint(x: compassCentre.x + cos(compassAngle) * compassRadius, y: compassCentre.y + sin(compassAngle) * compassRadius) }

  func compassBegan(_ p: CGPoint) {
    let reach = 30 / max(0.01, canvas.zoomScale)
    if compassPlaced {
      if hypot(p.x - compassCentre.x, p.y - compassCentre.y) < reach { compassGrab = .needle; return }
      if compassRadius > 0, hypot(p.x - compassTip.x, p.y - compassTip.y) < reach { compassGrab = .leg; return }
      guard compassRadius > 1 else { compassGrab = .leg; compassMoved(p); return }
      compassGrab = .arc
      compassLast = atan2(p.y - compassCentre.y, p.x - compassCentre.x)
      compassStart = compassLast
      compassSweep = 0
      capture = PenCapture(pen: pen, seq: document.nextSeq(), zoom: canvas.zoomScale, at: p, time: CACurrentMediaTime())
      ink.wet = capture?.wet
      ink.penDown()
      return
    }
    // The needle goes in only on a page.
    guard frames.contains(where: { $0.contains(p) }) else { return }
    compassPlaced = true
    compassCentre = p
    compassRadius = 0
    compassGrab = .leg
    drawCompass()
  }

  func compassMoved(_ p: CGPoint) {
    switch compassGrab {
    case .needle:
      if frames.contains(where: { $0.contains(p) }) { compassCentre = p }
    case .leg:
      compassRadius = hypot(p.x - compassCentre.x, p.y - compassCentre.y)
      compassAngle = atan2(p.y - compassCentre.y, p.x - compassCentre.x)
    case .arc:
      let a = atan2(p.y - compassCentre.y, p.x - compassCentre.x)
      var d = a - compassLast
      if d > .pi { d -= 2 * .pi } else if d < -.pi { d += 2 * .pi }
      compassLast = a
      compassSweep = max(-2 * .pi, min(2 * .pi, compassSweep + d))
      compassAngle = a
      if let c = capture {
        c.wet.reset(compassInk(compassPoints(centre: compassCentre, radius: compassRadius, from: compassStart, sweep: compassSweep)))
        ink.drawNow()
      }
    case .none: return
    }
    drawCompass()
  }

  func compassEnded() {
    defer { compassGrab = .none; drawCompass() }
    guard compassGrab == .arc, let c = capture else { return }
    capture = nil
    ink.wet = nil
    ink.penUp()
    if abs(compassSweep) > 0.02 {
      compassCommit(compassPoints(centre: compassCentre, radius: compassRadius, from: compassStart, sweep: compassSweep), seq: c.wet.seq)
    } else { ink.setNeedsInk() }
  }

  /// From the toolbar: the whole circle at the size it's set to.
  func compassFullCircle() {
    guard compassPlaced, compassRadius > 1 else { return }
    compassCommit(compassPoints(centre: compassCentre, radius: compassRadius, from: compassAngle, sweep: 2 * .pi), seq: document.nextSeq())
  }

  func compassReset() {
    compassPlaced = false
    compassRadius = 0
    drawCompass()
  }

  private func compassInk(_ pts: [CGPoint]) -> [InkPoint] {
    let look = pen.shape(p: 0.5, dirX: 1, dirY: 0, altitude: .pi / 2)
    return pts.map { InkPoint(x: Float($0.x), y: Float($0.y), r: look.r, a: look.a) }
  }

  /// Real ink, so it undoes, erases, selects and exports like any other stroke.
  private func compassCommit(_ pts: [CGPoint], seq: UInt32) {
    let page = frames.first { $0.contains(compassCentre) } ?? .infinite
    let now = Date().timeIntervalSince1970
    let strokes = compassRuns(pts, inside: page).enumerated().map { i, run in
      InkStroke(pts: compassInk(run), rgb: pen.rgb, kind: pen.kind, seq: i == 0 ? seq : document.nextSeq(), ts: now)
    }
    guard !strokes.isEmpty else { ink.setNeedsInk(); return }
    document.apply(removed: [], added: strokes)
    record(InkEdit(removed: [], added: strokes))
    ink.settle(strokes)
    ink.drawNow(finishing: true)
    markDirty()
  }

  /// The compass itself: needle at the point, a pencil leg at the size, the circle it would draw, and its size.
  func drawCompass() {
    if compassLayer.superlayer == nil {
      tapeHost.layer.addSublayer(compassLayer)
      compassLayer.addSublayer(compassGuide)
      compassLayer.addSublayer(compassArms)
      compassLayer.addSublayer(compassLabel)
      compassGuide.fillColor = nil
      compassGuide.strokeColor = UIColor(red: 0.25, green: 0.42, blue: 0.95, alpha: 0.35).cgColor
      compassArms.fillColor = UIColor(red: 0.25, green: 0.42, blue: 0.95, alpha: 1).cgColor
      compassArms.strokeColor = UIColor(red: 0.25, green: 0.42, blue: 0.95, alpha: 1).cgColor
      compassLabel.alignmentMode = .center
      compassLabel.foregroundColor = UIColor(red: 0.25, green: 0.42, blue: 0.95, alpha: 1).cgColor
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    let show = inkMode == .compass && compassPlaced
    compassLayer.isHidden = !show
    guard show else { return }
    let k = 1 / max(0.01, canvas.zoomScale)
    let c = compassCentre, tip = compassTip, r = compassRadius
    compassGuide.lineWidth = 1 * k
    compassGuide.lineDashPattern = [NSNumber(value: Double(5 * k)), NSNumber(value: Double(4 * k))]
    compassGuide.path = r > 1 ? UIBezierPath(arcCenter: c, radius: r, startAngle: 0, endAngle: 2 * .pi, clockwise: true).cgPath : nil

    // The two legs meet at a hinge off to one side, like the real thing.
    let arms = UIBezierPath()
    let mid = CGPoint(x: (c.x + tip.x) / 2, y: (c.y + tip.y) / 2)
    let lift = max(r * 0.55, 34 * k)
    let side: CGFloat = sin(compassAngle) > 0 ? -1 : 1      // the hinge stays on the upper side
    let hinge = CGPoint(x: mid.x - sin(compassAngle) * lift * -side, y: mid.y + cos(compassAngle) * lift * side)
    if r > 1 {
      arms.move(to: c); arms.addLine(to: hinge); arms.addLine(to: tip)
      arms.append(UIBezierPath(arcCenter: hinge, radius: 4 * k, startAngle: 0, endAngle: 2 * .pi, clockwise: true))
      arms.append(UIBezierPath(arcCenter: tip, radius: 6 * k, startAngle: 0, endAngle: 2 * .pi, clockwise: true))
    }
    arms.append(UIBezierPath(arcCenter: c, radius: 4.5 * k, startAngle: 0, endAngle: 2 * .pi, clockwise: true))
    compassArms.lineWidth = 1.5 * k
    compassArms.path = arms.cgPath

    let inches = r / 72
    compassLabel.isHidden = r < 8
    compassLabel.string = String(format: "%.2f in  ·  %.1f cm", inches, inches * 2.54)
    compassLabel.fontSize = 13 * k
    compassLabel.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
    compassLabel.contentsScale = UIScreen.main.scale * max(1, canvas.zoomScale)
    let w = 140 * k, h = 20 * k
    compassLabel.frame = CGRect(x: hinge.x - w / 2, y: hinge.y - h - 8 * k, width: w, height: h)
  }
}
