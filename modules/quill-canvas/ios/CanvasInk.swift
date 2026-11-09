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

enum InkMode { case write, erase, lasso, tape, laser, comment, measure, compass, shape }

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
      if touches.count > 1 || t.majorRadius > 52 {
        GestureLog.add("finger not drawing: \(touches.count) touches, radius \(Int(t.majorRadius))")
        state = .failed; return
      }   // two fingers, or a palm (a firm fingertip reads 42)
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
    if a.type == .direct && a.majorRadius > 60 {
      GestureLog.add("finger stroke dropped: it was a hand")
      if told { owner?.inkCancelled(); state = .cancelled } else { state = .failed }
      return
    }
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
    owner?.gesturesBack()
  }
}

/// Watches for a resting hand without taking part in anything. Any touch that lands while the Pencil
/// is writing, or just after, is a hand for as long as it stays down, however small it looks: the side of
/// a hand often starts as a fingertip-sized touch. While one is down the page can't start to scroll or zoom.
final class PalmWatch: UIGestureRecognizer {
  weak var owner: QuillCanvasView?
  private var hands = Set<ObjectIdentifier>()
  private static let afterWriting: CGFloat = 41
  private static let alone: CGFloat = 52

  private func look(_ began: Set<UITouch>?, _ event: UIEvent) {
    guard let scroll = view as? InkScrollView else { return }
    let writing = scroll.pencilDown || (owner?.pencilRecently ?? false)
    if let began, writing {
      for t in began where t.type == .direct { hands.insert(ObjectIdentifier(t)) }
    }
    let down = event.allTouches?.filter { $0.type == .direct && $0.phase != .ended && $0.phase != .cancelled } ?? []
    let biggest = down.map(\.majorRadius).max() ?? 0
    let resting = down.contains { hands.contains(ObjectIdentifier($0)) }
    let hand = resting || (writing ? biggest >= Self.afterWriting : (down.count == 1 && biggest >= Self.alone))
    if hand {
      if !scroll.palmOn {
        scroll.palmOn = true
        GestureLog.add("hand: \(down.count) touches, radius \(Int(biggest)), writing \(writing)")
        owner?.palmDown()
      }
    } else if scroll.palmOn && !writing && down.count >= 2 {
      scroll.palmOn = false    // a second finger, away from any hand: a pinch or a scroll after all
    }
  }
  private func done(_ touches: Set<UITouch>, _ event: UIEvent) {
    for t in touches { hands.remove(ObjectIdentifier(t)) }
    let left = event.allTouches?.filter { $0.phase != .ended && $0.phase != .cancelled && $0.type == .direct } ?? []
    if left.isEmpty {
      hands.removeAll()
      (view as? InkScrollView)?.palmOn = false
      state = .failed
    }
  }
  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) { look(touches, event) }
  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) { look(nil, event) }
  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { done(touches, event) }
  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { done(touches, event) }
  override func reset() {
    hands.removeAll()
    (view as? InkScrollView)?.palmOn = false
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
  private var lastPressure: Float = 0
  private var storedX: Float, storedY: Float
  var moveAnchor: CGPoint
  var page: CGRect = .infinite     // the stroke stays on this page
  var lastRaw: CGPoint?            // the last sample taken, to spot a jump no hand could make
  var lastRawTime: TimeInterval = 0
  var dropped: CGPoint?
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
    // The Pencil reports no pressure as it lifts. That's the end of a stroke, not a change of
    // pressure, so the line keeps the weight it had instead of swelling into a blob.
    if force > 0 { lastPressure = min(1, force * 2.2); return lastPressure }
    if lastPressure > 0 { return lastPressure }
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
    // Streamline eases the line from following the hand closely towards a slow, steady pull.
    // Moving slowly, there's little to lag behind, and the shake is most of what moves: filter more.
    let follow = 13 + 0.27 * speed
    let tau = 1 / (2 * Float.pi * (pen.stabilize ? 7 : follow * (1 - pen.streamline) + 9 * pen.streamline))
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
    // Width and shade change gently, so pressure can't put lumps in a small curve.
    let ease = 1 - exp(-dt / 0.06)
    r += (want.r - r) * ease
    a += (want.a - a) * ease
    if hypot(fx - storedX, fy - storedY) * zoom >= 1.4 {
      wet.append(InkPoint(x: fx, y: fy, r: r, a: a))
      storedX = fx; storedY = fy
    }
  }

  /// Redraws the end of the line, out to the Pencil and where it's heading.
  func refresh(predicted: [CGPoint]) {
    // Streamline trails behind the Pencil on purpose. Running a straight line out to the tip would
    // cut across the smoothed curve and leave chunks, so the line just ends where it's got to.
    if pen.streamline > 0.05 {
      wet.refresh(ahead: [InkPoint(x: fx, y: fy, r: r, a: a)])
      return
    }
    var ahead = [InkPoint(x: rawX, y: rawY, r: r, a: a)]
    // Barely moving: a guess at where the Pencil is going is only noise, and it makes the tip flicker.
    if lastSpeed > 150 {
      // Only along the way the line is already going, and not far: on a tiny curve a guess at
      // where the Pencil's heading points off the curve, and shows as a spike.
      let reach = 6 / zoom
      for p in predicted {
        let x = Float(p.x), y = Float(p.y)
        let mx = x - rawX, my = y - rawY, gone = hypot(mx, my)
        if gone > reach { break }
        if gone > 0.01 && (mx * dirX + my * dirY) / gone < 0.9 { break }
        ahead.append(InkPoint(x: x, y: y, r: r, a: a))
      }
    }
    wet.refresh(ahead: ahead)
  }

  /// The finished line.
  func finishedPoints() -> [InkPoint] {
    if snap != nil { return wet.pts }
    var pts = wet.pts
    let close = 1.2 / zoom     // on screen, about a point
    // The hand jitters as the Pencil lifts: points bunched right at the end aren't part of the line.
    // Measured from the end itself, and only a few: drawing slowly puts every point close to the next.
    if let end = pts.last {
      var dropped = 0
      while pts.count > 2, dropped < 3, hypot(pts[pts.count - 2].x - end.x, pts[pts.count - 2].y - end.y) < close {
        pts.remove(at: pts.count - 2)
        dropped += 1
      }
    }
    if pen.streamline > 0.05 {
      // It finishes where the smoothing got to, plus the rest of the way in small steps.
      if let last = pts.last {
        let gap = hypot(last.x - rawX, last.y - rawY)
        let steps = Int(min(12, gap / max(close, 2)))
        if steps > 0 {
          for i in 1...steps {
            let k = Float(i) / Float(steps)
            let eased = k * k * (3 - 2 * k)
            pts.append(InkPoint(x: last.x + (rawX - last.x) * eased, y: last.y + (rawY - last.y) * eased, r: last.r, a: last.a))
          }
        }
      }
    } else if let last = pts.last, hypot(last.x - rawX, last.y - rawY) >= close { pts.append(InkPoint(x: rawX, y: rawY, r: last.r, a: last.a)) }
    // And the end of a line never gets fatter than the line leading up to it.
    let count = pts.count
    if count > 2 {
      for i in max(1, count - 8)..<count where pts[i].r > pts[i - 1].r * 1.02 { pts[i].r = pts[i - 1].r * 1.02 }
    }
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
    // A hand dragging the page (not a flick still coasting by itself).
    let palm = canvas.isDragging && canvas.isTracking
    stopGlide()
    if zoomPreviewing { pinchEnded(now: true) }
    settleInk()
    canvas.pinchGestureRecognizer?.isEnabled = false
    canvas.panGestureRecognizer.isEnabled = false
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
  /// A big touch has appeared: it's a hand, and hands don't scroll or zoom.
  func palmDown() {
    // Only a scroll that a hand set off while writing. A zoom is never interrupted.
    guard pencilRecently, canvas.isDragging, canvas.isTracking, !canvas.isZooming, !zoomPreviewing else { return }
    let start = dragStartOffset
    canvas.panGestureRecognizer.isEnabled = false
    canvas.panGestureRecognizer.isEnabled = true
    canvas.setContentOffset(start, animated: false)
  }

  var pencilRecently: Bool { canvas.pencilDown || CACurrentMediaTime() - canvas.pencilUpAt < 1.5 }

  /// However a touch ended, the page can be moved again.
  func gesturesBack() {
    if !canvas.panGestureRecognizer.isEnabled || canvas.pinchGestureRecognizer?.isEnabled == false {
      GestureLog.add("gestures were still off, turned back on")
      canvas.panGestureRecognizer.isEnabled = true
      canvas.pinchGestureRecognizer?.isEnabled = true
    }
  }

  func fingerMayDraw(_ t: UITouch) -> Bool {
    let ok = fingerAllowed(t)
    if let why = ok { GestureLog.add("finger not drawing: \(why)") }
    return ok == nil
  }

  /// Why a finger can't draw here, or nil if it can.
  private func fingerAllowed(_ t: UITouch) -> String? {
    if CACurrentMediaTime() - lastZoomEnd < 0.3 { return "just after a zoom" }
    if #available(iOS 17.5, *), UIPencilInteraction.prefersPencilOnlyDrawing { return "iPad set to draw only with Apple Pencil" }
    // Someone writing with the Pencil rests their hand on the glass: for 20 seconds after it's
    // been used, a touch is a hand or a scroll, never ink.
    if canvas.pencilDown || CACurrentMediaTime() - canvas.pencilUpAt < 20 { return "the Pencil was just used" }
    if t.majorRadius > 52 { return "radius \(Int(t.majorRadius)), a palm" }   // a fingertip often reads 31 or 42
    if inkMode == .write && pageRect(at: location(t)) == nil { return "not on a page" }
    return nil
  }

  func inkBegan(_ t: UITouch, _ event: UIEvent) {
    guard isLoaded else { return }
    if t.type != .direct {
      canvas.pencilDown = true
      ink.penTouching = true
      GestureLog.watching = true    // notes any late frame while writing
      holdPageStill()               // a writing finger still lets two fingers scroll
    }
    if !zoomPreviewing { ink.ensureShown() }
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
    case .shape: shapeBegan(p)
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
    case .shape: shapeMoved(location(t))
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
    case .shape: shapeEnded()
    case .comment: if t.type != .direct { tappedForComment(at: location(t)) }   // a finger tap arrives by its own route
    }
    if t.type != .direct {
      canvas.pencilUpAt = CACurrentMediaTime()
      canvas.pencilDown = false
      ink.penTouching = false
      GestureLog.watching = false
    }
    GestureLog.add("stroke end")
    letPageMove()
  }

  func inkCancelled() {
    if canvas.pencilDown {
      canvas.pencilDown = false
      ink.penTouching = false
      canvas.pencilUpAt = CACurrentMediaTime()
      GestureLog.watching = false
    }
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
    var opened = !first
    for s in samples {
      var p = location(s)
      if let e = c.rulerEdge { p = onRuler(p, e) }
      // Samples from before it reached the page aren't part of this stroke.
      if !opened && !c.page.contains(p) { continue }
      // A jump across the page between two samples isn't the hand: drop it rather than draw a line to it.
      if let q = c.lastRaw {
        let jump = hypot(p.x - q.x, p.y - q.y) * canvas.zoomScale
        let dt = max(0.001, s.timestamp - c.lastRawTime)
        if jump > 90 && jump / CGFloat(dt) > 9000 {
          if let d = c.dropped, hypot(p.x - d.x, p.y - d.y) * canvas.zoomScale < 20 {
            GestureLog.add("stroke ended at a jump of \(Int(jump)) pt")
            finishStroke(c)      // two samples agree it's really over there: no line across
            return
          } else {
            c.dropped = p
            GestureLog.add("dropped a jump of \(Int(jump)) pt in \(Int(dt * 1000)) ms")
            continue
          }
        }
      }
      c.lastRaw = p
      c.lastRawTime = s.timestamp
      let force = s.type == .pencil && s.maximumPossibleForce > 0 ? Float(s.force / s.maximumPossibleForce) : 0
      let altitude = s.type == .pencil ? Float(s.altitudeAngle) : Float.pi / 2
      // Off the page: the stroke ends at its edge.
      if c.snap == nil && !c.page.contains(p) {
        c.add(CGPoint(x: min(c.page.maxX, max(c.page.minX, p.x)), y: min(c.page.maxY, max(c.page.minY, p.y))), force: force, altitude: altitude, time: s.timestamp, first: false)
        finishStroke(c)
        return
      }
      if c.snap == nil { c.add(p, force: force, altitude: altitude, time: s.timestamp, first: !opened) }
      opened = true
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
      // It adjusts the end of the line, not a whole new line across the page.
      let d = hypot(p.x - s.anchor.x, p.y - s.anchor.y)
      let line = hypot(s.anchor.x - s.points[0].x, s.anchor.y - s.points[0].y)
      if d > max(60, line * 0.5) { return }
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
    var points = c.finishedPoints()
    // Highlighting a line of text: a nearly straight swipe comes out ruler-straight.
    if straightMarker && c.pen.kind == .marker, let line = InkStraight.line(points) { points = line }
    if points.isEmpty {
      ink.wet = nil
      ink.penUp()
      ink.setNeedsInk()
      return
    }
    let stroke = InkStroke(pts: points, rgb: c.pen.rgb, kind: c.pen.kind, seq: c.wet.seq, ts: c.startedAt)
    if scratchOut && c.pen.kind != .marker && ScratchOut.isScribble(points) {
      let gone = ScratchOut.covered(by: stroke.bounds, in: document.strokes)
      if !gone.isEmpty {
        document.apply(removed: gone, added: [])
        record(InkEdit(removed: gone, added: []))
        ink.wet = nil
        ink.penUp()
        ink.setNeedsInk(rebuild: true)
        objectsChanged()
        return
      }
    }
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

  private func insideOutline(_ pts: [InkPoint], _ p: CGPoint) -> Bool {
    var inside = false
    let x = Float(p.x), y = Float(p.y)
    for i in pts.indices {
      let a = pts[i], b = pts[(i + 1) % pts.count]
      if (a.y <= y) != (b.y <= y), x < a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x) { inside.toggle() }
    }
    return inside
  }

  private func beginErase(_ p: CGPoint) {
    eraseLast = p
    eraseRemoved = []
    eraseAdded = []
    ink.penDown()
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
      if s.kind == .fill {
        if s.bounds.contains(p) && insideOutline(s.pts, p) { gone.append(s) }
        continue
      }
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
    ink.penUp()
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

  /// Automated tests only (launch argument -QuillTestInk 1): turning on the ruler draws tiny circles
  /// through the real pen code, with a hand's wobble and pressure, at real Pencil timing.
  private func testInkDots() {
    let z = max(0.01, canvas.zoomScale)
    let v = CGRect(x: canvas.bounds.minX / z, y: canvas.bounds.minY / z, width: canvas.bounds.width / z, height: canvas.bounds.height / z)
    var seed: UInt32 = 77
    func noise() -> CGFloat { seed = seed &* 1664525 &+ 1013904223; return CGFloat(seed >> 16) / 65536 - 0.5 }
    var added: [InkStroke] = []
    let radii: [CGFloat] = [1.5, 2.5, 4, 6, 9]
    let times: [Double] = [0.12, 0.25, 0.5, 0.9]
    for (row, time) in times.enumerated() {
      for (col, radius) in radii.enumerated() {
        let cx = v.minX + v.width * (CGFloat(col) + 0.7) / 5.5, cy = v.minY + v.height * (0.28 + CGFloat(row) * 0.14)
        let n = max(6, Int(time * 240))
        var t = 1000.0
        var c: PenCapture?
        for i in 0...n {
          let a = CGFloat(i) / CGFloat(n) * 2.15 * .pi - .pi / 2
          let wobble = 0.12 / z
          let p = CGPoint(x: cx + cos(a) * radius + noise() * wobble, y: cy + sin(a) * radius + noise() * wobble)
          let force = Float(0.28 + 0.1 * sin(Double(i) * 0.3)) * (i < 3 ? Float(i + 1) / 3 : 1)
          if c == nil { c = PenCapture(pen: pen, seq: document.nextSeq(), zoom: z, at: p, time: t) }
          c?.add(p, force: force, altitude: 1.0, time: t, first: i == 0)
          t += 1.0 / 240
        }
        if let c {
          let last = CGPoint(x: cx + cos(2.15 * .pi - .pi / 2) * radius, y: cy + sin(2.15 * .pi - .pi / 2) * radius)
          c.add(last, force: 0, altitude: 1.0, time: t, first: false)
          added.append(InkStroke(pts: c.finishedPoints(), rgb: pen.rgb, kind: pen.kind, seq: c.wet.seq, ts: 0))
        }
      }
    }
    document.apply(removed: [], added: added)
    record(InkEdit(removed: [], added: added))
    ink.settle(added)
    ink.drawNow(finishing: true)
  }

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
    if on && UserDefaults.standard.double(forKey: "QuillTestInk") > 0 { testInkDots(); return }
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
  private static let compassSizeKey = "quill.compass.size"
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
    // Opens at the size it was last set to. Dragging now moves the point; the pencil leg changes the size.
    let kept = CGFloat(UserDefaults.standard.double(forKey: Self.compassSizeKey))
    if kept > 1 {
      compassRadius = kept
      compassGrab = .needle
    } else {
      compassRadius = 0
      compassGrab = .leg
    }
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
    if compassGrab == .leg, compassRadius > 1 {
      UserDefaults.standard.set(Double(compassRadius), forKey: Self.compassSizeKey)
    }
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

  /// A new point: the size stays as it was.
  func compassReset() {
    compassPlaced = false
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
      compassLayer.addSublayer(compassDots)
      compassDots.fillColor = UIColor(red: 0.25, green: 0.42, blue: 0.95, alpha: 1).cgColor
      compassLayer.addSublayer(compassLabel)
      compassGuide.fillColor = nil
      compassGuide.strokeColor = UIColor(red: 0.25, green: 0.42, blue: 0.95, alpha: 0.35).cgColor
      compassArms.fillColor = nil
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
    var nx = -sin(compassAngle), ny = cos(compassAngle)
    if ny > 0 { nx = -nx; ny = -ny }                       // the hinge stays on the upper side
    let hinge = CGPoint(x: mid.x + nx * lift, y: mid.y + ny * lift)
    let dots = UIBezierPath(arcCenter: c, radius: 4.5 * k, startAngle: 0, endAngle: 2 * .pi, clockwise: true)
    if r > 1 {
      arms.move(to: c); arms.addLine(to: hinge); arms.addLine(to: tip)
      dots.append(UIBezierPath(arcCenter: hinge, radius: 4 * k, startAngle: 0, endAngle: 2 * .pi, clockwise: true))
      dots.append(UIBezierPath(arcCenter: tip, radius: 6 * k, startAngle: 0, endAngle: 2 * .pi, clockwise: true))
    }
    compassArms.lineWidth = 1.5 * k
    compassArms.path = arms.cgPath
    compassDots.path = dots.cgPath

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

// MARK: - Shapes

/// The outline of a shape dragged from `a` to `b`. With `lock`, lines keep to 15 degree steps, and
/// boxes and ellipses are square and round.
func shapeOutline(_ kind: String, from a: CGPoint, to b: CGPoint, lock: Bool) -> (points: [CGPoint], closed: Bool) {
  var end = b
  if lock {
    if kind == "line" || kind == "arrow" {
      let step = CGFloat.pi / 12
      let angle = (atan2(b.y - a.y, b.x - a.x) / step).rounded() * step
      let length = hypot(b.x - a.x, b.y - a.y)
      end = CGPoint(x: a.x + cos(angle) * length, y: a.y + sin(angle) * length)
    } else {
      let side = max(abs(b.x - a.x), abs(b.y - a.y))
      end = CGPoint(x: a.x + (b.x >= a.x ? side : -side), y: a.y + (b.y >= a.y ? side : -side))
    }
  }
  let box = CGRect(x: min(a.x, end.x), y: min(a.y, end.y), width: abs(end.x - a.x), height: abs(end.y - a.y))
  switch kind {
  case "arrow":
    let angle = atan2(end.y - a.y, end.x - a.x)
    let head = min(26, hypot(end.x - a.x, end.y - a.y) * 0.3)
    let left = CGPoint(x: end.x - cos(angle - 0.5) * head, y: end.y - sin(angle - 0.5) * head)
    let right = CGPoint(x: end.x - cos(angle + 0.5) * head, y: end.y - sin(angle + 0.5) * head)
    return (ShapeSnap.dense([a, end, left, end, right]), false)
  case "double":
    let angle = atan2(end.y - a.y, end.x - a.x)
    let head = min(26, hypot(end.x - a.x, end.y - a.y) * 0.25)
    let tip = { (p: CGPoint, back: CGFloat, turn: CGFloat) in CGPoint(x: p.x - cos(angle + turn) * back, y: p.y - sin(angle + turn) * back) }
    return (ShapeSnap.dense([tip(a, -head, -0.5), a, tip(a, -head, 0.5), a, end, tip(end, head, -0.5), end, tip(end, head, 0.5)]), false)
  case "diamond":
    let pts = [CGPoint(x: box.midX, y: box.minY), CGPoint(x: box.maxX, y: box.midY), CGPoint(x: box.midX, y: box.maxY), CGPoint(x: box.minX, y: box.midY), CGPoint(x: box.midX, y: box.minY)]
    return (ShapeSnap.dense(pts), true)
  case "star":
    let pts = (0...10).map { i -> CGPoint in
      let t = -CGFloat.pi / 2 + CGFloat(i) * .pi / 5
      let k: CGFloat = i % 2 == 0 ? 1 : 0.42
      return CGPoint(x: box.midX + cos(t) * box.width / 2 * k, y: box.midY + sin(t) * box.height / 2 * k + box.height * 0.05)
    }
    return (ShapeSnap.dense(pts), true)
  case "righttri":
    let pts = [CGPoint(x: box.minX, y: box.minY), CGPoint(x: box.minX, y: box.maxY), CGPoint(x: box.maxX, y: box.maxY), CGPoint(x: box.minX, y: box.minY)]
    return (ShapeSnap.dense(pts), true)
  case "hexagon":
    let pts = (0...6).map { i -> CGPoint in
      let t = CGFloat(i) * .pi / 3
      return CGPoint(x: box.midX + cos(t) * box.width / 2, y: box.midY + sin(t) * box.height / 2)
    }
    return (ShapeSnap.dense(pts), true)
  case "parallelogram":
    let k = box.width * 0.25
    let pts = [CGPoint(x: box.minX + k, y: box.minY), CGPoint(x: box.maxX, y: box.minY), CGPoint(x: box.maxX - k, y: box.maxY), CGPoint(x: box.minX, y: box.maxY), CGPoint(x: box.minX + k, y: box.minY)]
    return (ShapeSnap.dense(pts), true)
  case "check":
    let pts = [CGPoint(x: box.minX, y: box.minY + box.height * 0.55), CGPoint(x: box.minX + box.width * 0.36, y: box.maxY), CGPoint(x: box.maxX, y: box.minY)]
    return (ShapeSnap.dense(pts), false)
  case "rect":
    let pts = [CGPoint(x: box.minX, y: box.minY), CGPoint(x: box.maxX, y: box.minY), CGPoint(x: box.maxX, y: box.maxY), CGPoint(x: box.minX, y: box.maxY), CGPoint(x: box.minX, y: box.minY)]
    return (ShapeSnap.dense(pts), true)
  case "triangle":
    let pts = [CGPoint(x: box.midX, y: box.minY), CGPoint(x: box.maxX, y: box.maxY), CGPoint(x: box.minX, y: box.maxY), CGPoint(x: box.midX, y: box.minY)]
    return (ShapeSnap.dense(pts), true)
  case "ellipse":
    let n = max(24, Int((box.width + box.height) / 3))
    return ((0...n).map { i in
      let t = CGFloat(i) / CGFloat(n) * 2 * .pi
      return CGPoint(x: box.midX + cos(t) * box.width / 2, y: box.midY + sin(t) * box.height / 2)
    }, true)
  default:
    return (ShapeSnap.dense([a, end]), false)
  }
}

/// A shape that can still be reshaped by its handles.
struct ShapeEdit {
  var kind: String
  var ctrl: [CGPoint]
  var strokes: [InkStroke]
  var fill: Bool
}

/// The points a shape is made from, which become its handles (nil: this shape has none).
func shapeControls(_ kind: String, from a: CGPoint, to b: CGPoint, lock: Bool) -> [CGPoint]? {
  var end = b
  if lock {
    if kind == "line" || kind == "arrow" || kind == "double" {
      let step = CGFloat.pi / 12
      let angle = (atan2(b.y - a.y, b.x - a.x) / step).rounded() * step
      let length = hypot(b.x - a.x, b.y - a.y)
      end = CGPoint(x: a.x + cos(angle) * length, y: a.y + sin(angle) * length)
    } else {
      let side = max(abs(b.x - a.x), abs(b.y - a.y))
      end = CGPoint(x: a.x + (b.x >= a.x ? side : -side), y: a.y + (b.y >= a.y ? side : -side))
    }
  }
  let r = CGRect(x: min(a.x, end.x), y: min(a.y, end.y), width: abs(end.x - a.x), height: abs(end.y - a.y))
  func around(_ n: Int, _ k: (Int) -> CGFloat = { _ in 1 }, start: CGFloat = 0) -> [CGPoint] {
    (0..<n).map { i in
      let t = start + CGFloat(i) / CGFloat(n) * 2 * .pi
      return CGPoint(x: r.midX + cos(t) * r.width / 2 * k(i), y: r.midY + sin(t) * r.height / 2 * k(i))
    }
  }
  switch kind {
  case "line", "arrow", "double": return [a, end]
  case "rect": return [CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.maxX, y: r.minY), CGPoint(x: r.maxX, y: r.maxY), CGPoint(x: r.minX, y: r.maxY)]
  case "triangle": return [CGPoint(x: r.midX, y: r.minY), CGPoint(x: r.maxX, y: r.maxY), CGPoint(x: r.minX, y: r.maxY)]
  case "righttri": return [CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.minX, y: r.maxY), CGPoint(x: r.maxX, y: r.maxY)]
  case "diamond": return [CGPoint(x: r.midX, y: r.minY), CGPoint(x: r.maxX, y: r.midY), CGPoint(x: r.midX, y: r.maxY), CGPoint(x: r.minX, y: r.midY)]
  case "parallelogram":
    let k = r.width * 0.25
    return [CGPoint(x: r.minX + k, y: r.minY), CGPoint(x: r.maxX, y: r.minY), CGPoint(x: r.maxX - k, y: r.maxY), CGPoint(x: r.minX, y: r.maxY)]
  case "hexagon": return around(6)
  case "ellipse": return around(8)
  case "star": return around(10, { $0 % 2 == 0 ? 1 : 0.42 }, start: -.pi / 2)
  case "check": return [CGPoint(x: r.minX, y: r.minY + r.height * 0.55), CGPoint(x: r.minX + r.width * 0.36, y: r.maxY), CGPoint(x: r.maxX, y: r.minY)]
  default: return nil
  }
}

/// The outline through a shape's points: straight sides, or for a circle a smooth loop, so dragging
/// its points bends it like rubber.
func shapeFromControls(_ kind: String, _ c: [CGPoint]) -> (points: [CGPoint], closed: Bool) {
  switch kind {
  case "line", "arrow", "double": return shapeOutline(kind, from: c[0], to: c[1], lock: false)
  case "check": return (ShapeSnap.dense(c), false)
  case "ellipse":
    var out: [CGPoint] = []
    let n = c.count
    for i in 0..<n {
      let p0 = c[(i - 1 + n) % n], p1 = c[i], p2 = c[(i + 1) % n], p3 = c[(i + 2) % n]
      for s in 0..<16 {
        let t = CGFloat(s) / 16, t2 = t * t, t3 = t2 * t
        let f = { (a: CGFloat, b: CGFloat, c: CGFloat, d: CGFloat) -> CGFloat in
          0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
        }
        out.append(CGPoint(x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y)))
      }
    }
    if let first = out.first { out.append(first) }
    return (out, true)
  default: return (ShapeSnap.dense(c + [c[0]]), true)
  }
}

