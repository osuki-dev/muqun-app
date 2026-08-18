import AppKit
import CoreGraphics
import Foundation

private let coral = CGColor(red: 1, green: 90.0 / 255.0, blue: 74.0 / 255.0, alpha: 1)
private let warmWhite = CGColor(red: 252.0 / 255.0, green: 251.0 / 255.0, blue: 250.0 / 255.0, alpha: 1)
private let orbit = CGColor(red: 5.0 / 255.0, green: 11.0 / 255.0, blue: 18.0 / 255.0, alpha: 1)

enum BrandVariant {
  case lightIcon
  case darkIcon
  case foreground
  case monochrome
  case splashLight
  case splashDark
}

func mascotPath(in rect: CGRect) -> CGPath {
  let x = rect.minX
  let y = rect.minY
  let w = rect.width
  let h = rect.height
  let path = CGMutablePath()

  path.move(to: CGPoint(x: x + 0.08 * w, y: y + 0.82 * h))
  path.addLine(to: CGPoint(x: x + 0.08 * w, y: y + 0.38 * h))
  path.addCurve(
    to: CGPoint(x: x + 0.27 * w, y: y + 0.22 * h),
    control1: CGPoint(x: x + 0.08 * w, y: y + 0.28 * h),
    control2: CGPoint(x: x + 0.16 * w, y: y + 0.22 * h)
  )
  path.addLine(to: CGPoint(x: x + 0.27 * w, y: y + 0.09 * h))
  path.addCurve(
    to: CGPoint(x: x + 0.50 * w, y: y + 0.36 * h),
    control1: CGPoint(x: x + 0.27 * w, y: y + 0.05 * h),
    control2: CGPoint(x: x + 0.31 * w, y: y + 0.08 * h)
  )
  path.addCurve(
    to: CGPoint(x: x + 0.92 * w, y: y + 0.40 * h),
    control1: CGPoint(x: x + 0.64 * w, y: y + 0.17 * h),
    control2: CGPoint(x: x + 0.92 * w, y: y + 0.19 * h)
  )
  path.addLine(to: CGPoint(x: x + 0.92 * w, y: y + 0.82 * h))
  path.addCurve(
    to: CGPoint(x: x + 0.85 * w, y: y + 0.89 * h),
    control1: CGPoint(x: x + 0.92 * w, y: y + 0.86 * h),
    control2: CGPoint(x: x + 0.89 * w, y: y + 0.89 * h)
  )
  path.addLine(to: CGPoint(x: x + 0.83 * w, y: y + 0.89 * h))
  path.addLine(to: CGPoint(x: x + 0.83 * w, y: y + 0.95 * h))
  path.addCurve(
    to: CGPoint(x: x + 0.75 * w, y: y + 0.95 * h),
    control1: CGPoint(x: x + 0.83 * w, y: y + 0.98 * h),
    control2: CGPoint(x: x + 0.75 * w, y: y + 0.98 * h)
  )
  path.addLine(to: CGPoint(x: x + 0.75 * w, y: y + 0.89 * h))
  path.addCurve(
    to: CGPoint(x: x + 0.50 * w, y: y + 0.76 * h),
    control1: CGPoint(x: x + 0.62 * w, y: y + 0.89 * h),
    control2: CGPoint(x: x + 0.54 * w, y: y + 0.82 * h)
  )
  path.addCurve(
    to: CGPoint(x: x + 0.25 * w, y: y + 0.89 * h),
    control1: CGPoint(x: x + 0.46 * w, y: y + 0.82 * h),
    control2: CGPoint(x: x + 0.38 * w, y: y + 0.89 * h)
  )
  path.addLine(to: CGPoint(x: x + 0.25 * w, y: y + 0.95 * h))
  path.addCurve(
    to: CGPoint(x: x + 0.17 * w, y: y + 0.95 * h),
    control1: CGPoint(x: x + 0.25 * w, y: y + 0.98 * h),
    control2: CGPoint(x: x + 0.17 * w, y: y + 0.98 * h)
  )
  path.addLine(to: CGPoint(x: x + 0.17 * w, y: y + 0.89 * h))
  path.addLine(to: CGPoint(x: x + 0.15 * w, y: y + 0.89 * h))
  path.addCurve(
    to: CGPoint(x: x + 0.08 * w, y: y + 0.82 * h),
    control1: CGPoint(x: x + 0.11 * w, y: y + 0.89 * h),
    control2: CGPoint(x: x + 0.08 * w, y: y + 0.86 * h)
  )
  path.closeSubpath()
  return path
}

