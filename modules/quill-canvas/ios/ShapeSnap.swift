// Shape lock (like Procreate's QuickShape): draw a line, circle, oval, rectangle
// or triangle and hold the Pencil still at the end - the stroke snaps to a clean shape.
import PencilKit
import UIKit

enum ShapeSnap {
  /// How long the Pencil has to rest at the end of a stroke to snap it.
  static let holdTime: TimeInterval = 0.45

  /// The clean shape for a stroke that ended in a hold, or nil (keep it as drawn).
  /// `held`: how long the Pencil rested without moving before it lifted (timed live).
  static func snap(_ stroke: PKStroke, held: TimeInterval) -> PKStroke? {
    guard held >= holdTime else { return nil }
    let all = Array(stroke.path)
    guard all.count >= 4 else { return nil }
    let t = stroke.transform
    let pts = all.map { $0.location.applying(t) }
    let end = pts[pts.count - 1]
    // Leave out the resting points at the end.
    var holdStart = all.count - 1
    while holdStart > 0 && dist(pts[holdStart - 1], end) < 5 { holdStart -= 1 }
    let shape = Array(pts[0...max(1, holdStart)])
    guard shape.count >= 3 else { return nil }

    let start = shape[0], last = shape[shape.count - 1]
    let box = bounds(shape)
    let diag = hypot(box.width, box.height)
    guard diag > 12 else { return nil }

    var outline: [CGPoint]
    let length = zip(shape, shape.dropFirst()).reduce(0) { $0 + dist($1.0, $1.1) }
    let closed = dist(start, last) < max(14, diag * 0.22)
    if !closed {
      // A line: every point close to the straight line from start to end.
      let worst = shape.map { lineDistance($0, start, last) }.max() ?? 0
      guard worst < max(6, dist(start, last) * 0.09), length < dist(start, last) * 1.25 else { return nil }
      outline = [start, last]
    } else {
      let corners = simplify(shape + [start], tolerance: diag * 0.07)
      let n = corners.count - 1   // the closing point repeats the first
      if n == 3 {
        outline = Array(corners.prefix(3)) + [corners[0]]
      } else if n == 4 {
        outline = squareUp(Array(corners.prefix(4)), box: box) + []
        outline.append(outline[0])
      } else {
        // An ellipse (a circle if it's nearly round), from the drawn bounds.
        var r = box
        if abs(r.width - r.height) < max(r.width, r.height) * 0.15 {
          let s = (r.width + r.height) / 2
          r = CGRect(x: r.midX - s / 2, y: r.midY - s / 2, width: s, height: s)
        }
        let steps = max(36, Int((r.width + r.height) / 4))
        outline = (0...steps).map { i in
          let a = CGFloat(i) / CGFloat(steps) * 2 * .pi - .pi / 2
          return CGPoint(x: r.midX + cos(a) * r.width / 2, y: r.midY + sin(a) * r.height / 2)
        }
      }
    }
    return make(outline, like: all, ink: stroke.ink)
  }

  /// A new stroke along `outline` (dense points, same ink and pen size as the original).
  private static func make(_ outline: [CGPoint], like orig: [PKStrokePoint], ink: PKInk) -> PKStroke {
    let mid = orig[orig.count / 2]
    var pts: [PKStrokePoint] = []
    var tOff: TimeInterval = 0
    for (a, b) in zip(outline, outline.dropFirst()) {
      let n = max(1, Int(dist(a, b) / 3))
      for i in 0..<n {
        let k = CGFloat(i) / CGFloat(n)
        let p = CGPoint(x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k)
        pts.append(PKStrokePoint(location: p, timeOffset: tOff, size: mid.size, opacity: mid.opacity, force: mid.force, azimuth: mid.azimuth, altitude: mid.altitude))
        tOff += 0.004
      }
    }
    if let e = outline.last {
      pts.append(PKStrokePoint(location: e, timeOffset: tOff, size: mid.size, opacity: mid.opacity, force: mid.force, azimuth: mid.azimuth, altitude: mid.altitude))
    }
    return PKStroke(ink: ink, path: PKStrokePath(controlPoints: pts, creationDate: Date()), transform: .identity, mask: nil)
  }

  /// A drawn 4-corner shape: a neat rectangle if its sides are close to straight up and across.
  private static func squareUp(_ c: [CGPoint], box: CGRect) -> [CGPoint] {
    let axisAligned = zip(c, c.dropFirst() + [c[0]]).allSatisfy { a, b in
      let ang = abs(atan2(b.y - a.y, b.x - a.x)).truncatingRemainder(dividingBy: .pi / 2)
      return ang < 0.25 || ang > .pi / 2 - 0.25
    }
    if axisAligned {
      return [CGPoint(x: box.minX, y: box.minY), CGPoint(x: box.maxX, y: box.minY), CGPoint(x: box.maxX, y: box.maxY), CGPoint(x: box.minX, y: box.maxY)]
    }
    return c
  }

  // MARK: geometry

  private static func dist(_ a: CGPoint, _ b: CGPoint) -> CGFloat { hypot(a.x - b.x, a.y - b.y) }

  private static func bounds(_ p: [CGPoint]) -> CGRect {
    let xs = p.map(\.x), ys = p.map(\.y)
    return CGRect(x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!)
  }

  private static func lineDistance(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
    let l = dist(a, b)
    if l < 0.001 { return dist(p, a) }
    return abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / l
  }

  /// Douglas-Peucker: the few points that keep the drawn shape (its corners).
  private static func simplify(_ p: [CGPoint], tolerance: CGFloat) -> [CGPoint] {
    guard p.count > 2 else { return p }
    var maxD: CGFloat = 0, idx = 0
    for i in 1..<(p.count - 1) {
      let d = lineDistance(p[i], p[0], p[p.count - 1])
      if d > maxD { maxD = d; idx = i }
    }
    // A closed loop: start and end are the same point, so split at the farthest point.
    if dist(p[0], p[p.count - 1]) < 0.001 {
      var far: CGFloat = 0
      for i in 1..<(p.count - 1) where dist(p[i], p[0]) > far { far = dist(p[i], p[0]); idx = i }
      maxD = .greatestFiniteMagnitude
    }
    if maxD > tolerance {
      let left = simplify(Array(p[0...idx]), tolerance: tolerance)
      let right = simplify(Array(p[idx...]), tolerance: tolerance)
      return Array(left.dropLast()) + right
    }
    return [p[0], p[p.count - 1]]
  }
}
