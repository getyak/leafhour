import SwiftUI
import PhotosUI
import ImageIO
import CryptoKit

/// A device-only preference, namespaced with a one-way owner key. No provider requests occur at runtime.
@MainActor @Observable final class ProfileAvatarStore {
    static let shared = ProfileAvatarStore()
    static let presets = (0..<6).map { "avatar-thumbs-\($0)" } + (0..<3).map { "avatar-shapes-\($0)" }
    private(set) var revision = 0
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let directory: URL
    @ObservationIgnored private var images: [String: UIImage] = [:]
    init(defaults: UserDefaults = .standard, directory: URL? = nil) {
        self.defaults = defaults
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("LeafhourAvatars", isDirectory: true)
    }
    static func ownerKey(_ owner: String) -> String { SHA256.hash(data: Data(owner.utf8)).map { String(format: "%02x", $0) }.joined() }
    static func defaultPreset(_ owner: String) -> String {
        let digest = SHA256.hash(data: Data(owner.utf8))
        return presets[Int(Array(digest).first ?? 0) % 6]
    }
    func choice(_ owner: String) -> String { defaults.string(forKey: "leafhour.avatar." + Self.ownerKey(owner)) ?? Self.defaultPreset(owner) }
    func image(_ owner: String) -> UIImage? {
        _ = revision
        let choice = choice(owner)
        guard choice == "photo" else { return UIImage(named: choice) }
        let key = Self.ownerKey(owner)
        if let image = images[key] { return image }
        let image = UIImage(contentsOfFile: directory.appendingPathComponent(key + ".jpg").path)
        images[key] = image
        return image ?? UIImage(named: Self.defaultPreset(owner))
    }
    func select(_ preset: String, owner: String) {
        guard Self.presets.contains(preset) else { return }
        defaults.set(preset, forKey: "leafhour.avatar." + Self.ownerKey(owner)); revision += 1
    }
    func useDefault(owner: String) {
        defaults.removeObject(forKey: "leafhour.avatar." + Self.ownerKey(owner)); revision += 1
    }
    /// Thumbnail decoding avoids expanding the full photo; drawing to a new bitmap removes EXIF/GPS.
    nonisolated static func photoThumbnail(_ data: Data) throws -> Data {
        guard data.count <= 25 * 1024 * 1024,
              let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 512,
                kCGImageSourceShouldCacheImmediately: true
              ] as CFDictionary) else { throw AvatarError.unreadable }
        let image = UIImage(cgImage: cgImage), side: CGFloat = 384
        let scale = max(side / image.size.width, side / image.size.height)
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
        let thumbnail = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { renderer in
            UIColor.systemBackground.setFill(); renderer.fill(CGRect(x: 0, y: 0, width: side, height: side))
            image.draw(in: CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height))
        }
        guard let jpeg = thumbnail.jpegData(compressionQuality: 0.86) else { throw AvatarError.unreadable }
        return jpeg
    }
    func savePhoto(_ jpeg: Data, owner: String) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let key = Self.ownerKey(owner), url = directory.appendingPathComponent(Self.ownerKey(owner) + ".jpg")
        try jpeg.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        images[key] = UIImage(data: jpeg)
        defaults.set("photo", forKey: "leafhour.avatar." + key); revision += 1
    }
    enum AvatarError: LocalizedError {
        case unreadable
        var errorDescription: String? { "这张照片暂时无法读取。可以换一张不超过 25 MB 的图片，原头像仍保留。" }
    }
}

struct ProfileAvatarView: View {
    let owner: String
    var size: CGFloat = 34
    private var store: ProfileAvatarStore { .shared }
    var body: some View {
        Group {
            if let image = store.image(owner) { Image(uiImage: image).resizable().scaledToFill() }
            else { Image(systemName: "leaf.fill").resizable().scaledToFit().padding(size * 0.25).foregroundStyle(Color.leafInk).background(Color.leafInk.opacity(0.1)) }
        }.frame(width: size, height: size).clipShape(Circle())
            .overlay(Circle().strokeBorder(.primary.opacity(0.08), lineWidth: 0.5))
            .accessibilityHidden(true)
    }
}

struct ProfileAvatarPicker: View {
    let owner: String
    @Environment(\.dismiss) private var dismiss
    @State private var photo: PhotosPickerItem?
    @State private var working = false
    @State private var error: String?
    private var store: ProfileAvatarStore { .shared }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    ProfileAvatarView(owner: owner, size: 104).padding(.top, 16)
                    Text("一个小小的自己").font(.system(.title3, design: .serif))
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 72), spacing: 18)], spacing: 18) {
                        ForEach(Array(ProfileAvatarStore.presets.enumerated()), id: \.element) { index, name in
                            Button { store.select(name, owner: owner); error = nil } label: {
                                Image(name).resizable().scaledToFit().frame(width: 64, height: 64).clipShape(Circle())
                                    .padding(5).overlay(Circle().strokeBorder(store.choice(owner) == name ? Color.leafInk : .clear, lineWidth: 2))
                            }.buttonStyle(.plain).disabled(working).accessibilityLabel("\(index < 6 ? "小伙伴" : "几何")头像 \(index < 6 ? index + 1 : index - 5)")
                                .accessibilityAddTraits(store.choice(owner) == name ? .isSelected : [])
                                .accessibilityIdentifier("avatar-preset-\(index)")
                        }
                    }
                    PhotosPicker(selection: $photo, matching: .images, photoLibrary: .shared()) {
                        Label(working ? "正在准备照片…" : "从照片中选择", systemImage: "photo").frame(maxWidth: .infinity, minHeight: 48)
                    }.buttonStyle(.bordered).disabled(working).accessibilityIdentifier("avatar-photo-picker")
                    Button("恢复默认头像") { store.useDefault(owner: owner); error = nil }.frame(minHeight: 44).disabled(working)
                    if let error { Text(error).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("avatar-error") }
                    Text("头像仅保存在此设备，按书房账号分别保存。选择照片时只读取你选中的图片。")
                        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Text("插画：DiceBear · CC0").font(.caption2).foregroundStyle(.secondary)
                }.padding(24).frame(maxWidth: 460).frame(maxWidth: .infinity)
            }.scrollBounceBehavior(.always, axes: .vertical).background(Color.shelfPaper)
                .navigationTitle("选择头像").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() }.disabled(working) } }
                .interactiveDismissDisabled(working)
                .task(id: photo) {
                    guard let photo else { return }
                    working = true; error = nil
                    defer { working = false }
                    do {
                        guard let data = try await photo.loadTransferable(type: Data.self) else { throw ProfileAvatarStore.AvatarError.unreadable }
                        let jpeg = try await Task.detached(priority: .userInitiated) { try ProfileAvatarStore.photoThumbnail(data) }.value
                        try Task.checkCancellation(); try store.savePhoto(jpeg, owner: owner)
                    } catch is CancellationError { } catch { self.error = error.localizedDescription }
                }
        }.accessibilityIdentifier("avatar-picker")
    }
}