/// Shapes drawn as more than one line: a cross, and axes for a graph. Everything else is one line.
func shapePieces(_ kind: String, from a: CGPoint, to b: CGPoint, lock: Bool) -> [[CGPoint]] {
  var end = b
  if lock {
    let side = max(abs(b.x - a.x), abs(b.y - a.y))
    end = CGPoint(x: a.x + (b.x >= a.x ? side : -side), y: a.y + (b.y >= a.y ? side : -side))
  }
  let box = CGRect(x: min(a.x, end.x), y: min(a.y, end.y), width: abs(end.x - a.x), height: abs(end.y - a.y))
  switch kind {
  case "cross":
    return [ShapeSnap.dense([CGPoint(x: box.minX, y: box.minY), CGPoint(x: box.maxX, y: box.maxY)]),
            ShapeSnap.dense([CGPoint(x: box.maxX, y: box.minY), CGPoint(x: box.minX, y: box.maxY)])]
  case "numline":
    // A line with arrows at both ends and eleven evenly spaced ticks.
    let y = box.midY
    let head = min(12, box.width * 0.05)
    let tick = min(9, max(5, box.height * 0.35))
    var out = [ShapeSnap.dense([CGPoint(x: box.minX + head, y: y - head * 0.7), CGPoint(x: box.minX, y: y), CGPoint(x: box.minX + head, y: y + head * 0.7),
                               CGPoint(x: box.minX, y: y), CGPoint(x: box.maxX, y: y),
                               CGPoint(x: box.maxX - head, y: y - head * 0.7), CGPoint(x: box.maxX, y: y), CGPoint(x: box.maxX - head, y: y + head * 0.7)])]
    let inner = box.insetBy(dx: box.width * 0.08, dy: 0)
    if inner.width > 20 {
      for i in 0...10 {
        let x = inner.minX + inner.width * CGFloat(i) / 10
        out.append(ShapeSnap.dense([CGPoint(x: x, y: y - tick), CGPoint(x: x, y: y + tick)]))
      }
    }
    return out
  case "axes":
    let head = min(14, min(box.width, box.height) * 0.12)
    let x = [CGPoint(x: box.minX + head, y: box.midY - head * 0.7), CGPoint(x: box.minX, y: box.midY), CGPoint(x: box.minX + head, y: box.midY + head * 0.7),
             CGPoint(x: box.minX, y: box.midY), CGPoint(x: box.maxX, y: box.midY),
             CGPoint(x: box.maxX - head, y: box.midY - head * 0.7), CGPoint(x: box.maxX, y: box.midY), CGPoint(x: box.maxX - head, y: box.midY + head * 0.7)]
    let y = [CGPoint(x: box.midX - head * 0.7, y: box.minY + head), CGPoint(x: box.midX, y: box.minY), CGPoint(x: box.midX + head * 0.7, y: box.minY + head),
             CGPoint(x: box.midX, y: box.minY), CGPoint(x: box.midX, y: box.maxY),
             CGPoint(x: box.midX - head * 0.7, y: box.maxY - head), CGPoint(x: box.midX, y: box.maxY), CGPoint(x: box.midX + head * 0.7, y: box.maxY - head)]
    return [ShapeSnap.dense(x), ShapeSnap.dense(y)]
  default:
    return [shapeOutline(kind, from: a, to: b, lock: lock).points]
  }
}

