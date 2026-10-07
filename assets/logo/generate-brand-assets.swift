#!/usr/bin/env swift

// 品牌资产的唯一生成器：本目录的 icon.png（整张应用图标）与 adaptive.png（Android 自适应图标前景）
// 是全部品牌图形的源，两端用到的位图都由这里派生、生成物入库。改了源图跑一次：
//   xcrun swift assets/logo/generate-brand-assets.swift
//
// 派生物：
//   iOS  AppIcon.appiconset（1024，去 alpha——App Store 拒收带透明通道的图标）、
//        app_logo.imageset（关于页 72pt）、brand_mark.imageset（单色模板，着色交给使用处）
//   Android mipmap-*（ic_launcher / ic_launcher_round / ic_launcher_foreground）、
//        drawable-*（ic_brand_logo 72dp、ic_brand_mark 48dp 单色）

import AppKit
import Foundation

private let repository = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
private let logoDirectory = repository.appendingPathComponent("assets/logo")
private let assetCatalog = repository.appendingPathComponent("ios/App/Assets.xcassets")
private let androidResources = repository.appendingPathComponent("android/app/src/main/res")

private let densities: [(suffix: String, scale: CGFloat)] = [
    ("mdpi", 1), ("hdpi", 1.5), ("xhdpi", 2), ("xxhdpi", 3), ("xxxhdpi", 4),
]

private func loadSquare(_ name: String) -> CGImage {
    let url = logoDirectory.appendingPathComponent(name)
    guard let image = NSImage(contentsOf: url)?.cgImage(forProposedRect: nil, context: nil, hints: nil),
          image.width == 1024, image.height == 1024 else {
        fatalError("\(name) must be a readable 1024×1024 image")
    }
    return image
}

private let rgba = CGBitmapInfo.byteOrder32Big.union(CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue))

private func pixels(of image: CGImage) -> [UInt8] {
    var buffer = [UInt8](repeating: 0, count: image.width * image.height * 4)
    buffer.withUnsafeMutableBytes { bytes in
        let context = CGContext(
            data: bytes.baseAddress, width: image.width, height: image.height, bitsPerComponent: 8,
            bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: rgba.rawValue
        )!
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    }
    return buffer
}

private func image(from buffer: [UInt8], side: Int) -> CGImage {
    let provider = CGDataProvider(data: Data(buffer) as CFData)!
    return CGImage(
        width: side, height: side, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: side * 4,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: rgba, provider: provider, decode: nil,
        shouldInterpolate: true, intent: .defaultIntent
    )!
}

/// 单色标记：底色红通道为 0、图形（白与指针浅紫）红通道 ≥ 0.8，按红通道反解抗锯齿覆盖率；
/// 只留覆盖率、颜色恒白，着色交给使用处（iOS 模板渲染 / Android tint / 通知小图标）。
/// 裁到标记自身的方框（表盘外圈），与原生端标记的视口同一取法。
private func monochromeMark(from icon: CGImage) -> CGImage {
    let source = pixels(of: icon)
    var coverage = [CGFloat](repeating: 0, count: 1024 * 1024)
    var minX = 1024, maxX = 0, minY = 1024, maxY = 0
    for index in 0..<(1024 * 1024) {
        let alpha = min(max(CGFloat(source[index * 4]) / 255 / 0.8, 0), 1)
        coverage[index] = alpha
        guard alpha > 0.5 else { continue }
        let x = index % 1024, y = index / 1024
        minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
    }
    let side = max(maxX - minX, maxY - minY) + 1
    var output = [UInt8](repeating: 0, count: side * side * 4)
    for y in 0..<side {
        for x in 0..<side {
            let sx = minX + x, sy = minY + y
            guard sx < 1024, sy < 1024 else { continue }
            let value = UInt8((coverage[sy * 1024 + sx] * 255).rounded())
            let offset = (y * side + x) * 4
            output[offset] = value; output[offset + 1] = value; output[offset + 2] = value; output[offset + 3] = value
        }
    }
    return image(from: output, side: side)
}

private func writePNG(_ source: CGImage, side: Int, opaque: Bool = false, to url: URL) {
    let context = CGContext(
        data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: opaque ? CGImageAlphaInfo.noneSkipLast.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue
    )!
    context.interpolationQuality = .high
    context.draw(source, in: CGRect(x: 0, y: 0, width: side, height: side))
    let rep = NSBitmapImageRep(cgImage: context.makeImage()!)
    try! FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try! rep.representation(using: .png, properties: [:])!.write(to: url, options: .atomic)
}

private func writeImageSet(_ name: String, image source: CGImage, points: Int, template: Bool) {
    let directory = assetCatalog.appendingPathComponent("\(name).imageset")
    try? FileManager.default.removeItem(at: directory)
    var images: [[String: String]] = []
    for scale in 1...3 {
        let file = "\(name)@\(scale)x.png"
        writePNG(source, side: points * scale, to: directory.appendingPathComponent(file))
        images.append(["filename": file, "idiom": "universal", "scale": "\(scale)x"])
    }
    let contents: [String: Any] = [
        "images": images,
        "info": ["author": "xcode", "version": 1],
        "properties": ["template-rendering-intent": template ? "template" : "original"],
    ]
    let data = try! JSONSerialization.data(withJSONObject: contents, options: [.prettyPrinted, .sortedKeys])
    try! data.write(to: directory.appendingPathComponent("Contents.json"))
}

let icon = loadSquare("icon.png")
let adaptiveForeground = loadSquare("adaptive.png")
let mark = monochromeMark(from: icon)

// —— iOS ——
let appIcon = assetCatalog.appendingPathComponent("AppIcon.appiconset")
try? FileManager.default.removeItem(at: appIcon)
writePNG(icon, side: 1024, opaque: true, to: appIcon.appendingPathComponent("AppIcon-1024.png"))
let appIconContents: [String: Any] = [
    "images": [["filename": "AppIcon-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"]],
    "info": ["author": "xcode", "version": 1],
]
try! JSONSerialization.data(withJSONObject: appIconContents, options: [.prettyPrinted, .sortedKeys])
    .write(to: appIcon.appendingPathComponent("Contents.json"))
writeImageSet("app_logo", image: icon, points: 72, template: false)
writeImageSet("brand_mark", image: mark, points: 64, template: true)

// —— Android ——
for density in densities {
    let mipmap = androidResources.appendingPathComponent("mipmap-\(density.suffix)")
    let drawable = androidResources.appendingPathComponent("drawable-\(density.suffix)")
    // 基准尺寸：legacy 图标 48dp、自适应前景 108dp（源图已把图形留在安全区内，原样缩放）。
    writePNG(icon, side: Int(48 * density.scale), to: mipmap.appendingPathComponent("ic_launcher.png"))
    writePNG(icon, side: Int(48 * density.scale), to: mipmap.appendingPathComponent("ic_launcher_round.png"))
    writePNG(adaptiveForeground, side: Int(108 * density.scale), to: mipmap.appendingPathComponent("ic_launcher_foreground.png"))
    writePNG(icon, side: Int(72 * density.scale), to: drawable.appendingPathComponent("ic_brand_logo.png"))
    writePNG(mark, side: Int(48 * density.scale), to: drawable.appendingPathComponent("ic_brand_mark.png"))
}
print("brand assets generated")
