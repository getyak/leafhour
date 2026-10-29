// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "LeafhourCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "LeafhourCore", targets: ["LeafhourCore"])],
    dependencies: [.package(path: "../Vendor/ZIPFoundation"), .package(path: "../Vendor/swift-cmark")],
    targets: [
        .target(name: "LeafhourCore", dependencies: ["ZIPFoundation", .product(name: "cmark-gfm", package: "swift-cmark"), .product(name: "cmark-gfm-extensions", package: "swift-cmark")]),
        .testTarget(name: "LeafhourCoreTests", dependencies: ["LeafhourCore", "ZIPFoundation"])
    ]
)