enum InkStraight {
  /// The same stroke as a ruler-straight line, if it was nearly straight already; nil if not.
  static func line(_ pts: [InkPoint]) -> [InkPoint]? {
    guard pts.count >= 3, let a = pts.first, let b = pts.last else { return nil }
    let dx = CGFloat(b.x - a.x), dy = CGFloat(b.y - a.y)
    let length = hypot(dx, dy)
    guard length > 24 else { return nil }
    var path: CGFloat = 0, worst: CGFloat = 0
    for (i, p) in pts.enumerated() {
      if i > 0 { path += hypot(CGFloat(p.x - pts[i - 1].x), CGFloat(p.y - pts[i - 1].y)) }
      worst = max(worst, abs(CGFloat(p.x - a.x) * dy - CGFloat(p.y - a.y) * dx) / length)
    }
    guard worst <= max(3, length * 0.05), path <= length * 1.2 else { return nil }
    let r = pts.reduce(Float(0)) { $0 + $1.r } / Float(pts.count)
    let alpha = pts.reduce(Float(0)) { $0 + $1.a } / Float(pts.count)
    let n = max(2, Int(length / 1.4))
    return (0...n).map { i in
      let t = Float(i) / Float(n)
      return InkPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, r: r, a: alpha)
    }
  }
}

