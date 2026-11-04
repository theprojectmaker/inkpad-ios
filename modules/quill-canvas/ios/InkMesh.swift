// Turns points into triangles: a smooth curve through the points, drawn as a
// ribbon whose width follows the pen. Triangles stay sharp at any zoom.
import UIKit

/// One corner of a triangle (must match `Vtx` in the shader).
struct Vtx {
  var x: Float
  var y: Float
  var z: Float     // the stroke's place in the paint order
  var c: UInt32    // r | g << 8 | b << 16 | a << 24
  var g: Float     // 1: pencil grain
}

/// Builds a ribbon one curve sample at a time. It's a value: copy it to try out
/// the end of a stroke (where the Pencil is right now) without disturbing the rest.
struct Ribbon {
  let rgb: UInt32
  let z: Float
  let grain: Float
  private var started = false
  private var turning = false
  private var x: Float = 0, y: Float = 0, r: Float = 0, a: Float = 0
  private var dx: Float = 0, dy: Float = 0
  private var lx: Float = 0, ly: Float = 0, rx: Float = 0, ry: Float = 0, pc: UInt32 = 0

  init(stroke rgb: UInt32, kind: InkKind, seq: UInt32) {
    self.rgb = rgb
    self.z = Ribbon.depth(seq)
    self.grain = kind == .pencil ? 1 : 0
  }

  static func depth(_ seq: UInt32) -> Float { Float(seq % 16_000_000 + 1) / 16_777_216 }

  private func color(_ a: Float) -> UInt32 { rgb | UInt32(max(0, min(255, a * 255 + 0.5))) << 24 }

  mutating func add(_ p: InkPoint, to out: inout [Vtx]) {
    if !started {
      started = true
      x = p.x; y = p.y; r = p.r; a = p.a
      disc(to: &out)
      return
    }
    let mx = p.x - x, my = p.y - y
    let len = (mx * mx + my * my).squareRoot()
    if len < 0.01 { return }
    let nx = mx / len, ny = my / len
    if !turning {
      turning = true
      setPair(normalX: -ny, normalY: nx, k: 1)
    } else if dx * nx + dy * ny < 0.9 {
      // A sharp corner: finish the ribbon, round the corner, start again.
      let (ax, ay) = (-dy, dx)
      quad(toLX: x + ax * r, toLY: y + ay * r, toRX: x - ax * r, toRY: y - ay * r, c: color(a), to: &out)
      disc(to: &out)
      setPair(normalX: -ny, normalY: nx, k: 1)
    } else {
      var ax = -dy - ny, ay = dx + nx
      let l = max(0.0001, (ax * ax + ay * ay).squareRoot())
      ax /= l; ay /= l
      let k = 1 / max(0.7, ax * -dy + ay * dx)
      quad(toLX: x + ax * r * k, toLY: y + ay * r * k, toRX: x - ax * r * k, toRY: y - ay * r * k, c: color(a), to: &out)
      setPair(normalX: ax, normalY: ay, k: k)
    }
    dx = nx; dy = ny
    x = p.x; y = p.y; r = p.r; a = p.a
  }

  /// Closes the end of the stroke.
  mutating func finish(to out: inout [Vtx]) {
    guard started, turning else { return }
    let (ax, ay) = (-dy, dx)
    quad(toLX: x + ax * r, toLY: y + ay * r, toRX: x - ax * r, toRY: y - ay * r, c: color(a), to: &out)
    disc(to: &out)
  }

  private mutating func setPair(normalX ax: Float, normalY ay: Float, k: Float) {
    lx = x + ax * r * k; ly = y + ay * r * k
    rx = x - ax * r * k; ry = y - ay * r * k
    pc = color(a)
  }

  private mutating func quad(toLX: Float, toLY: Float, toRX: Float, toRY: Float, c: UInt32, to out: inout [Vtx]) {
    out.append(Vtx(x: lx, y: ly, z: z, c: pc, g: grain))
    out.append(Vtx(x: rx, y: ry, z: z, c: pc, g: grain))
    out.append(Vtx(x: toLX, y: toLY, z: z, c: c, g: grain))
    out.append(Vtx(x: toLX, y: toLY, z: z, c: c, g: grain))
    out.append(Vtx(x: rx, y: ry, z: z, c: pc, g: grain))
    out.append(Vtx(x: toRX, y: toRY, z: z, c: c, g: grain))
    lx = toLX; ly = toLY; rx = toRX; ry = toRY; pc = c
  }