func drawMascot(context: CGContext, rect: CGRect, body: CGColor, face: CGColor) {
  context.setFillColor(body)
  context.addPath(mascotPath(in: rect))
  context.fillPath()

  let eyeSize = rect.width * 0.075
  let eyeY = rect.minY + rect.height * 0.50
  context.setFillColor(face)
  context.fill(CGRect(x: rect.minX + rect.width * 0.28, y: eyeY, width: eyeSize, height: eyeSize))
  context.fill(CGRect(x: rect.minX + rect.width * 0.65, y: eyeY, width: eyeSize, height: eyeSize))

  let cursor = CGMutablePath()
  cursor.move(to: CGPoint(x: rect.minX + rect.width * 0.47, y: rect.minY + rect.height * 0.62))
  cursor.addLine(to: CGPoint(x: rect.minX + rect.width * 0.57, y: rect.minY + rect.height * 0.62))
  cursor.addLine(to: CGPoint(x: rect.minX + rect.width * 0.47, y: rect.minY + rect.height * 0.71))
  cursor.closeSubpath()
  context.addPath(cursor)
  context.fillPath()
}

func render(size: Int, variant: BrandVariant, destination: String) throws {
  guard let context = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: size * 4,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else { throw NSError(domain: "MuqunBrand", code: 1) }

  let full = CGRect(x: 0, y: 0, width: size, height: size)
  context.clear(full)
  context.translateBy(x: 0, y: CGFloat(size))
  context.scaleBy(x: 1, y: -1)

  switch variant {
  case .lightIcon:
    context.setFillColor(warmWhite)
    context.fill(full)
    drawMascot(context: context, rect: full.insetBy(dx: CGFloat(size) * 0.15, dy: CGFloat(size) * 0.13), body: coral, face: orbit)
  case .darkIcon:
    context.setFillColor(orbit)
    context.fill(full)
    drawMascot(context: context, rect: full.insetBy(dx: CGFloat(size) * 0.15, dy: CGFloat(size) * 0.13), body: coral, face: warmWhite)
  case .foreground:
    drawMascot(context: context, rect: full.insetBy(dx: CGFloat(size) * 0.22, dy: CGFloat(size) * 0.20), body: coral, face: orbit)
  case .monochrome:
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.addPath(mascotPath(in: full.insetBy(dx: CGFloat(size) * 0.22, dy: CGFloat(size) * 0.20)))
    context.fillPath()
  case .splashLight:
    drawMascot(context: context, rect: full.insetBy(dx: CGFloat(size) * 0.19, dy: CGFloat(size) * 0.17), body: coral, face: orbit)
  case .splashDark:
    drawMascot(context: context, rect: full.insetBy(dx: CGFloat(size) * 0.19, dy: CGFloat(size) * 0.17), body: coral, face: warmWhite)
  }

  guard let image = context.makeImage() else { throw NSError(domain: "MuqunBrand", code: 2) }
  let bitmap = NSBitmapImageRep(cgImage: image)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw NSError(domain: "MuqunBrand", code: 3)
  }
  try data.write(to: URL(fileURLWithPath: destination))
}

let root = FileManager.default.currentDirectoryPath + "/assets/images"
try render(size: 1024, variant: .lightIcon, destination: root + "/icon.png")
try render(size: 1024, variant: .darkIcon, destination: root + "/icon-dark.png")
try render(size: 1024, variant: .foreground, destination: root + "/android-icon-foreground.png")
try render(size: 1024, variant: .monochrome, destination: root + "/android-icon-monochrome.png")
try render(size: 512, variant: .splashLight, destination: root + "/splash-icon.png")
try render(size: 512, variant: .splashDark, destination: root + "/splash-icon-dark.png")
try render(size: 128, variant: .splashLight, destination: root + "/loading-mark.png")
try render(size: 64, variant: .lightIcon, destination: root + "/favicon.png")