/// Scribbling back and forth over writing deletes it (when it's turned on in Settings).
enum ScratchOut {
  /// Lots of ink in a small box that keeps turning back on itself.
  static func isScribble(_ pts: [InkPoint]) -> Bool {
    guard pts.count >= 12 else { return false }
    var minX = CGFloat.infinity, minY = CGFloat.infinity, maxX = -CGFloat.infinity, maxY = -CGFloat.infinity
    var length: CGFloat = 0
    for (i, p) in pts.enumerated() {
      minX = min(minX, CGFloat(p.x)); maxX = max(maxX, CGFloat(p.x))
      minY = min(minY, CGFloat(p.y)); maxY = max(maxY, CGFloat(p.y))
      if i > 0 { length += hypot(CGFloat(p.x - pts[i - 1].x), CGFloat(p.y - pts[i - 1].y)) }
    }
    let w = maxX - minX, h = maxY - minY
    let span = max(w, h)
    guard span > 10, span < 420 else { return false }
    // Turns along whichever way it moves most: a scribble's back and forth.
    let across = w >= h
    let leg = span * 0.35
    var turns = 0, dir: CGFloat = 0, run: CGFloat = 0
    for i in 1..<pts.count {
      let d = across ? CGFloat(pts[i].x - pts[i - 1].x) : CGFloat(pts[i].y - pts[i - 1].y)
      if abs(d) < 0.01 { continue }
      let sign: CGFloat = d > 0 ? 1 : -1
      if dir == 0 || sign == dir { dir = sign; run += abs(d); continue }
      if run >= leg { turns += 1; dir = sign; run = abs(d) } else { run += abs(d) * 0.5 }
    }
    return turns >= 4 && length > span * 4
  }