  private func disc(to out: inout [Vtx]) {
    let c = color(a)
    let n = max(10, min(36, Int(5 + r * 5)))
    let step = 2 * Float.pi / Float(n)
    var px = x + r, py = y
    for i in 1...n {
      let t = step * Float(i)
      let qx = x + r * cos(t), qy = y + r * sin(t)
      out.append(Vtx(x: x, y: y, z: z, c: c, g: grain))
      out.append(Vtx(x: px, y: py, z: z, c: c, g: grain))
      out.append(Vtx(x: qx, y: qy, z: z, c: c, g: grain))
      px = qx; py = qy
    }
  }
}

enum InkMesh {
  /// How far the flat pieces may stray from the true curve, in canvas points.
  private static let tolerance: Float = 0.02

  /// The curve from p1 to p2 (p0 and p3 are its neighbours): a centripetal
  /// Catmull-Rom spline, which never loops or overshoots when points bunch up.
  static func curve(_ p0: InkPoint, _ p1: InkPoint, _ p2: InkPoint, _ p3: InkPoint, ribbon: inout Ribbon, out: inout [Vtx]) {
    let d1 = hypot(p1.x - p0.x, p1.y - p0.y).squareRoot()
    let d2 = hypot(p2.x - p1.x, p2.y - p1.y).squareRoot()
    let d3 = hypot(p3.x - p2.x, p3.y - p2.y).squareRoot()
    if d2 < 0.001 { ribbon.add(p2, to: &out); return }
    var b1x = p1.x, b1y = p1.y, b2x = p2.x, b2y = p2.y
    if d1 > 0.001 {
      let k = 3 * d1 * (d1 + d2), m = 2 * d1 * d1 + 3 * d1 * d2 + d2 * d2
      b1x = (d1 * d1 * p2.x - d2 * d2 * p0.x + m * p1.x) / k
      b1y = (d1 * d1 * p2.y - d2 * d2 * p0.y + m * p1.y) / k
    }
    if d3 > 0.001 {
      let k = 3 * d3 * (d3 + d2), m = 2 * d3 * d3 + 3 * d3 * d2 + d2 * d2
      b2x = (d3 * d3 * p1.x - d2 * d2 * p3.x + m * p2.x) / k
      b2y = (d3 * d3 * p1.y - d2 * d2 * p3.y + m * p2.y) / k
    }
    let bend = max(abs(p1.x - 2 * b1x + b2x) + abs(p1.y - 2 * b1y + b2y), abs(b1x - 2 * b2x + p2.x) + abs(b1y - 2 * b2y + p2.y))
    let n = max(1, min(24, Int((bend * 0.75 / tolerance).squareRoot().rounded(.up))))
    if n > 1 {
      for i in 1..<n {
        let t = Float(i) / Float(n), u = 1 - t
        let w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t
        ribbon.add(InkPoint(x: w0 * p1.x + w1 * b1x + w2 * b2x + w3 * p2.x,
                            y: w0 * p1.y + w1 * b1y + w2 * b2y + w3 * p2.y,
                            r: p1.r + (p2.r - p1.r) * t,
                            a: p1.a + (p2.a - p1.a) * t), to: &out)
      }
    }
    ribbon.add(p2, to: &out)
  }

  /// The curve for segment `s` of a list of points.
  static func segment(_ s: Int, of pts: [InkPoint], ribbon: inout Ribbon, out: inout [Vtx]) {
    curve(pts[max(0, s - 1)], pts[s], pts[s + 1], pts[min(pts.count - 1, s + 2)], ribbon: &ribbon, out: &out)
  }

  static func triangles(_ stroke: InkStroke) -> [Vtx] {
    var out: [Vtx] = []
    out.reserveCapacity(stroke.pts.count * 18 + 120)
    var ribbon = Ribbon(stroke: stroke.rgb, kind: stroke.kind, seq: stroke.seq)
    guard let first = stroke.pts.first else { return out }
    ribbon.add(first, to: &out)
    if stroke.pts.count > 1 {
      for s in 0..<(stroke.pts.count - 1) { segment(s, of: stroke.pts, ribbon: &ribbon, out: &out) }
    }
    ribbon.finish(to: &out)
    return out
  }
}

