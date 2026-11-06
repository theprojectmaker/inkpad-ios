// Puts the ink on screen with Metal. Settled ink is kept as a picture of the screen
// so each new frame only adds the stroke being written; a frame goes out as soon as
// the Pencil moves. Sits inside the scroll view, covering just the visible part.
import Metal
import IOSurface
import QuartzCore
import UIKit

private let shaderSource = """
#include <metal_stdlib>
using namespace metal;

struct Vtx { float x; float y; float z; uchar4 c; float g; };
struct View { float4 m; float2 t; float2 s; float2 o; float k; };
struct Out { float4 pos [[position]]; float4 c; float2 page; float g; };

vertex Out inkV(uint id [[vertex_id]], constant Vtx *v [[buffer(0)]], constant View &u [[buffer(1)]]) {
  Vtx a = v[id];
  float2 p = float2(a.x * u.m.x + a.y * u.m.z + u.t.x, a.x * u.m.y + a.y * u.m.w + u.t.y);
  Out o;
  o.pos = float4(p * u.s + u.o, a.z, 1);
  o.c = float4(a.c) / 255.0;
  o.c.a *= u.k;
  o.page = float2(a.x, a.y);
  o.g = a.g;
  return o;
}

static float hash21(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

static float noise(float2 p) {
  float2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + float2(1, 0)), f.x), mix(hash21(i + float2(0, 1)), hash21(i + float2(1, 1)), f.x), f.y);
}

fragment float4 inkF(Out in [[stage_in]]) {
  float a = in.c.a;
  if (in.g > 0.5) {
    float2 q = fmod(in.page, 2048.0);
    // Two grids of small squares at different slants, each square its own strength.
    float2 u = float2(0.82 * q.x - 0.57 * q.y, 0.57 * q.x + 0.82 * q.y) * 1.25;
    float2 v = float2(0.26 * q.x + 0.97 * q.y, 0.97 * q.x - 0.26 * q.y) * 0.95;
    float h1 = hash21(floor(u)), h2 = hash21(floor(v) + 17.0);
    float fleck = max(step(0.42, h1) * (0.45 + 0.55 * h1), step(0.5, h2) * (0.4 + 0.6 * h2));
    a *= fleck * 0.92 + 0.08 * noise(q * 2.6);
  }
  return float4(in.c.rgb * a, a);
}

struct Sheet { float4 pos [[position]]; float2 uv; };

vertex Sheet sheetV(uint id [[vertex_id]]) {
  float2 uv = float2((id << 1) & 2, id & 2);
  Sheet o;
  o.pos = float4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0, 1);
  o.uv = uv;
  return o;
}

fragment float4 sheetF(Sheet in [[stage_in]], texture2d<float> t [[texture(0)]]) {
  constexpr sampler s(filter::nearest, address::clamp_to_edge);
  return t.sample(s, in.uv);
}
"""

private struct ViewUniform {
  var m: SIMD4<Float>
  var t: SIMD2<Float>
  var s: SIMD2<Float>
  var o: SIMD2<Float>
  var k: Float
}

/// Metal, set up once for the whole app. nil if it can't run (the ink then uses Core Graphics).
final class InkGPU {
  static let shared: InkGPU? = {
    let g = InkGPU()
    NSLog("Quill ink engine: %@", g == nil ? "Core Graphics" : "Metal")
    return g
  }()

  let device: MTLDevice
  let queue: MTLCommandQueue
  let ink: MTLRenderPipelineState
  let sheet: MTLRenderPipelineState
  let inkDepth: MTLDepthStencilState
  let noDepth: MTLDepthStencilState
  let samples = 4

