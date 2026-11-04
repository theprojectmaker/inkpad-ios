// Shape lock (like Procreate's QuickShape): draw a line, circle, oval, rectangle
// or triangle and hold the Pencil still at the end - the stroke snaps to a clean shape.
import UIKit

enum ShapeSnap {
  /// How long the Pencil has to rest to snap the stroke.
  static let holdTime: TimeInterval = 0.45

  /// The clean outline for what was drawn, or nil (keep it as drawn). A line has two points;
  /// `closed` shapes end where they started.
  static func outline(_ pts: [CGPoint]) -> (points: [CGPoint], closed: Bool)? {
    guard pts.count >= 4, let end = pts.last else { return nil }
    // Leave out the resting points at the end.
    var holdStart = pts.count - 1
    while holdStart > 0 && dist(pts[holdStart - 1], end) < 5 { holdStart -= 1 }
    let shape = Array(pts[0...max(1, holdStart)])
    guard shape.count >= 3 else { return nil }

    let start = shape[0], last = shape[shape.count - 1]
    let box = bounds(shape)
    let diag = hypot(box.width, box.height)
    guard diag > 12 else { return nil }

    let length = zip(shape, shape.dropFirst()).reduce(0) { $0 + dist($1.0, $1.1) }
    if dist(start, last) >= max(14, diag * 0.22) {
      // A line: every point close to the straight line from start to end.
      let worst = shape.map { lineDistance($0, start, last) }.max() ?? 0
      guard worst < max(6, dist(start, last) * 0.09), length < dist(start, last) * 1.25 else { return nil }
      return ([start, last], false)
    }
    let corners = simplify(shape + [start], tolerance: diag * 0.07)
    let n = corners.count - 1   // the closing point repeats the first
    if n == 3 { return (Array(corners.prefix(3)) + [corners[0]], true) }
    if n == 4 {
      let square = squareUp(Array(corners.prefix(4)), box: box)
      return (square + [square[0]], true)
    }
    // An ellipse (a circle if it's nearly round), from the drawn bounds.
    var r = box
    if abs(r.width - r.height) < max(r.width, r.height) * 0.15 {
      let s = (r.width + r.height) / 2
      r = CGRect(x: r.midX - s / 2, y: r.midY - s / 2, width: s, height: s)
    }
    let steps = max(36, Int((r.width + r.height) / 4))
    return ((0...steps).map { i in
      let a = CGFloat(i) / CGFloat(steps) * 2 * .pi - .pi / 2
      return CGPoint(x: r.midX + cos(a) * r.width / 2, y: r.midY + sin(a) * r.height / 2)
    }, true)
  }

  /// Points along an outline, close together so the corners stay sharp in the curve drawn through them.
  static func dense(_ outline: [CGPoint]) -> [CGPoint] {
    var out: [CGPoint] = []
    for (a, b) in zip(outline, outline.dropFirst()) {
      let n = max(1, Int(dist(a, b) / 3))
      for i in 0..<n {
        let k = CGFloat(i) / CGFloat(n)
        out.append(CGPoint(x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k))
      }
    }
    if let e = outline.last { out.append(e) }
    return out
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

  static func dist(_ a: CGPoint, _ b: CGPoint) -> CGFloat { hypot(a.x - b.x, a.y - b.y) }

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