  /// The strokes it was scribbled over: most of each one inside the scribble.
  static func covered(by scribble: CGRect, in strokes: [InkStroke]) -> [InkStroke] {
    let box = scribble.insetBy(dx: -3, dy: -3)
    return strokes.filter { s in
      guard !s.lifted, s.kind != .fill, s.bounds.intersects(box) else { return false }
      let i = s.bounds.intersection(box)
      return i.width * i.height >= 0.6 * max(1, s.bounds.width * s.bounds.height)
    }
  }
}

extension QuillCanvasView {
  /// Ink for a shape preview: the separate lines of a cross or axes, with invisible joins between them.
  private func shapeInk(_ pieces: [[CGPoint]]) -> [InkPoint] {
    var out: [InkPoint] = []
    for (i, piece) in pieces.enumerated() {
      let ink = shapeInk(piece)
      if i > 0, let last = out.last, let first = ink.first {
        out.append(InkPoint(x: last.x, y: last.y, r: 0, a: 0))
        out.append(InkPoint(x: first.x, y: first.y, r: 0, a: 0))
      }
      out.append(contentsOf: ink)
    }
    return out
  }

  private func shapeInk(_ pts: [CGPoint]) -> [InkPoint] {
    let look = pen.shape(p: 0.5, dirX: 1, dirY: 0, altitude: .pi / 2)
    return pts.map { InkPoint(x: Float($0.x), y: Float($0.y), r: look.r, a: look.a) }
  }