  private init?() {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else { return nil }
    self.device = device
    self.queue = queue
    do {
      let lib = try device.makeLibrary(source: shaderSource, options: nil)
      let make = { (v: String, f: String, blend: Bool) throws -> MTLRenderPipelineState in
        let d = MTLRenderPipelineDescriptor()
        d.vertexFunction = lib.makeFunction(name: v)
        d.fragmentFunction = lib.makeFunction(name: f)
        d.rasterSampleCount = 4
        d.depthAttachmentPixelFormat = .depth32Float
        let c = d.colorAttachments[0]!
        c.pixelFormat = .bgra8Unorm
        c.isBlendingEnabled = blend
        c.rgbBlendOperation = .add
        c.alphaBlendOperation = .add
        c.sourceRGBBlendFactor = .one
        c.sourceAlphaBlendFactor = .one
        c.destinationRGBBlendFactor = .oneMinusSourceAlpha
        c.destinationAlphaBlendFactor = .oneMinusSourceAlpha
        return try device.makeRenderPipelineState(descriptor: d)
      }
      ink = try make("inkV", "inkF", true)
      sheet = try make("sheetV", "sheetF", false)
    } catch {
      NSLog("Quill ink shaders failed: %@", String(describing: error))
      return nil
    }
    // Each sample takes a stroke once, so a see-through stroke never darkens where it crosses itself.
    let a = MTLDepthStencilDescriptor()
    a.depthCompareFunction = .greater
    a.isDepthWriteEnabled = true
    let b = MTLDepthStencilDescriptor()
    b.depthCompareFunction = .always
    b.isDepthWriteEnabled = false
    guard let da = device.makeDepthStencilState(descriptor: a), let db = device.makeDepthStencilState(descriptor: b) else { return nil }
    inkDepth = da
    noDepth = db
  }
}

/// Where a stroke's triangles are on the GPU.
struct InkMeshRef {
  let buffer: MTLBuffer
  let offset: Int
  let count: Int
}

/// Hands out room for triangles from big blocks.
private final class MeshArena {
  private let device: MTLDevice
  private var block: MTLBuffer?
  private var used = 0
  private(set) var total = 0
  private let blockSize = 4 << 20

  init(device: MTLDevice) { self.device = device }

  func store(_ v: [Vtx]) -> InkMeshRef? {
    let bytes = v.count * MemoryLayout<Vtx>.stride
    if bytes == 0 { return nil }
    if block == nil || used + bytes > blockSize {
      if bytes > blockSize {
        total += bytes
        return v.withUnsafeBytes { raw in
          device.makeBuffer(bytes: raw.baseAddress!, length: bytes, options: .storageModeShared).map { InkMeshRef(buffer: $0, offset: 0, count: v.count) }
        }
      }
      block = device.makeBuffer(length: blockSize, options: .storageModeShared)
      used = 0
      total += blockSize
    }
    guard let block else { return nil }
    v.withUnsafeBytes { block.contents().advanced(by: used).copyMemory(from: $0.baseAddress!, byteCount: bytes) }
    let ref = InkMeshRef(buffer: block, offset: used, count: v.count)
    used += bytes
    return ref
  }

  func reset() { block = nil; used = 0; total = 0 }
}

/// What the writing is really doing on this iPad, for the on-screen readout.
final class InkStats {
  var on = false
  var frames = 0, skipped = 0, samples = 0, stalls = 0
  var cpu = 0.0, gpu = 0.0, lag = 0.0, worstLag = 0.0
  var lagCount = 0
  var lastMove: TimeInterval = 0
  private var windowStart: TimeInterval = 0

  /// A report once every half second while the Pencil is down.
  func report(now: TimeInterval) -> String? {
    if windowStart == 0 { windowStart = now; return nil }
    let t = now - windowStart
    guard t >= 0.5 else { return nil }
    var model = utsname()
    uname(&model)
    let name = withUnsafeBytes(of: &model.machine) { String(cString: $0.bindMemory(to: CChar.self).baseAddress!) }
    let n = max(1, Double(frames)), l = max(1, Double(lagCount))
    let text = """
    \(name) · \(UIScreen.main.maximumFramesPerSecond) Hz screen
    lag \(Int(lag / l * 1000)) ms (worst \(Int(worstLag * 1000))) · \(Int(Double(frames) / t)) frames/s
    pencil \(Int(Double(samples) / t))/s · app \(String(format: "%.1f", cpu / n * 1000)) ms · GPU \(String(format: "%.1f", gpu / n * 1000)) ms
    held back \(skipped) · stalls \(stalls)
    """
    frames = 0; skipped = 0; samples = 0; stalls = 0
    cpu = 0; gpu = 0; lag = 0; worstLag = 0; lagCount = 0
    windowStart = now
    return text
  }
}

final class InkView: UIView {
  override class var layerClass: AnyClass { InkGPU.shared != nil ? CAMetalLayer.self : CALayer.self }

  let document: InkDocument
  var wet: WetInk?
  var zoom: CGFloat = 1
  var liftedTransform: CGAffineTransform = .identity
  var lifted: [InkStroke] = []
  let stats = InkStats()
  var lastInputTime: TimeInterval = 0

