// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "LeafhourCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "LeafhourCore", targets: ["LeafhourCore"])],
    dependencies: [.package(path: "../Vendor/ZIPFoundation")],
    targets: [
        .target(name: "LeafhourCore", dependencies: ["ZIPFoundation"]),
        .testTarget(name: "LeafhourCoreTests", dependencies: ["LeafhourCore", "ZIPFoundation"])
    ]
)