  func shapeBegan(_ p: CGPoint) {
    if let e = shapeEdit {
      let reach = 26 / max(0.01, canvas.zoomScale)
      if let i = e.ctrl.indices.min(by: { hypot(e.ctrl[$0].x - p.x, e.ctrl[$0].y - p.y) < hypot(e.ctrl[$1].x - p.x, e.ctrl[$1].y - p.y) }),
         hypot(e.ctrl[i].x - p.x, e.ctrl[i].y - p.y) <= reach {
        shapeDrag = i
        document.apply(removed: e.strokes, added: [])
        capture = PenCapture(pen: pen, seq: document.nextSeq(), zoom: canvas.zoomScale, at: p, time: CACurrentMediaTime())
        ink.wet = capture?.wet
        ink.penDown()
        ink.setNeedsInk(rebuild: true)
        shapeHandleMoved(p)
        return
      }
      endShapeEdit()
    }
    guard let page = frames.first(where: { $0.contains(p) }) else { return }
    shapeStart = p
    shapePage = page
    shapePoints = []
    capture = PenCapture(pen: pen, seq: document.nextSeq(), zoom: canvas.zoomScale, at: p, time: CACurrentMediaTime())
    ink.wet = capture?.wet
    ink.penDown()
  }

  func shapeMoved(_ p: CGPoint) {
    if shapeDrag != nil { shapeHandleMoved(p); return }
    guard let c = capture else { return }
    let end = CGPoint(x: min(shapePage.maxX, max(shapePage.minX, p.x)), y: min(shapePage.maxY, max(shapePage.minY, p.y)))
    shapeEnd = end
    shapePieceList = shapePieces(shapeKind, from: shapeStart, to: end, lock: shapeLock)
    shapePoints = shapePieceList.flatMap { $0 }
    c.wet.reset(shapePieceList.count == 1 ? shapeInk(shapePoints) : shapeInk(shapePieceList))
    ink.drawNow()
  }