  private let gpu = InkGPU.shared
  private lazy var arena: MeshArena? = gpu.map { MeshArena(device: $0.device) }
  private var settledDirty = true
  private var pendingSettle: [InkStroke] = []
  private var settled: MTLTexture?
  private var spare: MTLTexture?
  private var msaa: MTLTexture?
  private var depth: MTLTexture?
  private var unshown = 0               // frames sent that aren't on screen yet
  private var drewThisRefresh = false
  private var sentAt: CFTimeInterval = 0
  private var lastCommand: MTLCommandBuffer?
  private var framePending = false
  private var frameQueued = false
  private var wetBuffer: MTLBuffer?
  private var wetUploaded = 0
  private var wetGeneration = -1
  private weak var wetOwner: WetInk?
  private var link: CADisplayLink?
  private var fallbackSettled: UIImage?
  var onLinkTick: (() -> Void)?
  private var replay: (cut: Double, from: Double, to: Double)?
  private var laterCount = 0
  weak var mirror: InkView?       // the zoom window shows the same ink
  private var padOrigin: CGPoint?
  private var pageFrameQueued = false
  var paused = false            // pinching: the pages carry a picture of the ink instead
  /// The page is being dragged. The ink is then a finished picture sitting with the pages (a plain
  /// layer, so it moves exactly as they do), bigger than the screen, and replaced as it's scrolled off.
  private(set) var moving = false
  private let plate = CALayer()
  private var plateRect = CGRect.null
  private var plateReady = false       // on screen, in place of the Metal ink
  private var plateBusy = false
  private var plateRun = 0
  private var plateSurfaces: [(texture: MTLTexture, surface: IOSurfaceRef)] = []
  private var plateMSAA: MTLTexture?, plateDepth: MTLTexture?
  private var plateSize = (w: 0, h: 0)
  private var plateNext = 0
  private var onShown: (() -> Void)?   // once the first frame after a pinch reaches the screen

  init(document: InkDocument) {
    self.document = document
    super.init(frame: .zero)
    isOpaque = false
    backgroundColor = .clear
    isUserInteractionEnabled = false
    contentMode = .topLeft
    if let m = layer as? CAMetalLayer, let gpu {
      m.device = gpu.device
      m.pixelFormat = .bgra8Unorm
      m.isOpaque = false
      m.framebufferOnly = true
      m.maximumDrawableCount = 3
      m.colorspace = CGColorSpace(name: CGColorSpace.sRGB)
    }
  }