/// The stroke being written. Everything already settled goes in `stable` and is never
/// rebuilt; `tail` (the last bit plus where the Pencil is heading) is redone each frame.
final class WetInk {
  private(set) var pts: [InkPoint] = []
  let rgb: UInt32
  let kind: InkKind
  let seq: UInt32
  private var ribbon: Ribbon
  private var settled = 0
  private(set) var stable: [Vtx] = []
  private(set) var tail: [Vtx] = []
  private(set) var generation = 0     // bumped when `stable` is thrown away

  init(rgb: UInt32, kind: InkKind, seq: UInt32) {
    self.rgb = rgb
    self.kind = kind
    self.seq = seq
    ribbon = Ribbon(stroke: rgb, kind: kind, seq: seq)
    stable.reserveCapacity(4096)
  }

  /// Replaces the whole line (shape lock).
  func reset(_ points: [InkPoint]) {
    pts = points
    settled = 0
    stable.removeAll(keepingCapacity: true)
    ribbon = Ribbon(stroke: rgb, kind: kind, seq: seq)
    generation += 1
    if let f = pts.first { ribbon.add(f, to: &stable) }
    refresh(ahead: [])
  }

  func append(_ p: InkPoint) {
    pts.append(p)
    if pts.count == 1 { ribbon.add(p, to: &stable) }
  }

  /// Redoes the unsettled end, running on through `ahead` (the live Pencil position and its predictions).
  func refresh(ahead: [InkPoint]) {
    while settled < pts.count - 2 {
      InkMesh.segment(settled, of: pts, ribbon: &ribbon, out: &stable)
      settled += 1
    }
    tail.removeAll(keepingCapacity: true)
    var r = ribbon
    let all = ahead.isEmpty ? pts : pts + ahead
    if all.count > 1 && settled < all.count - 1 {
      for s in settled..<(all.count - 1) { InkMesh.segment(s, of: all, ribbon: &r, out: &tail) }
    }
    r.finish(to: &tail)
  }
}

/// The same ink drawn with Core Graphics: PDFs, thumbnails, and any device without Metal.
enum InkRaster {
  static func cgColor(_ rgb: UInt32, alpha: CGFloat) -> CGColor {
    UIColor(red: CGFloat(rgb & 255) / 255, green: CGFloat(rgb >> 8 & 255) / 255, blue: CGFloat(rgb >> 16 & 255) / 255, alpha: alpha).cgColor
  }

  /// Fills triangles as one shape, so they show no seams and never darken where they overlap.
  static func fill(_ v: [Vtx], rgb: UInt32, alpha: CGFloat, in ctx: CGContext) {
    guard v.count >= 3 else { return }
    ctx.beginPath()
    var i = 0
    while i + 2 < v.count {
      let a = v[i], b = v[i + 1], c = v[i + 2]
      let flip = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0
      let (m, n) = flip ? (c, b) : (b, c)
      ctx.move(to: CGPoint(x: CGFloat(a.x), y: CGFloat(a.y)))
      ctx.addLine(to: CGPoint(x: CGFloat(m.x), y: CGFloat(m.y)))
      ctx.addLine(to: CGPoint(x: CGFloat(n.x), y: CGFloat(n.y)))
      ctx.closePath()
      i += 3
    }
    ctx.setFillColor(cgColor(rgb, alpha: alpha))
    ctx.fillPath(using: .winding)
  }

  static func draw(_ s: InkStroke, in ctx: CGContext) {
    let mean = s.pts.reduce(Float(0)) { $0 + $1.a } / Float(max(1, s.pts.count))
    fill(InkMesh.triangles(s), rgb: s.rgb, alpha: CGFloat(mean), in: ctx)
  }

  /// The ink inside `rect`, drawn with `rect`'s corner at the context's origin.
  static func draw(_ strokes: [InkStroke], rect: CGRect, in ctx: CGContext) {
    ctx.saveGState()
    ctx.clip(to: CGRect(origin: .zero, size: rect.size))
    ctx.translateBy(x: -rect.minX, y: -rect.minY)
    for s in strokes where s.bounds.intersects(rect) { draw(s, in: ctx) }
    ctx.restoreGState()
  }

  /// A clear picture of the ink inside `rect`; nil if there's none there.
  static func image(_ strokes: [InkStroke], rect: CGRect, scale: CGFloat) -> UIImage? {
    guard strokes.contains(where: { $0.bounds.intersects(rect) }) else { return nil }
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = scale
    fmt.opaque = false
    return UIGraphicsImageRenderer(size: rect.size, format: fmt).image { draw(strokes, rect: rect, in: $0.cgContext) }
  }
}