  func shapeEnded() {
    if shapeDrag != nil { shapeHandleEnded(); return }
    guard let c = capture else { return }
    capture = nil
    ink.wet = nil
    ink.penUp()
    let box = shapePoints.reduce(CGRect.null) { $0.union(CGRect(origin: $1, size: .zero)) }
    guard shapePoints.count > 1, max(box.width, box.height) * canvas.zoomScale > 6 else { ink.setNeedsInk(); return }
    let closed = ["rect", "ellipse", "triangle", "diamond", "star", "righttri", "hexagon", "parallelogram"].contains(shapeKind)
    let now = Date().timeIntervalSince1970
    var added: [InkStroke] = []
    if closed && shapeFill {
      // The outline's own number goes on top, so the fill sits underneath it.
      added.append(InkStroke(pts: shapePoints.map { InkPoint(x: Float($0.x), y: Float($0.y), r: 0, a: 0.35) }, rgb: pen.rgb, kind: .fill, seq: c.wet.seq, ts: now))
      added.append(InkStroke(pts: shapeInk(shapePoints), rgb: pen.rgb, kind: pen.kind, seq: document.nextSeq(), ts: now))
    } else {
      for (i, piece) in shapePieceList.enumerated() where piece.count > 1 {
        added.append(InkStroke(pts: shapeInk(piece), rgb: pen.rgb, kind: pen.kind, seq: i == 0 ? c.wet.seq : document.nextSeq(), ts: now))
      }
    }
    document.apply(removed: [], added: added)
    record(InkEdit(removed: [], added: added))
    ink.settle(added)
    ink.drawNow(finishing: true)
    if let ctrl = shapeControls(shapeKind, from: shapeStart, to: shapeEnd, lock: shapeLock) {
      shapeEdit = ShapeEdit(kind: shapeKind, ctrl: ctrl, strokes: added, fill: closed && shapeFill)
      placeShapeHandles()
    }
  }