  required init?(coder: NSCoder) { fatalError() }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { penUp(); plateSurfaces = []; plateSize = (0, 0); plateMSAA = nil; plateDepth = nil } else { matchScreen(); setNeedsInk(rebuild: true) }
  }

  // MARK: - The zoom window

  /// Shows `rect` of the page, filling a view of `size`, instead of following the scroll view.
  func setPad(rect: CGRect, size: CGSize) {
    if bounds.size != size { bounds.size = size; matchScreen() }
    zoom = size.width / max(1, rect.width)
    padOrigin = CGPoint(x: rect.minX * zoom, y: rect.minY * zoom)
    settledDirty = true
    drawNow()
  }

  // MARK: - Replay

  /// While a recording plays, ink written later in it shows faintly and fills in as it plays.
  func setReplay(_ r: (cut: Double, from: Double, to: Double)?) {
    let was = replay != nil
    replay = r
    var n = 0
    if let r { for s in document.strokes where s.ts > r.cut && s.ts >= r.from && s.ts <= r.to { n += 1 } }
    if n != laterCount || was != (r != nil) {
      laterCount = n
      setNeedsInk(rebuild: true)
    }
  }

  private func isLater(_ s: InkStroke) -> Bool {
    guard let r = replay else { return false }
    return s.ts > r.cut && s.ts >= r.from && s.ts <= r.to
  }

  // MARK: - What changed

  /// Ask for a new frame (several asks in one go become one frame).
  func setNeedsInk(rebuild: Bool = false) {
    if rebuild { settledDirty = true }
    if let m = mirror { m.setNeedsInk(rebuild: rebuild) }
    if frameQueued { return }
    frameQueued = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.frameQueued = false
      self.drawNow()
    }
  }

  /// The scroll position or zoom moved: keep up in this very frame.
  func scrolled(to visible: CGRect, zoom z: CGFloat) {
    if moving {
      // Waiting for the first picture: the ink is a subview of the scroll view, so it's riding along already.
      if !plateReady { return }
      if !plateRect.insetBy(dx: 0, dy: visible.height * 0.15).contains(visible) { renderPlate(around: visible, zoom: z) }
    }
    let now = CGRect(x: center.x - bounds.width / 2, y: center.y - bounds.height / 2, width: bounds.width, height: bounds.height)
    if now == visible && zoom == z { return }
    settledDirty = true
    place(visible, z)
    if !paused { queuePageFrame() }
  }

  /// The page has started moving.
  func beginMoving(visible: CGRect, zoom z: CGFloat) {
    guard gpu != nil, !moving else { return }
    moving = true
    renderPlate(around: visible, zoom: z)
  }

  /// The page has stopped. The sharp ink goes back on, and only once it's really on the screen does
  /// the picture go. If they overlap for a frame they're in the same place, so it can't be seen to jump.
  func endMoving() {
    guard moving else { return }
    moving = false
    plateRun += 1
    plateBusy = false
    guard plateReady else { return }
    plateReady = false
    let run = plateRun
    resume { [weak self] in self?.hidePlate(run) }
    // If the iPad never says the frame arrived.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
      guard let self, !self.moving, !self.paused else { return }
      self.reveal()
      self.hidePlate(run)
    }
  }

  /// A pinch has its own pictures on the pages.
  func dropPlate() {
    moving = false
    plateRun += 1
    plateBusy = false
    plateReady = false
    hidePlate(plateRun)
  }

  private func hidePlate(_ run: Int) {
    guard run == plateRun, !moving else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    plate.isHidden = true
    plate.contents = nil
    CATransaction.commit()
  }

  private func makePlateTargets(w: Int, h: Int) -> Bool {
    if plateSize.w == w && plateSize.h == h && plateSurfaces.count == 2 { return true }
    plateSurfaces = []
    guard let gpu else { return false }
    for _ in 0..<2 {
      let props: [String: Any] = [
        kIOSurfaceWidth as String: w, kIOSurfaceHeight as String: h, kIOSurfaceBytesPerElement as String: 4,
        kIOSurfacePixelFormat as String: 0x4247_5241,   // 'BGRA'
      ]
      guard let surface = IOSurfaceCreate(props as CFDictionary) else { plateSurfaces = []; return false }
      let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: w, height: h, mipmapped: false)
      d.usage = [.renderTarget, .shaderRead]
      d.storageMode = .shared
      guard let t = gpu.device.makeTexture(descriptor: d, iosurface: surface, plane: 0) else { plateSurfaces = []; return false }
      plateSurfaces.append((t, surface))
    }
    func extra(_ format: MTLPixelFormat, _ usage: MTLTextureUsage) -> MTLTexture? {
      let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: format, width: w, height: h, mipmapped: false)
      d.textureType = .type2DMultisample
      d.sampleCount = gpu.samples
      d.usage = usage
      d.storageMode = .private
      #if !targetEnvironment(simulator)
      d.storageMode = .memoryless
      #endif
      return gpu.device.makeTexture(descriptor: d)
    }
    plateMSAA = extra(.bgra8Unorm, [.renderTarget])
    plateDepth = extra(.depth32Float, [.renderTarget])
    plateSize = (w, h)
    return plateMSAA != nil && plateDepth != nil
  }

  /// Draws off screen, and only when that's completely finished does the picture appear or change.
  private func renderPlate(around visible: CGRect, zoom z: CGFloat) {
    guard !plateBusy else { return }
    // Without a picture to move, the ink just keeps following the scroll as it's redrawn.
    let giveUp = { [self] in if !plateReady { moving = false } }
    guard let gpu, let cmd = gpu.queue.makeCommandBuffer() else { giveUp(); return }
    let scale = contentScaleFactor
    let wide = ((superview as? UIScrollView)?.contentSize.width ?? 0) > visible.width + 1
    let limit = CGFloat(8192) / scale
    let rect = visible.insetBy(dx: wide ? -min(visible.width * 0.25, (limit - visible.width) / 2) : 0, dy: -min(visible.height * 0.6, (limit - visible.height) / 2))
    guard makePlateTargets(w: Int(rect.width * scale), h: Int(rect.height * scale)), let msaa = plateMSAA, let depth = plateDepth else { giveUp(); return }
    plateBusy = true
    plateNext = (plateNext + 1) % 2
    let target = plateSurfaces[plateNext]
    let run = plateRun
    let view = ViewUniform(m: SIMD4(1, 0, 0, 1), t: SIMD2(0, 0),
                           s: SIMD2(2 * Float(z) / Float(rect.width), -2 * Float(z) / Float(rect.height)),
                           o: SIMD2(-1 - 2 * Float(rect.minX) / Float(rect.width), 1 + 2 * Float(rect.minY) / Float(rect.height)),
                           k: 1)
    let area = CGRect(x: rect.minX / z, y: rect.minY / z, width: rect.width / z, height: rect.height / z)
    let strokes = document.strokes.filter { !$0.lifted && $0.bounds.intersects(area) }
    encode(cmd, msaa, depth, into: target.texture) { enc in
      if self.replay == nil {
        self.drawStrokes(strokes, enc, gpu, view)
      } else {
        self.drawStrokes(strokes.filter { !self.isLater($0) }, enc, gpu, view)
        var faint = view
        faint.k = 0.16
        self.drawStrokes(strokes.filter { self.isLater($0) }, enc, gpu, faint)
      }
      if !self.lifted.isEmpty {
        var moved = view
        let t = self.liftedTransform
        moved.m = SIMD4(Float(t.a), Float(t.b), Float(t.c), Float(t.d))
        moved.t = SIMD2(Float(t.tx), Float(t.ty))
        self.drawStrokes(self.lifted, enc, gpu, moved)
      }
    }
    cmd.addCompletedHandler { [weak self] _ in
      DispatchQueue.main.async {
        guard let self, run == self.plateRun, self.moving else { return }
        self.plateBusy = false
        self.showPlate(target.surface, rect)
      }
    }
    cmd.commit()
  }

  private func showPlate(_ surface: IOSurfaceRef, _ rect: CGRect) {
    if plate.superlayer == nil, let host = layer.superlayer {
      plate.contentsGravity = .resize
      plate.zPosition = layer.zPosition
      host.insertSublayer(plate, below: layer)
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    plate.frame = rect
    plate.contents = surface
    plate.isHidden = false
    CATransaction.commit()
    plateRect = rect
    if !plateReady {
      // The picture's up: now the Metal ink can be cleared. Until then both are there, in the same place.
      plateReady = true
      blank()
    }
  }

  private func place(_ r: CGRect, _ z: CGFloat) {
    UIView.performWithoutAnimation {
      if bounds.size != r.size { bounds.size = r.size; matchScreen() }
      center = CGPoint(x: r.midX, y: r.midY)
    }
    zoom = z
  }

  /// Pinching starts: an empty frame replaces the last one. Hiding the view instead would keep
  /// that frame, and it would flash at the old zoom, small and in the wrong place, on the way back.
  func blank() {
    paused = true
    onShown = nil
    if gpu == nil { isHidden = true; return }
    layer.opacity = Self.unseen
  }

  /// Still on screen as far as the system goes, so frames keep arriving, but too faint to see.
  private static let unseen: Float = 0.001

  /// The sharp ink is really on screen: it shows, in the same screen update as the picture leaving.
  func reveal() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer.opacity = 1
    CATransaction.commit()
  }

  /// Back to drawing the ink, sharp, in the same screen update as the pages.
  func resume(onShown shown: (() -> Void)? = nil) {
    paused = false
    isHidden = false
    onShown = { [weak self] in
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      self?.reveal()
      shown?()
      CATransaction.commit()
    }
    settledDirty = true
    queuePageFrame()
  }

  /// A zoom step changes the scale, the inset and the offset one after another, each
  /// reporting here. Drawing at each one put out frames with half-updated positions, so
  /// the ink is drawn once, just before the screen update that carries the pages.
  private func queuePageFrame() {
    if pageFrameQueued { return }
    pageFrameQueued = true
    let order = 1_000_000   // Core Animation commits at 2,000,000
    let watcher = CFRunLoopObserverCreateWithHandler(nil, CFRunLoopActivity.beforeWaiting.rawValue, false, order) { [weak self] _, _ in
      guard let self else { return }
      self.pageFrameQueued = false
      self.drawNow(withPages: true)
    }
    CFRunLoopAddObserver(CFRunLoopGetMain(), watcher, .commonModes)
  }

  /// A finished stroke joins the settled ink in the same frame the wet one leaves, so nothing flashes.
  func settle(_ strokes: [InkStroke]) {
    pendingSettle.append(contentsOf: strokes)
    mirror?.settle(strokes)
  }

  func penDown() {
    mirror?.penDown()
    guard link == nil else { return }
    let l = CADisplayLink(target: self, selector: #selector(tick))
    l.preferredFrameRateRange = CAFrameRateRange(minimum: 80, maximum: 120, preferred: 120)
    l.add(to: .main, forMode: .common)
    link = l
  }

  func penUp() {
    mirror?.penUp()
    link?.invalidate()
    link = nil
  }

  @objc private func tick() {
    drewThisRefresh = false
    onLinkTick?()
    if framePending { drawNow() }
  }

  // MARK: - Targets

  private func matchScreen() {
    let scale = window?.screen.scale ?? UIScreen.main.scale
    contentScaleFactor = scale
    layer.contentsScale = scale
    let w = Int(bounds.width * scale), h = Int(bounds.height * scale)
    guard let m = layer as? CAMetalLayer, let gpu, w > 0, h > 0 else { return }
    let size = CGSize(width: w, height: h)
    if m.drawableSize != size { m.drawableSize = size }
    if settled?.width == w && settled?.height == h { return }
    let make = { (format: MTLPixelFormat, samples: Int, usage: MTLTextureUsage, memoryless: Bool) -> MTLTexture? in
      let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: format, width: w, height: h, mipmapped: false)
      d.textureType = samples > 1 ? .type2DMultisample : .type2D
      d.sampleCount = samples
      d.usage = usage
      d.storageMode = .private
      #if !targetEnvironment(simulator)
      if memoryless { d.storageMode = .memoryless }
      #endif
      return gpu.device.makeTexture(descriptor: d)
    }
    settled = make(.bgra8Unorm, 1, [.renderTarget, .shaderRead], false)
    spare = make(.bgra8Unorm, 1, [.renderTarget, .shaderRead], false)
    msaa = make(.bgra8Unorm, gpu.samples, [.renderTarget], true)
    depth = make(.depth32Float, gpu.samples, [.renderTarget], true)
    settledDirty = true
  }

  // MARK: - A frame

  /// withPages: goes out in the same screen update as the pages moving under it (scrolling).
  /// Otherwise it goes straight out, the quickest path, for the Pencil.
  func drawNow(withPages: Bool = false, finishing: Bool = false) {
    guard window != nil, bounds.width > 1 else { return }
    if let m = mirror {
      m.wet = wet
      m.lifted = lifted
      m.liftedTransform = liftedTransform
      m.drawNow(finishing: finishing)
    }
    guard let gpu else { drawFallback(); return }
    if paused { return }
    if withPages {
      lastCommand?.waitUntilCompleted()     // ink and pages have to move together
    } else if link != nil && drewThisRefresh && !finishing {
      framePending = true       // one frame per screen refresh; the next refresh picks this up
      return
    } else if unshown >= 2 && CACurrentMediaTime() - sentAt < 0.1 {
      // A frame takes two refreshes to reach the screen, so two may be on their way (one
      // would halve the frame rate). More would put the ink behind the Pencil, and asking
      // for a drawable could stall the main thread.
      framePending = true
      if stats.on { stats.skipped += 1 }
      if link == nil {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
          if self?.framePending == true { self?.drawNow() }
        }
      }
      return
    }
    drewThisRefresh = true
    framePending = false
    let began = CACurrentMediaTime()
    guard let m = layer as? CAMetalLayer, let msaa, let depth, settled != nil else { return }
    if m.presentsWithTransaction != withPages { m.presentsWithTransaction = withPages }
    guard let drawable = m.nextDrawable(), let cmd = gpu.queue.makeCommandBuffer() else {
      // No frame to draw into right now. Without another try the screen would keep showing old ink.
      framePending = true
      if link == nil {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.016) { [weak self] in
          if self?.framePending == true { self?.drawNow() }
        }
      }
      return
    }
    let view = uniform(.identity)
    let shown = paused ? nil : onShown
    if !paused { onShown = nil }

    if paused {
      // Nothing to draw: the frame below comes out empty.
    } else if settledDirty {
      settledDirty = false
      pendingSettle.removeAll()
      encode(cmd, msaa, depth, into: spare!) { enc in
        let all = self.visibleStrokes()
        if self.replay == nil {
          self.drawStrokes(all, enc, gpu, view)
        } else {
          self.drawStrokes(all.filter { !self.isLater($0) }, enc, gpu, view)
          var faint = view
          faint.k = 0.16
          self.drawStrokes(all.filter { self.isLater($0) }, enc, gpu, faint)
        }
      }
      swap(&settled, &spare)
    } else if !pendingSettle.isEmpty {
      let adding = pendingSettle
      pendingSettle.removeAll()
      encode(cmd, msaa, depth, into: spare!) { enc in
        self.drawSheet(enc, gpu)
        self.drawStrokes(adding, enc, gpu, view)
      }
      swap(&settled, &spare)
    }

    encode(cmd, msaa, depth, into: drawable.texture) { enc in
      if self.paused { return }
      self.drawSheet(enc, gpu)
      if !self.lifted.isEmpty { self.drawStrokes(self.lifted, enc, gpu, self.uniform(self.liftedTransform)) }
      if let wet = self.wet { self.drawWet(wet, enc, gpu, view) }
    }

    unshown += 1
    sentAt = CACurrentMediaTime()
    lastCommand = cmd
    #if targetEnvironment(simulator)
    // The simulator can't report when a frame reaches the screen.
    cmd.addCompletedHandler { [weak self] _ in
      DispatchQueue.main.async {
        shown?()
        guard let self else { return }
        self.unshown = max(0, self.unshown - 1)
        if self.framePending { self.drawNow() }
      }
    }
    #else
    let input = wet == nil ? 0 : lastInputTime
    drawable.addPresentedHandler { [weak self] onScreen in
      let at = onScreen.presentedTime
      DispatchQueue.main.async {
        shown?()
        guard let self else { return }
        self.unshown = max(0, self.unshown - 1)
        if self.stats.on && input > 0 && at > 0 {
          self.stats.lag += at - input
          self.stats.lagCount += 1
          self.stats.worstLag = max(self.stats.worstLag, at - input)
        }
        if self.framePending { self.drawNow() }
      }
    }
    #endif
    cmd.addCompletedHandler { [weak self] done in
      if let e = done.error { NSLog("Quill ink frame failed: %@", String(describing: e)) }
      let gpuTime = done.gpuEndTime - done.gpuStartTime
      DispatchQueue.main.async { if self?.stats.on == true { self?.stats.gpu += gpuTime } }
    }
    if stats.on {
      stats.frames += 1
      stats.cpu += CACurrentMediaTime() - began
    }
    if withPages {
      cmd.commit()
      cmd.waitUntilScheduled()
      drawable.present()
    } else {
      cmd.present(drawable)
      cmd.commit()
    }
  }

  private func encode(_ cmd: MTLCommandBuffer, _ msaa: MTLTexture, _ depth: MTLTexture, into target: MTLTexture, _ body: (MTLRenderCommandEncoder) -> Void) {
    let pass = MTLRenderPassDescriptor()
    let c = pass.colorAttachments[0]!
    c.texture = msaa
    c.resolveTexture = target
    c.loadAction = .clear
    c.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    c.storeAction = .multisampleResolve
    pass.depthAttachment.texture = depth
    pass.depthAttachment.loadAction = .clear
    pass.depthAttachment.clearDepth = 0
    pass.depthAttachment.storeAction = .dontCare
    guard let enc = cmd.makeRenderCommandEncoder(descriptor: pass) else { return }
    body(enc)
    enc.endEncoding()
  }

  private func uniform(_ t: CGAffineTransform) -> ViewUniform {
    let w = Float(max(1, bounds.width)), h = Float(max(1, bounds.height))
    let z = Float(zoom)
    let ox = Float(padOrigin?.x ?? (center.x - bounds.width / 2)), oy = Float(padOrigin?.y ?? (center.y - bounds.height / 2))
    return ViewUniform(m: SIMD4(Float(t.a), Float(t.b), Float(t.c), Float(t.d)),
                       t: SIMD2(Float(t.tx), Float(t.ty)),
                       s: SIMD2(2 * z / w, -2 * z / h),
                       o: SIMD2(-1 - 2 * ox / w, 1 + 2 * oy / h),
                       k: 1)
  }

  private func visibleRect() -> CGRect {
    let z = max(0.01, zoom)
    let ox = padOrigin?.x ?? (center.x - bounds.width / 2), oy = padOrigin?.y ?? (center.y - bounds.height / 2)
    return CGRect(x: ox / z, y: oy / z, width: bounds.width / z, height: bounds.height / z)
  }

  private func visibleStrokes() -> [InkStroke] {
    let r = visibleRect()
    return document.strokes.filter { !$0.lifted && $0.bounds.intersects(r) }
  }

  private func drawSheet(_ enc: MTLRenderCommandEncoder, _ gpu: InkGPU) {
    enc.setRenderPipelineState(gpu.sheet)
    enc.setDepthStencilState(gpu.noDepth)
    enc.setFragmentTexture(settled, index: 0)
    enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
  }

  private func drawStrokes(_ strokes: [InkStroke], _ enc: MTLRenderCommandEncoder, _ gpu: InkGPU, _ view: ViewUniform) {
    enc.setRenderPipelineState(gpu.ink)
    enc.setDepthStencilState(gpu.inkDepth)
    var u = view
    enc.setVertexBytes(&u, length: MemoryLayout<ViewUniform>.stride, index: 1)
    if let arena, arena.total > 192 << 20 {
      // Too much kept on the GPU: drop it all, what's on screen comes straight back.
      for s in document.strokes { s.mesh = nil }
      arena.reset()
    }
    let stride = MemoryLayout<Vtx>.stride
    var buffer: MTLBuffer?, start = 0, count = 0
    let flush = {
      guard let buffer, count > 0 else { return }
      enc.setVertexBuffer(buffer, offset: start, index: 0)
      enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: count)
    }
    for s in strokes {
      if s.mesh == nil { s.mesh = arena?.store(InkMesh.triangles(s)) }
      guard let m = s.mesh else { continue }
      if m.buffer === buffer && m.offset == start + count * stride {
        count += m.count   // next to the last one in memory: one draw covers both
      } else {
        flush()
        buffer = m.buffer; start = m.offset; count = m.count
      }
    }
    flush()
  }

  private func drawWet(_ wet: WetInk, _ enc: MTLRenderCommandEncoder, _ gpu: InkGPU, _ view: ViewUniform) {
    enc.setRenderPipelineState(gpu.ink)
    enc.setDepthStencilState(gpu.inkDepth)
    var u = view
    enc.setVertexBytes(&u, length: MemoryLayout<ViewUniform>.stride, index: 1)
    let stride = MemoryLayout<Vtx>.stride
    if wetOwner !== wet || wetGeneration != wet.generation {
      wetOwner = wet
      wetGeneration = wet.generation
      wetBuffer = nil
      wetUploaded = 0
    }
    if wet.stable.count > wetUploaded {
      let need = wet.stable.count * stride
      if wetBuffer == nil || wetBuffer!.length < need {
        guard let bigger = gpu.device.makeBuffer(length: max(1 << 18, need * 2), options: .storageModeShared) else { return }
        if let old = wetBuffer { bigger.contents().copyMemory(from: old.contents(), byteCount: wetUploaded * stride) }
        wetBuffer = bigger
      }
      wet.stable.withUnsafeBytes { raw in
        wetBuffer!.contents().advanced(by: wetUploaded * stride)
          .copyMemory(from: raw.baseAddress!.advanced(by: wetUploaded * stride), byteCount: (wet.stable.count - wetUploaded) * stride)
      }
      wetUploaded = wet.stable.count
    }
    if let wetBuffer, wetUploaded > 0 {
      enc.setVertexBuffer(wetBuffer, offset: 0, index: 0)
      enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: wetUploaded)
    }
    let tail = wet.tail
    if tail.isEmpty { return }
    let bytes = tail.count * stride
    tail.withUnsafeBytes { raw in
      if bytes <= 4096 {
        enc.setVertexBytes(raw.baseAddress!, length: bytes, index: 0)
      } else if let b = gpu.device.makeBuffer(bytes: raw.baseAddress!, length: bytes, options: .storageModeShared) {
        enc.setVertexBuffer(b, offset: 0, index: 0)
      }
    }
    enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: tail.count)
  }

  // MARK: - Without Metal

  private func drawFallback() {
    let rect = visibleRect()
    let z = max(0.01, zoom)
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 1
    fmt.opaque = false
    if settledDirty || !pendingSettle.isEmpty || fallbackSettled == nil {
      settledDirty = false
      pendingSettle.removeAll()
      let strokes = visibleStrokes()
      fallbackSettled = UIGraphicsImageRenderer(size: bounds.size, format: fmt).image { c in
        c.cgContext.scaleBy(x: z, y: z)
        InkRaster.draw(strokes, rect: rect, in: c.cgContext)
      }
    }
    let top = UIGraphicsImageRenderer(size: bounds.size, format: fmt).image { c in
      fallbackSettled?.draw(at: .zero)
      c.cgContext.scaleBy(x: z, y: z)
      c.cgContext.translateBy(x: -rect.minX, y: -rect.minY)
      c.cgContext.saveGState()
      c.cgContext.concatenate(liftedTransform)
      for s in lifted { InkRaster.draw(s, in: c.cgContext) }
      c.cgContext.restoreGState()
      if let wet {
        let alpha = CGFloat(wet.pts.last?.a ?? 1)
        InkRaster.fill(wet.stable, rgb: wet.rgb, alpha: alpha, in: c.cgContext)
        InkRaster.fill(wet.tail, rgb: wet.rgb, alpha: alpha, in: c.cgContext)
      }
    }
    layer.contents = top.cgImage
  }
}