  private func shapeHandleMoved(_ p: CGPoint) {
    guard var e = shapeEdit, let i = shapeDrag, let c = capture else { return }
    e.ctrl[i] = p
    shapeEdit = e
    c.wet.reset(shapeInk(shapeFromControls(e.kind, e.ctrl).points))
    ink.drawNow()
    placeShapeHandles()
  }

  private func shapeHandleEnded() {
    guard let e = shapeEdit, let c = capture else { shapeDrag = nil; return }
    capture = nil
    ink.wet = nil
    ink.penUp()
    shapeDrag = nil
    let outline = shapeFromControls(e.kind, e.ctrl).points
    let now = Date().timeIntervalSince1970
    var added: [InkStroke] = []
    let rgb = e.strokes.last?.rgb ?? pen.rgb
    let kind = e.strokes.last?.kind ?? pen.kind
    if e.fill {
      added.append(InkStroke(pts: outline.map { InkPoint(x: Float($0.x), y: Float($0.y), r: 0, a: 0.35) }, rgb: rgb, kind: .fill, seq: c.wet.seq, ts: now))
      added.append(InkStroke(pts: shapeInk(outline), rgb: rgb, kind: kind, seq: document.nextSeq(), ts: now))
    } else {
      added.append(InkStroke(pts: shapeInk(outline), rgb: rgb, kind: kind, seq: c.wet.seq, ts: now))
    }
    document.apply(removed: [], added: added)
    record(InkEdit(removed: e.strokes, added: added))
    shapeEdit = ShapeEdit(kind: e.kind, ctrl: e.ctrl, strokes: added, fill: e.fill)
    ink.settle(added)
    ink.setNeedsInk(rebuild: true)
    ink.drawNow(finishing: true)
    placeShapeHandles()
  }

  /// The handles go away: the shape is finished.
  func endShapeEdit() {
    shapeEdit = nil
    shapeDrag = nil
    shapeHandles.isHidden = true
  }

  /// Round handles on the shape's points, kept in place as the page scrolls and zooms.
  func placeShapeHandles() {
    guard let e = shapeEdit, inkMode == .shape else { shapeHandles.isHidden = true; return }
    if shapeHandles.superlayer == nil {
      shapeHandles.fillColor = UIColor.white.cgColor
      shapeHandles.strokeColor = UIColor(red: 0, green: 0.48, blue: 1, alpha: 1).cgColor
      shapeHandles.lineWidth = 2
      shapeHandles.shadowColor = UIColor.black.cgColor
      shapeHandles.shadowOpacity = 0.18
      shapeHandles.shadowRadius = 3
      shapeHandles.shadowOffset = CGSize(width: 0, height: 1)
      layer.addSublayer(shapeHandles)
    }
    let path = UIBezierPath()
    for p in e.ctrl {
      let v = pageHost.convert(p, to: self)
      path.append(UIBezierPath(ovalIn: CGRect(x: v.x - 7, y: v.y - 7, width: 14, height: 14)))
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    shapeHandles.path = path.cgPath
    shapeHandles.isHidden = false
    CATransaction.commit()
  }
}
